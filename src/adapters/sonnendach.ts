import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { geoResultsSchema, identifyUrl, nullableNumberish, nullableString } from '../http/geoadmin.ts';
import { pickKey } from '../keys.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

/**
 * Sonnendach (BFE): Eignung der Dachflächen für Solarstrom und Solarwärme.
 * Layer `ch.bfe.solarenergie-eignung-daecher`. Ein Treffer = eine Dachfläche (Segment).
 *
 * Verifiziert 15.10.2026 am Gebäudepunkt Maygutstrasse 26, Wabern (2601737/1197338.426), Fixtures sind die echten Antworten:
 *  - tolerance=0: ein Segment unter dem Punkt (df_nummer 4, Klasse 2) plus Pseudo-Treffer featureId -99 (Hinweistext), den wir ignorieren.
 *  - tolerance=20 (imageDisplay 100,100,96, mapExtent 100 m): 6 Treffer, davon 4 Segmente des Gebäudes
 *    (building_id 1131629, gwr_egid 1271632, df_nummer 1 bis 4) und 2 Segmente des Nachbarhauses (gwr_egid 1271643).
 *    tolerance=30 liefert byte-identisch dasselbe.
 *  - `find` auf building_id oder gwr_egid läuft in ein 504 Gateway Timeout (nach rund 60 s). Nicht brauchbar.
 * Felder je Segment (Auszug): klasse 4, klasse_text "Sehr gut##Trés bonne##Molto buona##Very good##Sehr gut", flaeche 75.14,
 * ausrichtung 40, neigung 26, mstrahlung 1380 (kWh/m²/a), stromertrag 16592 (kWh/a), stromertrag_winterhalbjahr 5132,
 * finanzertrag 1659.2 (CHF/a), waermeertrag 6529; Gebäudeebene (auf allen Segmenten gleich): bedarf_heizung 18154, bedarf_warmwasser 3600.
 *
 * Ablauf: identify tolerance=0 am Gebäudepunkt → Segment unter dem Punkt (liefert building_id und gwr_egid).
 * Danach identify mit Toleranz 20, gefiltert auf dieselbe gwr_egid oder building_id. Schlägt der zweite Aufruf fehl,
 * bleibt es beim einen Segment. `solar.segmente_vollstaendig` ist nur true, wenn die df_nummer der gefundenen
 * Segmente lückenlos 1 bis n sind (so nummeriert Sonnendach die Dachflächen eines Gebäudes; beobachtet an zwei Gebäuden).
 * Bestes Segment: höchste Klasse, bei Gleichstand höhere Einstrahlung (mstrahlung), dann grössere Fläche.
 * Ohne diese Regel hinge "bestes Segment" von der Reihenfolge in der API-Antwort ab.
 */
const seg = z.object({
  klasse: nullableNumberish,
  klasse_text: nullableString,
  flaeche: nullableNumberish,
  ausrichtung: nullableNumberish,
  neigung: nullableNumberish,
  mstrahlung: nullableNumberish,
  gstrahlung: nullableNumberish,
  stromertrag: nullableNumberish,
  stromertrag_winterhalbjahr: nullableNumberish,
  stromertrag_sommerhalbjahr: nullableNumberish,
  finanzertrag: nullableNumberish,
  waermeertrag: nullableNumberish,
  bedarf_heizung: nullableNumberish,
  bedarf_warmwasser: nullableNumberish,
  gwr_egid: nullableNumberish,
  building_id: nullableNumberish,
  df_nummer: nullableNumberish,
  datum_aenderung: nullableString,
});
type Seg = z.infer<typeof seg>;

const LAYER = 'ch.bfe.solarenergie-eignung-daecher';

/** df_nummer 1..n ohne Lücke und ohne Doppelte? Dann haben wir alle Dachflächen des Gebäudes. */
function dfNummernLueckenlos(segs: Seg[]): boolean {
  const nummern = segs.map((s) => s.df_nummer).filter((n): n is number => n != null);
  if (nummern.length !== segs.length) return false;
  const set = new Set(nummern);
  return set.size === nummern.length && Math.max(...nummern) === nummern.length && Math.min(...nummern) === 1;
}

/** Rang für "bestes Segment": Klasse, dann Einstrahlung pro m², dann Fläche. Deterministisch, unabhängig von der API-Reihenfolge. */
function rang(s: Seg): number {
  return (s.klasse ?? 0) * 1e9 + (s.mstrahlung ?? 0) * 1e4 + Math.min(s.flaeche ?? 0, 9999);
}

export const klasseText = (k: number | null): string | null =>
  k == null ? null : ({ 1: 'gering', 2: 'mittel', 3: 'gut', 4: 'sehr gut', 5: 'hervorragend' } as Record<number, string>)[k] ?? null;

export const sonnendach: Adapter = {
  manifest: {
    id: 'sonnendach',
    title: 'Sonnendach: Solarpotenzial',
    provider: 'BFE',
    needs: ['lv95_bau'],
    yields: [],
    provides: ['solar.'],
    ttlDays: 180,
    timeoutMs: 10_000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BFE, swisstopo (Sonnendach.ch)',
    endpoint: `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?layers=all:${LAYER}`,
    status: 'verifiziert',
    notes: 'Summen über alle Segmente des Gebäudes. Beste Klasse zählt als Klasse des Gebäudes.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const point = pickKey(ctx.keys, 'lv95_bau', 'lv95') as LV95;
    const url = identifyUrl([LAYER], point, { tolerance: 0 });
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const real = data.results.filter((r) => String(r.featureId) !== '-99');
    if (real.length === 0) throw new EmptyResultError(url, 'Kein Sonnendach-Segment unter dem Punkt');
    const first = seg.parse(real[0]!.attributes);

    // Alle Segmente des Gebäudes einsammeln (Toleranz 20 reicht für Wabern, siehe Kopfkommentar).
    let segments: Seg[] = [first];
    let segmentsUrl = url;
    let vollstaendig = false;
    try {
      const wideUrl = identifyUrl([LAYER], point, { tolerance: 20 });
      const wide = await ctx.http.json(wideUrl, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
      const same = wide.data.results
        .filter((r) => String(r.featureId) !== '-99')
        .map((r) => seg.parse(r.attributes))
        .filter((s) =>
          (first.gwr_egid != null && s.gwr_egid === first.gwr_egid) ||
          (first.building_id != null && s.building_id === first.building_id),
        );
      if (same.length >= 1) {
        segments = same;
        segmentsUrl = wideUrl;
        vollstaendig = dfNummernLueckenlos(same);
      }
    } catch (err) {
      ctx.log.warn('sonnendach: umkreis-abfrage fehlgeschlagen, nur ein segment', { error: String(err) });
    }

    const sum = (f: (s: Seg) => number | null) => {
      const vals = segments.map(f).filter((v): v is number => v != null);
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : null;
    };
    const best = segments.reduce((b, s) => (rang(s) > rang(b) ? s : b), segments[0]!);

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], unit?: string, u = segmentsUrl) => {
      const f: AdapterOutput['facts'][number] = { key, value, request_url: u };
      if (unit) f.unit = unit;
      facts.push(f);
    };

    push('solar.klasse', best.klasse);
    push('solar.klasse_text', klasseText(best.klasse));
    push('solar.segmente', segments.length);
    push('solar.segmente_vollstaendig', vollstaendig);
    push('solar.dachflaeche_m2', sum((s) => s.flaeche), 'm2');
    push('solar.einstrahlung_max_kwh_m2a', Math.max(...segments.map((s) => s.mstrahlung ?? 0)) || null, 'kWh/m2/a');
    push('solar.stromertrag_kwh_a', sum((s) => s.stromertrag), 'kWh/a');
    push('solar.stromertrag_winter_kwh_a', sum((s) => s.stromertrag_winterhalbjahr), 'kWh/a');
    push('solar.finanzertrag_chf_a', sum((s) => s.finanzertrag), 'CHF/a');
    push('solar.waermeertrag_kwh_a', sum((s) => s.waermeertrag), 'kWh/a');
    push('solar.bestes_segment.ausrichtung_grad', best.ausrichtung, '° (0 = Süd)');
    push('solar.bestes_segment.neigung_grad', best.neigung, '°');
    push('solar.bestes_segment.flaeche_m2', best.flaeche != null ? Math.round(best.flaeche) : null, 'm2');
    // Gebäudeebene (identisch auf allen Segmenten)
    push('solar.waermebedarf_heizung_kwh_a', first.bedarf_heizung, 'kWh/a', url);
    push('solar.waermebedarf_warmwasser_kwh_a', first.bedarf_warmwasser, 'kWh/a', url);
    if (first.building_id != null) push('solar.building_id', first.building_id, undefined, url);

    const out: AdapterOutput = { facts };
    const m = first.datum_aenderung?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (m) out.source_date = `${m[3]}-${m[2]}-${m[1]}`;
    return out;
  },
};
