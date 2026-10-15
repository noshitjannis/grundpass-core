import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.ts';
import { Core } from '../src/core.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { silentLogger } from '../src/log.ts';
import { steckbriefAlsText, type Steckbrief } from '../src/views/steckbrief.ts';
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
    expect(s.adresse).toMatchObject({ egid: 1271632, egrid: 'CH586746359755', parzelle: '5711', gemeinde: 'Köniz', kanton: 'BE' });
    const ids = s.abschnitte.map((a) => a.id);
    expect(ids).toContain('gebaeude');
    expect(ids).toContain('parzelle');
    expect(ids).toContain('solar');
    expect(ids).toContain('wohnung');
    const geb = s.abschnitte.find((a) => a.id === 'gebaeude')!;
    const typ = geb.felder.find((f) => f.key === 'gebaeude.klasse_kurz')!;
    expect(typ.value).toBe('Einfamilienhaus');
    expect(typ.quelle).toBe('gwr');
    expect(typ.stand).toBe('2026-10-12'); // GWR-Exportdatum, nicht Abrufdatum
    expect(typ.url).toContain('find?layer=ch.bfs.gebaeude_wohnungs_register');
    // Baujahr fehlt im Register: Lücke, kein erfundener Wert
    expect(s.luecken.find((l) => l.key === 'gebaeude.baujahr')).toMatchObject({ grund: 'fehlt_im_register', quelle: 'gwr' });
    expect(s.quellen.find((q) => q.adapter === 'laerm-strasse')?.experimentell).toBe(true);
    expect(s.attribution.some((a) => a.includes('BFS'))).toBe(true);
    // Text-Ausgabe läuft durch
    const text = steckbriefAlsText(s);
    expect(text).toContain('GEBÄUDE');
    expect(text).toContain('Einfamilienhaus');
    expect(text).toContain('LÜCKEN');
  });

  it('kann auch direkt mit EGID und validiert Eingaben', async () => {
    const ok = await app.request('/v1/steckbrief?egid=1271632');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Steckbrief).quellen.find((q) => q.adapter === 'geocode')?.status).toBe('nicht_anwendbar');
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
