import { describe, expect, it } from 'vitest';
import { adapters, avParzelle, geocode, gwr, kulturgueter, laermBahn, laermStrasse, naturgefahren, oereb, oevGueteklasse, radon, sonnendach, zustaendigeStellen } from '../src/adapters/index.ts';
import { amtAdresse, parseStufe, themaSlug } from '../src/adapters/oereb.ts';
import { adresseAusZeilen } from '../src/adapters/zustaendige-stellen.ts';
import { geojsonAreaM2, pointInGeometry } from '../src/adapters/av-parzelle.ts';
import { BAHN_HINWEIS } from '../src/adapters/laerm-bahn.ts';
import { KGS_UMKREIS_M, kgsKategorie, kgsNummer } from '../src/adapters/kulturgueter.ts';
import { DATENSTAND, legendeUrl } from '../src/adapters/naturgefahren.ts';
import { parseWmsFeatureInfoText } from '../src/http/geoadmin.ts';
import { FELDER } from '../src/views/felder.ts';
import { buildSteckbrief } from '../src/views/steckbrief.ts';
import { EmptyResultError, SchemaDriftError } from '../src/errors.ts';
import { silentLogger } from '../src/log.ts';
import type { AdapterContext, Keys, RunResult } from '../src/types.ts';
import { fixture, fixtureText, httpFor, wabernRoutes } from './helpers/fixtures.ts';

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

  it('Teilstring-Treffer der API: nimmt die exakte EGID, nicht results[0]', async () => {
    const beide = fixture('gwr-find-teilstring.json') as { results: Array<{ attributes: { egid: string } }> };
    const verdreht = { results: [...beide.results].reverse() }; // Gossau SG (191271632) zuerst
    const http = httpFor([{ match: () => true, body: verdreht }]);
    const out = await gwr.resolve({ keys: { egid: 1271632 }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'adresse.gemeinde')).toBe('Köniz');
    expect(out.keys?.egrid).toBe('CH586746359755');
  });

  it('EGID nicht exakt in der Antwort: Lücke, nie ein anderes Gebäude', async () => {
    const beide = fixture('gwr-find-teilstring.json') as { results: Array<{ attributes: { egid: string } }> };
    const nurGossau = { results: beide.results.filter((r) => r.attributes.egid === '191271632') };
    const http = httpFor([{ match: () => true, body: nurGossau }]);
    await expect(gwr.resolve({ keys: { egid: 1271632 }, http, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('fragt find mit contains=false ab', async () => {
    const calls: string[] = [];
    await gwr.resolve({ keys: { egid: 1271632 }, http: httpFor(wabernRoutes(), calls), now: () => new Date(), log: silentLogger });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('contains=false');
  });
});

describe('av-parzelle', () => {
  const punkt = { e: 2601737, n: 1197338.426 }; // GWR-Gebäudepunkt Wabern, liegt in Parzelle 5711
  const egrid = 'CH586746359755';
  type Route = Parameters<typeof httpFor>[0];
  const ctxMit = (keys: Keys, routes: Route = wabernRoutes(), calls: string[] = []): AdapterContext => ({ keys, http: httpFor(routes, calls), now: () => new Date(), log: silentLogger });

  it('Hauptweg mit EGRID: genau eine find-Anfrage auf egris_egrid, Fakten und Geometrie der Register-Parzelle, Confidence 1', async () => {
    const calls: string[] = [];
    const out = await avParzelle.resolve(ctxMit({ lv95_bau: punkt, egrid }, wabernRoutes(), calls));
    expect(calls).toHaveLength(1); // Punkt liegt in der Parzelle: keine Gegenprobe
    expect(calls[0]).toContain('/find?');
    expect(calls[0]).toContain('layer=ch.swisstopo-vd.amtliche-vermessung');
    expect(calls[0]).toContain('searchField=egris_egrid');
    expect(calls[0]).toContain(`searchText=${egrid}`);
    expect(calls[0]).toContain('contains=false');
    expect(calls[0]).toContain('returnGeometry=true');
    expect(calls[0]).toContain('geometryFormat=geojson');
    expect(fact(out, 'parzelle.nummer')).toBe('5711');
    expect(fact(out, 'parzelle.egrid')).toBe(egrid);
    expect(fact(out, 'parzelle.nummerierungsbereich')).toBe('BE0200000051');
    expect(fact(out, 'parzelle.flaeche_m2')).toBe(764); // Shoelace über das echte 7-Eck: 764.39 m²
    expect(out.facts.find((f) => f.key === 'parzelle.flaeche_m2')?.confidence).toBe(0.95);
    expect(out.facts.find((f) => f.key === 'parzelle.nummer')?.confidence).toBe(1);
    expect(fact(out, 'parzelle.art')).toBeUndefined(); // realestate_type ist null: kein Fakt, kein Default
    expect(fact(out, 'parzelle.hinweis_vermessung')).toBeUndefined();
    expect(fact(out, 'parzelle.treffer_am_punkt')).toBeUndefined();
    expect(out.keys).toMatchObject({ egrid, bfs_nr: 355, kanton: 'BE', parzelle_nr: '5711' });
    expect(out.facts.every((f) => f.request_url === calls[0])).toBe(true);
  });

  it('gibt die Parzellengeometrie als GeoJSON-String (LV95) weiter, Confidence 1, nicht im Feldkatalog', async () => {
    const out = await avParzelle.resolve(ctxFor({ lv95_bau: punkt, egrid }));
    const f = out.facts.find((x) => x.key === 'parzelle.geometrie_geojson');
    expect(f?.confidence).toBe(1);
    const geom = JSON.parse(f?.value as string) as { type: string; coordinates: Array<Array<[number, number]>> };
    expect(geom.type).toBe('Polygon');
    expect(geom.coordinates[0]!.length).toBeGreaterThanOrEqual(7);
    expect(geom.coordinates[0]![0]![0]).toBeGreaterThan(2_600_000); // LV95 Ost
    expect(Math.round(geojsonAreaM2(geom)!)).toBe(764);
    expect(FELDER['parzelle.geometrie_geojson']).toBeUndefined();
  });

  it('Baden, Rütistrasse 1: Gebäudepunkt liegt auf 3827, das Register nennt 3258. find liefert 3258 (395 m²), die Gegenprobe am Punkt benennt den Widerspruch', async () => {
    const gebaeudepunkt = { e: 2665322.862, n: 1258605.675 }; // GWR, EGID 534491
    const calls: string[] = [];
    const routes: Route = [
      { match: (u) => u.pathname.endsWith('/find'), body: fixture('av-parzelle-find-3258.json') },
      { match: (u) => u.pathname.endsWith('/identify'), body: fixture('av-parzelle-3827-punkt.json') },
    ];
    const out = await avParzelle.resolve(ctxMit({ lv95_bau: gebaeudepunkt, egrid: 'CH959983779505', parzelle_nr: '3258', kanton: 'AG' }, routes, calls));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/find?');
    expect(calls[1]).toContain('/identify?');
    expect(calls[1]).toContain('geometry=2665322.862%2C1258605.675');
    expect(fact(out, 'parzelle.nummer')).toBe('3258');
    expect(fact(out, 'parzelle.egrid')).toBe('CH959983779505');
    expect(fact(out, 'parzelle.flaeche_m2')).toBe(395); // Shoelace 394.67 m², Grundbuchfläche laut ÖREB 394
    expect(out.facts.find((f) => f.key === 'parzelle.nummer')?.confidence).toBe(1);
    expect(out.facts.find((f) => f.key === 'parzelle.flaeche_m2')?.confidence).toBe(0.95);
    const geom = JSON.parse(fact(out, 'parzelle.geometrie_geojson') as string) as { coordinates: Array<Array<[number, number]>> };
    expect(geom.coordinates[0]!.length).toBe(43);
    expect(pointInGeometry(gebaeudepunkt, geom)).toBe(false);
    const hinweis = out.facts.find((f) => f.key === 'parzelle.hinweis_vermessung');
    expect(hinweis?.value).toContain('auf Parzelle 3827 (CH189083957747), nicht auf 3258 (CH959983779505)');
    expect(hinweis?.request_url).toBe(calls[1]); // der Hinweis zeigt auf die Punkt-Abfrage, die ihn belegt
    expect(out.keys).toMatchObject({ egrid: 'CH959983779505', bfs_nr: 4021, kanton: 'AG', parzelle_nr: '3258' });
  });

  it('Gegenprobe ohne Hinweis: Punkt ausserhalb der Geometrie, aber identify nennt die Register-Parzelle mit (Grenzfall)', async () => {
    const calls: string[] = [];
    // Punkt ausserhalb des 5711-Polygons; die Fixture-Route für identify liefert trotzdem 5711, wie bei einem Punkt auf der Grenze
    const out = await avParzelle.resolve(ctxMit({ lv95_bau: { e: 2601700, n: 1197300 }, egrid }, wabernRoutes(), calls));
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('/identify?');
    expect(fact(out, 'parzelle.hinweis_vermessung')).toBeUndefined();
    expect(out.facts.find((f) => f.key === 'parzelle.nummer')?.confidence).toBe(1);
  });

  it('ohne EGRID: identify am Gebäudepunkt wie bis Version 2', async () => {
    const calls: string[] = [];
    const out = await avParzelle.resolve(ctxMit({ lv95_bau: punkt }, wabernRoutes(), calls));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/identify?');
    expect(calls[0]).toContain('tolerance=0');
    expect(calls[0]).toContain('geometryFormat=geojson');
    expect(fact(out, 'parzelle.nummer')).toBe('5711');
    expect(fact(out, 'parzelle.flaeche_m2')).toBe(764);
    expect(out.facts.find((f) => f.key === 'parzelle.nummer')?.confidence).toBe(1);
    expect(fact(out, 'parzelle.hinweis_vermessung')).toBeUndefined();
    expect(out.keys).toMatchObject({ egrid, bfs_nr: 355, kanton: 'BE', parzelle_nr: '5711' });
  });

  it('EGRID in der AV unbekannt (find leer): Fallback auf den Punkt, fremde Parzelle mit Confidence 0.8 und Hinweis, keine stille Übernahme', async () => {
    const calls: string[] = [];
    const routes: Route = [
      { match: (u) => u.pathname.endsWith('/find'), body: { results: [] } },
      { match: (u) => u.pathname.endsWith('/identify'), body: fixture('av-parzelle-5711.json') },
    ];
    const out = await avParzelle.resolve(ctxMit({ lv95_bau: punkt, egrid: 'CH000000000000', parzelle_nr: '9999' }, routes, calls));
    expect(calls).toHaveLength(2);
    expect(fact(out, 'parzelle.nummer')).toBe('5711');
    expect(out.facts.find((f) => f.key === 'parzelle.nummer')?.confidence).toBe(0.8);
    expect(out.facts.find((f) => f.key === 'parzelle.flaeche_m2')?.confidence).toBe(0.8);
    expect(out.facts.find((f) => f.key === 'parzelle.geometrie_geojson')?.confidence).toBe(1);
    expect(fact(out, 'parzelle.hinweis_vermessung')).toContain('Parzelle 5711 (CH586746359755), das Gebäuderegister nennt 9999 (CH000000000000)');
  });

  it('EGRID in der AV unbekannt und kein Gebäudepunkt: Lücke, EmptyResultError', async () => {
    const http = httpFor([{ match: () => true, body: { results: [] } }]);
    await expect(
      avParzelle.resolve({ keys: { egrid: 'CH000000000000' }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('Esri-Form (attributes statt properties) ist Schema-Drift, kein stiller Fallback', async () => {
    const http = httpFor([{ match: () => true, body: fixture('av-parzelle-5711-esrijson.json') }]);
    await expect(
      avParzelle.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('keine Parzelle unter dem Punkt ist eine Lücke: EmptyResultError', async () => {
    const http = httpFor([{ match: () => true, body: { results: [] } }]);
    await expect(
      avParzelle.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger }),
    ).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('geojsonAreaM2 zieht Löcher ab und kann MultiPolygon', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Array<[number, number]>;
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]] as Array<[number, number]>;
    expect(geojsonAreaM2({ type: 'Polygon', coordinates: [square, hole] })).toBe(96);
    expect(geojsonAreaM2({ type: 'MultiPolygon', coordinates: [[square], [square]] })).toBe(200);
    expect(geojsonAreaM2(null)).toBeNull();
  });

  it('pointInGeometry: Even-Odd mit Loch und MultiPolygon, unbekannte Form ist null', () => {
    const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]] as Array<[number, number]>;
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]] as Array<[number, number]>;
    const rechts = square.map(([x, y]) => [x + 20, y]) as Array<[number, number]>;
    expect(pointInGeometry({ e: 5, n: 8 }, { type: 'Polygon', coordinates: [square, hole] })).toBe(true);
    expect(pointInGeometry({ e: 3, n: 3 }, { type: 'Polygon', coordinates: [square, hole] })).toBe(false); // im Loch
    expect(pointInGeometry({ e: 11, n: 5 }, { type: 'Polygon', coordinates: [square] })).toBe(false);
    expect(pointInGeometry({ e: 25, n: 5 }, { type: 'MultiPolygon', coordinates: [[square], [rechts]] })).toBe(true);
    expect(pointInGeometry({ e: 15, n: 5 }, { type: 'MultiPolygon', coordinates: [[square], [rechts]] })).toBe(false);
    expect(pointInGeometry({ e: 1, n: 1 }, null)).toBeNull();
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

describe('oereb', () => {
  const httpMit = (datei: string, host: string) => httpFor([{ match: (u) => u.hostname === host, body: fixture(datei) }]);
  const ctx = (datei: string, host: string, keys: Keys): AdapterContext => ({ keys, http: httpMit(datei, host), now: () => new Date('2026-10-15T10:00:00Z'), log: silentLogger });
  const feld = (out: Awaited<ReturnType<typeof oereb.resolve>>, key: string) => out.facts.find((f) => f.key === key);

  it('Manifest: braucht egrid und kanton, gilt für AG, ZH, BE, 14 Tage TTL', () => {
    expect(oereb.manifest.needs).toEqual(['egrid', 'kanton']);
    expect(oereb.manifest.cantons).toEqual(['AG', 'ZH', 'BE']);
    expect(oereb.manifest.ttlDays).toBe(14);
  });

  it('BE Wabern: Grundnutzung per SubCode, Grundbuchfläche 761 m² mit Confidence 1, weitere Themen, Stand aus UpdateDateCS', async () => {
    const out = await oereb.resolve(ctx('oereb-be-wabern.json', 'www.oereb2.apps.be.ch', { egrid: 'CH586746359755', kanton: 'BE' }));
    expect(fact(out, 'zone.bezeichnung')).toBe('Wohnzone (Art. 29 BauR), Bauklasse IIa (Art. 53 BauR)');
    expect(fact(out, 'zone.code')).toBe('102_2');
    expect(fact(out, 'zone.anteil_prozent')).toBe(100);
    expect(fact(out, 'zone.anzahl')).toBe(1);
    expect(feld(out, 'zone.bezeichnung')?.confidence).toBe(1);
    expect(feld(out, 'parzelle.flaeche_grundbuch_m2')).toMatchObject({ value: 761, unit: 'm2', confidence: 1 });
    expect(fact(out, 'zone.baureglement_url')).toBe('https://oerebfiles.apps.be.ch/35501/6862/721.0_Baureglement.pdf');
    expect(fact(out, 'zone.baureglement_titel')).toContain('Baureglement');
    // Köniz führt keine Lärm-Empfindlichkeitsstufe im Kataster: keine Stufe, kein Text, nichts geraten
    expect(fact(out, 'laerm.empfindlichkeitsstufe')).toBeUndefined();
    expect(fact(out, 'laerm.empfindlichkeitsstufe_text')).toBeUndefined();
    expect(fact(out, 'oereb.belastungen_anzahl')).toBe(2);
    expect(fact(out, 'oereb.belastungen')).toBe('Sicherheitszonenplan; Gewässerschutzbereiche (Zusatzinformation nach Art. 8b Abs. 1 Bst. b ÖREBKV)');
    expect(fact(out, 'oereb.sicherheitszonenplan.betroffen')).toBe(true);
    expect(fact(out, 'oereb.sicherheitszonenplan.text')).toBe('Genehmigter Sicherheitszonenperimeter');
    expect(fact(out, 'oereb.gewaesserschutzbereiche.text')).toBe('übriger Bereich üB');
    expect(fact(out, 'oereb.gewaesserschutzbereiche.anteil_prozent')).toBe(100);
    expect(fact(out, 'oereb.aenderungen_hangig_anzahl')).toBeUndefined();
    expect(fact(out, 'oereb.auszug_pdf_url')).toBe('https://www.oereb2.apps.be.ch/extract/pdf?EGRID=CH586746359755');
    expect(fact(out, 'oereb.kataster_url')).toBe('https://www.be.ch/oerebk');
    expect(out.source_date).toBe('2026-10-06');
    expect(out.facts.every((f) => f.request_url === 'https://www.oereb2.apps.be.ch/extract/json?EGRID=CH586746359755')).toBe(true);
  });

  it('AG Baden: ohne SubCode entscheidet die Code-Systematik, Kernzone vor Gestaltungsplan, ES III, Confidence 0.95', async () => {
    const out = await oereb.resolve(ctx('oereb-ag-baden.json', 'api.geo.ag.ch', { egrid: 'CH959983779505', kanton: 'AG' }));
    expect(fact(out, 'zone.bezeichnung')).toBe('Kernzone 5 [K5]');
    expect(fact(out, 'zone.code')).toBe('145101');
    expect(fact(out, 'zone.anzahl')).toBe(1);
    expect(feld(out, 'zone.bezeichnung')?.confidence).toBe(0.95);
    expect(fact(out, 'parzelle.flaeche_grundbuch_m2')).toBe(394);
    expect(fact(out, 'laerm.empfindlichkeitsstufe')).toBe('III');
    expect(fact(out, 'laerm.empfindlichkeitsstufe_text')).toBe('Empfindlichkeitsstufe III');
    expect(fact(out, 'oereb.nutzungsplanung_ueberlagernd.betroffen')).toBe(true);
    expect(fact(out, 'oereb.nutzungsplanung_ueberlagernd.text')).toBe('Gestaltungsplan Innenstadt Nord - Westlich Bahnlinie');
    expect(fact(out, 'oereb.belastungen_anzahl')).toBe(1);
    expect(fact(out, 'zone.baureglement_titel')).toBe('Bau- und Nutzungsordnung');
    expect(fact(out, 'zone.baureglement_url')).toMatch(/^https:\/\/oereblex\.ag\.ch\//);
    expect(fact(out, 'oereb.auszug_pdf_url')).toBe('https://api.geo.ag.ch/v2/oereb/extract/pdf?EGRID=CH959983779505');
  });

  it('ZH Zürich: Hülle «Extract», Theme.code klein, zwei Grundnutzungen nach Anteil, Baulinien als Länge, hängige Änderung gezählt', async () => {
    const out = await oereb.resolve(ctx('oereb-zh-zuerich.json', 'maps.zh.ch', { egrid: 'CH139977917088', kanton: 'ZH' }));
    expect(fact(out, 'zone.bezeichnung')).toBe('siehe gültige Bau- und Zonenordnung der Stadt Zürich (K)');
    expect(fact(out, 'zone.code')).toBe('C130701');
    expect(fact(out, 'zone.anteil_prozent')).toBe(97);
    expect(fact(out, 'zone.anzahl')).toBe(2);
    expect(fact(out, 'zone.weitere.1.bezeichnung')).toBe('siehe gültige Bau- und Zonenordnung der Stadt Zürich (FP)');
    expect(fact(out, 'zone.weitere.1.anteil_prozent')).toBe(3);
    expect(fact(out, 'parzelle.flaeche_grundbuch_m2')).toBe(513);
    expect(fact(out, 'laerm.empfindlichkeitsstufe')).toBe('III');
    expect(fact(out, 'laerm.empfindlichkeitsstufe_anteil_prozent')).toBe(97);
    expect(fact(out, 'oereb.nutzungsplanung_ueberlagernd.text')).toBe('Kernzonenplan');
    expect(fact(out, 'oereb.baulinien.betroffen')).toBe(true);
    expect(fact(out, 'oereb.baulinien.laenge_m')).toBe(34);
    expect(fact(out, 'oereb.baulinien.thema')).toBe('Baulinien (kantonal/kommunal)');
    expect(fact(out, 'oereb.aenderungen_hangig_anzahl')).toBe(1); // Kernzonenplan als changeWithPreEffect
    expect(fact(out, 'oereb.belastungen_anzahl')).toBe(2);
  });

  it('ZH Winterthur: ES II aus dem TypeCode, «keine» wird nicht zur Stufe, belastete Standorte und Gewässerraum mit Anteil', async () => {
    const out = await oereb.resolve(ctx('oereb-zh-winterthur.json', 'maps.zh.ch', { egrid: 'CH427786200879', kanton: 'ZH' }));
    expect(fact(out, 'zone.bezeichnung')).toBe('Zone für öffentliche Bauten (Oe)');
    expect(fact(out, 'zone.anteil_prozent')).toBe(100);
    expect(fact(out, 'zone.weitere.1.bezeichnung')).toBe('Gewässer (Gw)');
    expect(fact(out, 'laerm.empfindlichkeitsstufe')).toBe('II');
    expect(fact(out, 'oereb.belastete_standorte.betroffen')).toBe(true);
    expect(fact(out, 'oereb.belastete_standorte.anteil_prozent')).toBe(1);
    expect(fact(out, 'oereb.gewaesserraum.anteil_prozent')).toBe(8);
    expect(fact(out, 'oereb.nutzungsplanung_ueberlagernd.text')).toContain('Kantonaler Gestaltungsplan allgemein');
    expect(fact(out, 'parzelle.flaeche_grundbuch_m2')).toBe(26087);
  });

  it('Version 2: zuständige Stellen aus ResponsibleOffice und PLRCadastreAuthority, an allen vier Fixtures', async () => {
    expect(oereb.manifest.version).toBe(2);
    const be = await oereb.resolve(ctx('oereb-be-wabern.json', 'www.oereb2.apps.be.ch', { egrid: 'CH586746359755', kanton: 'BE' }));
    expect(fact(be, 'zone.zustaendig')).toBe('Gemeinde Köniz');
    expect(fact(be, 'zone.zustaendig_url')).toBe('https://www.koeniz.ch');
    expect(fact(be, 'laerm.zustaendig')).toBeUndefined(); // Köniz führt keine Lärmstufe im Kataster
    expect(fact(be, 'oereb.sicherheitszonenplan.zustaendig')).toBe('Bundesamt für Zivilluftfahrt BAZL');
    expect(fact(be, 'oereb.sicherheitszonenplan.zustaendig_url')).toBe('https://www.bazl.admin.ch/de');
    expect(fact(be, 'oereb.gewaesserschutzbereiche.zustaendig')).toBe('Amt für Wasser und Abfall des Kantons Bern');
    expect(fact(be, 'oereb.kataster_stelle')).toBe('Amt für Geoinformation');
    expect(fact(be, 'oereb.kataster_adresse')).toBe('Reiterstrasse 11, 3013 Bern');
    expect(fact(be, 'oereb.kataster_url')).toBe('https://www.be.ch/oerebk');

    const ag = await oereb.resolve(ctx('oereb-ag-baden.json', 'api.geo.ag.ch', { egrid: 'CH959983779505', kanton: 'AG' }));
    expect(fact(ag, 'zone.zustaendig')).toBe('Baden');
    expect(fact(ag, 'zone.zustaendig_url')).toBe('https://www.baden.ch');
    expect(fact(ag, 'laerm.zustaendig')).toBe('Baden');
    expect(fact(ag, 'laerm.zustaendig_url')).toBe('https://www.baden.ch');
    expect(fact(ag, 'oereb.kataster_stelle')).toBe('Vermessungsamt');
    expect(fact(ag, 'oereb.kataster_adresse')).toBe('Bahnhofplatz 3c, 5001 Aarau');

    const zh = await oereb.resolve(ctx('oereb-zh-zuerich.json', 'maps.zh.ch', { egrid: 'CH139977917088', kanton: 'ZH' }));
    expect(fact(zh, 'zone.zustaendig')).toBe('Stadt Zürich');
    expect(fact(zh, 'laerm.zustaendig')).toBe('Stadt Zürich');
    expect(fact(zh, 'oereb.baulinien.zustaendig')).toBe('Stadt Zürich');
    expect(fact(zh, 'oereb.kataster_stelle')).toBe('Amt für Raumentwicklung');
    expect(fact(zh, 'oereb.kataster_adresse')).toBe('Stampfenbachstrasse 12, 8090 Zürich'); // Line1/Line2 (Baudirektion) bleiben weg

    const wi = await oereb.resolve(ctx('oereb-zh-winterthur.json', 'maps.zh.ch', { egrid: 'CH807306583219', kanton: 'ZH' }));
    expect(fact(wi, 'zone.zustaendig')).toBe('Stadt Winterthur');
    expect(fact(wi, 'laerm.zustaendig')).toBe('Stadt Winterthur');
    expect(fact(wi, 'oereb.belastete_standorte.zustaendig')).toBe('Amt für Abfall, Wasser, Energie und Luft');
    expect(fact(wi, 'oereb.belastete_standorte.zustaendig_url')).toBe('http://www.altlasten.zh.ch'); // Leerzeichen am Ende der Quelle getrimmt
    // amtAdresse: nur, was da ist
    expect(amtAdresse({ Street: 'Stadthaus', Number: null, PostalCode: '8021', City: 'Zürich' })).toBe('Stadthaus, 8021 Zürich');
    expect(amtAdresse({ City: 'Bern' })).toBe('Bern');
    expect(amtAdresse(undefined)).toBeNull();
  });

  it('204 ohne Inhalt heisst EGRID unbekannt: Lücke (EmptyResultError), kein Ausfall', async () => {
    const http = httpFor([{ match: () => true, body: null, status: 204 }]);
    await expect(oereb.resolve({ keys: { egrid: 'CH586746359755', kanton: 'ZH' }, http, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('HTML oder fremdes JSON ist Schema-Drift', async () => {
    const html = httpFor([{ match: () => true, body: '<!DOCTYPE html><html>Seite nicht gefunden</html>' }]);
    await expect(oereb.resolve({ keys: { egrid: 'CH1', kanton: 'BE' }, http: html, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(SchemaDriftError);
    const fremd = httpFor([{ match: () => true, body: { GetExtractByIdResponse: { Auszug: {} } } }]);
    await expect(oereb.resolve({ keys: { egrid: 'CH1', kanton: 'BE' }, http: fremd, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('Kanton ohne Eintrag in der Tabelle wirft, statt eine fremde Basis zu raten', async () => {
    await expect(oereb.resolve(ctx('oereb-be-wabern.json', 'www.oereb2.apps.be.ch', { egrid: 'CH1', kanton: 'SG' }))).rejects.toThrow(/nicht angeschlossen/);
  });

  it('parseStufe und themaSlug: nur Erkennbares, nichts geraten', () => {
    expect(parseStufe('Empfindlichkeitsstufe III', 'ES_III')).toBe('III');
    expect(parseStufe('Empfindlichkeitsstufe II, aufgestuft (nein)', 'laermempfindlichkeitsstufen_2_0')).toBe('II');
    expect(parseStufe('Empfindlichkeitsstufe keine, aufgestuft (nein)', 'laermempfindlichkeitsstufen_0_0')).toBeNull();
    expect(parseStufe(undefined, 'ES_IV')).toBe('IV');
    expect(parseStufe('Lärmempfindlichkeitsstufe I', undefined)).toBe('I');
    expect(parseStufe('irgendwas', 'xyz')).toBeNull();
    expect(themaSlug('ch.BE.Gewaesserschutzbereiche')).toBe('gewaesserschutzbereiche');
    expect(themaSlug('ch.BelasteteStandorte')).toBe('belastete_standorte');
    expect(themaSlug('ch.ZH.Baulinien')).toBe('baulinien');
    expect(themaSlug('ch.Grundwasserschutzzonen')).toBe('grundwasserschutzzonen');
  });
});

describe('zustaendige-stellen', () => {
  const punkt = { e: 2601737, n: 1197338 };
  const mit = (datei: string, calls: string[] = []): AdapterContext => ({ keys: { lv95_bau: punkt }, http: httpFor([{ match: (u) => u.pathname.endsWith('/identify'), body: fixture(datei) }], calls), now: () => new Date(), log: silentLogger });
  const feld = (out: { facts: Array<{ key: string }> }, key: string) => out.facts.find((f) => f.key === key);

  it('Manifest: braucht den Gebäudepunkt, liefert grundbuch.* und vermessung.geometer_*, 90 Tage', () => {
    expect(zustaendigeStellen.manifest.needs).toEqual(['lv95_bau']);
    expect(zustaendigeStellen.manifest.provides).toEqual(['grundbuch.', 'vermessung.geometer_']);
    expect(zustaendigeStellen.manifest.ttlDays).toBe(90);
  });

  it('Wabern: genau ein Grundbuchkreis mit Kontakt, Geometer ohne Personenname, ein Request auf beide Layer', async () => {
    const calls: string[] = [];
    const out = await zustaendigeStellen.resolve(mit('stellen-wabern.json', calls));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('layers=all%3Ach.swisstopo-vd.geometa-grundbuch%2Cch.swisstopo-vd.geometa-nfgeom');
    expect(calls[0]).toContain('tolerance=0');
    expect(calls[0]).toContain('returnGeometry=false');
    expect(fact(out, 'grundbuch.kreis')).toBe('Bern-Mittelland');
    expect(fact(out, 'grundbuch.ortsteil')).toBe('Köniz');
    expect(fact(out, 'grundbuch.fuehrung')).toBe('eidg. Grundbuch ganz eingeführt');
    expect(fact(out, 'grundbuch.adresse')).toBe('Poststrasse 25, 3071 Ostermundigen');
    expect(fact(out, 'grundbuch.telefon')).toBe('031 635 93 00');
    expect(fact(out, 'grundbuch.email')).toBe('gba.bemi@be.ch');
    expect(fact(out, 'grundbuch.hinweis')).toBeUndefined();
    expect(fact(out, 'grundbuch.kreise_anzahl')).toBeUndefined();
    expect(fact(out, 'vermessung.geometer_firma')).toBe('bbp geomatik ag');
    expect(fact(out, 'vermessung.geometer_adresse')).toBe('Könizstrasse 161, 3097 Liebefeld');
    expect(fact(out, 'vermessung.geometer_telefon')).toBe('031 970 30 50');
    expect(fact(out, 'vermessung.geometer_email')).toBe('bbp@geozen.ch');
    // Der Name des Geometers ist eine Person: taucht in keinem Fakt auf
    expect(out.facts.some((f) => f.key.includes('name') || String(f.value).includes('Tschudi'))).toBe(false);
    expect(out.facts.every((f) => f.request_url === calls[0] && f.confidence === 1)).toBe(true);
    expect(out.keys).toEqual({});
  });

  it('Zürich: 21 Ortsteil-Einträge mit 11 Kreisen plus ein leerer Eintrag: nur Anzahl und Hinweis, kein Telefon, kein erster Treffer', async () => {
    const out = await zustaendigeStellen.resolve(mit('stellen-zuerich.json'));
    expect(fact(out, 'grundbuch.kreise_anzahl')).toBe(11);
    expect(fact(out, 'grundbuch.hinweis')).toBe('Die Gemeinde hat 11 Grundbuchkreise. Die Amtliche Vermessung löst sie nicht räumlich auf, zuständig ist das Grundbuchamt bzw. Notariat des Quartiers.');
    for (const k of ['grundbuch.kreis', 'grundbuch.ortsteil', 'grundbuch.adresse', 'grundbuch.telefon', 'grundbuch.email', 'grundbuch.fuehrung']) expect(feld(out, k), k).toBeUndefined();
    expect(fact(out, 'vermessung.geometer_firma')).toBe('Stadt Zürich, Geomatik + Vermessung');
    expect(fact(out, 'vermessung.geometer_email')).toBe('vermessung@zuerich.ch');
  });

  it('Baden: Ortsteile Baden und Turgi mit demselben Kreis und Kontakt zählen als einer, Ortsteil bleibt offen', async () => {
    const out = await zustaendigeStellen.resolve(mit('stellen-baden.json'));
    expect(fact(out, 'grundbuch.kreis')).toBe('Baden');
    expect(fact(out, 'grundbuch.ortsteil')).toBeUndefined(); // zwei Ortsteile am selben Punkt, der Layer sagt nicht, welcher gilt
    expect(fact(out, 'grundbuch.adresse')).toBe('Bahnhofstrasse 40, 5400 Baden');
    expect(fact(out, 'grundbuch.telefon')).toBe('056 200 09 40');
    expect(fact(out, 'grundbuch.hinweis')).toBeUndefined();
    expect(fact(out, 'vermessung.geometer_firma')).toBe('Steinmann Ingenieure und Planer AG');
  });

  it('nur leere Grundbuch-Einträge: Lücke (EmptyResultError), auch wenn ein Geometer da ist', async () => {
    const z = fixture('stellen-zuerich.json') as { results: Array<{ layerBodId: string; attributes: Record<string, unknown> }> };
    const nurLeer = { results: z.results.filter((r) => r.layerBodId !== 'ch.swisstopo-vd.geometa-grundbuch' || !r.attributes.grundbuchkreis) };
    expect(nurLeer.results.filter((r) => r.layerBodId === 'ch.swisstopo-vd.geometa-grundbuch')).toHaveLength(1);
    const http = httpFor([{ match: () => true, body: nurLeer }]);
    await expect(zustaendigeStellen.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('Geometer: der ordentliche vor dem Stellvertreter', async () => {
    const w = fixture('stellen-wabern.json') as { results: Array<{ layerBodId: string; attributes: Record<string, unknown> }> };
    const geometer = w.results.find((r) => r.layerBodId === 'ch.swisstopo-vd.geometa-nfgeom')!;
    const vertreter = { ...geometer, attributes: { ...geometer.attributes, stellvertreter: true, firmenname: 'Vertretung AG', name: 'Muster Hans' } };
    const body = { results: [...w.results.filter((r) => r !== geometer), vertreter, geometer] };
    const http = httpFor([{ match: () => true, body }]);
    const out = await zustaendigeStellen.resolve({ keys: { lv95_bau: punkt }, http, now: () => new Date(), log: silentLogger });
    expect(fact(out, 'vermessung.geometer_firma')).toBe('bbp geomatik ag');
  });

  it('adresseAusZeilen: # wird Komma, leere Teile fallen weg', () => {
    expect(adresseAusZeilen('Poststrasse 25#3071 Ostermundigen')).toBe('Poststrasse 25, 3071 Ostermundigen');
    expect(adresseAusZeilen('# ')).toBeNull();
    expect(adresseAusZeilen(null)).toBeNull();
    expect(adresseAusZeilen('Weberstrasse 5#8004 Zürich#')).toBe('Weberstrasse 5, 8004 Zürich');
  });
});

describe('laerm-bahn', () => {
  const wabern = { e: 2601737, n: 1197338.426 };
  type Route = Parameters<typeof httpFor>[0];
  const ctxMit = (routes: Route, calls: string[] = []): AdapterContext => ({ keys: { lv95_bau: wabern }, http: httpFor(routes, calls), now: () => new Date(), log: silentLogger });

  it('liest Lr Tag und Nacht aus features[0].properties.value_0 (Wabern 16.4/6.2), Confidence 1, zwei WMS-Anfragen', async () => {
    const calls: string[] = [];
    const out = await laermBahn.resolve(ctxMit(wabernRoutes(), calls));
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('LAYERS=ch.bafu.laerm-bahnlaerm_tag');
    expect(calls[1]).toContain('LAYERS=ch.bafu.laerm-bahnlaerm_nacht');
    expect(calls.every((c) => c.includes('INFO_FORMAT=application%2Fjson'))).toBe(true);
    expect(out.facts.find((f) => f.key === 'laerm.bahn.tag_db')).toMatchObject({ value: 16.4, unit: 'dB', confidence: 1 });
    expect(out.facts.find((f) => f.key === 'laerm.bahn.nacht_db')).toMatchObject({ value: 6.2, unit: 'dB', confidence: 1 });
    expect(fact(out, 'laerm.bahn.hinweis')).toBeUndefined();
    expect(out.facts.map((f) => f.key)).toEqual(['laerm.bahn.tag_db', 'laerm.bahn.nacht_db']);
  });

  it('Zürich-Fixture: 16.6/11.9', async () => {
    const routes: Route = [
      { match: (u) => (u.searchParams.get('LAYERS') ?? '').endsWith('_tag'), body: fixture('laerm-bahn-tag-zuerich.json') },
      { match: (u) => (u.searchParams.get('LAYERS') ?? '').endsWith('_nacht'), body: fixture('laerm-bahn-nacht-zuerich.json') },
    ];
    const out = await laermBahn.resolve(ctxMit(routes));
    expect(fact(out, 'laerm.bahn.tag_db')).toBe(16.6);
    expect(fact(out, 'laerm.bahn.nacht_db')).toBe(11.9);
  });

  it('ohne kartierten Bahnlärm (features leer): kein Wert, kein Default, sondern der Hinweis «keine Bahnlärm-Belastung kartiert»', async () => {
    const out = await laermBahn.resolve(ctxMit([{ match: () => true, body: fixture('laerm-wms-leer.json') }]));
    expect(out.facts.map((f) => f.key)).toEqual(['laerm.bahn.hinweis']);
    expect(fact(out, 'laerm.bahn.hinweis')).toBe(BAHN_HINWEIS);
    expect(out.facts[0]?.request_url).toContain('LAYERS=ch.bafu.laerm-bahnlaerm_tag');
  });

  it('nur ein Pegel kartiert: der andere fehlt mit Hinweis, der vorhandene bleibt', async () => {
    const routes: Route = [
      { match: (u) => (u.searchParams.get('LAYERS') ?? '').endsWith('_tag'), body: fixture('laerm-bahn-tag-wabern.json') },
      { match: () => true, body: fixture('laerm-wms-leer.json') },
    ];
    const out = await laermBahn.resolve(ctxMit(routes));
    expect(fact(out, 'laerm.bahn.tag_db')).toBe(16.4);
    expect(fact(out, 'laerm.bahn.nacht_db')).toBeUndefined();
    expect(fact(out, 'laerm.bahn.hinweis')).toBe(`${BAHN_HINWEIS} (Nacht)`);
  });

  it('der Hinweis wird im Steckbrief zur Lücke von laerm.bahn.tag_db mit dem Text als Grund', () => {
    const run: RunResult = {
      run_id: 'r', subject: 'egid:1', input: { egid: 1 }, keys: { egid: 1 },
      facts: [{ subject: 'egid:1', key: 'laerm.bahn.hinweis', value: BAHN_HINWEIS, source: 'laerm-bahn', fetched_at: '2026-10-16T10:00:00.000Z', confidence: 1, run_id: 'r', request_url: 'https://wms.geo.admin.ch/?x' }],
      adapters: [{ adapter: 'laerm-bahn', status: 'ok', ms: 1, facts_count: 1, stage: 2 }],
      partial: false, started_at: '2026-10-16T10:00:00.000Z', finished_at: '2026-10-16T10:00:01.000Z', ms: 1000,
    };
    const s = buildSteckbrief(run, adapters);
    expect(s.luecken.find((l) => l.key === 'laerm.bahn.tag_db')).toMatchObject({ grund: 'hinweis', detail: BAHN_HINWEIS, quelle: 'laerm-bahn' });
    expect(s.luecken.filter((l) => l.key.startsWith('laerm.bahn.'))).toHaveLength(1); // nacht_db ist nicht erwartet, eine Lücke reicht
    expect(s.abschnitte.find((a) => a.id === 'laerm')).toBeUndefined(); // der Hinweis selbst ist kein Feld
  });

  it('andere Antwortform (kein value_0) ist Schema-Drift', async () => {
    const http = httpFor([{ match: () => true, body: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { GRAY_INDEX: 52 } }] } }]);
    await expect(laermBahn.resolve({ keys: { lv95_bau: wabern }, http, now: () => new Date(), log: silentLogger })).rejects.toBeInstanceOf(SchemaDriftError);
  });
});

describe('naturgefahren', () => {
  const wabern = { e: 2601737, n: 1197338.426 };
  type Route = Parameters<typeof httpFor>[0];
  const ctxMit = (routes: Route, calls: string[] = []): AdapterContext => ({ keys: { lv95_bau: wabern }, http: httpFor(routes, calls), now: () => new Date(), log: silentLogger });
  const zuerichRoutes = (): Route => [
    { match: (u) => u.searchParams.get('LAYERS') === 'ch.bafu.gefaehrdungskarte-oberflaechenabfluss', body: fixtureText('naturgefahren-oberflaechenabfluss-zuerich.json') },
    { match: (u) => u.searchParams.get('LAYERS') === 'ch.bafu.aquaprotect_100', body: fixtureText('naturgefahren-aquaprotect-100-zuerich.json') },
    { match: (u) => u.searchParams.get('LAYERS') === 'ch.bafu.gefahren-gefaehrdungszonen', body: fixtureText('naturgefahren-erdbeben-zuerich.json') },
  ];

  it('Wabern: in keiner Fläche, Erdbebenzone Z1b; drei text/plain-Anfragen am Gebäudepunkt', async () => {
    const calls: string[] = [];
    const out = await naturgefahren.resolve(ctxMit(wabernRoutes(), calls));
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.includes('INFO_FORMAT=text%2Fplain') && c.includes('REQUEST=GetFeatureInfo'))).toBe(true);
    expect(out.facts.map((f) => [f.key, f.value])).toEqual([
      ['naturgefahr.oberflaechenabfluss.betroffen', false],
      ['naturgefahr.hochwasser.aquaprotect_100', false],
      ['naturgefahr.erdbeben.zone', 'Z1b'],
    ]);
    expect(out.facts.every((f) => f.confidence === 1 && f.request_url?.startsWith('https://wms.geo.admin.ch/?'))).toBe(true);
  });

  it('Stand pro Fakt aus dem Datenstand des Layers (geo.admin-Legende), nicht pro Lauf; Manifest Version 2', async () => {
    expect(naturgefahren.manifest).toMatchObject({ id: 'naturgefahren', needs: ['lv95_bau'], provides: ['naturgefahr.'], ttlDays: 365, version: 2 });
    const out = await naturgefahren.resolve(ctxMit(wabernRoutes()));
    expect(out.source_date).toBeUndefined();
    expect(out.facts.map((f) => [f.key, f.source_date])).toEqual([
      ['naturgefahr.oberflaechenabfluss.betroffen', '2018-05-22'],
      ['naturgefahr.hochwasser.aquaprotect_100', '2008-12-18'],
      ['naturgefahr.erdbeben.zone', '2026-04-13'],
    ]);
    expect(DATENSTAND['ch.bafu.aquaprotect_100']).toBe('2008-12-18');
    expect(legendeUrl('ch.bafu.aquaprotect_100')).toBe('https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bafu.aquaprotect_100/legend?lang=de');
  });

  it('Zürich: Oberflächenabfluss und Aquaprotect betroffen (Feature ohne Attribute), Erdbebenzone Z1a', async () => {
    const out = await naturgefahren.resolve(ctxMit(zuerichRoutes()));
    expect(fact(out, 'naturgefahr.oberflaechenabfluss.betroffen')).toBe(true);
    expect(fact(out, 'naturgefahr.hochwasser.aquaprotect_100')).toBe(true);
    expect(fact(out, 'naturgefahr.erdbeben.zone')).toBe('Z1a');
    // Keine Klasse: Der Dienst liefert sie nicht, also wird keine erfunden
    expect(out.facts.some((f) => f.key.includes('klasse') || f.key.includes('code'))).toBe(false);
  });

  it('ohne Erdbebenzonen-Treffer gibt es keinen Zonen-Fakt (Lücke), die Flächen bleiben', async () => {
    const routes: Route = [{ match: () => true, body: 'GetFeatureInfo results:\n\n  Search returned no results.\n' }];
    const out = await naturgefahren.resolve(ctxMit(routes));
    expect(out.facts.map((f) => f.key)).toEqual(['naturgefahr.oberflaechenabfluss.betroffen', 'naturgefahr.hochwasser.aquaprotect_100']);
    expect(FELDER['naturgefahr.erdbeben.zone']?.erwartet).toBe(true);
  });

  it('Erdbebenzonen-Treffer ohne das Attribut ist Schema-Drift, kein Raten', async () => {
    const routes: Route = [
      { match: (u) => u.searchParams.get('LAYERS') === 'ch.bafu.gefahren-gefaehrdungszonen', body: "GetFeatureInfo results:\n\nLayer 'ch.bafu.gefahren-gefaehrdungszonen'\n  Feature 12: \n    zone = 'Z1b'\n" },
      { match: () => true, body: 'GetFeatureInfo results:\n\n  Search returned no results.\n' },
    ];
    await expect(naturgefahren.resolve(ctxMit(routes))).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('HTML oder JSON statt GetFeatureInfo-Text ist Schema-Drift', async () => {
    await expect(naturgefahren.resolve(ctxMit([{ match: () => true, body: '<html>Fehler</html>' }]))).rejects.toBeInstanceOf(SchemaDriftError);
    await expect(naturgefahren.resolve(ctxMit([{ match: () => true, body: { type: 'FeatureCollection', features: [] } }]))).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('parseWmsFeatureInfoText: Layer, Features, Attribute; leere Antwort gibt keine Layer', () => {
    const text = fixtureText('naturgefahren-erdbeben-wabern.json');
    expect(parseWmsFeatureInfoText(text, 'u')).toEqual([{ layer: 'ch.bafu.gefahren-gefaehrdungszonen', features: [{ id: '12', attributes: { Erdbebenzone_SIA_261: 'Z1b' } }] }]);
    expect(parseWmsFeatureInfoText(fixtureText('naturgefahren-oberflaechenabfluss-zuerich.json'), 'u')).toEqual([{ layer: 'ch.bafu.gefaehrdungskarte-oberflaechenabfluss', features: [{ id: '8688', attributes: {} }] }]);
    expect(parseWmsFeatureInfoText(fixtureText('naturgefahren-aquaprotect-100-wabern.json'), 'u')).toEqual([]);
    expect(() => parseWmsFeatureInfoText('irgendwas', 'u')).toThrow(SchemaDriftError);
    expect(() => parseWmsFeatureInfoText("GetFeatureInfo results:\n  Feature 1:\n", 'u')).toThrow(SchemaDriftError);
  });
});

describe('kulturgueter', () => {
  const wabern = { e: 2601737, n: 1197338.426 };
  const zytglogge = { e: 2600698.025, n: 1199652.118 }; // GWR-Gebäudepunkt Bim Zytglogge 3, Bern
  type Route = Parameters<typeof httpFor>[0];
  const ctxMit = (keys: Keys, routes: Route, calls: string[] = []): AdapterContext => ({ keys, http: httpFor(routes, calls), now: () => new Date(), log: silentLogger });

  it('Manifest: braucht den Gebäudepunkt, liefert kulturgut.*, 180 Tage', () => {
    expect(kulturgueter.manifest).toMatchObject({ id: 'kulturgueter', needs: ['lv95_bau'], provides: ['kulturgut.'], ttlDays: 180, version: 1 });
  });

  it('Wabern: kein Kulturgut im Umkreis von 15 m: betroffen false als Fakt, sonst nichts, keine Lücke', async () => {
    const calls: string[] = [];
    const out = await kulturgueter.resolve(ctxMit({ lv95_bau: wabern }, wabernRoutes(), calls));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('layers=all%3Ach.babs.kulturgueter');
    expect(calls[0]).toContain(`tolerance=${KGS_UMKREIS_M}`);
    expect(calls[0]).toContain('returnGeometry=true');
    expect(calls[0]).toContain('imageDisplay=100%2C100%2C96');
    expect(out.facts.map((f) => [f.key, f.value])).toEqual([['kulturgut.kgs.betroffen', false]]);
    const run: RunResult = {
      run_id: 'r', subject: 'egid:1', input: { egid: 1 }, keys: { egid: 1 },
      facts: out.facts.map((f) => ({ ...f, subject: 'egid:1', source: 'kulturgueter', fetched_at: '2026-10-16T10:00:00.000Z', confidence: f.confidence ?? 1, run_id: 'r' })),
      adapters: [{ adapter: 'kulturgueter', status: 'ok', ms: 1, facts_count: 1, stage: 2 }],
      partial: false, started_at: '2026-10-16T10:00:00.000Z', finished_at: '2026-10-16T10:00:01.000Z', ms: 1000,
    };
    const s = buildSteckbrief(run, adapters);
    expect(s.luecken.some((l) => l.key.startsWith('kulturgut.'))).toBe(false);
    expect(s.abschnitte.find((a) => a.id === 'ortsbild')?.felder.map((f) => [f.label, f.value])).toEqual([['KGS-Inventar (Kulturgüterschutz)', false]]);
  });

  it('Zytglogge: nächster Treffer Zeitglockenturm in 1 m, Kategorie A aus A.A, KGS-Nummer 665, das zweite Objekt in 9 m wird gezählt', async () => {
    const out = await kulturgueter.resolve(ctxMit({ lv95_bau: zytglogge }, [{ match: () => true, body: fixture('kulturgueter-zytglogge.json') }]));
    expect(fact(out, 'kulturgut.kgs.betroffen')).toBe(true);
    expect(fact(out, 'kulturgut.kgs.name')).toBe('Zeitglockenturm');
    expect(out.facts.find((f) => f.key === 'kulturgut.kgs.kategorie')).toMatchObject({ value: 'A (national)', confidence: 0.8 });
    expect(fact(out, 'kulturgut.kgs.kategorie_code')).toBe('A.A');
    expect(fact(out, 'kulturgut.kgs.nummer')).toBe(665);
    expect(fact(out, 'kulturgut.kgs.objektart')).toBe('Militärische Anlagen und Wehrbauten,Stadt- und Ortsbefestigungen');
    expect(out.facts.find((f) => f.key === 'kulturgut.kgs.distanz_m')).toMatchObject({ value: 1, unit: 'm', confidence: 0.95 });
    expect(fact(out, 'kulturgut.kgs.weitere_im_umkreis')).toBe(1);
    expect(out.facts.every((f) => f.request_url?.includes('identify'))).toBe(true);
  });

  it('Treffer der API ausserhalb von 15 m werden nicht übernommen (Toleranz ist in Pixeln, die Distanz rechnen wir selbst)', async () => {
    const weitWeg = { e: zytglogge.e + 40, n: zytglogge.n };
    const out = await kulturgueter.resolve(ctxMit({ lv95_bau: weitWeg }, [{ match: () => true, body: fixture('kulturgueter-zytglogge.json') }]));
    expect(out.facts.map((f) => [f.key, f.value])).toEqual([['kulturgut.kgs.betroffen', false]]);
  });

  it('Treffer ohne Punktgeometrie ist Schema-Drift', async () => {
    const ohne = fixture('kulturgueter-zytglogge.json') as { results: Array<Record<string, unknown>> };
    const body = { results: ohne.results.map((r) => ({ ...r, geometry: undefined })) };
    await expect(kulturgueter.resolve(ctxMit({ lv95_bau: zytglogge }, [{ match: () => true, body }]))).rejects.toBeInstanceOf(SchemaDriftError);
  });

  it('kgsKategorie und kgsNummer: nur Eindeutiges', () => {
    expect(kgsKategorie('A.A')).toBe('A (national)');
    expect(kgsKategorie('A')).toBe('A (national)');
    expect(kgsKategorie('B.X')).toBe('B (regional)');
    expect(kgsKategorie('C')).toBeNull();
    expect(kgsKategorie(null)).toBeNull();
    expect(kgsNummer('KGS_NR665')).toBe(665);
    expect(kgsNummer('665')).toBeNull();
    expect(kgsNummer(null)).toBeNull();
  });
});
