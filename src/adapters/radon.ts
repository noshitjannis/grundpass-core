import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { geoResultsSchema, identifyUrl, nullableNumberish } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Radonkarte des BAG. Layer `ch.bag.radonkarte`.
 * Verifiziert 15.10.2026: probability_prozent 21, confidence 427.82.
 * `probability_prozent` ist die Wahrscheinlichkeit, dass in einem Gebäude an diesem Ort der Referenzwert
 * von 300 Bq/m³ überschritten wird. Das ist keine Messung am Gebäude, sondern eine Karte.
 */
const attrs = z.object({ probability_prozent: nullableNumberish, confidence: nullableNumberish });

export function radonEinstufung(p: number | null): string | null {
  if (p == null) return null;
  if (p < 10) return 'gering';
  if (p < 20) return 'mittel';
  return 'erhöht';
}

export const radon: Adapter = {
  manifest: {
    id: 'radon',
    title: 'Radonkarte',
    provider: 'BAG',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['radon.'],
    ttlDays: 365,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BAG (Radonkarte Schweiz)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:ch.bag.radonkarte',
    status: 'verifiziert',
    notes: 'Einstufung gering/mittel/erhöht ist unsere Lesehilfe (<10 %, <20 %, ab 20 %), nicht vom BAG. Confidence des Fakts darum 0.8.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const url = identifyUrl(['ch.bag.radonkarte'], point);
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const hit = data.results[0];
    if (!hit) throw new EmptyResultError(url, 'Kein Radon-Wert am Punkt');
    const a = attrs.parse(hit.attributes);
    return {
      facts: [
        { key: 'radon.wahrscheinlichkeit_prozent', value: a.probability_prozent, unit: '%', request_url: url },
        { key: 'radon.einstufung', value: radonEinstufung(a.probability_prozent), request_url: url, confidence: 0.8 },
        { key: 'radon.referenzwert_bq_m3', value: 300, unit: 'Bq/m3', request_url: url },
      ],
    };
  },
};
