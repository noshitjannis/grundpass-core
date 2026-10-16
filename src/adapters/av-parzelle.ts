import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { findUrl, geoJsonResultsSchema, identifyUrl, nullableNumberish, nullableString, type GeoJsonFeature } from '../http/geoadmin.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Amtliche Vermessung, Liegenschaft (Parzelle) des Gebäudes. Layer `ch.swisstopo-vd.amtliche-vermessung`.
 *
 * Zwei Wege, beide verifiziert 15.10.2026 mit echten Antworten:
 *  1. Hauptweg mit EGRID (aus dem GWR): `find` mit searchField=egris_egrid, contains=false, returnGeometry=true,
 *     geometryFormat=geojson. Liefert genau die Parzelle, die das Gebäuderegister nennt, samt Geometrie
 *     (Fixtures av-parzelle-find-3258.json, av-parzelle-find-5711.json). Unbekannte EGRID: `{"results": []}`, HTTP 200.
 *  2. Fallback ohne EGRID, oder wenn die EGRID in der AV unbekannt ist: `identify` am Gebäudepunkt, tolerance=0
 *     (Fixture av-parzelle-5711.json). Bis Version 2 war das der einzige Weg, und er zeichnete in Baden (Rütistrasse 1)
 *     die Nachbarparzelle: Der GWR-Gebäudepunkt liegt auf 3827, das Register nennt 3258.
 *
 * Gegenprobe im Hauptweg: Liegt der Gebäudepunkt nicht in der gefundenen Geometrie (Even-Odd-Test, kein Netzaufruf),
 * fragt der Adapter einmal `identify` am Punkt und benennt in `parzelle.hinweis_vermessung` die Parzelle darunter
 * (Fixture av-parzelle-3827-punkt.json). Die Fakten bleiben die der Register-Parzelle mit Confidence 1; sichtbar ist
 * nur, dass sich die beiden Register widersprechen. Liegt der Punkt auf einer Grenze, nennt identify auch die
 * Register-Parzelle, dann gibt es keinen Hinweis.
 *
 * Antwortform (beide Wege gleich, geometryFormat=geojson): GeoJSON-Features, Attribute in `properties` (nicht `attributes`),
 * Geometrie als GeoJSON-Polygon. Gelesen: bfsnr, ak, number, identnd, egris_egrid, realestate_type, geoportal_url.
 * Eine Fläche liefert die API nicht, darum Shoelace in LV95-Metern, Löcher abgezogen (Confidence 0.95).
 * Die Geometrie geht roh weiter (parzelle.geometrie_geojson), damit die App den Lageplan zeichnen kann.
 */
const LAYER = 'ch.swisstopo-vd.amtliche-vermessung';

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

/** Alle Ringe eines GeoJSON-Polygons oder MultiPolygons (oder Esri-`rings`). null, wenn die Form unbekannt ist. */
function alleRinge(geom: unknown): Ring[] | null {
  if (!geom || typeof geom !== 'object') return null;
  const g = geom as { type?: string; coordinates?: unknown; rings?: unknown };
  if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return g.coordinates as Ring[];
  if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return (g.coordinates as Ring[][]).flat();
  if (Array.isArray(g.rings)) return g.rings as Ring[];
  return null;
}

/**
 * Liegt der Punkt in der Fläche? Even-Odd-Regel über alle Ringe: Löcher und MultiPolygone zählen damit von selbst richtig.
 * Ein Punkt genau auf einer Kante ist unentschieden; der Adapter beantwortet ein «nein» mit einer echten Abfrage, nie mit einer Annahme.
 * null = Geometrie unbekannt.
 */
export function pointInGeometry(p: LV95, geom: unknown): boolean | null {
  const ringe = alleRinge(geom);
  if (!ringe) return null;
  let drin = false;
  for (const r of ringe) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i]!;
      const [xj, yj] = r[j]!;
      if (yi > p.n !== yj > p.n && p.e < ((xj - xi) * (p.n - yi)) / (yj - yi) + xi) drin = !drin;
    }
  }
  return drin;
}

export const avParzelle: Adapter = {
  manifest: {
    id: 'av-parzelle',
    title: 'Amtliche Vermessung: Parzelle',
    provider: 'swisstopo / Kantone',
    needs: ['egrid|lv95_bau'],
    yields: ['egrid', 'bfs_nr', 'kanton', 'parzelle_nr'],
    provides: ['parzelle.'],
    ttlDays: 90,
    version: 4, // 16.10.2026: parzelle.hinweis_code mit Parametern neben dem Hinweistext; 3 (15.10.2026): Hauptweg find per EGRID statt identify am Punkt
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© swisstopo, Kantone (amtliche Vermessung)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.swisstopo-vd.amtliche-vermessung&searchField=egris_egrid',
    status: 'verifiziert',
    notes:
      'Hauptweg: find per EGRID aus dem GWR, liefert die Parzelle des Gebäuderegisters mit Geometrie. Fallback ohne EGRID oder bei in der AV unbekannter EGRID: identify am Gebäudepunkt (tolerance=0); bei mehreren Treffern gewinnt die bekannte EGRID, eine fremde Parzelle bekommt Confidence 0.8 und einen Hinweis. Fläche aus der Geometrie (Confidence 0.95). Liegt der Gebäudepunkt nicht in der Register-Parzelle, nennt parzelle.hinweis_vermessung die Parzelle unter dem Punkt.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const wanted = ctx.keys.egrid;
    const point = ctx.keys.lv95_bau;
    const hole = (url: string) => ctx.http.json(url, geoJsonResultsSchema, { timeoutMs: this.manifest.timeoutMs });

    let feature: GeoJsonFeature | undefined;
    let url = '';
    // Nur im Fallback relevant: Ist die Parzelle unter dem Punkt die aus dem GWR?
    let passt = true;
    let trefferAmPunkt: number | undefined;

    // 1. Hauptweg: find per EGRID. Genau die Parzelle, die das Gebäuderegister nennt.
    if (wanted) {
      url = findUrl(LAYER, 'egris_egrid', wanted, { geometry: true, geometryFormat: 'geojson' });
      const { data } = await hole(url);
      feature = data.results.find((r) => r.properties.egris_egrid === wanted);
      if (!feature && !point) throw new EmptyResultError(url, `Die amtliche Vermessung kennt die EGRID ${wanted} nicht, und ohne Gebäudepunkt gibt es keinen Fallback`);
    }

    // 2. Fallback: identify am Gebäudepunkt. Ohne EGRID der einzige Weg; mit EGRID nur, wenn die AV sie nicht kennt.
    if (!feature) {
      if (!point) throw new EmptyResultError(this.manifest.endpoint, 'Weder EGRID noch Gebäudepunkt bekannt');
      url = identifyUrl([LAYER], point, { geometry: true, geometryFormat: 'geojson' });
      const { data } = await hole(url);
      if (data.results.length === 0) throw new EmptyResultError(url, 'Keine Parzelle unter dem Gebäudepunkt');
      const treffer = wanted ? data.results.find((r) => r.properties.egris_egrid === wanted) : undefined;
      feature = treffer ?? data.results[0]!;
      passt = !wanted || !!treffer;
      trefferAmPunkt = data.results.length;
    }

    const a = attrs.parse(feature.properties);
    const area = geojsonAreaM2(feature.geometry);
    // Fallback mit fremder Parzelle (die AV kennt die GWR-EGRID nicht, unter dem Punkt liegt eine andere): Confidence sinkt,
    // der Hinweis macht es sichtbar. Das GWR behält die Keys (erster Schreiber), ÖREB und Grundbuchfläche folgen der Register-Parzelle.
    const c = passt ? 1 : 0.8;

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], extra: Partial<AdapterOutput['facts'][number]> = {}) =>
      facts.push({ key, value, request_url: url, confidence: c, ...extra });

    if (a.number) push('parzelle.nummer', a.number);
    if (a.egris_egrid) push('parzelle.egrid', a.egris_egrid);
    if (a.identnd) push('parzelle.nummerierungsbereich', a.identnd);
    if (a.bfsnr != null) push('parzelle.bfs_nr', a.bfsnr);
    if (a.ak) push('parzelle.kanton', a.ak);
    if (a.realestate_type) push('parzelle.art', a.realestate_type);
    if (a.geoportal_url) push('parzelle.geoportal_url', a.geoportal_url);
    if (area != null) push('parzelle.flaeche_m2', Math.round(area), { unit: 'm2', confidence: passt ? 0.95 : 0.8 });
    // Die Geometrie selbst (GeoJSON, LV95) für den Lageplan der App. Kein Eintrag im Feldkatalog, erscheint nicht im Steckbrief.
    if (feature.geometry && typeof feature.geometry === 'object') push('parzelle.geometrie_geojson', JSON.stringify(feature.geometry), { confidence: 1 });
    if (trefferAmPunkt != null && trefferAmPunkt > 1) push('parzelle.treffer_am_punkt', trefferAmPunkt);

    // Hinweistexte kommen mit Code und Parametern (parzelle.hinweis_code, parzelle.hinweis_*), damit die View den Satz in jeder
    // Sprache aus dem Code bauen kann. Der deutsche Text bleibt als Fakt (Quellsprache).
    const hinweisParams = (code: string, punkt: { number: string | null; egris_egrid: string | null } | null, register: { nummer: string; egrid: string }, extra: Partial<AdapterOutput['facts'][number]> = {}) => {
      push('parzelle.hinweis_code', code, extra);
      if (punkt) {
        push('parzelle.hinweis_punkt_nummer', punkt.number ?? null, extra);
        push('parzelle.hinweis_punkt_egrid', punkt.egris_egrid ?? null, extra);
      }
      push('parzelle.hinweis_register_nummer', register.nummer, extra);
      push('parzelle.hinweis_register_egrid', register.egrid, extra);
    };
    if (!passt) {
      push(
        'parzelle.hinweis_vermessung',
        `Unter dem Gebäudepunkt liegt laut amtlicher Vermessung Parzelle ${a.number ?? '?'} (${a.egris_egrid ?? '?'}), das Gebäuderegister nennt ${ctx.keys.parzelle_nr ?? '?'} (${wanted}); diese EGRID kennt die amtliche Vermessung nicht. Die Fläche aus der Geometrie gehört zu ${a.number ?? 'dieser Parzelle'}.`,
      );
      hinweisParams('egrid_unbekannt', { number: a.number, egris_egrid: a.egris_egrid }, { nummer: ctx.keys.parzelle_nr ?? '?', egrid: wanted ?? '?' });
    } else if (wanted && point && pointInGeometry(point, feature.geometry) === false) {
      // Gegenprobe: Die Register-Parzelle ist da, aber der Gebäudepunkt liegt nicht darin. Welche Parzelle liegt unter dem Punkt?
      const punktUrl = identifyUrl([LAYER], point, { geometry: true, geometryFormat: 'geojson' });
      const { data } = await hole(punktUrl);
      const auchHier = data.results.some((r) => r.properties.egris_egrid === wanted);
      if (!auchHier) {
        const unten = data.results[0] ? attrs.parse(data.results[0].properties) : null;
        const wo = unten ? `auf Parzelle ${unten.number ?? '?'} (${unten.egris_egrid ?? '?'})` : 'auf keiner Parzelle';
        push(
          'parzelle.hinweis_vermessung',
          `Der Gebäudepunkt aus dem Gebäuderegister liegt laut amtlicher Vermessung ${wo}, nicht auf ${a.number ?? '?'} (${wanted}). Gezeigt wird die Parzelle aus dem Gebäuderegister.`,
          { request_url: punktUrl },
        );
        hinweisParams(unten ? 'punkt_auf_anderer_parzelle' : 'punkt_auf_keiner_parzelle', unten ? { number: unten.number, egris_egrid: unten.egris_egrid } : null, { nummer: a.number ?? '?', egrid: wanted }, { request_url: punktUrl });
      }
    }

    const keys: AdapterOutput['keys'] = {};
    if (a.egris_egrid) keys.egrid = a.egris_egrid;
    if (a.bfsnr != null) keys.bfs_nr = a.bfsnr;
    if (a.ak) keys.kanton = a.ak;
    if (a.number) keys.parzelle_nr = a.number;
    return { facts, keys };
  },
};
