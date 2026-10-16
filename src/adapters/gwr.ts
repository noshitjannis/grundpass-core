import { z } from 'zod';
import * as codes from '../codes/gwr.ts';
import { EmptyResultError } from '../errors.ts';
import { findUrl, geoResultsSchema, nullableNumberish, nullableString } from '../http/geoadmin.ts';
import type { Adapter, AdapterOutput } from '../types.ts';

/**
 * Eidg. Gebäude- und Wohnungsregister (GWR) über geo.admin `find` auf dem Layer
 * `ch.bfs.gebaeude_wohnungs_register`. Ein Aufruf liefert Gebäude UND Wohnungen (als Arrays).
 *
 * Verifiziert 15.10.2026 mit EGID 1271632 (Maygutstrasse 26, Wabern), Fixture ist die echte Antwort. Feldliste in docs/QUELLEN.md.
 * Die API liefert egid, edid und stroffiziel als Strings, Zahlenfelder sonst als Zahlen (nullableNumberish fängt beides).
 * `find` ist ohne contains=false eine Teilstring-Suche (searchText 1271632 traf auch EGID 191271632, Gossau SG).
 * findUrl setzt contains=false; zusätzlich wird auf die exakte EGID gefiltert. Kein Treffer mit dieser EGID ist eine Lücke,
 * nie ein anderes Gebäude.
 * Wichtig: Das GWR liefert hier schon EGRID und Parzellennummer (egrid, lparz) sowie die Gebäudekoordinate
 * (gkode/gkodn). Darum ist das GWR der Schlüssel-Lieferant für alle Stufen danach.
 */
const attrs = z.object({
  egid: nullableNumberish,
  strname_deinr: nullableString,
  plz_plz6: nullableString,
  ggdename: nullableString,
  ggdenr: nullableNumberish,
  gexpdat: nullableString,
  gdekt: nullableString,
  egrid: nullableString,
  lparz: nullableString,
  gkode: nullableNumberish,
  gkodn: nullableNumberish,
  gstat: nullableNumberish,
  gkat: nullableNumberish,
  gklas: nullableNumberish,
  gbauj: nullableNumberish,
  gbaup: nullableNumberish,
  gabbj: nullableNumberish,
  garea: nullableNumberish,
  gvol: nullableNumberish,
  gastw: nullableNumberish,
  ganzwhg: nullableNumberish,
  gebf: nullableNumberish,
  gwaerzh1: nullableNumberish,
  genh1: nullableNumberish,
  gwaerdath1: nullableString,
  gwaerzh2: nullableNumberish,
  genh2: nullableNumberish,
  gwaerzw1: nullableNumberish,
  genw1: nullableNumberish,
  gwaerdatw1: nullableString,
  dplz4: nullableNumberish,
  dplzname: nullableString,
  strname: z.array(z.string()).nullable().optional(),
  deinr: nullableString,
  // Wohnungen als parallele Arrays
  ewid: z.array(z.union([z.string(), z.number()]).nullable()).nullable().optional(),
  wstwk: z.array(z.number().nullable()).nullable().optional(),
  wstat: z.array(z.number().nullable()).nullable().optional(),
  wbauj: z.array(z.number().nullable()).nullable().optional(),
  warea: z.array(z.number().nullable()).nullable().optional(),
  wazim: z.array(z.number().nullable()).nullable().optional(),
  wkche: z.array(z.number().nullable()).nullable().optional(),
  wmehrg: z.array(z.number().nullable()).nullable().optional(),
});

/** "12.10.2026" → "2026-10-12" */
function chDateToIso(s: string | null): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : undefined;
}

export const gwr: Adapter = {
  manifest: {
    id: 'gwr',
    title: 'GWR Gebäude und Wohnungen',
    provider: 'BFS',
    needs: ['egid'],
    yields: ['egrid', 'lv95_bau', 'bfs_nr', 'kanton', 'parzelle_nr'],
    provides: ['gebaeude.', 'wohnung.', 'wohnungen.', 'adresse.gemeinde', 'adresse.kanton', 'parzelle.nummer', 'parzelle.egrid'],
    ttlDays: 30,
    version: 2, // 16.10.2026: Code-Fakten zu jedem Textfakt (heizung.kurz_code, heizung2.*_code, warmwasser.*_code, wohnung.<ewid>.status_code), damit die View in jeder Sprache aus dem Code rendert
    timeoutMs: 8000,
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© BFS, Gebäude- und Wohnungsregister (GWR)',
    endpoint: 'https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.bfs.gebaeude_wohnungs_register',
    status: 'verifiziert',
    notes: 'Codes nach Merkmalskatalog 4.2 (de), 4.3 (fr, it, en). Unbekannte Codes bleiben roh. Jeder Textfakt hat einen Code-Fakt daneben. Baujahr fehlt oft, dann gibt es nur die Bauperiode.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const egid = ctx.keys.egid!;
    const url = findUrl('ch.bfs.gebaeude_wohnungs_register', 'egid', egid);
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const feature = data.results.find((r) => String(r.attributes.egid) === String(egid));
    if (!feature) throw new EmptyResultError(url, `EGID ${egid} nicht im GWR`);
    const a = attrs.parse(feature.attributes);

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], unit?: string) => {
      const f: AdapterOutput['facts'][number] = { key, value, request_url: url };
      if (unit) f.unit = unit;
      facts.push(f);
    };

    // Adresse laut GWR
    if (a.strname_deinr) push('adresse.strasse_nr', a.strname_deinr);
    if (a.dplz4 != null) push('adresse.plz', a.dplz4);
    if (a.dplzname) push('adresse.ort', a.dplzname);
    if (a.ggdename) push('adresse.gemeinde', a.ggdename);
    if (a.ggdenr != null) push('adresse.bfs_nr', a.ggdenr);
    if (a.gdekt) push('adresse.kanton', a.gdekt);

    // Gebäude
    push('gebaeude.egid', egid);
    push('gebaeude.status', codes.gebaeudeStatus(a.gstat));
    push('gebaeude.status_code', a.gstat);
    push('gebaeude.kategorie', codes.gebaeudeKategorie(a.gkat));
    push('gebaeude.kategorie_code', a.gkat);
    push('gebaeude.klasse', codes.gebaeudeKlasse(a.gklas));
    push('gebaeude.klasse_kurz', codes.gebaeudeKlasseKurz(a.gklas));
    push('gebaeude.klasse_code', a.gklas);
    push('gebaeude.baujahr', a.gbauj);
    push('gebaeude.bauperiode', codes.bauperiode(a.gbaup));
    push('gebaeude.bauperiode_code', a.gbaup);
    const mitte = codes.bauperiodeMitte(a.gbaup);
    if (a.gbauj == null && mitte) push('gebaeude.bauperiode_mitte', Number(mitte));
    if (a.gabbj != null) push('gebaeude.abbruchjahr', a.gabbj);
    push('gebaeude.grundflaeche_m2', a.garea, 'm2');
    push('gebaeude.volumen_m3', a.gvol, 'm3');
    push('gebaeude.energiebezugsflaeche_m2', a.gebf, 'm2');
    push('gebaeude.geschosse', a.gastw);
    push('gebaeude.wohnungen_anzahl', a.ganzwhg);
    if (a.gkode != null && a.gkodn != null) {
      push('gebaeude.koordinaten.e', a.gkode, 'm (LV95)');
      push('gebaeude.koordinaten.n', a.gkodn, 'm (LV95)');
    }

    // Heizung und Warmwasser
    push('gebaeude.heizung.erzeuger', codes.waermeerzeugerHeizung(a.gwaerzh1));
    push('gebaeude.heizung.erzeuger_code', a.gwaerzh1);
    push('gebaeude.heizung.energietraeger', codes.energietraeger(a.genh1));
    push('gebaeude.heizung.energietraeger_code', a.genh1);
    push('gebaeude.heizung.kurz', codes.heizungKurz(a.gwaerzh1, a.genh1));
    push('gebaeude.heizung.kurz_code', codes.heizungKurzCode(a.gwaerzh1, a.genh1));
    if (a.gwaerdath1) push('gebaeude.heizung.stand', chDateToIso(a.gwaerdath1) ?? a.gwaerdath1);
    if (a.gwaerzh2 != null) {
      push('gebaeude.heizung2.erzeuger', codes.waermeerzeugerHeizung(a.gwaerzh2));
      push('gebaeude.heizung2.erzeuger_code', a.gwaerzh2);
      push('gebaeude.heizung2.energietraeger', codes.energietraeger(a.genh2));
      push('gebaeude.heizung2.energietraeger_code', a.genh2);
    }
    push('gebaeude.warmwasser.erzeuger', codes.waermeerzeugerWarmwasser(a.gwaerzw1));
    push('gebaeude.warmwasser.erzeuger_code', a.gwaerzw1);
    push('gebaeude.warmwasser.energietraeger', codes.energietraeger(a.genw1));
    push('gebaeude.warmwasser.energietraeger_code', a.genw1);

    // Parzelle laut GWR
    if (a.egrid) push('parzelle.egrid', a.egrid);
    if (a.lparz) push('parzelle.nummer', a.lparz);

    // Wohnungen
    const n = a.ewid?.length ?? 0;
    for (let i = 0; i < n; i++) {
      const ewid = a.ewid?.[i];
      if (ewid == null) continue;
      const p = `wohnung.${ewid}`;
      push(`${p}.ewid`, Number(ewid));
      push(`${p}.stockwerk`, codes.stockwerk(a.wstwk?.[i] ?? null));
      push(`${p}.stockwerk_code`, a.wstwk?.[i] ?? null);
      push(`${p}.status`, codes.wohnungStatus(a.wstat?.[i] ?? null));
      push(`${p}.status_code`, a.wstat?.[i] ?? null);
      push(`${p}.zimmer`, a.wazim?.[i] ?? null);
      push(`${p}.flaeche_m2`, a.warea?.[i] ?? null, 'm2');
      push(`${p}.baujahr`, a.wbauj?.[i] ?? null);
      push(`${p}.kueche`, a.wkche?.[i] == null ? null : a.wkche[i] === 1);
      push(`${p}.mehrgeschossig`, a.wmehrg?.[i] == null ? null : a.wmehrg[i] === 1);
    }

    const keys: AdapterOutput['keys'] = {};
    if (a.egrid) keys.egrid = a.egrid;
    if (a.gkode != null && a.gkodn != null) keys.lv95_bau = { e: a.gkode, n: a.gkodn };
    if (a.ggdenr != null) keys.bfs_nr = a.ggdenr;
    if (a.gdekt) keys.kanton = a.gdekt;
    if (a.lparz) keys.parzelle_nr = a.lparz;

    const out: AdapterOutput = { facts, keys };
    const sd = chDateToIso(a.gexpdat);
    if (sd) out.source_date = sd;
    return out;
  },
};
