import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { geoJsonResultsSchema, identifyUrl, nullableNumberish, nullableString } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Amtliche Vermessung, Liegenschaft (Parzelle) unter dem Gebäudepunkt.
 * Layer `ch.swisstopo-vd.amtliche-vermessung`, identify mit tolerance=0, returnGeometry=true und geometryFormat=geojson.
 *
 * Verifiziert 15.10.2026 mit der echten Antwort (Fixture av-parzelle-5711.json): Mit geometryFormat=geojson ist jeder
 * Treffer ein GeoJSON-Feature, die Attribute stehen in `properties` (nicht `attributes`), die Geometrie ist ein
 * GeoJSON-Polygon. Die erste Fassung las `attributes` und fiel live mit Schema-Drift aus.
 * properties: bfsnr 355, ak "BE", number "5711", identnd "BE0200000051", egris_egrid "CH586746359755",
 * realestate_type null, geoportal_url (kantonales Geoportal). Geometrie: 7 Stützpunkte, Shoelace 764.39 m².
 * Eine Fläche liefert die API nicht. Darum rechnen wir sie selbst (Shoelace in LV95-Metern, Löcher abgezogen).
 */
const attrs = z.object({
  bfsnr: nullableNumberish,
  ak: nullableString,
  number: nullableString,
  identnd: nullableString,
  egris_egrid: nullableString,
  realestate_type: nullableString,
  geoportal_url: nullableString,
});

type Ring = Array<[number, number]>;

function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    s += xj * yi - xi * yj;
  }
  return Math.abs(s) / 2;
}

/** Fläche eines GeoJSON-Polygons oder MultiPolygons in projizierten Metern. Löcher werden abgezogen. */
export function geojsonAreaM2(geom: unknown): number | null {
  if (!geom || typeof geom !== 'object') return null;
  const g = geom as { type?: string; coordinates?: unknown };
  const polyArea = (rings: Ring[]) => rings.reduce((acc, r, i) => acc + (i === 0 ? 1 : -1) * ringArea(r), 0);
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return polyArea(g.coordinates as Ring[]);
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
    return (g.coordinates as Ring[][]).reduce((acc, p) => acc + polyArea(p), 0);
  }
  // Esri-JSON: { rings: [...] }
  const e = geom as { rings?: Ring[] };
  if (Array.isArray(e.rings)) return polyArea(e.rings);
  return null;
}

export const avParzelle: Adapter = {
  manifest: {
    id: 'av-parzelle',
    title: 'Amtliche Vermessung: Parzelle',
    provider: 'swisstopo / Kantone',
    needs: ['lv95_bau'],
    yields: ['egrid', 'bfs_nr', 'kanton', 'parzelle_nr'],
    provides: ['parzelle.'],
    ttlDays: 90,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© swisstopo, Kantone (amtliche Vermessung)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:ch.swisstopo-vd.amtliche-vermessung',
    status: 'verifiziert',
    notes: 'Fläche wird aus der Geometrie berechnet (Confidence 0.95). Liegt der Punkt auf einer Grenze, kommen mehrere Parzellen; dann gewinnt die mit der bekannten EGRID.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const url = identifyUrl(['ch.swisstopo-vd.amtliche-vermessung'], point, { geometry: true, geometryFormat: 'geojson' });
    const { data } = await ctx.http.json(url, geoJsonResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    if (data.results.length === 0) throw new EmptyResultError(url, 'Keine Parzelle unter dem Punkt');

    const wanted = ctx.keys.egrid;
    const feature = (wanted && data.results.find((r) => r.properties.egris_egrid === wanted)) || data.results[0]!;
    const a = attrs.parse(feature.properties);
    const area = geojsonAreaM2(feature.geometry);

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], extra: Partial<AdapterOutput['facts'][number]> = {}) =>
      facts.push({ key, value, request_url: url, ...extra });

    if (a.number) push('parzelle.nummer', a.number);
    if (a.egris_egrid) push('parzelle.egrid', a.egris_egrid);
    if (a.identnd) push('parzelle.nummerierungsbereich', a.identnd);
    if (a.bfsnr != null) push('parzelle.bfs_nr', a.bfsnr);
    if (a.ak) push('parzelle.kanton', a.ak);
    if (a.realestate_type) push('parzelle.art', a.realestate_type);
    if (a.geoportal_url) push('parzelle.geoportal_url', a.geoportal_url);
    if (area != null) push('parzelle.flaeche_m2', Math.round(area), { unit: 'm2', confidence: 0.95 });
    if (data.results.length > 1) push('parzelle.treffer_am_punkt', data.results.length);

    const keys: AdapterOutput['keys'] = {};
    if (a.egris_egrid) keys.egrid = a.egris_egrid;
    if (a.bfsnr != null) keys.bfs_nr = a.bfsnr;
    if (a.ak) keys.kanton = a.ak;
    if (a.number) keys.parzelle_nr = a.number;
    return { facts, keys };
  },
};
