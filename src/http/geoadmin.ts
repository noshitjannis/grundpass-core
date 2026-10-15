import { z } from 'zod';
import type { LV95 } from '../types.ts';

/**
 * URL-Bauer für die geo.admin-REST-API (api3.geo.admin.ch) und den WMS (wms.geo.admin.ch).
 * Alles ohne Key. Dokumentation: https://api3.geo.admin.ch/services/sdiservices.html
 *
 * Verifiziert am 15.10.2026 mit echten Antworten:
 *  - SearchServer type=locations liefert attrs.y = Ost (E), attrs.x = Nord (N). Ja, vertauscht.
 *  - identify mit tolerance=0 braucht weder imageDisplay noch mapExtent.
 *  - identify mit tolerance>0 braucht beides.
 *  - Reine Raster-Layer (z.B. Strassenlärm) sind über identify nicht abfragbar, nur über WMS GetFeatureInfo.
 *  - find sucht ohne `contains=false` als Teilstring: searchText 1271632 traf auch EGID 191271632 (Gossau SG).
 *    Darum setzt findUrl contains=false. Bestätigt 15.10.2026: damit genau ein Treffer.
 *  - identify mit geometryFormat=geojson liefert GeoJSON-Features: Attribute in `properties`, nicht `attributes`,
 *    Geometrie als GeoJSON. Ohne geometryFormat kommt Esri-JSON mit `attributes` und `geometry.rings`.
 *    Darum zwei Schemas: geoResultsSchema (Esri-Form) und geoJsonResultsSchema (GeoJSON-Form).
 *  - find kann dasselbe: mit returnGeometry=true und geometryFormat=geojson kommen GeoJSON-Features, Form identisch zu identify
 *    (amtliche Vermessung per egris_egrid, Baden und Wabern). Unbekannter Suchwert gibt `{"results": []}` mit HTTP 200.
 */

export const API3 = 'https://api3.geo.admin.ch/rest/services/api';
export const WMS = 'https://wms.geo.admin.ch/';

export function searchServerUrl(searchText: string, opts: { origins?: string; limit?: number } = {}): string {
  const p = new URLSearchParams({
    searchText,
    type: 'locations',
    origins: opts.origins ?? 'address',
    sr: '2056',
    limit: String(opts.limit ?? 5),
  });
  return `${API3}/SearchServer?${p}`;
}

export function findUrl(
  layer: string,
  searchField: string,
  searchText: string | number,
  opts: { geometry?: boolean; geometryFormat?: 'esrijson' | 'geojson' } = {},
): string {
  const p = new URLSearchParams({
    layer,
    searchField,
    searchText: String(searchText),
    returnGeometry: String(opts.geometry ?? false),
    sr: '2056',
    lang: 'de',
    // Ohne contains=false ist die Suche eine Teilstring-Suche (1271632 trifft auch 191271632).
    contains: 'false',
  });
  if (opts.geometryFormat) p.set('geometryFormat', opts.geometryFormat);
  return `${API3}/MapServer/find?${p}`;
}

export function identifyUrl(
  layers: string[],
  point: LV95,
  opts: { tolerance?: number; geometry?: boolean; geometryFormat?: 'esrijson' | 'geojson' } = {},
): string {
  const tol = opts.tolerance ?? 0;
  const p = new URLSearchParams({
    geometry: `${point.e},${point.n}`,
    geometryType: 'esriGeometryPoint',
    layers: `all:${layers.join(',')}`,
    tolerance: String(tol),
    sr: '2056',
    returnGeometry: String(opts.geometry ?? false),
    lang: 'de',
  });
  if (opts.geometryFormat) p.set('geometryFormat', opts.geometryFormat);
  if (tol > 0) {
    // Bei Toleranz > 0 verlangt die API ein Bild-Koordinatensystem, über das die Toleranz in Meter übersetzt wird.
    // 1 px = 1 m bei 96 dpi und einer Extent-Breite von 100 m auf 100 px.
    const half = 50;
    p.set('imageDisplay', '100,100,96');
    p.set('mapExtent', `${point.e - half},${point.n - half},${point.e + half},${point.n + half}`);
  }
  return `${API3}/MapServer/identify?${p}`;
}

/** WMS GetFeatureInfo für Raster-Layer. Fragt ein 3x3-Pixel-Fenster um den Punkt ab und trifft den mittleren Pixel. */
export function wmsFeatureInfoUrl(layer: string, point: LV95, infoFormat = 'application/json'): string {
  const half = 1.5; // Meter, also 1 m pro Pixel bei 3 px
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetFeatureInfo',
    LAYERS: layer,
    QUERY_LAYERS: layer,
    CRS: 'EPSG:2056',
    BBOX: `${point.e - half},${point.n - half},${point.e + half},${point.n + half}`,
    WIDTH: '3',
    HEIGHT: '3',
    I: '1',
    J: '1',
    INFO_FORMAT: infoFormat,
    FORMAT: 'image/png',
    STYLES: '',
    FEATURE_COUNT: '1',
  });
  return `${WMS}?${p}`;
}

// ---------------------------------------------------------------------------
// Gemeinsame Zod-Schemas
// ---------------------------------------------------------------------------

/** Ein identify/find-Resultat. `attributes` bleibt offen, jeder Adapter parst seinen Teil. */
export const geoFeatureSchema = z.object({
  layerBodId: z.string(),
  featureId: z.union([z.number(), z.string()]),
  id: z.union([z.number(), z.string()]).optional(),
  attributes: z.record(z.string(), z.unknown()),
  geometry: z.unknown().optional(),
});

export const geoResultsSchema = z.object({
  results: z.array(geoFeatureSchema),
});

export type GeoFeature = z.infer<typeof geoFeatureSchema>;

/**
 * Ein identify-Resultat mit `geometryFormat=geojson`. Verifiziert 15.10.2026 (amtliche Vermessung):
 * `{ type: "Feature", featureId, id, layerBodId, layerName, bbox, geometry: <GeoJSON>, properties: {…} }`.
 */
export const geoJsonFeatureSchema = z.object({
  type: z.literal('Feature'),
  layerBodId: z.string(),
  featureId: z.union([z.number(), z.string()]),
  id: z.union([z.number(), z.string()]).optional(),
  bbox: z.array(z.number()).optional(),
  properties: z.record(z.string(), z.unknown()),
  geometry: z.unknown().optional(),
});

export const geoJsonResultsSchema = z.object({
  results: z.array(geoJsonFeatureSchema),
});

export type GeoJsonFeature = z.infer<typeof geoJsonFeatureSchema>;

/** Hilfsfunktion: Attribut-Record eines Features gegen ein Zod-Schema parsen, mit lesbarem Fehler. */
export function parseAttributes<T>(feature: GeoFeature, schema: z.ZodType<T>): T {
  return schema.parse(feature.attributes);
}

/** Zahl, die auch als String kommen darf. geo.admin ist da nicht konsequent. */
export const numberish = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}, z.number());

export const nullableNumberish = z.preprocess((v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  if (typeof v === 'string' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}, z.number().nullable());

export const nullableString = z.preprocess((v) => {
  if (v === null || v === undefined || v === '' || v === '-') return null;
  return typeof v === 'number' ? String(v) : v;
}, z.string().nullable());
