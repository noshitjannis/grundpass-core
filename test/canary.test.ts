import { describe, expect, it } from 'vitest';
import { runCanary } from '../src/canary/run.ts';
import { Core } from '../src/core.ts';
import { silentLogger } from '../src/log.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { fakeFetch, wabernRoutes } from './helpers/fixtures.ts';
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
