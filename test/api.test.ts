import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { Core } from '../src/core.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { silentLogger } from '../src/log.ts';
import { adressZeile, steckbriefAlsText, type Steckbrief } from '../src/views/steckbrief.ts';
import { httpFor, wabernRoutes } from './helpers/fixtures.ts';

let core: Core;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  process.env.CANARY_TOKEN = 'geheim';
  core = await Core.create({ store: 'memory', http: httpFor(wabernRoutes()), log: silentLogger, breaker: new CircuitBreaker() });
  app = createApp(core);
});
afterAll(async () => {
  await core.close();
});

describe('GET /v1/steckbrief', () => {
  it('liefert Abschnitte, Lücken und Quellen für eine Adresse', async () => {
    const res = await app.request('/v1/steckbrief?adresse=Maygutstrasse%2026,%203084%20Wabern');
    expect(res.status).toBe(200);
    const s = (await res.json()) as Steckbrief;
    expect(s.subject).toBe('egid:1271632');
    expect(s.adresse).toMatchObject({ egid: 1271632, egrid: 'CH586746359755', parzelle: '5711', strasse: 'Maygutstrasse 26', plz: 3084, ort: 'Wabern', gemeinde: 'Köniz', kanton: 'BE' });
    const ids = s.abschnitte.map((a) => a.id);
    expect(ids).toContain('gebaeude');
    expect(ids).toContain('parzelle');
    expect(ids).toContain('solar');
    expect(ids).toContain('wohnung');
    const geb = s.abschnitte.find((a) => a.id === 'gebaeude')!;
    const typ = geb.felder.find((f) => f.key === 'gebaeude.klasse_kurz')!;
    expect(typ.value).toBe('Einfamilienhaus');
    expect(typ.quelle).toBe('gwr');
    expect(typ.daten_vom).toBe('2026-10-12'); // GWR-Exportdatum, getrennt vom Abrufdatum
    expect(typ.abgefragt_am).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((typ as unknown as Record<string, unknown>).stand).toBeUndefined();
    expect(typ.url).toContain('find?layer=ch.bfs.gebaeude_wohnungs_register');
    // Baujahr fehlt im Register: Lücke, kein erfundener Wert
    expect(s.luecken.find((l) => l.key === 'gebaeude.baujahr')).toMatchObject({ grund: 'fehlt_im_register', quelle: 'gwr' });
    // Alle zwölf Adapter sind verifiziert (Lärm und ÖREB seit 15.10.2026, zuständige Stellen, Bahnlärm, Naturgefahren und KGS seit 16.10.2026), darum nirgends das experimentell-Flag
    expect(s.quellen).toHaveLength(12);
    expect(s.quellen.map((q) => q.experimentell)).toEqual(new Array(12).fill(false));
    const idsAlle = s.abschnitte.map((a) => a.id);
    expect(idsAlle).toContain('naturgefahren');
    expect(idsAlle).toContain('ortsbild');
    expect(idsAlle.indexOf('ortsbild')).toBeGreaterThan(idsAlle.indexOf('zone'));
    expect(idsAlle.indexOf('naturgefahren')).toBeGreaterThan(idsAlle.indexOf('laerm'));
    expect(s.abschnitte.find((a) => a.id === 'ortsbild')?.felder.map((f) => [f.key, f.value])).toEqual([['kulturgut.kgs.betroffen', false]]);
    expect(s.attribution.some((a) => a.includes('BFS'))).toBe(true);
    // Stand pro Feld: naturgefahren trägt drei Layer-Stände, darum kein daten_vom am Adapter, nur abgefragt_am; gwr hat einen für alle
    const natur = s.abschnitte.find((a) => a.id === 'naturgefahren')!;
    expect(natur.felder.map((f) => [f.label, f.daten_vom])).toEqual([
      ['Oberflächenabfluss bei Starkregen', '2018-05-22'],
      ['Hochwasser 100-jährlich (Aquaprotect)', '2008-12-18'],
      ['Erdbebenzone (SIA 261)', '2026-04-13'],
    ]);
    const qNatur = s.quellen.find((q) => q.adapter === 'naturgefahren')!;
    expect(qNatur.daten_vom).toBeUndefined();
    expect(qNatur.abgefragt_am).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.quellen.find((q) => q.adapter === 'gwr')).toMatchObject({ daten_vom: '2026-10-12' });
    expect(s.quellen.find((q) => q.adapter === 'radon')?.daten_vom).toBeUndefined();
    expect(s.quellen.every((q) => !('stand' in q))).toBe(true);
    // Text-Ausgabe: Kopf in drei Zeilen, Quellenzeile mit Daten vom und abgefragt, Bool-Felder als betroffen / nicht betroffen
    const text = steckbriefAlsText(s);
    expect(text.split('\n').slice(0, 3)).toEqual(['grundpass · Maygutstrasse 26', '3084 Wabern · Gemeinde Köniz · BE', 'EGID 1271632 · EGRID CH586746359755 · Parzelle 5711']);
    expect(text).toContain('GEBÄUDE');
    expect(text).toContain('Einfamilienhaus');
    expect(text).toMatch(/Gebäudetyp\s+Einfamilienhaus\s+gwr · Daten vom 2026-10-12 · abgefragt \d{4}-\d{2}-\d{2}/);
    expect(text).toMatch(/Radon-Wahrscheinlichkeit\s+\d+ %\s+radon · abgefragt \d{4}-\d{2}-\d{2}\n/);
    expect(text).toMatch(/Oberflächenabfluss bei Starkregen\s+nicht betroffen\s+naturgefahren · Daten vom 2018-05-22/);
    expect(text).toMatch(/KGS-Inventar \(Kulturgüterschutz\)\s+nicht betroffen/);
    expect(text).not.toMatch(/\bnein\b/);
    expect(text).toMatch(/naturgefahren\s+ok\s+\d+ ms  abgefragt \d{4}-\d{2}-\d{2}\n/);
    expect(text).toMatch(/gwr\s+ok\s+\d+ ms  Daten vom 2026-10-12 · abgefragt \d{4}-\d{2}-\d{2}\n/);
    expect(text).toContain('LÜCKEN');
  });

  it('kann auch direkt mit EGID und validiert Eingaben', async () => {
    const ok = await app.request('/v1/steckbrief?egid=1271632');
    expect(ok.status).toBe(200);
    const s = (await ok.json()) as Steckbrief;
    expect(s.quellen.find((q) => q.adapter === 'geocode')?.status).toBe('nicht_anwendbar');
    // Auch ohne geocode steht der Kopf: Strasse, PLZ Ort, Gemeinde und Kanton kommen aus dem GWR
    expect(s.adresse).toMatchObject({ label: 'Maygutstrasse 26', strasse: 'Maygutstrasse 26', plz: 3084, ort: 'Wabern', gemeinde: 'Köniz', kanton: 'BE' });
    expect(steckbriefAlsText(s).split('\n').slice(0, 2)).toEqual(['grundpass · Maygutstrasse 26', '3084 Wabern · Gemeinde Köniz · BE']);
    expect(adressZeile({ plz: 8001, ort: 'Zürich', gemeinde: 'Zürich', kanton: 'ZH' })).toBe('8001 Zürich · Gemeinde Zürich · ZH');
    expect(adressZeile({ ort: 'Wabern', kanton: 'BE' })).toBe('Wabern · BE'); // fehlende Teile fallen weg, kein Platzhalter
    expect(adressZeile({ gemeinde: 'Köniz' })).toBe('Gemeinde Köniz');
    expect(adressZeile({})).toBe('');
    expect((await app.request('/v1/steckbrief?egid=abc')).status).toBe(400);
    expect((await app.request('/v1/steckbrief')).status).toBe(400);
    expect((await app.request('/v1/steckbrief?adresse=x')).status).toBe(400);
  });

  it('zweiter Aufruf kommt aus dem Cache', async () => {
    const res = await app.request('/v1/steckbrief?adresse=Maygutstrasse%2026,%203084%20Wabern');
    const s = (await res.json()) as Steckbrief;
    expect(s.quellen.find((q) => q.adapter === 'gwr')?.status).toBe('cached');
    const fresh = (await (await app.request('/v1/steckbrief?adresse=Maygutstrasse%2026,%203084%20Wabern&nocache=1')).json()) as Steckbrief;
    expect(fresh.quellen.find((q) => q.adapter === 'gwr')?.status).toBe('ok');
  });
});

describe('weitere Endpoints', () => {
  it('/v1/fakten liefert den Stand aus dem Store', async () => {
    const res = await app.request('/v1/fakten?egid=1271632');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { facts: Array<{ key: string }>; runs: unknown[] };
    expect(body.facts.some((f) => f.key === 'parzelle.flaeche_m2')).toBe(true);
    expect(body.runs.length).toBeGreaterThan(0);
    expect((await app.request('/v1/fakten?egid=999999999')).status).toBe(404);
  });

  it('/v1/sources zeigt Manifeste und Plan', async () => {
    const body = (await (await app.request('/v1/sources')).json()) as { adapters: Array<{ id: string; enabled: boolean }>; plan: { stages: string[][] } };
    expect(body.adapters.map((a) => a.id)).toContain('gwr');
    expect(body.plan.stages[0]).toEqual(['geocode']);
  });

  it('/v1/status ist ok ohne offene Breaker', async () => {
    const body = (await (await app.request('/v1/status')).json()) as { zustand: string };
    expect(body.zustand).toBe('ok');
  });

  it('/internal braucht Token', async () => {
    expect((await app.request('/internal/canary', { method: 'POST' })).status).toBe(401);
    const res = await app.request('/internal/adapters/radon/off', { method: 'POST', headers: { authorization: 'Bearer geheim' } });
    expect(await res.json()).toEqual({ id: 'radon', enabled: false });
    const s = (await (await app.request('/v1/steckbrief?egid=1271632&nocache=1')).json()) as Steckbrief;
    expect(s.quellen.find((q) => q.adapter === 'radon')?.status).toBe('disabled');
    await app.request('/internal/adapters/radon/on', { method: 'POST', headers: { authorization: 'Bearer geheim' } });
  });
});
