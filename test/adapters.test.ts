import { describe, expect, it } from 'vitest';
import { avParzelle, geocode, gwr, laermStrasse, oevGueteklasse, radon, sonnendach } from '../src/adapters/index.ts';
import { geojsonAreaM2 } from '../src/adapters/av-parzelle.ts';
import { EmptyResultError, SchemaDriftError } from '../src/errors.ts';
import { silentLogger } from '../src/log.ts';
import type { AdapterContext, Keys } from '../src/types.ts';
import { fixture, httpFor, wabernRoutes } from './helpers/fixtures.ts';

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
  const punkt = { e: 2601737, n: 1197338.426 };

  it('summiert die vier Segmente des eigenen Gebäudes, ignoriert Nachbarhaus und -99', async () => {
    const out = await sonnendach.resolve(ctxFor({ lv95_bau: punkt }));
    expect(fact(out, 'solar.segmente')).toBe(4);
    expect(fact(out, 'solar.segmente_vollstaendig')).toBe(true);
    expect(fact(out, 'solar.klasse')).toBe(4);
    expect(fact(out, 'solar.klasse_text')).toBe('sehr gut');
    expect(fact(out, 'solar.stromertrag_kwh_a')).toBe(9625 + 16592 + 6330 + 12003); // 44550, df_nummer 1 bis 4
    expect(fact(out, 'solar.stromertrag_winter_kwh_a')).toBe(3005 + 5132 + 1392 + 2559);
    expect(fact(out, 'solar.dachflaeche_m2')).toBe(Math.round(44.2003953823 + 75.1426060066 + 44.2033316159 + 76.3160940852)); // 240
    expect(fact(out, 'solar.finanzertrag_chf_a')).toBe(Math.round(962.5 + 1659.2 + 633 + 1200.3));
    expect(fact(out, 'solar.waermeertrag_kwh_a')).toBe(6545 + 6529 + 5215 + 5220);
    expect(fact(out, 'solar.einstrahlung_max_kwh_m2a')).toBe(1380);
    expect(fact(out, 'solar.waermebedarf_heizung_kwh_a')).toBe(18154);
    expect(fact(out, 'solar.waermebedarf_warmwasser_kwh_a')).toBe(3600);
    expect(fact(out, 'solar.building_id')).toBe(1131629);
    expect(out.source_date).toBe('2020-04-13');
    // Summen tragen die Umkreis-URL, Gebäudewerte die Punkt-URL
    expect(out.facts.find((f) => f.key === 'solar.dachflaeche_m2')?.request_url).toContain('tolerance=20');
    expect(out.facts.find((f) => f.key === 'solar.waermebedarf_heizung_kwh_a')?.request_url).toContain('tolerance=0');
  });

  it('bestes Segment: bei gleicher Klasse entscheidet die Einstrahlung, nicht die Reihenfolge der API', async () => {
    const out = await sonnendach.resolve(ctxFor({ lv95_bau: punkt }));
    // In der Antwort kommt df_nummer 1 (Klasse 4, 1361 kWh/m²a, 44 m²) vor df_nummer 2 (Klasse 4, 1380 kWh/m²a, 75 m²).
    expect(fact(out, 'solar.bestes_segment.ausrichtung_grad')).toBe(40);
    expect(fact(out, 'solar.bestes_segment.neigung_grad')).toBe(26);
    expect(fact(out, 'solar.bestes_segment.flaeche_m2')).toBe(75);
  });

  it('segmente_vollstaendig ist false, wenn die df_nummer Lücken haben', async () => {
    const wide = fixture('sonnendach-wide.json') as { results: Array<{ attributes: { df_nummer?: number } }> };
    const ohneDf3 = { results: wide.results.filter((r) => r.attributes.df_nummer !== 3) };
    const http = httpFor([
      { match: (u) => u.searchParams.get('tolerance') === '0', body: fixture('sonnendach-point.json') },
      { match: () => true, body: ohneDf3 },
    ]);
    const out = await sonnendach.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'solar.segmente')).toBe(3);
    expect(fact(out, 'solar.segmente_vollstaendig')).toBe(false);
  });

  it('Umkreis-Abfrage fällt aus: nur das Segment unter dem Punkt, sichtbar unvollständig', async () => {
    const http = httpFor([
      { match: (u) => u.searchParams.get('tolerance') === '0', body: fixture('sonnendach-point.json') },
      { match: () => true, body: 'Server kaputt', status: 500 },
    ]);
    const out = await sonnendach.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'solar.segmente')).toBe(1);
    expect(fact(out, 'solar.segmente_vollstaendig')).toBe(false);
    expect(fact(out, 'solar.klasse')).toBe(2); // unter dem Punkt liegt df_nummer 4, Klasse 2
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

describe('laerm-strasse', () => {
  it('liest Lr Tag und Nacht aus features[0].properties.value_0, Confidence 1', async () => {
    const out = await laermStrasse.resolve(ctxFor({ lv95_bau: { e: 2601737, n: 1197338.426 } }));
    expect(fact(out, 'laerm.strasse.tag_db')).toBe(33.2);
    expect(fact(out, 'laerm.strasse.nacht_db')).toBe(24.1);
    expect(out.facts.find((f) => f.key === 'laerm.strasse.tag_db')).toMatchObject({ unit: 'dB', confidence: 1 });
    expect(out.facts.find((f) => f.key === 'laerm.strasse.nacht_db')).toMatchObject({ unit: 'dB', confidence: 1 });
    expect(out.facts.every((f) => f.request_url?.startsWith('https://wms.geo.admin.ch/?'))).toBe(true);
    expect(out.facts.find((f) => f.key === 'laerm.strasse.tag_db')?.request_url).toContain('LAYERS=ch.bafu.laerm-strassenlaerm_tag');
    expect(out.facts.find((f) => f.key === 'laerm.strasse.nacht_db')?.request_url).toContain('LAYERS=ch.bafu.laerm-strassenlaerm_nacht');
    expect(out.facts.some((f) => f.key.endsWith('_roh'))).toBe(false);
    expect(laermStrasse.manifest.status).toBe('verifiziert');
  });

  it('ohne kartierten Strassenlärm (features leer) ist es eine Lücke: EmptyResultError', async () => {
    const http = httpFor([{ match: () => true, body: fixture('laerm-wms-leer.json') }]);
    await expect(
      laermStrasse.resolve({ keys: { lv95_bau: { e: 2646000, n: 1141000 } }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('andere Antwortform (kein value_0) ist Schema-Drift, es wird keine Zahl geraten', async () => {
    const http = httpFor([{ match: () => true, body: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { GRAY_INDEX: 52 } }] } }]);
    await expect(
      laermStrasse.resolve({ keys: { lv95_bau: { e: 1, n: 1 } }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('Text statt JSON ist Schema-Drift, kein "erste Zahl im Text"', async () => {
    const http = httpFor([{ match: () => true, body: "GetFeatureInfo results:\n  ch.bafu.laerm-strassenlaerm_tag.value_0.name = '33.2'" }]);
    await expect(
      laermStrasse.resolve({ keys: { lv95_bau: { e: 1, n: 1 } }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });
});
