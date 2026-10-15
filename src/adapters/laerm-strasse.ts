import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { numberish, wmsFeatureInfoUrl } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterContext, AdapterOutput, LV95 } from '../types.ts';

/**
 * Strassenlärm Tag und Nacht (BAFU, sonBASE). Layer `ch.bafu.laerm-strassenlaerm_tag` und `_nacht`.
 * Reine Raster-Layer: `identify` auf api3 gibt dafür einen Fehler, darum WMS GetFeatureInfo.
 *
 * Verifiziert 15.10.2026 am Gebäudepunkt Maygutstrasse 26, Wabern (2601737/1197338.426):
 *  - INFO_FORMAT=application/json liefert eine FeatureCollection mit genau einem Feature.
 *    Der Pegel steht in `properties.value_0`, als String ("33.2" Tag, "24.1" Nacht).
 *    Die Geometrie des Features ist der Mittelpunkt der getroffenen Rasterzelle, nicht der angefragte Punkt.
 *  - text/plain und application/vnd.ogc.gml liefern denselben Wert unter `<layer>.value_0.name`.
 *    text/html lehnt der Server ab (ServiceException InvalidFormat).
 *  - Ohne kartierten Strassenlärm (geprüft am Aletschgletscher) ist `features` leer. Das ist eine Lücke, kein Ausfall.
 *
 * Bedeutung laut Layer-Legende (api3 …/MapServer/ch.bafu.laerm-strassenlaerm_tag/legend?lang=de):
 * Beurteilungspegel Lr_Tag bzw. Lr_Nacht in dB(A) aus der flächendeckenden Modellrechnung sonBASE,
 * Verkehrszählungen 2021, Datenstand 31.12.2021, Geobasisdatensätze 120.1 (Tag) und 120.2 (Nacht).
 * Rechtlich nicht verbindlich. GetFeatureInfo liefert kein Datum, darum kein `source_date`.
 * Die Immissionsgrenzwerte zum Vergleich kommen nicht von hier, sondern als derived-Fakt aus der Empfindlichkeitsstufe
 * des ÖREB-Katasters (seit 15.10.2026; vorher pauschal ES II).
 */
const featureInfo = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      properties: z.object({ value_0: numberish }),
    }),
  ),
});

const LAYER_TAG = 'ch.bafu.laerm-strassenlaerm_tag';
const LAYER_NACHT = 'ch.bafu.laerm-strassenlaerm_nacht';

async function readPegel(ctx: AdapterContext, layer: string, point: LV95, timeoutMs: number): Promise<{ url: string; db: number }> {
  const url = wmsFeatureInfoUrl(layer, point, 'application/json');
  const { data } = await ctx.http.json(url, featureInfo, { timeoutMs });
  const feature = data.features[0];
  if (!feature) throw new EmptyResultError(url, 'Kein Strassenlärm kartiert am Punkt');
  return { url, db: feature.properties.value_0 };
}

export const laermStrasse: Adapter = {
  manifest: {
    id: 'laerm-strasse',
    title: 'Strassenlärm Tag und Nacht',
    provider: 'BAFU',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['laerm.strasse.'],
    ttlDays: 180,
    version: 2, // 15.10.2026: keine pauschalen Grenzwerte mehr, die kommen derived aus der Empfindlichkeitsstufe
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BAFU (sonBASE, Lärmbelastung Strasse)',
    endpoint: `https://wms.geo.admin.ch/?REQUEST=GetFeatureInfo&LAYERS=${LAYER_TAG}`,
    status: 'verifiziert',
    notes:
      'Raster via WMS GetFeatureInfo (application/json, Feld value_0). Beurteilungspegel Lr Tag und Lr Nacht in dB(A) am Gebäudepunkt, Modellrechnung sonBASE des BAFU, Datenstand 31.12.2021. Keine Fassadenmessung, rechtlich nicht verbindlich.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const t = this.manifest.timeoutMs ?? 8000;
    const [tag, nacht] = await Promise.all([readPegel(ctx, LAYER_TAG, point, t), readPegel(ctx, LAYER_NACHT, point, t)]);
    return {
      facts: [
        { key: 'laerm.strasse.tag_db', value: tag.db, unit: 'dB', request_url: tag.url, confidence: 1 },
        { key: 'laerm.strasse.nacht_db', value: nacht.db, unit: 'dB', request_url: nacht.url, confidence: 1 },
        // Grenzwerte liefert dieser Adapter nicht mehr pauschal (früher ES II fix). Sie entstehen in resolver/derive.ts
        // aus laerm.empfindlichkeitsstufe (ÖREB-Kataster), LSV Anhang 3.
      ],
    };
  },
};
