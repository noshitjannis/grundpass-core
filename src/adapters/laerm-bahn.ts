import { z } from 'zod';
import { numberish, wmsFeatureInfoUrl } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterContext, AdapterOutput, LV95 } from '../types.ts';

/**
 * Eisenbahnlärm Tag und Nacht (BAFU). Layer `ch.bafu.laerm-bahnlaerm_tag` und `_nacht`, gleiches Muster wie laerm-strasse:
 * reine Raster-Layer, darum WMS GetFeatureInfo (application/json), Pegel in `features[0].properties.value_0` als String.
 *
 * Verifiziert 16.10.2026: Wabern (2601737/1197338) Tag 16.4, Nacht 6.2 dB; Zürich Bahnhofstrasse-Gegend (2683400/1247900)
 * Tag 16.6, Nacht 11.9 dB. Auch weit weg von Gleisen liefert die Karte kleine Werte; wo gar nichts kartiert ist, ist `features`
 * leer. Das ist keine Störung und kein Ausfall, sondern eine Lücke mit Hinweis: Der Adapter liefert dann statt der Pegel den
 * Fakt `laerm.bahn.hinweis` («keine Bahnlärm-Belastung kartiert»), den die Steckbrief-View als Grund der Lücke zeigt. Kein Default.
 *
 * Bedeutung laut Layer-Legende (api3 …/MapServer/ch.bafu.laerm-bahnlaerm_tag/legend?lang=de): Beurteilungspegel Lr_Tag bzw.
 * Lr_Nacht in dB(A) aus dem Emissionskataster 2021 (EK2021, Verkehrsdaten der SBB für SBB, BLS, SOB, SZU, Zentralbahn, RhB),
 * Geobasisdatensatz 120.3, Datenstand 31.12.2021. Gesetzlich nicht verbindlich; verbindlich ist das BAV. GetFeatureInfo liefert
 * kein Datum, darum kein `source_date`. Die Immissionsgrenzwerte zum Vergleich entstehen in resolver/derive.ts aus der
 * Empfindlichkeitsstufe des ÖREB-Katasters (LSV Anhang 4).
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

const LAYER_TAG = 'ch.bafu.laerm-bahnlaerm_tag';
const LAYER_NACHT = 'ch.bafu.laerm-bahnlaerm_nacht';

export const BAHN_HINWEIS = 'keine Bahnlärm-Belastung kartiert';

async function readPegel(ctx: AdapterContext, layer: string, point: LV95, timeoutMs: number): Promise<{ url: string; db: number | null }> {
  const url = wmsFeatureInfoUrl(layer, point, 'application/json');
  const { data } = await ctx.http.json(url, featureInfo, { timeoutMs });
  const feature = data.features[0];
  return { url, db: feature ? feature.properties.value_0 : null };
}

export const laermBahn: Adapter = {
  manifest: {
    id: 'laerm-bahn',
    title: 'Bahnlärm Tag und Nacht',
    provider: 'BAFU',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['laerm.bahn.'],
    ttlDays: 180,
    version: 1,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BAFU (Lärmbelastung Eisenbahn, Emissionskataster 2021)',
    endpoint: `https://wms.geo.admin.ch/?REQUEST=GetFeatureInfo&LAYERS=${LAYER_TAG}`,
    status: 'verifiziert',
    notes:
      'Raster via WMS GetFeatureInfo (application/json, Feld value_0). Beurteilungspegel Lr Tag und Lr Nacht in dB(A) am Gebäudepunkt, Emissionskataster 2021 des BAFU, Datenstand 31.12.2021. Ohne kartierten Bahnlärm kein Wert, sondern der Hinweis laerm.bahn.hinweis. Rechtlich nicht verbindlich.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const t = this.manifest.timeoutMs ?? 8000;
    const [tag, nacht] = await Promise.all([readPegel(ctx, LAYER_TAG, point, t), readPegel(ctx, LAYER_NACHT, point, t)]);
    const facts: AdapterOutput['facts'] = [];
    if (tag.db !== null) facts.push({ key: 'laerm.bahn.tag_db', value: tag.db, unit: 'dB', request_url: tag.url, confidence: 1 });
    if (nacht.db !== null) facts.push({ key: 'laerm.bahn.nacht_db', value: nacht.db, unit: 'dB', request_url: nacht.url, confidence: 1 });
    if (tag.db === null || nacht.db === null) {
      // Kein Wert am Punkt ist eine Lücke mit Text, kein Default: Die View hängt den Hinweis an die Lücke laerm.bahn.tag_db.
      const fehlt = [tag.db === null ? 'Tag' : null, nacht.db === null ? 'Nacht' : null].filter((x): x is string => x !== null);
      const text = fehlt.length === 2 ? BAHN_HINWEIS : `${BAHN_HINWEIS} (${fehlt.join(', ')})`;
      facts.push({ key: 'laerm.bahn.hinweis', value: text, request_url: tag.db === null ? tag.url : nacht.url, confidence: 1 });
    }
    return { facts };
  },
};
