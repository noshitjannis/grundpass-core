import { SchemaDriftError } from '../errors.ts';
import { parseWmsFeatureInfoText, wmsFeatureInfoUrl, type WmsTextLayer } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterContext, AdapterOutput, LV95 } from '../types.ts';

/**
 * Naturgefahren aus den schweizweiten Bundeslayern (BAFU), alle am Gebäudepunkt per WMS GetFeatureInfo, INFO_FORMAT text/plain:
 *
 *  - `ch.bafu.gefaehrdungskarte-oberflaechenabfluss` (Datenstand 2018-05-22): Regenwasser, das bei Starkregen über das Gelände
 *    fliesst, unabhängig von Bächen und Flüssen. Modellrechnung ohne Prüfung im Gelände, Wiederkehrperiode über 100 Jahre.
 *    Der Dienst gibt pro Treffer nur «Feature <id>:» ohne Attribute heraus (auch als JSON und GML): Die drei Klassen der Legende
 *    (Fliesstiefe bis 0.1 m, 0.1 bis 0.25 m, ab 0.25 m) sind nur im Kartenbild. Darum nur `betroffen` ja/nein, keine Klasse.
 *  - `ch.bafu.aquaprotect_100` (Datenstand 2008-12-18): grobe schweizweite Übersicht der bei einem 100-jährlichen Hochwasser
 *    potenziell überschwemmten Gebiete, ohne Schutzbauten. Ebenfalls Feature ohne Attribute: drin oder nicht drin.
 *  - `ch.bafu.gefahren-gefaehrdungszonen` (Erdbebenzonen SIA 261, Datenstand 2026-04-13): Attribut `Erdbebenzone_SIA_261`
 *    mit den Zonen Z1a, Z1b, Z2, Z3a, Z3b (Legende: «Erdbebenzone 1a» bis «Erdbebenzone 3b»). Wird roh durchgereicht.
 *
 * Verifiziert 16.10.2026: Wabern (2601737/1197338) nichts drin, Zone Z1b; Zürich Bahnhofstrasse-Gegend (2683400/1247900)
 * Oberflächenabfluss und Aquaprotect betroffen, Zone Z1a. text/plain statt JSON, weil die JSON-Antwort der Erdbebenzonen die ganze
 * Zonengeometrie mitschickt (5 bis 8 MB). GetFeatureInfo liefert kein Datum; der Stand der Daten steht pro Layer auf der
 * Layermetadaten-Seite von geo.admin (Legende mit «Datenstand», Version 2 dieses Adapters seit 16.10.2026):
 *   https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bafu.gefaehrdungskarte-oberflaechenabfluss/legend?lang=de  Datenstand 22.05.2018
 *   https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bafu.aquaprotect_100/legend?lang=de                        Datenstand 18.12.2008
 *   https://api3.geo.admin.ch/rest/services/api/MapServer/ch.bafu.gefahren-gefaehrdungszonen/legend?lang=de             Datenstand 13.04.2026
 * Diese drei Daten trägt jeder Fakt als `source_date` (pro Fakt, nicht pro Lauf: drei Layer, drei Stände). Ändert geo.admin
 * den Datenstand, muss die Konstante nachgeführt werden; der Live-Test prüft die Legendenseiten dagegen.
 *
 * Die kantonalen Gefahrenkarten (Hochwasser, Rutschung, Sturz, Lawine) sind nicht schweizweit in einem Layer und fehlen hier
 * bewusst (docs/QUELLEN.md).
 */
const LAYER_ABFLUSS = 'ch.bafu.gefaehrdungskarte-oberflaechenabfluss';
const LAYER_AQUAPROTECT = 'ch.bafu.aquaprotect_100';
const LAYER_ERDBEBEN = 'ch.bafu.gefahren-gefaehrdungszonen';
const FELD_ERDBEBEN = 'Erdbebenzone_SIA_261';

/** Datenstand pro Layer laut Layermetadaten-Seite (Legende) von geo.admin, ISO. Wird `source_date` jedes Fakts. */
export const DATENSTAND = {
  [LAYER_ABFLUSS]: '2018-05-22',
  [LAYER_AQUAPROTECT]: '2008-12-18',
  [LAYER_ERDBEBEN]: '2026-04-13',
} as const;

/** Legendenseite eines Layers auf geo.admin; dort steht der Datenstand. Für den Live-Test und die Doku. */
export function legendeUrl(layer: string): string {
  return `https://api3.geo.admin.ch/rest/services/api/MapServer/${layer}/legend?lang=de`;
}

async function lies(ctx: AdapterContext, layer: string, point: LV95, timeoutMs: number): Promise<{ url: string; features: WmsTextLayer['features'] }> {
  const url = wmsFeatureInfoUrl(layer, point, 'text/plain');
  const { data } = await ctx.http.text(url, { timeoutMs });
  return { url, features: parseWmsFeatureInfoText(data, url).flatMap((l) => l.features) };
}

export const naturgefahren: Adapter = {
  manifest: {
    id: 'naturgefahren',
    title: 'Naturgefahren (Bundeslayer)',
    provider: 'BAFU',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['naturgefahr.'],
    ttlDays: 365,
    // Version 2 (16.10.2026): source_date pro Fakt aus dem Datenstand der Layer
    version: 2,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BAFU (Gefährdungskarte Oberflächenabfluss, Aquaprotect, Erdbebenzonen SIA 261)',
    endpoint: `https://wms.geo.admin.ch/?REQUEST=GetFeatureInfo&LAYERS=${LAYER_ABFLUSS}`,
    status: 'verifiziert',
    notes:
      'Drei WMS-GetFeatureInfo-Abfragen (text/plain) am Gebäudepunkt. Oberflächenabfluss und Aquaprotect HQ100 nur als betroffen ja/nein, weil der Dienst keine Attribute liefert; Erdbebenzone SIA 261 roh (Z1a bis Z3b). Stand pro Fakt aus dem Datenstand des Layers (geo.admin-Legende: 2018, 2008, 2026). Grobe Bundesübersichten ohne Rechtsverbindlichkeit; die kantonalen Gefahrenkarten fehlen.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const t = this.manifest.timeoutMs ?? 8000;
    const [abfluss, aqua, erdbeben] = await Promise.all([lies(ctx, LAYER_ABFLUSS, point, t), lies(ctx, LAYER_AQUAPROTECT, point, t), lies(ctx, LAYER_ERDBEBEN, point, t)]);
    const facts: AdapterOutput['facts'] = [
      { key: 'naturgefahr.oberflaechenabfluss.betroffen', value: abfluss.features.length > 0, request_url: abfluss.url, confidence: 1, source_date: DATENSTAND[LAYER_ABFLUSS] },
      { key: 'naturgefahr.hochwasser.aquaprotect_100', value: aqua.features.length > 0, request_url: aqua.url, confidence: 1, source_date: DATENSTAND[LAYER_AQUAPROTECT] },
    ];
    const zoneFeature = erdbeben.features[0];
    if (zoneFeature) {
      const zone = zoneFeature.attributes[FELD_ERDBEBEN];
      if (!zone) throw new SchemaDriftError(erdbeben.url, `Erdbebenzonen-Treffer ohne Attribut ${FELD_ERDBEBEN}`);
      facts.push({ key: 'naturgefahr.erdbeben.zone', value: zone, request_url: erdbeben.url, confidence: 1, source_date: DATENSTAND[LAYER_ERDBEBEN] });
    }
    // Ohne Erdbebenzonen-Treffer (ausserhalb der Karte) gibt es keinen Zonen-Fakt: Lücke im Steckbrief, keine Annahme.
    return { facts };
  },
};
