import { z } from 'zod';
import { EmptyResultError, SchemaDriftError } from '../errors.ts';
import type { Adapter, AdapterOutput } from '../types.ts';
import { GRUNDNUTZUNG_SUBCODE, OEREB_KANTONE, OEREB_KANTONE_LISTE, oerebExtractUrl, type OerebKanton } from './oereb/kantone.ts';

/**
 * ÖREB-Kataster: Zone (Grundnutzung), Lärm-Empfindlichkeitsstufe, amtliche Grundbuchfläche und die weiteren
 * Eigentumsbeschränkungen einer Parzelle. Datenextrakt per EGRID vom kantonalen Webservice (Tabelle in oereb/kantone.ts).
 *
 * Antwortform (extract-2.0, openoereb-JSON), verifiziert 15.10.2026 an Wabern BE, Baden und Klingnau AG, Zürich und
 * Winterthur ZH: `GetExtractByIdResponse.extract` (BE, AG) bzw. `.Extract` (ZH) mit `RealEstate.{EGRID, Number, IdentDN,
 * Canton, MunicipalityName, MunicipalityCode, LandRegistryArea, RestrictionOnLandownership[]}`. Jede Beschränkung:
 * `Theme.{Code|code, SubCode?, Text[]}` (ZH schreibt `code` klein), `LegendText[]`, `TypeCode`, `Lawstatus.Code`
 * (inForce, changeWithPreEffect …), `PartInPercent`/`AreaShare` bei Flächen, `LengthShare` bei Linien (Baulinien),
 * `LegalProvisions[].{Title[], TextAtWeb[]}`. Texte sind Listen `{Language, Text}`, wir nehmen `de`, sonst den ersten.
 * Antwort 204 ohne Inhalt heisst: EGRID in diesem Kataster unbekannt (Lücke, kein Ausfall).
 *
 * Nicht im Kataster und darum hier nicht erfunden: Ausnützungsziffer, Geschosszahl, Grenzabstände. Die stehen im
 * kommunalen Baureglement bzw. der BNO; wir liefern den Link darauf (`zone.baureglement_url`), wenn der Extract ihn nennt.
 */

// ---------------------------------------------------------------------------
// Schema: nur, was wir lesen. Unbekannte Felder werden gestrippt.
// ---------------------------------------------------------------------------

const textEintrag = z.object({ Language: z.string().optional(), Text: z.string() });
const texte = z.union([z.array(textEintrag), textEintrag, z.string()]);
const thema = z.object({ Code: z.string().optional(), code: z.string().optional(), SubCode: z.string().optional(), Text: texte.optional() });
const rechtsvorschrift = z.object({ Title: texte.optional(), TextAtWeb: texte.optional() });
const beschraenkung = z.object({
  LegendText: texte.optional(),
  Theme: thema,
  TypeCode: z.string().optional(),
  Lawstatus: z.object({ Code: z.string().optional(), code: z.string().optional() }).optional(),
  AreaShare: z.number().optional(),
  PartInPercent: z.number().optional(),
  LengthShare: z.number().optional(),
  NrOfPoints: z.number().optional(),
  LegalProvisions: z.array(rechtsvorschrift).optional(),
});
const liegenschaft = z.object({
  EGRID: z.string().optional(),
  Number: z.string().optional(),
  IdentDN: z.string().optional(),
  Canton: z.string().optional(),
  MunicipalityName: z.string().optional(),
  MunicipalityCode: z.union([z.number(), z.string()]).optional(),
  LandRegistryArea: z.number().optional(),
  RestrictionOnLandownership: z.array(beschraenkung).optional(),
});
const extract = z.object({
  UpdateDateCS: z.string().optional(),
  CreationDate: z.string().optional(),
  RealEstate: liegenschaft,
  ConcernedTheme: z.array(thema).optional(),
  NotConcernedTheme: z.array(thema).optional(),
  ThemeWithoutData: z.array(thema).optional(),
  PLRCadastreAuthority: z.object({ Name: texte.optional(), OfficeAtWeb: texte.optional() }).optional(),
});
export const extractResponseSchema = z.object({
  GetExtractByIdResponse: z.object({ extract: extract.optional(), Extract: extract.optional() }),
});

type Texte = z.infer<typeof texte>;
type Beschraenkung = z.infer<typeof beschraenkung>;

/** Deutscher Text aus einer mehrsprachigen Liste, sonst der erste. */
export function textDe(t: Texte | undefined): string | undefined {
  if (t === undefined) return undefined;
  if (typeof t === 'string') return t;
  if (!Array.isArray(t)) return t.Text;
  return (t.find((x) => x.Language === 'de') ?? t[0])?.Text;
}

/** `ch.BE.Gewaesserschutzbereiche` → `gewaesserschutzbereiche`, `ch.BelasteteStandorte` → `belastete_standorte`. */
export function themaSlug(code: string): string {
  return code
    .replace(/^ch\./, '')
    .replace(/^[A-Z]{2}\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

export type Stufe = 'I' | 'II' | 'III' | 'IV';
const STUFEN: Record<string, Stufe> = { I: 'I', II: 'II', III: 'III', IV: 'IV', '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };

/**
 * Empfindlichkeitsstufe aus Legende oder TypeCode. Beobachtet: AG «Empfindlichkeitsstufe III» / `ES_III`,
 * ZH «Empfindlichkeitsstufe II, aufgestuft (nein)» / `laermempfindlichkeitsstufen_2_0`, ZH «Empfindlichkeitsstufe keine» / `…_0_0`.
 * Nichts Erkennbares → null, es wird keine Stufe geraten.
 */
export function parseStufe(legend?: string, typeCode?: string): Stufe | null {
  const m1 = legend?.match(/Empfindlichkeitsstufe\s*(IV|III|II|I)(?![IVX])/i);
  if (m1?.[1]) return STUFEN[m1[1].toUpperCase()] ?? null;
  const m2 = typeCode?.match(/(?:^|[^A-Za-z0-9])(?:ES[_ -]?)?(IV|III|II|I)(?![A-Za-z])/);
  if (m2?.[1]) return STUFEN[m2[1]] ?? null;
  const m3 = typeCode?.match(/(?:^|[^0-9])([1-4])(?:[^0-9]|$)/);
  if (m3?.[1] && /empfindlichkeit|^ES/i.test(typeCode ?? '')) return STUFEN[m3[1]] ?? null;
  return null;
}

type Eintrag = {
  code: string;
  subCode?: string;
  thema?: string;
  legende?: string;
  typeCode?: string;
  inKraft: boolean;
  anteil?: number;
  flaeche?: number;
  laenge?: number;
  rechtsvorschriften: Array<{ titel?: string; url?: string }>;
};

function normalisiere(b: Beschraenkung): Eintrag {
  const e: Eintrag = {
    code: b.Theme.Code ?? b.Theme.code ?? '',
    inKraft: (b.Lawstatus?.Code ?? b.Lawstatus?.code ?? 'inForce') === 'inForce',
    rechtsvorschriften: (b.LegalProvisions ?? []).map((r) => {
      const o: { titel?: string; url?: string } = {};
      const t = textDe(r.Title);
      const u = textDe(r.TextAtWeb);
      if (t) o.titel = t;
      if (u) o.url = u;
      return o;
    }),
  };
  if (b.Theme.SubCode) e.subCode = b.Theme.SubCode;
  const th = textDe(b.Theme.Text);
  if (th) e.thema = th;
  const lg = textDe(b.LegendText);
  if (lg) e.legende = lg;
  if (b.TypeCode) e.typeCode = b.TypeCode;
  if (typeof b.PartInPercent === 'number') e.anteil = b.PartInPercent;
  if (typeof b.AreaShare === 'number') e.flaeche = b.AreaShare;
  if (typeof b.LengthShare === 'number') e.laenge = b.LengthShare;
  return e;
}

function istGrundnutzung(e: Eintrag, k: OerebKanton): boolean {
  if (e.code !== 'ch.Nutzungsplanung') return false;
  if (e.subCode) return GRUNDNUTZUNG_SUBCODE.test(e.subCode);
  return !!k.grundnutzungTypeCode && !!e.typeCode && k.grundnutzungTypeCode.test(e.typeCode);
}

const istLaermStufe = (e: Eintrag) => /Laermempfindlichkeitsstufen$/.test(e.code);
const nachAnteil = (a: Eintrag, b: Eintrag) => (b.anteil ?? -1) - (a.anteil ?? -1) || (b.flaeche ?? -1) - (a.flaeche ?? -1);
const BAUREGLEMENT = /Baureglement|Nutzungsordnung|Zonenordnung|Zonenreglement|Bauordnung|Baugesetz der Gemeinde/i;

export const oereb: Adapter = {
  manifest: {
    id: 'oereb',
    title: 'ÖREB-Kataster',
    provider: 'Kantone (ÖREB-Kataster)',
    needs: ['egrid', 'kanton'],
    yields: [],
    provides: ['zone.', 'oereb.', 'laerm.empfindlichkeitsstufe', 'parzelle.flaeche_grundbuch_m2'],
    ttlDays: 14,
    timeoutMs: 20000,
    cantons: OEREB_KANTONE_LISTE,
    license: 'Öffentlicher amtlicher Kataster (Art. 16a GeoIG, ÖREBKV), frei nutzbar mit Quellenangabe',
    attribution: '© ÖREB-Kataster der Kantone AG, ZH und BE',
    endpoint: '<kantonale Basis>/extract/json?EGRID=<EGRID>, Basis pro Kanton in src/adapters/oereb/kantone.ts',
    status: 'verifiziert',
    notes:
      'Grundnutzung als Hauptzone (grösster Anteil), weitere Grundnutzungen als zone.weitere.<n>.*, überlagernde Nutzungsplanung und alle anderen betroffenen Themen als oereb.<thema>.*. Lärm-Empfindlichkeitsstufe nur, wenn der Kataster sie führt. Ausnützungsziffer steht nicht im ÖREB-Kataster, sondern im Baureglement (Link, wenn vorhanden).',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const kanton = ctx.keys.kanton;
    const egrid = ctx.keys.egrid;
    const k = kanton ? OEREB_KANTONE[kanton] : undefined;
    if (!k) throw new Error(`ÖREB-Kataster für Kanton ${kanton ?? '?'} nicht angeschlossen`);
    if (!egrid) throw new Error('ÖREB-Kataster: EGRID fehlt');

    const url = oerebExtractUrl(k, egrid);
    const res = await ctx.http.text(url, { timeoutMs: this.manifest.timeoutMs });
    if (res.status === 204 || !res.data.trim()) throw new EmptyResultError(url, `EGRID ${egrid} ist im ÖREB-Kataster ${k.kanton} nicht bekannt`);
    let raw: unknown;
    try {
      raw = JSON.parse(res.data);
    } catch {
      throw new SchemaDriftError(url, `Antwort ist kein JSON: ${res.data.slice(0, 120)}`);
    }
    let parsed: z.infer<typeof extractResponseSchema>;
    try {
      parsed = extractResponseSchema.parse(raw);
    } catch (err) {
      throw new SchemaDriftError(url, (err as Error).message.slice(0, 600));
    }
    const ex = parsed.GetExtractByIdResponse.extract ?? parsed.GetExtractByIdResponse.Extract;
    if (!ex) throw new SchemaDriftError(url, 'GetExtractByIdResponse ohne extract/Extract');

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], extra: Partial<AdapterOutput['facts'][number]> = {}) =>
      facts.push({ key, value, request_url: url, ...extra });

    const re = ex.RealEstate;
    if (typeof re.LandRegistryArea === 'number') push('parzelle.flaeche_grundbuch_m2', re.LandRegistryArea, { unit: 'm2', confidence: 1 });

    const alle = (re.RestrictionOnLandownership ?? []).map(normalisiere);
    const inKraft = alle.filter((e) => e.inKraft);
    const haengig = alle.length - inKraft.length;

    // Zone: Grundnutzung, grösster Anteil zuerst
    const zonen = inKraft.filter((e) => istGrundnutzung(e, k)).sort(nachAnteil);
    const haupt = zonen[0];
    const zc = k.zoneConfidence;
    if (haupt) {
      push('zone.bezeichnung', haupt.legende ?? null, { confidence: zc });
      if (haupt.typeCode) push('zone.code', haupt.typeCode, { confidence: zc });
      if (haupt.anteil != null) push('zone.anteil_prozent', haupt.anteil, { unit: '%', confidence: zc });
      push('zone.anzahl', zonen.length, { confidence: zc });
      zonen.slice(1).forEach((z, i) => {
        const n = i + 1;
        push(`zone.weitere.${n}.bezeichnung`, z.legende ?? null, { confidence: zc });
        if (z.typeCode) push(`zone.weitere.${n}.code`, z.typeCode, { confidence: zc });
        if (z.anteil != null) push(`zone.weitere.${n}.anteil_prozent`, z.anteil, { unit: '%', confidence: zc });
      });
      const reglement = haupt.rechtsvorschriften.find((r) => r.titel && BAUREGLEMENT.test(r.titel) && r.url);
      if (reglement?.url) {
        push('zone.baureglement_url', reglement.url, { confidence: zc });
        if (reglement.titel) push('zone.baureglement_titel', reglement.titel, { confidence: zc });
      }
    }

    // Lärm-Empfindlichkeitsstufe: Eintrag mit grösstem Anteil, der eine Stufe I bis IV nennt
    const stufen = inKraft.filter(istLaermStufe).sort(nachAnteil);
    const mitStufe = stufen.map((e) => ({ e, stufe: parseStufe(e.legende, e.typeCode) })).find((x) => x.stufe);
    if (mitStufe) {
      push('laerm.empfindlichkeitsstufe', mitStufe.stufe, { confidence: 1 });
      if (mitStufe.e.legende) push('laerm.empfindlichkeitsstufe_text', mitStufe.e.legende);
      if (mitStufe.e.anteil != null) push('laerm.empfindlichkeitsstufe_anteil_prozent', mitStufe.e.anteil, { unit: '%' });
    } else if (stufen[0]?.legende) {
      // Kataster führt das Thema, nennt aber keine Stufe I bis IV (z.B. «keine»): Text zeigen, Stufe offen lassen.
      push('laerm.empfindlichkeitsstufe_text', stufen[0].legende);
    }

    // Weitere Themen: alles ausser Grundnutzung und Lärmstufen, gruppiert nach Thema
    type Gruppe = { thema: string; texte: string[]; anteil?: number; laenge: number; anzahl: number };
    const gruppen = new Map<string, Gruppe>();
    for (const e of inKraft) {
      if (istGrundnutzung(e, k) || istLaermStufe(e)) continue;
      const ueberlagernd = e.code === 'ch.Nutzungsplanung';
      const slug = ueberlagernd ? 'nutzungsplanung_ueberlagernd' : themaSlug(e.code || e.thema || 'unbekannt');
      const g = gruppen.get(slug) ?? { thema: ueberlagernd ? 'Nutzungsplanung: überlagernde Festlegungen' : (e.thema ?? e.code), texte: [], laenge: 0, anzahl: 0 };
      if (e.legende && !g.texte.includes(e.legende)) g.texte.push(e.legende);
      if (e.anteil != null) g.anteil = Math.max(g.anteil ?? 0, e.anteil);
      if (e.laenge != null) g.laenge += e.laenge;
      g.anzahl++;
      gruppen.set(slug, g);
    }
    for (const [slug, g] of gruppen) {
      push(`oereb.${slug}.betroffen`, true);
      push(`oereb.${slug}.thema`, g.thema);
      if (g.texte.length) push(`oereb.${slug}.text`, g.texte.join('; '));
      if (g.anteil != null) push(`oereb.${slug}.anteil_prozent`, g.anteil, { unit: '%' });
      if (g.laenge > 0) push(`oereb.${slug}.laenge_m`, Math.round(g.laenge), { unit: 'm' });
    }
    push('oereb.belastungen_anzahl', gruppen.size);
    if (gruppen.size) push('oereb.belastungen', [...gruppen.values()].map((g) => g.thema).join('; '));
    if (haengig > 0) push('oereb.aenderungen_hangig_anzahl', haengig);

    push('oereb.auszug_pdf_url', oerebExtractUrl(k, egrid, 'pdf'));
    const katasterUrl = textDe(ex.PLRCadastreAuthority?.OfficeAtWeb);
    if (katasterUrl) push('oereb.kataster_url', katasterUrl);

    const out: AdapterOutput = { facts, keys: {} };
    const stand = ex.UpdateDateCS?.slice(0, 10);
    if (stand && /^\d{4}-\d{2}-\d{2}$/.test(stand)) out.source_date = stand;
    return out;
  },
};
