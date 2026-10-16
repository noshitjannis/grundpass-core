import { z } from 'zod';
import { SchemaDriftError } from '../errors.ts';
import { geoResultsSchema, identifyUrl, nullableString } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Kulturgüterschutz-Inventar des Bundes (KGS, BABS). Layer `ch.babs.kulturgueter`: Punkte der Objekte von nationaler Bedeutung
 * (Inventar 2021, rund 3400 Objekte, Geobasisdatensatz 65.1, Datenstand 30.06.2026). identify mit Toleranz 15 (bei imageDisplay
 * 100,100,96 und 100 m Extent ist 1 px = 1 m), returnGeometry=true (Esri-Form: geometry {x, y}). Übernommen wird nur, was
 * rechnerisch innerhalb von 15 m um den Gebäudepunkt liegt; die Distanz ist ein Fakt. Nächster Treffer zuerst.
 *
 * Verifiziert 16.10.2026: Wabern und Zürich Bahnhofstrasse-Gegend ohne Treffer (betroffen false, kein Default, keine Lücke);
 * Gebäudepunkt Bim Zytglogge 3, Bern (2600698.025/1199652.118): Zeitglockenturm (KGS_NR665) in 1 m und das Haus Bim Zytglogge 1
 * (KGS_NR696) in 9 m. Gelesene Felder: kgs_nr, beschreibung, kgs_kategorie, gemeinde, kanton, objektart_de_list; nicht gelesen:
 * adresse_list, weblinks_list, bemerkung_list, bild_nr_list, die fr/it-Listen, ehemaligegemeinde.
 *
 * kgs_kategorie ist im Layer durchgehend «A.A» (find auf A.A trifft, A.S/B.A/B nicht). Der erste Buchstabe ist die KGS-Kategorie
 * (A national, B regional; der Layer enthält laut Legende nur Objekte von nationaler Bedeutung), der Rest ist nicht dokumentiert
 * und wird nicht gedeutet: lesbar nur A/B, roh der ganze Code.
 *
 * Der Inventarpunkt sitzt irgendwo auf dem Objekt, der Gebäudepunkt des GWR auch: Bei grossen Objekten (Bundeshaus: 31 m) liegen
 * sie weiter als 15 m auseinander, dann ist betroffen false. Das ist die bewusste Grenze dieses Adapters.
 * Was hier nicht steht: das ISOS (Ortsbilder) und der kommunale oder kantonale Denkmalschutz des Gebäudes (docs/QUELLEN.md).
 */
const LAYER = 'ch.babs.kulturgueter';
export const KGS_UMKREIS_M = 15;

const attrs = z.object({
  kgs_nr: nullableString,
  beschreibung: nullableString,
  kgs_kategorie: nullableString,
  gemeinde: nullableString,
  kanton: nullableString,
  objektart_de_list: nullableString,
});
const esriPoint = z.object({ x: z.number(), y: z.number() });

/** A → «A (national)», B → «B (regional)», sonst null. Mehr sagt der Code nicht eindeutig. */
export function kgsKategorie(code: string | null): string | null {
  if (!code) return null;
  if (/^A(\.|$)/.test(code)) return 'A (national)';
  if (/^B(\.|$)/.test(code)) return 'B (regional)';
  return null;
}

/** «KGS_NR665» → 665, sonst null. */
export function kgsNummer(kgsNr: string | null): number | null {
  const m = kgsNr?.match(/^KGS_NR(\d+)$/);
  return m ? Number(m[1]) : null;
}

export const kulturgueter: Adapter = {
  manifest: {
    id: 'kulturgueter',
    title: 'KGS-Inventar (Kulturgüterschutz)',
    provider: 'BABS',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['kulturgut.'],
    ttlDays: 180,
    version: 1,
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BABS (KGS-Inventar)',
    endpoint: `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:${LAYER}`,
    status: 'verifiziert',
    notes:
      'identify mit Toleranz 15 m am Gebäudepunkt, übernommen nur Treffer innerhalb 15 m (Distanz als Fakt). Kulturgüterschutz ist kein Denkmalschutz im engen Sinn; ISOS und kommunaler Denkmalschutz fehlen.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const url = identifyUrl([LAYER], point, { tolerance: KGS_UMKREIS_M, geometry: true });
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const treffer = data.results
      .map((r) => {
        const a = attrs.parse(r.attributes);
        const g = esriPoint.safeParse(r.geometry);
        if (!g.success) throw new SchemaDriftError(url, 'KGS-Treffer ohne Punktgeometrie (x, y)');
        return { a, distanz: Math.hypot(g.data.x - point.e, g.data.y - point.n) };
      })
      .filter((t) => t.distanz <= KGS_UMKREIS_M)
      .sort((x, y) => x.distanz - y.distanz);

    const facts: AdapterOutput['facts'] = [{ key: 'kulturgut.kgs.betroffen', value: treffer.length > 0, request_url: url, confidence: 1 }];
    const naechster = treffer[0];
    if (naechster) {
      const { a, distanz } = naechster;
      facts.push(
        { key: 'kulturgut.kgs.name', value: a.beschreibung, request_url: url },
        { key: 'kulturgut.kgs.kategorie', value: kgsKategorie(a.kgs_kategorie), request_url: url, confidence: 0.8 },
        { key: 'kulturgut.kgs.kategorie_code', value: a.kgs_kategorie, request_url: url },
        { key: 'kulturgut.kgs.nummer', value: kgsNummer(a.kgs_nr), request_url: url },
        { key: 'kulturgut.kgs.objektart', value: a.objektart_de_list, request_url: url },
        { key: 'kulturgut.kgs.distanz_m', value: Math.round(distanz), unit: 'm', request_url: url, confidence: 0.95 },
      );
      if (treffer.length > 1) facts.push({ key: 'kulturgut.kgs.weitere_im_umkreis', value: treffer.length - 1, request_url: url });
    }
    return { facts };
  },
};
