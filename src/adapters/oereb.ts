import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { EmptyResultError, SchemaDriftError } from '../errors.ts';
import type { Adapter, AdapterOutput } from '../types.ts';
import {
  GRUNDNUTZUNG_HINWEIS,
  GRUNDNUTZUNG_KENNZEICHNUNG,
  NUTZUNGSPLANUNG_OHNE_DATEN_HINWEIS,
  NUTZUNGSPLANUNG_THEMA,
  OEREB_KANTONE,
  OEREB_KANTONE_ANGEBUNDEN,
  OEREB_TIMEOUT_MAX_MS,
  oerebExtractUrl,
  oerebTimeoutMs,
  type OerebKanton,
  type OerebSprache,
} from './oereb/kantone.ts';

/**
 * ÖREB-Kataster: Zone (Grundnutzung), Lärm-Empfindlichkeitsstufe, amtliche Grundbuchfläche und die weiteren
 * Eigentumsbeschränkungen einer Parzelle. Datenextrakt extract-2.0 per EGRID vom kantonalen Webservice; Basis, Sprache, Format,
 * Erkennungsregel, Timeout und Status pro Kanton in oereb/kantone.ts (26 Einträge, 24 angebunden, Inventar vom 16.10.2026).
 *
 * Antwortform: Drei JSON-Dialekte und XML (SO, SH), alle auf die openoereb-Form gebracht (parseXml, erkenneForm, normalisiereBaum),
 * bevor das Zod-Schema greift. Gemeinsam ist der Kern aus der Weisung: `RealEstate.{EGRID, Number, IdentDN, Canton, MunicipalityName,
 * MunicipalityCode, LandRegistryArea, RestrictionOnLandownership[]}`, pro Beschränkung `Theme.{Code|code, SubCode?, Text}`,
 * `LegendText`, `TypeCode`, `Lawstatus.Code` (inForce, changeWithPreEffect, changeWithoutPreEffect), `PartInPercent`/`AreaShare`
 * bei Flächen, `LengthShare` bei Linien, `NrOfPoints` bei Punkten, `LegalProvisions[].{Title, TextAtWeb}`,
 * `ResponsibleOffice.{Name, OfficeAtWeb}`; am Extract `UpdateDateCS`, `PLRCadastreAuthority` und `ThemeWithoutData` (Themen, zu denen
 * der Kataster in dieser Gemeinde keine Daten führt). Texte sind Listen `{Language, Text}` (textIn: Kantonssprache, dann de, fr, it, rm,
 * sonst der erste). Antwort 204 ohne Inhalt heisst: EGRID in diesem Kataster unbekannt (Lücke, kein Ausfall).
 *
 * Hinweistexte kommen mit Code: `zone.hinweis` trägt `zone.hinweis_code` (flaechenanteil, thema_ohne_daten), damit die View den Text in
 * jeder Sprache aus dem Code bauen kann. Der deutsche Text bleibt als Fakt (Quellsprache, API-stabil).
 *
 * Nicht im Kataster und darum hier nicht erfunden: Ausnützungsziffer, Geschosszahl, Grenzabstände. Die stehen im
 * kommunalen Baureglement bzw. der BNO; wir liefern den Link darauf (`zone.baureglement_url`), wenn der Extract ihn nennt.
 */

// ---------------------------------------------------------------------------
// Dialekte: openoereb, GeoShop (XML nach JSON), .NET-Serialisierung, XML
// ---------------------------------------------------------------------------

export type OerebForm = 'openoereb' | 'geoshop' | 'dotnet' | 'xml';

/**
 * XML-Extract (SO, SH) in einen Baum, wie ihn der JSON-Pfad kennt: Namensraum-Präfixe weg (`ns3:Extract` → `Extract`), Attribute als
 * `@…` (normalisiereBaum streicht sie), Werte bleiben Strings (die Zahlen wandelt `anzahl` wie bei GeoShop), einzelne Elemente statt
 * Arrays (die Listenfelder macht normalisiereBaum zu Arrays), Entitäten (`&amp;`) aufgelöst. Ungültiges XML (HTML-Fehlerseite,
 * abgeschnittene Antwort) wirft, der Aufrufer macht daraus Schema-Drift.
 */
export function parseXml(text: string): unknown {
  const ok = XMLValidator.validate(text);
  if (ok !== true) throw new Error(`kein gültiges XML: ${ok.err.msg}`);
  const parser = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, trimValues: true, processEntities: true });
  return parser.parse(text) as unknown;
}

/** Reihenfolge der Enumerationen im Schema OeREBKRMtrsfr_V2_0; die .NET-Dienste (FR, VD, GE) liefern den Index statt des Namens. */
const SPRACHEN_ENUM = ['de', 'fr', 'it', 'rm', 'en'];
const LAWSTATUS_ENUM = ['inForce', 'changeWithPreEffect', 'changeWithoutPreEffect'];
/** Felder, die laut Modell Listen sind. GeoShop liefert bei einem einzigen Element ein Objekt statt eines Arrays. */
const LISTEN = new Set(['RestrictionOnLandownership', 'LegalProvisions', 'ConcernedTheme', 'NotConcernedTheme', 'ThemeWithoutData', 'OtherLegend']);
/** .NET: In diesen Objekten heisst das Feld `LocalisedText` eigentlich so (Kontext = Schlüssel des Elternobjekts). */
const UMBENENNEN: Record<string, string> = { RestrictionOnLandownership: 'LegendText', OtherLegend: 'LegendText', LegalProvisions: 'TextAtWeb', ResponsibleOffice: 'OfficeAtWeb', PLRCadastreAuthority: 'OfficeAtWeb' };

/**
 * Erkennt die Hülle: openoereb `GetExtractByIdResponse.extract|Extract`, XML (geparst) `{"?xml", GetExtractByIdResponse: {Extract}}`,
 * GeoShop `{"?xml", Extract}` (oder Extract mit `@`-Attributen), .NET `{schemaLocation, Extract}` (LU) oder `{Item: {RealEstate…}}`
 * (FR, VD, GE). Sonst null.
 */
export function erkenneForm(raw: unknown): { form: OerebForm; extract: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const resp = r.GetExtractByIdResponse;
  if (resp && typeof resp === 'object') {
    const ex = (resp as Record<string, unknown>).extract ?? (resp as Record<string, unknown>).Extract;
    return ex && typeof ex === 'object' ? { form: '?xml' in r ? 'xml' : 'openoereb', extract: ex } : null;
  }
  if (r.Extract && typeof r.Extract === 'object') {
    const geoshop = '?xml' in r || Object.keys(r.Extract as object).some((k) => k.startsWith('@'));
    return { form: geoshop ? 'geoshop' : 'dotnet', extract: r.Extract };
  }
  if (r.Item && typeof r.Item === 'object' && 'RealEstate' in (r.Item as object)) return { form: 'dotnet', extract: r.Item };
  return null;
}

/**
 * Bringt einen Extract-Baum auf die openoereb-Form: `@`- und `?`-Schlüssel weg, `{LocalisedText: X}` und `{LocalisedMText: X}`
 * werden X, die .NET-Umbenennungen rückgängig (LocalisedText heisst je nach Kontext LegendText, TextAtWeb oder OfficeAtWeb),
 * Sprache und Lawstatus als Namen statt Zahlen, Listenfelder immer als Array. Zahlen als Strings bleiben Strings (siehe `zahl`).
 */
export function normalisiereBaum(value: unknown, elternKey = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => normalisiereBaum(v, elternKey));
  if (!value || typeof value !== 'object') return value;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => !k.startsWith('@') && !k.startsWith('?'));
  // GeoShop-Hülle {LocalisedText: X} auspacken; in den .NET-Kontexten ist LocalisedText dagegen ein echtes Feld (unten umbenannt)
  if (keys.length === 1 && (keys[0] === 'LocalisedText' || keys[0] === 'LocalisedMText') && !(elternKey in UMBENENNEN)) return normalisiereBaum(o[keys[0]!], elternKey);
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    let v = o[k];
    const name = k === 'LocalisedText' ? (UMBENENNEN[elternKey] ?? k) : k;
    if (k === 'Language' && typeof v === 'number') v = SPRACHEN_ENUM[v] ?? v;
    if (k === 'Code' && elternKey === 'Lawstatus' && typeof v === 'number') v = LAWSTATUS_ENUM[v] ?? v;
    if (LISTEN.has(k) && v != null && !Array.isArray(v)) v = [v];
    out[name] = normalisiereBaum(v, k);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Schema: nur, was wir lesen. Unbekannte Felder werden gestrippt.
// ---------------------------------------------------------------------------

/** Zahl, die auch als String («609») oder gar nicht kommen darf. Umrechnung in `anzahl`. */
const zahl = z.union([z.number(), z.string(), z.null()]).optional();
const textEintrag = z.object({ Language: z.union([z.string(), z.number()]).optional(), Text: z.string().nullable().optional() });
const texte = z.union([z.array(textEintrag), textEintrag, z.string()]);
/** TypeCode als String, in AR ein String mit JSON-Objekt `{"de": "…"}` (typeCodeText); ein echtes Objekt wird vorsorglich auch gelesen. */
const typeCode = z.union([z.string(), z.record(z.string(), z.string())]).nullable().optional();
const thema = z.object({ Code: z.string().optional(), code: z.string().optional(), SubCode: z.string().nullable().optional(), Text: texte.optional() });
const rechtsvorschrift = z.object({ Title: texte.optional(), TextAtWeb: texte.optional() });
/** Zuständige Stelle: ResponsibleOffice einer Beschränkung oder PLRCadastreAuthority des Katasters. Alles optional. */
const amt = z.object({
  Name: texte.optional(),
  OfficeAtWeb: texte.optional(),
  Street: z.string().nullable().optional(),
  Number: z.union([z.string(), z.number()]).nullable().optional(),
  PostalCode: z.union([z.string(), z.number()]).nullable().optional(),
  City: z.string().nullable().optional(),
});
const legendeEintrag = z.object({ LegendText: texte.optional(), TypeCode: typeCode });
const beschraenkung = z.object({
  LegendText: texte.optional(),
  Theme: thema,
  TypeCode: typeCode,
  Lawstatus: z.object({ Code: z.union([z.string(), z.number()]).optional(), code: z.string().optional() }).nullable().optional(),
  AreaShare: zahl,
  PartInPercent: zahl,
  LengthShare: zahl,
  NrOfPoints: zahl,
  LegalProvisions: z.array(rechtsvorschrift).nullable().optional(),
  ResponsibleOffice: amt.nullable().optional(),
  Map: z.object({ OtherLegend: z.array(legendeEintrag).nullable().optional() }).nullable().optional(),
});
const liegenschaft = z.object({
  EGRID: z.string().optional(),
  Number: z.union([z.string(), z.number()]).optional(),
  IdentDN: z.string().nullable().optional(),
  Canton: z.union([z.string(), z.number()]).optional(),
  MunicipalityName: z.string().optional(),
  MunicipalityCode: z.union([z.number(), z.string()]).optional(),
  LandRegistryArea: zahl,
  RestrictionOnLandownership: z.array(beschraenkung).nullable().optional(),
});
export const extractSchema = z.object({
  UpdateDateCS: z.string().nullable().optional(),
  CreationDate: z.string().nullable().optional(),
  RealEstate: liegenschaft,
  ConcernedTheme: z.array(thema).nullable().optional(),
  /** Themen, zu denen der Kataster in dieser Gemeinde (noch) keine Daten führt. SO: Nutzungsplanung der Stadt Solothurn. */
  ThemeWithoutData: z.array(thema).nullable().optional(),
  PLRCadastreAuthority: amt.nullable().optional(),
});

type Texte = z.infer<typeof texte>;
type Amt = z.infer<typeof amt>;
type Beschraenkung = z.infer<typeof beschraenkung>;

/** Zahl aus number oder numerischem String, sonst undefined. */
export function anzahl(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/**
 * Text aus einer mehrsprachigen Liste: zuerst die Kantonssprache, dann de, fr, it, rm, sonst der erste nicht leere Eintrag.
 * Nichts wird übersetzt; ein Zonenname, den der Dienst nur auf Französisch führt, bleibt französisch.
 */
export function textIn(t: Texte | undefined | null, sprache: OerebSprache): string | undefined {
  if (t === undefined || t === null) return undefined;
  if (typeof t === 'string') return t.trim() || undefined;
  const liste = Array.isArray(t) ? t : [t];
  const hat = (x: (typeof liste)[number]) => typeof x.Text === 'string' && x.Text.trim() !== '';
  for (const s of [sprache, 'de', 'fr', 'it', 'rm']) {
    const hit = liste.find((x) => x.Language === s && hat(x));
    if (hit) return hit.Text!.trim();
  }
  return liste.find(hat)?.Text?.trim();
}

/** «Reiterstrasse 11, 3013 Bern» aus Street, Number, PostalCode, City einer Stelle; nur, was da ist. Line1/Line2 (ZH) bleiben weg. */
export function amtAdresse(a: Pick<Amt, 'Street' | 'Number' | 'PostalCode' | 'City'> | undefined | null): string | null {
  if (!a) return null;
  const teil = (xs: Array<string | number | null | undefined>) => xs.filter((x) => x != null && String(x).trim()).map((x) => String(x).trim()).join(' ');
  const teile = [teil([a.Street, a.Number]), teil([a.PostalCode, a.City])].filter(Boolean);
  return teile.length ? teile.join(', ') : null;
}

/** `ch.BE.Gewaesserschutzbereiche` → `gewaesserschutzbereiche`, `ch.BelasteteStandorte` → `belastete_standorte`. Bundes- und Kantonsthemen gleich. */
export function themaSlug(code: string): string {
  return code
    .replace(/^ch\./, '')
    .replace(/^[A-Z]{2}\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

/** ISO-Datum aus `2026-10-06T00:00:00`, `2026-10-15T08:27:15.87+02:00` oder .NET `/Date(1792131942114)/`. Sonst undefined. */
export function isoDatum(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const net = s.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  const iso = net ? new Date(Number(net[1])).toISOString() : s;
  const d = iso.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
}

export type Stufe = 'I' | 'II' | 'III' | 'IV';
const STUFEN: Record<string, Stufe> = { I: 'I', II: 'II', III: 'III', IV: 'IV', '1': 'I', '2': 'II', '3': 'III', '4': 'IV' };

/**
 * Empfindlichkeitsstufe aus Legende oder TypeCode. Beobachtet: de «Empfindlichkeitsstufe III» (AG, SZ, GL, ZG, BS, BL, SG, TG),
 * «Lärmempfindlichkeitsstufe II» (BE), «Abweichende Empfindlichkeitsstufe II» (AI), «Empfindlichkeitsstufe III, aufgestuft» (FR, ZH);
 * fr «Degré de sensibilité III» (VD, GE), «Degré de sensibilité au bruit III» (JU); it «Grado di sensibilità III»; Kürzel ES/DS/GS mit Stufe.
 * TypeCodes: AG `ES_III`, ZH `laermempfindlichkeitsstufen_2_0`, AR/SG `III`, JU `r145_sens_bruit_DS_III`, LU `3`.
 * «Empfindlichkeitsstufe keine» (ZH) → null, es wird keine Stufe geraten.
 */
export function parseStufe(legend?: string, typeCode?: string): Stufe | null {
  const m1 = legend?.match(/(?:Empfindlichkeitsstufe|Degré de sensibilité(?: au bruit)?|Grado di sensibilità(?: al rumore)?)\s*(IV|III|II|I)(?![IVX])/i);
  if (m1?.[1]) return STUFEN[m1[1].toUpperCase()] ?? null;
  const m1b = legend?.match(/\b(?:ES|DS|GS)[ _-]?(IV|III|II|I)(?![A-Za-z])/);
  if (m1b?.[1]) return STUFEN[m1b[1]] ?? null;
  const m2 = typeCode?.match(/(?:^|[^A-Za-z0-9])(?:ES[_ -]?|DS[_ -]?|GS[_ -]?)?(IV|III|II|I)(?![A-Za-z])/);
  if (m2?.[1]) return STUFEN[m2[1]] ?? null;
  const m3 = typeCode?.match(/(?:^|[^0-9])([1-4])(?:[^0-9]|$)/);
  if (m3?.[1] && /empfindlichkeit|^ES|^[1-4]$/i.test(typeCode ?? '')) return STUFEN[m3[1]] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Einträge
// ---------------------------------------------------------------------------

type Eintrag = {
  code: string;
  subCode?: string;
  /** Subthema-Text: Theme.Text (openoereb, .NET) bzw. der Layer-Titel (GeoShop). Regel 1 prüft ihn neben dem SubCode. */
  subThema?: string;
  thema?: string;
  legende?: string;
  typeCode?: string;
  inKraft: boolean;
  anteil?: number;
  flaeche?: number;
  laenge?: number;
  rechtsvorschriften: Array<{ titel?: string; url?: string }>;
  zustaendig?: string;
  zustaendigUrl?: string;
};

/** TypeCode als Text. AR liefert statt eines Codes den String `{"de": "Wohnzone W2"}` (JSON-Objekt im String): dann der Text in der Kantonssprache. */
function typeCodeText(tc: z.infer<typeof typeCode>, sprache: OerebSprache): string | undefined {
  if (!tc) return undefined;
  let o: Record<string, string> | undefined;
  if (typeof tc === 'string') {
    const t = tc.trim();
    if (!t) return undefined;
    if (!t.startsWith('{')) return t;
    try {
      const p = JSON.parse(t) as unknown;
      if (p && typeof p === 'object' && !Array.isArray(p)) o = p as Record<string, string>;
      else return t;
    } catch {
      return t;
    }
  } else {
    o = tc;
  }
  const wert = o[sprache] ?? o.de ?? Object.values(o)[0];
  return typeof wert === 'string' && wert.trim() ? wert.trim() : undefined;
}

function normalisiere(b: Beschraenkung, form: OerebForm, sprache: OerebSprache): Eintrag {
  const law = b.Lawstatus?.Code ?? b.Lawstatus?.code;
  const e: Eintrag = {
    code: b.Theme.Code ?? b.Theme.code ?? '',
    inKraft: law === undefined || law === null || law === 'inForce',
    rechtsvorschriften: (b.LegalProvisions ?? []).map((r) => {
      const o: { titel?: string; url?: string } = {};
      const t = textIn(r.Title, sprache);
      const u = textIn(r.TextAtWeb, sprache);
      if (t) o.titel = t;
      if (u) o.url = u;
      return o;
    }),
  };
  if (b.Theme.SubCode) e.subCode = b.Theme.SubCode;
  const tc = typeCodeText(b.TypeCode, sprache);
  if (tc) e.typeCode = tc;
  const themaText = textIn(b.Theme.Text, sprache);
  if (themaText) e.thema = themaText;
  const legendeEigen = textIn(b.LegendText, sprache);
  if (form === 'geoshop') {
    // GeoShop: LegendText am Eintrag ist der Layer-Titel («Grundnutzung (Sarnen)»), die Zonenbezeichnung steht in Map.OtherLegend
    // unter demselben TypeCode. Ohne Treffer bleibt der Layer-Titel, sichtbar, nicht geraten.
    const passend = (b.Map?.OtherLegend ?? []).find((o) => tc !== undefined && typeCodeText(o.TypeCode, sprache) === tc);
    const legende = passend ? textIn(passend.LegendText, sprache) : undefined;
    if (legende) e.legende = legende;
    else if (legendeEigen) e.legende = legendeEigen;
    if (legendeEigen) e.subThema = legendeEigen;
  } else {
    if (legendeEigen) e.legende = legendeEigen;
    if (themaText) e.subThema = themaText;
  }
  const amtName = textIn(b.ResponsibleOffice?.Name, sprache);
  const amtUrl = textIn(b.ResponsibleOffice?.OfficeAtWeb, sprache);
  if (amtName) e.zustaendig = amtName;
  if (amtUrl) e.zustaendigUrl = amtUrl;
  const anteil = anzahl(b.PartInPercent);
  const flaeche = anzahl(b.AreaShare);
  const laenge = anzahl(b.LengthShare);
  if (anteil !== undefined) e.anteil = anteil;
  if (flaeche !== undefined) e.flaeche = flaeche;
  if (laenge !== undefined && laenge > 0) e.laenge = laenge;
  return e;
}

/**
 * Dieselbe Festlegung kommt oft in mehreren Teilflächen (UR: Kernzone 1 in drei Stücken zu 19, 3 und 5 %; AR: 21 Einträge
 * für sechs Zonen). Gleiches Thema, gleicher SubCode, gleicher TypeCode und gleiche Legende werden ein Eintrag, Anteile,
 * Flächen und Längen summiert (Anteil auf eine Dezimale gerundet, höchstens 100: Olten führt zwei Gestaltungsplan-Perimeter
 * mit gleicher Legende zu 100 und 20.4 %, die sich überlagern, statt sich zu ergänzen). Rechtsvorschriften und Stelle vom ersten Eintrag.
 */
export function verschmelze(eintraege: Eintrag[]): Eintrag[] {
  const out: Eintrag[] = [];
  const index = new Map<string, Eintrag>();
  for (const e of eintraege) {
    const key = [e.code, e.subCode ?? '', e.typeCode ?? '', e.legende ?? '', e.inKraft ? '1' : '0'].join('|');
    const vorhanden = index.get(key);
    if (!vorhanden) {
      const kopie = { ...e };
      index.set(key, kopie);
      out.push(kopie);
      continue;
    }
    if (e.anteil !== undefined) vorhanden.anteil = Math.min(100, Math.round(((vorhanden.anteil ?? 0) + e.anteil) * 10) / 10);
    if (e.flaeche !== undefined) vorhanden.flaeche = (vorhanden.flaeche ?? 0) + e.flaeche;
    if (e.laenge !== undefined) vorhanden.laenge = (vorhanden.laenge ?? 0) + e.laenge;
  }
  for (const e of out) if (e.anteil !== undefined) e.anteil = Math.min(100, Math.round(e.anteil * 10) / 10);
  return out;
}

export type Erkennung = 'subcode' | 'typecode' | 'flaechenanteil';

/** Regel 1 und 2 der Kette (Regel 3 entscheidet der Aufrufer über alle Einträge). null = keine Kennzeichnung, keine Systematik. */
export function erkenneGrundnutzung(e: Pick<Eintrag, 'code' | 'subCode' | 'subThema' | 'typeCode'>, k: Pick<OerebKanton, 'grundnutzungRegel'>): Erkennung | null {
  if (!(k.grundnutzungRegel.thema ?? NUTZUNGSPLANUNG_THEMA).test(e.code)) return null;
  const kennzeichnung = k.grundnutzungRegel.kennzeichnung ?? GRUNDNUTZUNG_KENNZEICHNUNG;
  if ((e.subCode && kennzeichnung.test(e.subCode)) || (e.subThema && kennzeichnung.test(e.subThema))) return 'subcode';
  const tc = k.grundnutzungRegel.typeCode;
  if (tc && e.typeCode && tc.test(e.typeCode)) return 'typecode';
  return null;
}

const CONFIDENCE: Record<Erkennung, number> = { subcode: 1, typecode: 0.95, flaechenanteil: 0.8 };
const istLaermStufe = (e: Eintrag) => /Laermempfindlichkeitsstufen$/.test(e.code);
const nachAnteil = (a: Eintrag, b: Eintrag) => (b.anteil ?? -1) - (a.anteil ?? -1) || (b.flaeche ?? -1) - (a.flaeche ?? -1);
const BAUREGLEMENT = /Baureglement|Nutzungsordnung|Zonenordnung|Zonenreglement|Bauordnung|Baugesetz der Gemeinde|Règlement (communal|général) (sur|des) (les )?constructions|Regolamento edilizio/i;

export const oereb: Adapter = {
  manifest: {
    id: 'oereb',
    title: 'ÖREB-Kataster',
    provider: 'Kantone (ÖREB-Kataster)',
    needs: ['egrid', 'kanton'],
    yields: [],
    provides: ['zone.', 'oereb.', 'laerm.empfindlichkeitsstufe', 'laerm.zustaendig', 'parzelle.flaeche_grundbuch_m2'],
    ttlDays: 14,
    version: 4, // 16.10.2026: 24 Kantone (SO, SH über XML), zone.hinweis_code, Hinweis thema_ohne_daten; 3: Regelkette, Teilflächen, Sprachen
    // Harte Grenze des Resolvers = grösster Kantons-Timeout (GL 90 s wegen Kaltstart). Die wirksame Grenze pro Kanton setzt oerebTimeoutMs.
    timeoutMs: OEREB_TIMEOUT_MAX_MS,
    cantons: OEREB_KANTONE_ANGEBUNDEN,
    license: 'Öffentlicher amtlicher Kataster (Art. 16a GeoIG, ÖREBKV), frei nutzbar mit Quellenangabe',
    attribution: '© ÖREB-Kataster der Kantone',
    endpoint: '<kantonale Basis>/extract/<json|xml>?EGRID=<EGRID>&GEOMETRY=false&WITHIMAGES=false&LANG=<sprache>, Basis, Format und Regel pro Kanton in src/adapters/oereb/kantone.ts',
    status: 'verifiziert',
    notes:
      'Grundnutzung als Hauptzone (grösster Anteil) nach Regelkette Kennzeichnung, TypeCode, Flächenanteil (zone.erkennung); weitere Grundnutzungen als zone.weitere.<n>.*, überlagernde Nutzungsplanung und alle anderen betroffenen Themen als oereb.<thema>.*. Lärm-Empfindlichkeitsstufe nur, wenn der Kataster sie führt. Ausnützungsziffer steht nicht im ÖREB-Kataster, sondern im Baureglement (Link, wenn vorhanden). SO und SH liefern XML statt JSON. Kantone ohne nutzbaren Dienst (VS, NE) stehen mit Grund in kantone.ts.',
  },

  async resolve(ctx): Promise<AdapterOutput> {
    const kanton = ctx.keys.kanton;
    const egrid = ctx.keys.egrid;
    const k = kanton ? OEREB_KANTONE[kanton] : undefined;
    if (!k || k.status === 'kein_dienst') throw new Error(`ÖREB-Kataster für Kanton ${kanton ?? '?'} nicht angeschlossen${k ? `: ${k.notizen}` : ''}`);
    if (!egrid) throw new Error('ÖREB-Kataster: EGRID fehlt');
    const sprache = k.sprache;

    const url = oerebExtractUrl(k, egrid);
    const res = await ctx.http.text(url, { timeoutMs: oerebTimeoutMs(k) });
    if (res.status === 204 || !res.data.trim()) throw new EmptyResultError(url, `EGRID ${egrid} ist im ÖREB-Kataster ${k.kanton} nicht bekannt`);
    let raw: unknown;
    if (k.format === 'xml') {
      try {
        raw = parseXml(res.data);
      } catch (err) {
        throw new SchemaDriftError(url, `Antwort ist kein XML-Extract: ${(err as Error).message.slice(0, 120)} · ${res.data.slice(0, 120)}`);
      }
    } else {
      try {
        raw = JSON.parse(res.data);
      } catch {
        throw new SchemaDriftError(url, `Antwort ist kein JSON: ${res.data.slice(0, 120)}`);
      }
    }
    const form = erkenneForm(raw);
    if (!form) throw new SchemaDriftError(url, 'keine bekannte Hülle (GetExtractByIdResponse.extract, Extract, Item)');
    let ex: z.infer<typeof extractSchema>;
    try {
      ex = extractSchema.parse(normalisiereBaum(form.extract));
    } catch (err) {
      throw new SchemaDriftError(url, (err as Error).message.slice(0, 600));
    }

    const facts: AdapterOutput['facts'] = [];
    const push = (key: string, value: AdapterOutput['facts'][number]['value'], extra: Partial<AdapterOutput['facts'][number]> = {}) =>
      facts.push({ key, value, request_url: url, ...extra });

    const re = ex.RealEstate;
    const grundbuch = anzahl(re.LandRegistryArea);
    if (grundbuch !== undefined) push('parzelle.flaeche_grundbuch_m2', grundbuch, { unit: 'm2', confidence: 1 });

    const alle = (re.RestrictionOnLandownership ?? []).map((b) => normalisiere(b, form.form, sprache));
    const haengig = alle.filter((e) => !e.inKraft).length;
    const inKraft = verschmelze(alle.filter((e) => e.inKraft));

    // Zone: Regelkette. Regel 1 und 2 pro Eintrag; greift keine, Regel 3 über den grössten Flächenanteil.
    const istNutzungsplanung = (e: Eintrag) => (k.grundnutzungRegel.thema ?? NUTZUNGSPLANUNG_THEMA).test(e.code);
    const nutzungsplanung = inKraft.filter(istNutzungsplanung);
    const regelVon = new Map<Eintrag, Erkennung>();
    for (const e of nutzungsplanung) {
      const r = erkenneGrundnutzung(e, k);
      if (r) regelVon.set(e, r);
    }
    let zonen: Eintrag[];
    let erkennung: Erkennung | undefined;
    if (regelVon.size) {
      zonen = [...regelVon.keys()].sort(nachAnteil);
      erkennung = regelVon.get(zonen[0]!);
    } else {
      zonen = nutzungsplanung.filter((e) => e.anteil !== undefined || e.flaeche !== undefined).sort(nachAnteil).slice(0, 1);
      if (zonen.length) erkennung = 'flaechenanteil';
    }
    const istZone = new Set(zonen);
    const haupt = zonen[0];
    // Kein Eintrag der Nutzungsplanung, und der Extract sagt selbst, dass der Kataster das Thema hier ohne Daten führt (SO, Stadt
    // Solothurn): Das ist eine Lücke mit Hinweis, kein Rätsel. Text deutsch, Code für die View.
    const nutzungsplanungOhneDaten = (ex.ThemeWithoutData ?? []).some((t) => (k.grundnutzungRegel.thema ?? NUTZUNGSPLANUNG_THEMA).test(t.Code ?? t.code ?? ''));
    if (!nutzungsplanung.length && nutzungsplanungOhneDaten) {
      push('zone.hinweis', NUTZUNGSPLANUNG_OHNE_DATEN_HINWEIS);
      push('zone.hinweis_code', 'thema_ohne_daten');
    }
    if (haupt && erkennung) {
      const zc = CONFIDENCE[erkennung];
      push('zone.bezeichnung', haupt.legende ?? null, { confidence: zc });
      push('zone.erkennung', erkennung, { confidence: zc });
      if (erkennung === 'flaechenanteil') {
        push('zone.hinweis', GRUNDNUTZUNG_HINWEIS, { confidence: zc });
        push('zone.hinweis_code', 'flaechenanteil', { confidence: zc });
      }
      if (haupt.typeCode) push('zone.code', haupt.typeCode, { confidence: zc });
      if (haupt.anteil !== undefined) push('zone.anteil_prozent', haupt.anteil, { unit: '%', confidence: zc });
      // Regel 3 kennt die Zahl der Grundnutzungen nicht, darum dort kein zone.anzahl
      if (erkennung !== 'flaechenanteil') push('zone.anzahl', zonen.length, { confidence: zc });
      zonen.slice(1).forEach((z, i) => {
        const n = i + 1;
        push(`zone.weitere.${n}.bezeichnung`, z.legende ?? null, { confidence: zc });
        if (z.typeCode) push(`zone.weitere.${n}.code`, z.typeCode, { confidence: zc });
        if (z.anteil !== undefined) push(`zone.weitere.${n}.anteil_prozent`, z.anteil, { unit: '%', confidence: zc });
      });
      const reglement = haupt.rechtsvorschriften.find((r) => r.titel && BAUREGLEMENT.test(r.titel) && r.url);
      if (reglement?.url) {
        push('zone.baureglement_url', reglement.url, { confidence: zc });
        if (reglement.titel) push('zone.baureglement_titel', reglement.titel, { confidence: zc });
      }
      // Zuständige Stelle der Grundnutzung (ResponsibleOffice), meist die Gemeinde
      if (haupt.zustaendig) push('zone.zustaendig', haupt.zustaendig, { confidence: zc });
      if (haupt.zustaendigUrl) push('zone.zustaendig_url', haupt.zustaendigUrl, { confidence: zc });
    }

    // Lärm-Empfindlichkeitsstufe: Eintrag mit grösstem Anteil, der eine Stufe I bis IV nennt
    const stufen = inKraft.filter(istLaermStufe).sort(nachAnteil);
    const mitStufe = stufen.map((e) => ({ e, stufe: parseStufe(e.legende, e.typeCode) })).find((x) => x.stufe);
    if (mitStufe) {
      push('laerm.empfindlichkeitsstufe', mitStufe.stufe, { confidence: 1 });
      if (mitStufe.e.legende) push('laerm.empfindlichkeitsstufe_text', mitStufe.e.legende);
      if (mitStufe.e.anteil !== undefined) push('laerm.empfindlichkeitsstufe_anteil_prozent', mitStufe.e.anteil, { unit: '%' });
    } else if (stufen[0]?.legende) {
      // Kataster führt das Thema, nennt aber keine Stufe I bis IV (z.B. «keine»): Text zeigen, Stufe offen lassen.
      push('laerm.empfindlichkeitsstufe_text', stufen[0].legende);
    }
    const laermStelle = mitStufe?.e ?? stufen[0];
    if (laermStelle?.zustaendig) push('laerm.zustaendig', laermStelle.zustaendig);
    if (laermStelle?.zustaendigUrl) push('laerm.zustaendig_url', laermStelle.zustaendigUrl);

    // Weitere Themen: alles ausser Grundnutzung und Lärmstufen, gruppiert nach Thema. Nach Regel 3 ist bei den übrigen
    // Nutzungsplanungs-Einträgen offen, ob sie Grundnutzung oder überlagernd sind; sie heissen dann nutzungsplanung_weitere.
    type Gruppe = { thema: string; texte: string[]; anteil?: number; laenge: number; anzahl: number; zustaendig?: string; zustaendigUrl?: string };
    const gruppen = new Map<string, Gruppe>();
    for (const e of inKraft) {
      if (istZone.has(e) || istLaermStufe(e)) continue;
      const np = istNutzungsplanung(e);
      const slug = np ? (erkennung === 'flaechenanteil' ? 'nutzungsplanung_weitere' : 'nutzungsplanung_ueberlagernd') : themaSlug(e.code || e.thema || 'unbekannt');
      const titel = np
        ? erkennung === 'flaechenanteil'
          ? 'Nutzungsplanung: weitere Einträge (Grundnutzung oder überlagernd, vom Kataster nicht gekennzeichnet)'
          : 'Nutzungsplanung: überlagernde Festlegungen'
        : (e.thema ?? e.code);
      const g = gruppen.get(slug) ?? { thema: titel, texte: [], laenge: 0, anzahl: 0 };
      if (e.legende && !g.texte.includes(e.legende)) g.texte.push(e.legende);
      if (e.anteil !== undefined) g.anteil = Math.max(g.anteil ?? 0, e.anteil);
      if (e.laenge !== undefined) g.laenge += e.laenge;
      if (!g.zustaendig && e.zustaendig) {
        g.zustaendig = e.zustaendig;
        if (e.zustaendigUrl) g.zustaendigUrl = e.zustaendigUrl;
      }
      g.anzahl++;
      gruppen.set(slug, g);
    }
    for (const [slug, g] of gruppen) {
      push(`oereb.${slug}.betroffen`, true);
      push(`oereb.${slug}.thema`, g.thema);
      if (g.texte.length) push(`oereb.${slug}.text`, g.texte.join('; '));
      if (g.anteil !== undefined) push(`oereb.${slug}.anteil_prozent`, g.anteil, { unit: '%' });
      if (g.laenge > 0) push(`oereb.${slug}.laenge_m`, Math.round(g.laenge), { unit: 'm' });
      if (g.zustaendig) push(`oereb.${slug}.zustaendig`, g.zustaendig);
      if (g.zustaendigUrl) push(`oereb.${slug}.zustaendig_url`, g.zustaendigUrl);
    }
    push('oereb.belastungen_anzahl', gruppen.size);
    if (gruppen.size) push('oereb.belastungen', [...gruppen.values()].map((g) => g.thema).join('; '));
    if (haengig > 0) push('oereb.aenderungen_hangig_anzahl', haengig);

    push('oereb.auszug_pdf_url', oerebExtractUrl(k, egrid, 'pdf'));
    // Katasterstelle (PLRCadastreAuthority): Name, Website, Postadresse
    const ka = ex.PLRCadastreAuthority;
    const katasterUrl = textIn(ka?.OfficeAtWeb, sprache);
    if (katasterUrl) push('oereb.kataster_url', katasterUrl);
    const katasterStelle = textIn(ka?.Name, sprache);
    if (katasterStelle) push('oereb.kataster_stelle', katasterStelle);
    const katasterAdresse = amtAdresse(ka);
    if (katasterAdresse) push('oereb.kataster_adresse', katasterAdresse);

    const out: AdapterOutput = { facts, keys: {} };
    const stand = isoDatum(ex.UpdateDateCS);
    if (stand) out.source_date = stand;
    return out;
  },
};
