import { describe, expect, it } from 'vitest';
import { avParzelle, geocode, gwr, laermStrasse, oevGueteklasse, radon, sonnendach } from '../src/adapters/index.ts';
import { geojsonAreaM2 } from '../src/adapters/av-parzelle.ts';
import { silentLogger } from '../src/log.ts';
import type { AdapterContext, Keys } from '../src/types.ts';
import { httpFor, wabernRoutes } from './helpers/fixtures.ts';

const ctxFor = (keys: Keys): AdapterContext => ({ keys, http: httpFor(wabernRoutes()), now: () => new Date('2026-10-15T10:00:00Z'), log: silentLogger });
const fact = (out: { facts: Array<{ key: string; value: unknown }> }, key: string) => out.facts.find((f) => f.key === key)?.value;

describe('geocode', () => {
  it('liefert EGID und LV95 (y=Ost, x=Nord) aus dem SearchServer', async () => {
    const out = await geocode.resolve(ctxFor({ adresse: 'Maygutstrasse 26, 3084 Wabern' }));
    expect(out.keys?.egid).toBe(1271632);
    expect(out.keys?.lv95).toEqual({ e: 2601733.5, n: 1197341.75 });
    expect(fact(out, 'adresse.label')).toBe('Maygutstrasse 26 3084 Wabern');
    expect(out.facts.every((f) => f.request_url?.includes('SearchServer'))).toBe(true);
  });
});

describe('gwr', () => {
  it('mappt Codes, liefert EGRID, Gebäudepunkt, Parzelle und Wohnungen', async () => {
    const out = await gwr.resolve(ctxFor({ egid: 1271632 }));
    expect(out.keys).toMatchObject({ egrid: 'CH586746359755', bfs_nr: 355, kanton: 'BE', parzelle_nr: '5711', lv95_bau: { e: 2601737.0, n: 1197338.426 } });
    expect(out.source_date).toBe('2026-10-12');
    expect(fact(out, 'gebaeude.klasse_kurz')).toBe('Einfamilienhaus');
    expect(fact(out, 'gebaeude.status')).toBe('bestehend');
    expect(fact(out, 'gebaeude.baujahr')).toBeNull();
    expect(fact(out, 'gebaeude.bauperiode')).toBe('1946 bis 1960');
    expect(fact(out, 'gebaeude.bauperiode_mitte')).toBe(1953);
    expect(fact(out, 'gebaeude.heizung.kurz')).toBe('Ölheizung');
    expect(fact(out, 'gebaeude.heizung.energietraeger')).toBe('Heizöl');
    expect(fact(out, 'gebaeude.grundflaeche_m2')).toBe(139);
    expect(fact(out, 'wohnung.1.zimmer')).toBe(6);
    expect(fact(out, 'wohnung.1.flaeche_m2')).toBe(150);
    expect(fact(out, 'wohnung.1.stockwerk')).toBe('Parterre');
    expect(fact(out, 'wohnung.1.kueche')).toBe(true);
  });

  it('lässt unbekannte Codes als null und reicht den Rohcode durch', async () => {
    const out = await gwr.resolve(ctxFor({ egid: 1271632 }));
    expect(fact(out, 'gebaeude.heizung.erzeuger_code')).toBe(7430);
    expect(fact(out, 'gebaeude.heizung.erzeuger')).toBe('Heizkessel (generisch) für ein Gebäude');
  });
});

describe('av-parzelle', () => {
  it('rechnet die Fläche aus der Geometrie und bevorzugt die bekannte EGRID', async () => {
    const out = await avParzelle.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338 }, egrid: 'CH586746359755' }));
    expect(fact(out, 'parzelle.nummer')).toBe('5711');
    expect(fact(out, 'parzelle.flaeche_m2')).toBe(761);
    expect(out.facts.find((f) => f.key === 'parzelle.flaeche_m2')?.confidence).toBe(0.95);
    expect(out.keys?.kanton).toBe('BE');
  });

  it('geojsonAreaM2 zieht Löcher ab und kann MultiPolygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Array<[number, number]>;
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]] as Array<[number, number]>;
    expect(geojsonAreaM2({ type: 'Polygon', coordinates: [square, hole] })).toBe(96);
    expect(geojsonAreaM2({ type: 'MultiPolygon', coordinates: [[square], [square]] })).toBe(200);
    expect(geojsonAreaM2(null)).toBeNull();
  });
});

describe('sonnendach', () => {
  it('summiert nur die Segmente des eigenen Gebäudes und ignoriert -99', async () => {
    const out = await sonnendach.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338 } }));
    expect(fact(out, 'solar.segmente')).toBe(2);
    expect(fact(out, 'solar.segmente_vollstaendig')).toBe(true);
    expect(fact(out, 'solar.klasse')).toBe(4);
    expect(fact(out, 'solar.klasse_text')).toBe('sehr gut');
    expect(fact(out, 'solar.stromertrag_kwh_a')).toBe(16592 + 9800);
    expect(fact(out, 'solar.dachflaeche_m2')).toBe(Math.round(75.1426060066 + 70.4));
    expect(fact(out, 'solar.waermebedarf_heizung_kwh_a')).toBe(18154);
    expect(out.source_date).toBe('2020-04-13');
  });
});

describe('oev-gueteklasse', () => {
  it('extrahiert den Buchstaben', async () => {
    const out = await oevGueteklasse.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338 } }));
    expect(fact(out, 'oev.gueteklasse')).toBe('D');
    expect(fact(out, 'oev.gueteklasse_text')).toBe('geringe Erschliessung');
  });

  it('ausserhalb aller Polygone ist ein gültiger Wert, kein Fehler', async () => {
    const http = httpFor([{ match: () => true, body: { results: [] } }]);
    const out = await oevGueteklasse.resolve({ keys: { lv95: { e: 1, n: 1 } }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'oev.gueteklasse')).toBe('keine');
  });
});

describe('radon', () => {
  it('liefert Prozent und Einstufung mit tieferer Confidence', async () => {
    const out = await radon.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338 } }));
    expect(fact(out, 'radon.wahrscheinlichkeit_prozent')).toBe(21);
    expect(fact(out, 'radon.einstufung')).toBe('erhöht');
    expect(out.facts.find((f) => f.key === 'radon.einstufung')?.confidence).toBe(0.8);
  });
});

describe('laerm-strasse (experimentell)', () => {
  it('liest Tag und Nacht aus GetFeatureInfo-JSON', async () => {
    const out = await laermStrasse.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338 } }));
    expect(fact(out, 'laerm.strasse.tag_db')).toBe(52);
    expect(fact(out, 'laerm.strasse.nacht_db')).toBe(43);
    expect(laermStrasse.manifest.status).toBe('experimentell');
  });

  it('fällt bei Text-Antwort auf die erste Zahl zurück', async () => {
    const http = httpFor([{ match: () => true, body: 'Lden = 58 dB(A)' }]);
    const out = await laermStrasse.resolve({ keys: { lv95: { e: 1, n: 1 } }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'laerm.strasse.tag_db')).toBe(58);
  });
});
