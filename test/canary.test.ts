import { describe, expect, it } from 'vitest';
import { runCanary } from '../src/canary/run.ts';
import { runKantonsCanary } from '../src/canary/kantone.ts';
import { geocode, gwr, oereb } from '../src/adapters/index.ts';
import { Core } from '../src/core.ts';
import { silentLogger } from '../src/log.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { fakeFetch, fixture, wabernRoutes } from './helpers/fixtures.ts';
import { createHttpClient } from '../src/http/client.ts';

const adressen = [{ name: 'Wabern', adresse: 'Maygutstrasse 26, 3084 Wabern', kanton: 'BE' }];

describe('canary', () => {
  it('setzt beim ersten Lauf die Baseline, meldet Ausfälle einmal und dedupliziert', async () => {
    const routes = wabernRoutes();
    let radonKaputt = false;
    const fetch = fakeFetch([
      { match: (u) => radonKaputt && u.searchParams.get('layers') === 'all:ch.bag.radonkarte', body: 'kaputt', status: 500 },
      ...routes,
    ]);
    const core = await Core.create({ store: 'memory', http: createHttpClient({ fetch, retries: 0 }), log: silentLogger, breaker: new CircuitBreaker({ threshold: 99 }) });
    const gesendet: string[] = [];
    const sink = async (titel: string) => {
      gesendet.push(titel);
    };

    const r1 = await runCanary(core, { adressen, sink });
    expect(r1.ok).toBe(true);
    expect(r1.adressen[0]?.baseline_neu).toBe(true);
    expect(r1.alarme).toEqual([]);
    expect(gesendet).toEqual([]);
    expect(r1.adapter_gesundheit.gwr).toEqual({ ok: 1, total: 1 });

    radonKaputt = true;
    const r2 = await runCanary(core, { adressen, sink });
    expect(r2.ok).toBe(false);
    expect(r2.alarme.map((a) => [a.adapter, a.art])).toEqual([['radon', 'http']]);
    expect(r2.benachrichtigt).toBe(true);
    expect(gesendet).toHaveLength(1);
    expect(gesendet[0]).toContain('Ausfall bei radon');

    const r3 = await runCanary(core, { adressen, sink });
    expect(r3.benachrichtigt).toBe(false); // gleiche Alarme, keine zweite Nachricht
    expect(gesendet).toHaveLength(1);

    radonKaputt = false;
    const r4 = await runCanary(core, { adressen, sink });
    expect(r4.ok).toBe(true);
    radonKaputt = true;
    const r5 = await runCanary(core, { adressen, sink });
    expect(r5.benachrichtigt).toBe(true); // nach Erholung meldet ein neuer Ausfall wieder
    expect(gesendet).toHaveLength(2);
    expect(await core.store.getSnapshot('canary:last')).toBeTruthy();
    await core.close();
  });

  it('meldet Drift bei stabilen Fakten', async () => {
    const gwrFixture = JSON.parse(JSON.stringify((await import('./helpers/fixtures.ts')).fixture('gwr-1271632.json'))) as { results: Array<{ attributes: Record<string, unknown> }> };
    let parzelle = '5711';
    const fetch = fakeFetch([
      {
        match: (u) => u.searchParams.get('layer') === 'ch.bfs.gebaeude_wohnungs_register',
        get body() {
          const copy = JSON.parse(JSON.stringify(gwrFixture)) as typeof gwrFixture;
          copy.results[0]!.attributes.lparz = parzelle;
          return copy;
        },
      },
      ...wabernRoutes(),
    ]);
    const core = await Core.create({ store: 'memory', http: createHttpClient({ fetch, retries: 0 }), log: silentLogger, breaker: new CircuitBreaker() });
    await runCanary(core, { adressen, sink: async () => {} });
    parzelle = '9999';
    const r = await runCanary(core, { adressen, sink: async () => {} });
    expect(r.adressen[0]?.drift).toEqual([{ key: 'parzelle.nummer', vorher: '5711', nachher: '9999' }]);
    expect(r.alarme.some((a) => a.art === 'drift')).toBe(true);
    expect(r.ok).toBe(true); // Drift ist eine Warnung, kein Ausfall
    await core.close();
  });

  it('baselineErneuern überschreibt die Baseline mit dem aktuellen Stand, ohne Drift-Alarm; danach gilt der neue Stand', async () => {
    const gwrFixture = JSON.parse(JSON.stringify((await import('./helpers/fixtures.ts')).fixture('gwr-1271632.json'))) as { results: Array<{ attributes: Record<string, unknown> }> };
    let parzelle = '5711';
    const fetch = fakeFetch([
      {
        match: (u) => u.searchParams.get('layer') === 'ch.bfs.gebaeude_wohnungs_register',
        get body() {
          const copy = JSON.parse(JSON.stringify(gwrFixture)) as typeof gwrFixture;
          copy.results[0]!.attributes.lparz = parzelle;
          return copy;
        },
      },
      ...wabernRoutes(),
    ]);
    const core = await Core.create({ store: 'memory', http: createHttpClient({ fetch, retries: 0 }), log: silentLogger, breaker: new CircuitBreaker() });
    const sink = async () => {};
    await runCanary(core, { adressen, sink }); // Baseline 5711
    parzelle = '3258';
    const drift = await runCanary(core, { adressen, sink });
    expect(drift.adressen[0]?.drift).toHaveLength(1); // ohne Erneuern meldet jeder Lauf dieselbe Drift

    // Liste mit fremdem Namen: diese Adresse bleibt unberührt, Drift bleibt
    const fremd = await runCanary(core, { adressen, sink, baselineErneuern: ['Gibtsnicht'] });
    expect(fremd.adressen[0]?.baseline_neu).toBe(false);
    expect(fremd.adressen[0]?.drift).toHaveLength(1);

    // Erneuern per Name: Baseline wird 3258, kein Drift-Alarm in diesem Lauf, baseline_neu true
    const neu = await runCanary(core, { adressen, sink, baselineErneuern: ['Wabern'] });
    expect(neu.adressen[0]?.baseline_neu).toBe(true);
    expect(neu.adressen[0]?.drift).toEqual([]);
    expect(neu.alarme.some((a) => a.art === 'drift')).toBe(false);
    expect(neu.baseline_erneuert).toEqual(['Wabern']);
    expect(await core.store.getSnapshot('canary:baseline:Maygutstrasse 26, 3084 Wabern')).toMatchObject({ 'parzelle.nummer': '3258' });

    // Danach ohne Option: keine Drift mehr
    const danach = await runCanary(core, { adressen, sink });
    expect(danach.adressen[0]?.drift).toEqual([]);
    expect(danach.adressen[0]?.baseline_neu).toBe(false);

    // true erneuert alle Adressen
    parzelle = '9999';
    const alle = await runCanary(core, { adressen, sink, baselineErneuern: true });
    expect(alle.adressen[0]?.baseline_neu).toBe(true);
    expect(alle.adressen[0]?.drift).toEqual([]);
    expect(await core.store.getSnapshot('canary:baseline:Maygutstrasse 26, 3084 Wabern')).toMatchObject({ 'parzelle.nummer': '9999' });
    await core.close();
  });
});

describe('kantons-canary', () => {
  const wabern = { name: 'Bern Rathaus', adresse: 'Maygutstrasse 26, 3084 Wabern', kanton: 'BE' };
  const gwrMit = (kanton: string) => {
    const copy = JSON.parse(JSON.stringify((fixture('gwr-1271632.json')))) as { results: Array<{ attributes: Record<string, unknown> }> };
    copy.results[0]!.attributes.gdekt = kanton;
    return copy;
  };
  const coreMit = async (routen: Parameters<typeof fakeFetch>[0]) =>
    Core.create({ store: 'memory', adapters: [geocode, gwr, oereb], http: createHttpClient({ fetch: fakeFetch([...routen, ...wabernRoutes()]), retries: 0 }), log: silentLogger, breaker: new CircuitBreaker({ threshold: 99 }) });

  it('ok, wenn der angebundene Kanton eine Zone liefert: kein Alarm, keine Nachricht, nur drei Adapter im Lauf', async () => {
    const core = await coreMit([]);
    const gesendet: string[] = [];
    const r = await runKantonsCanary(core, { adressen: [wabern], sink: async (t) => void gesendet.push(t) });
    expect(r.ok).toBe(true);
    expect(r.alarme).toEqual([]);
    expect(gesendet).toEqual([]);
    expect(r.kantone[0]).toMatchObject({ kanton: 'BE', erwartet: 'verifiziert', status: 'ok', befund: 'ok', zone: 'Wohnzone (Art. 29 BauR), Bauklasse IIa (Art. 53 BauR)', erkennung: 'subcode' });
    await core.close();
  });

  it('leer bei 204 (EGRID unbekannt), failed bei 500 mit Fehlerart, Nachricht mit Kanton und Befund, Exit über ok', async () => {
    const leer = await coreMit([{ match: (u) => u.hostname === 'www.oereb2.apps.be.ch', body: null, status: 204 }]);
    const gesendet: Array<[string, string, string]> = [];
    const r1 = await runKantonsCanary(leer, { adressen: [wabern], sink: async (t, x, s) => void gesendet.push([t, x, s]) });
    expect(r1.ok).toBe(false);
    expect(r1.kantone[0]).toMatchObject({ befund: 'leer', status: 'failed', error_kind: 'empty' });
    expect(r1.alarme[0]).toMatch(/^BE \(Bern Rathaus\): leer · empty/);
    expect(gesendet[0]?.[2]).toBe('warn');
    await leer.close();

    const kaputt = await coreMit([{ match: (u) => u.hostname === 'www.oereb2.apps.be.ch', body: 'kaputt', status: 500 }]);
    const r2 = await runKantonsCanary(kaputt, { adressen: [wabern], sink: async (t, x, s) => void gesendet.push([t, x, s]) });
    expect(r2.kantone[0]).toMatchObject({ befund: 'failed', error_kind: 'http' });
    expect(r2.alarme[0]).toMatch(/failed · http/);
    expect(gesendet[1]?.[2]).toBe('error');
    expect(gesendet[1]?.[0]).toBe('grundpass Kantone: 1 von 1 mit Befund');
    await kaputt.close();
  });

  it('kein_dienst (NE): Adapter ausser_kanton, Befund kein_dienst, kein Alarm; falscher Kanton und vorgelagerter Ausfall werden gemeldet', async () => {
    const ne = await coreMit([{ match: (u) => u.searchParams.get('layer') === 'ch.bfs.gebaeude_wohnungs_register', body: gwrMit('NE') }]);
    const r1 = await runKantonsCanary(ne, { adressen: [{ ...wabern, kanton: 'NE', name: 'Neuchâtel Hôtel de Ville' }], sink: async () => {} });
    expect(r1.ok).toBe(true);
    expect(r1.kantone[0]).toMatchObject({ befund: 'kein_dienst', status: 'ausser_kanton', erwartet: 'kein_dienst' });
    await ne.close();

    const falsch = await coreMit([]);
    const r2 = await runKantonsCanary(falsch, { adressen: [{ ...wabern, kanton: 'ZH' }], sink: async () => {} });
    expect(r2.kantone[0]).toMatchObject({ befund: 'falscher_kanton', fehler: 'GWR nennt Kanton BE' });
    expect(r2.ok).toBe(false);
    await falsch.close();

    const ohneGwr = await coreMit([{ match: (u) => u.searchParams.get('layer') === 'ch.bfs.gebaeude_wohnungs_register', body: { results: [] } }]);
    const r3 = await runKantonsCanary(ohneGwr, { adressen: [wabern], sink: async () => {} });
    expect(r3.kantone[0]).toMatchObject({ befund: 'vorgelagert', status: 'skipped' });
    expect(r3.kantone[0]?.fehler).toMatch(/^gwr: /);
    expect(r3.alarme[0]).toMatch(/vorgelagert · gwr:/);
    await ohneGwr.close();
  });
});

