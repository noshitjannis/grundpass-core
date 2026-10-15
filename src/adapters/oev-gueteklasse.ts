import { z } from 'zod';
import { geoResultsSchema, identifyUrl, nullableString } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * ÖV-Güteklassen des ARE. Layer `ch.are.gueteklassen_oev`.
 * Verifiziert 15.10.2026: klasse_de "D - geringe Erschliessung", klasse_fr "D - faible desserte".
 * Liegt der Punkt in keinem Polygon, ist das kein Fehler: Das Gebäude liegt ausserhalb der Güteklassen
 * (sehr geringe Erschliessung). Wir liefern dann `keine`.
 */
const attrs = z.object({ klasse_de: nullableString, klasse_fr: nullableString });

const TEXT: Record<string, string> = {
  A: 'sehr gute Erschliessung',
  B: 'gute Erschliessung',
  C: 'mittelmässige Erschliessung',
  D: 'geringe Erschliessung',
};

export const oevGueteklasse: Adapter = {
  manifest: {
    id: 'oev-gueteklasse',
    title: 'ÖV-Güteklasse',
    provider: 'ARE',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['oev.'],
    ttlDays: 180,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© ARE (ÖV-Güteklassen)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:ch.are.gueteklassen_oev',
    status: 'verifiziert',
    notes: 'A bis D. Ausserhalb aller Polygone = keine Güteklasse, das ist ein gültiger Wert.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const url = identifyUrl(['ch.are.gueteklassen_oev'], point);
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const hit = data.results[0];
    if (!hit) {
      return {
        facts: [
          { key: 'oev.gueteklasse', value: 'keine', request_url: url },
          { key: 'oev.gueteklasse_text', value: 'ausserhalb der ÖV-Güteklassen, sehr geringe Erschliessung', request_url: url },
        ],
      };
    }
    const a = attrs.parse(hit.attributes);
    const letter = a.klasse_de?.trim().charAt(0).toUpperCase() ?? null;
    const text = letter && TEXT[letter] ? TEXT[letter] : (a.klasse_de ?? null);
    return {
      facts: [
        { key: 'oev.gueteklasse', value: letter, request_url: url },
        { key: 'oev.gueteklasse_text', value: text, request_url: url },
      ],
    };
  },
};
