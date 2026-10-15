import { z } from 'zod';
import { SchemaDriftError } from '../errors.ts';
import { wmsFeatureInfoUrl } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Strassenlärm Tag und Nacht (BAFU, sonBASE). Layer `ch.bafu.laerm-strassenlaerm_tag` / `_nacht`.
 *
 * STATUS: EXPERIMENTELL. Diese Layer sind reine Raster. `identify` auf api3 liefert dafür einen Fehler
 * (am 15.10.2026 bestätigt), darum gehen wir über WMS GetFeatureInfo. Die Antwortform konnte aus der
 * Sandbox nicht verifiziert werden (URL zu lang für den Fetch-Proxy). Der Parser ist darum tolerant:
 * JSON mit features[].properties → erste numerische Eigenschaft; sonst Text → erste Zahl.
 * Der Live-Test (pnpm test:live) klärt die Form. Bis dahin Confidence 0.7 und Status experimentell.
 */
const jsonShape = z.object({
  features: z.array(z.object({ properties: z.record(z.string(), z.unknown()).optional() })).optional(),
});

function pickNumber(props: Record<string, unknown> | undefined): number | null {
  if (!props) return null;
  const preferred = ['value', 'VALUE', 'GRAY_INDEX', 'gray_index', 'db', 'dB', 'laerm', 'class', 'klasse'];
  for (const k of preferred) {
    const v = props[k];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  }
  for (const v of Object.values(props)) {
    if (typeof v === 'number') return v;
  }
  return null;
}

async function readValue(ctx: Parameters<Adapter['resolve']>[0], layer: string, point: LV95, timeoutMs: number) {
  const url = wmsFeatureInfoUrl(layer, point, 'application/json');
  const { data: text } = await ctx.http.text(url, { timeoutMs });
  let value: number | null = null;
  let raw: string | null = null;
  try {
    const parsed = jsonShape.parse(JSON.parse(text));
    const props = parsed.features?.[0]?.properties;
    value = pickNumber(props);
    if (value == null && props) raw = JSON.stringify(props).slice(0, 200);
  } catch {
    // Kein JSON: evtl. text/plain oder GML. Erste Zahl nehmen.
    const m = text.match(/-?\d+(\.\d+)?/);
    if (m) value = Number(m[0]);
    else raw = text.slice(0, 200);
  }
  if (value == null && raw == null) throw new SchemaDriftError(url, 'Keine auswertbare Antwort');
  return { url, value, raw };
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
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BAFU (sonBASE, Lärmbelastung Strasse)',
    endpoint: 'https://wms.geo.admin.ch/?REQUEST=GetFeatureInfo&LAYERS=ch.bafu.laerm-strassenlaerm_tag',
    status: 'experimentell',
    notes: 'Raster via WMS GetFeatureInfo. Antwortform noch nicht live bestätigt. Werte sind Lden-Pegel in dB am Gebäudepunkt, keine Fassadenmessung.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const t = this.manifest.timeoutMs ?? 8000;
    const [tag, nacht] = await Promise.all([
      readValue(ctx, 'ch.bafu.laerm-strassenlaerm_tag', point, t),
      readValue(ctx, 'ch.bafu.laerm-strassenlaerm_nacht', point, t),
    ]);
    const facts: AdapterOutput['facts'] = [];
    facts.push({ key: 'laerm.strasse.tag_db', value: tag.value, unit: 'dB', request_url: tag.url, confidence: 0.7 });
    facts.push({ key: 'laerm.strasse.nacht_db', value: nacht.value, unit: 'dB', request_url: nacht.url, confidence: 0.7 });
    if (tag.raw) facts.push({ key: 'laerm.strasse.tag_roh', value: tag.raw, request_url: tag.url, confidence: 0.5 });
    if (nacht.raw) facts.push({ key: 'laerm.strasse.nacht_roh', value: nacht.raw, request_url: nacht.url, confidence: 0.5 });
    // Immissionsgrenzwerte LSV für Wohnzonen (ES II): Tag 60 dB, Nacht 50 dB. Nur als Einordnung.
    facts.push({ key: 'laerm.strasse.grenzwert_wohnzone_tag_db', value: 60, unit: 'dB', request_url: tag.url });
    facts.push({ key: 'laerm.strasse.grenzwert_wohnzone_nacht_db', value: 50, unit: 'dB', request_url: nacht.url });
    return { facts };
  },
};
