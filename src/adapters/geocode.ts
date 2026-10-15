import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { numberish, searchServerUrl } from '../http/geoadmin.ts';
import type { Adapter, AdapterOutput } from '../types.ts';

/**
 * Adresse → EGID + Koordinaten über den geo.admin SearchServer (amtliches Gebäudeadressverzeichnis).
 *
 * Verifiziert 15.10.2026: "Maygutstrasse 26 3084 Wabern" liefert
 *   attrs.featureId "1271632_0" (EGID_EDID), attrs.y 2601733.5 (Ost), attrs.x 1197341.75 (Nord),
 *   attrs.label "Maygutstrasse 26 <b>3084 Wabern</b>", attrs.detail "maygutstrasse 26 3084 wabern 355 koeniz ch be".
 * Achtung: x und y sind gegenüber der LV95-Konvention vertauscht. y ist Ost.
 */
const schema = z.object({
  results: z.array(
    z.object({
      id: z.union([z.number(), z.string()]).optional(),
      weight: z.number().optional(),
      attrs: z.object({
        label: z.string(),
        detail: z.string().optional(),
        origin: z.string(),
        featureId: z.union([z.string(), z.number()]).optional(),
        x: numberish,
        y: numberish,
        lat: numberish.optional(),
        lon: numberish.optional(),
        num: z.union([z.number(), z.string()]).optional(),
      }),
    }),
  ),
});

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export const geocode: Adapter = {
  manifest: {
    id: 'geocode',
    title: 'Adresse → Gebäude',
    provider: 'swisstopo / BFS',
    needs: ['adresse'],
    yields: ['egid', 'lv95'],
    provides: ['adresse.'],
    ttlDays: 30,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© swisstopo, BFS (amtliches Gebäudeadressverzeichnis)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/SearchServer',
    status: 'verifiziert',
    notes: 'Nimmt den ersten Treffer mit origin=address. Ohne EGID im Treffer gibt es nur Koordinaten.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const adresse = ctx.keys.adresse!;
    const url = searchServerUrl(adresse, { limit: 5 });
    const { data } = await ctx.http.json(url, schema, { timeoutMs: this.manifest.timeoutMs });
    const hit = data.results.find((r) => r.attrs.origin === 'address') ?? data.results[0];
    if (!hit) throw new EmptyResultError(url, 'Adresse nicht gefunden');

    const label = stripTags(hit.attrs.label);
    const lv95 = { e: hit.attrs.y, n: hit.attrs.x };
    let egid: number | undefined;
    if (hit.attrs.featureId != null) {
      const m = String(hit.attrs.featureId).match(/^(\d+)(?:_\d+)?$/);
      if (m) egid = Number(m[1]);
    }

    const facts: AdapterOutput['facts'] = [
      { key: 'adresse.label', value: label, request_url: url },
      { key: 'adresse.eingabe', value: adresse, request_url: url },
      { key: 'adresse.koordinaten.e', value: lv95.e, unit: 'm (LV95)', request_url: url },
      { key: 'adresse.koordinaten.n', value: lv95.n, unit: 'm (LV95)', request_url: url },
    ];
    if (hit.attrs.lat != null && hit.attrs.lon != null) {
      facts.push({ key: 'adresse.koordinaten.lat', value: hit.attrs.lat, request_url: url });
      facts.push({ key: 'adresse.koordinaten.lon', value: hit.attrs.lon, request_url: url });
    }
    if (egid != null) facts.push({ key: 'gebaeude.egid', value: egid, request_url: url });

    const keys: AdapterOutput['keys'] = { lv95 };
    if (egid != null) keys.egid = egid;
    return { facts, keys };
  },
};
