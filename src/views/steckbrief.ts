import type { Adapter, AdapterRunReport, Fact, RunResult, Sprache } from '../types.ts';
import { ABSCHNITTE, FELDER, WOHNUNG_FELDER, type AbschnittId, type FeldDef } from './felder.ts';
import { formatDatum, formatZahl, fuelle } from './format.ts';
import { texte, type Texte } from './i18n/index.ts';
import { hinweisIn, wertIn } from './werte.ts';

export type SteckbriefFeld = {
  key: string;
  label: string;
  value: Fact['value'];
  unit?: string;
  erklaerung?: string;
  quelle: string;
  quelle_titel: string;
  /** Stand der Daten laut Quelle (`source_date`, ISO-Datum), wenn die Quelle einen kennt. Sonst fehlt das Feld, es wird nichts ersetzt. */
  daten_vom?: string;
  /** Tag des Abrufs (`fetched_at`, ISO-Datum). Immer da. */
  abgefragt_am: string;
  url?: string;
  confidence: number;
  derived_from?: string[];
};

export type SteckbriefAbschnitt = {
  id: AbschnittId | 'wohnung';
  titel: string;
  felder: SteckbriefFeld[];
};

export type Luecke = {
  key: string;
  label: string;
  /** `hinweis`: Die Quelle hat statt des Werts einen Hinweis geliefert (Text in `detail`), z.B. grundbuch.hinweis bei mehreren Grundbuchkreisen. */
  grund: 'fehlt_im_register' | 'quelle_nicht_erreichbar' | 'quelle_uebersprungen' | 'quelle_abgeschaltet' | 'quelle_ausser_kanton' | 'hinweis';
  quelle?: string;
  detail?: string;
};

export type QuellenEintrag = {
  adapter: string;
  titel: string;
  provider: string;
  attribution: string;
  status: AdapterRunReport['status'];
  /** Stand der Daten, wenn alle Fakten des Adapters denselben `source_date` tragen. Bei mehreren Ständen (naturgefahren: drei Layer) fehlt er hier und steht pro Feld. */
  daten_vom?: string;
  /** Tag des Abrufs der Fakten (bei `cached` der ursprüngliche Abruf). Fehlt, wenn der Adapter keine Fakten geliefert hat. */
  abgefragt_am?: string;
  url?: string;
  ms: number;
  fehler?: string;
  experimentell: boolean;
};

export type Steckbrief = {
  run_id: string;
  subject: string | null;
  partial: boolean;
  /** Sprache der Lesefassung (Labels, Erklärungen, Lückengründe, code-gestützte Werte). Deutsch ist die Quellsprache. */
  lang: Sprache;
  adresse: {
    /** Volle Adresse laut geocode («Maygutstrasse 26 3084 Wabern»), bei Eingabe per EGID die Strasse laut GWR. */
    label?: string;
    /** Strasse und Hausnummer laut GWR («Maygutstrasse 26»). */
    strasse?: string;
    plz?: number;
    ort?: string;
    gemeinde?: string;
    kanton?: string;
    egid?: number;
    egrid?: string;
    parzelle?: string;
  };
  abschnitte: SteckbriefAbschnitt[];
  luecken: Luecke[];
  quellen: QuellenEintrag[];
  attribution: string[];
  erstellt_am: string;
  ms: number;
};

export type SteckbriefOptions = { lang?: Sprache };

function bestFact(facts: Fact[], key: string): Fact | undefined {
  // Höchste Confidence, dann jüngster. `owner`-Fakten sollen Register nie überstimmen, darum Confidence zuerst.
  return facts
    .filter((f) => f.key === key)
    .sort((a, b) => b.confidence - a.confidence || b.fetched_at.localeCompare(a.fetched_at))[0];
}

/** Label eines Feldkatalog-Keys in der Sprache. Fehlt der Text (der Vollständigkeitstest verhindert das), steht der Key sichtbar da, kein deutscher Ersatz. */
function feldText(T: Texte, key: string): Pick<FeldDef, 'label' | 'erklaerung'> {
  const t = T.felder[key];
  if (!t) return { label: key };
  return t.erklaerung ? { label: t.label, erklaerung: t.erklaerung } : { label: t.label };
}

type Kontext = { T: Texte; lang: Sprache; facts: Fact[]; titles: Map<string, string> };

function toFeld(f: Fact, def: Pick<FeldDef, 'label' | 'erklaerung'>, k: Kontext): SteckbriefFeld {
  const out: SteckbriefFeld = {
    key: f.key,
    label: def.label,
    value: wertIn(f.key, f.value, k.facts, k.lang),
    quelle: f.source,
    quelle_titel: k.titles.get(f.source) ?? f.source,
    abgefragt_am: f.fetched_at.slice(0, 10),
    confidence: f.confidence,
  };
  if (f.source_date) out.daten_vom = f.source_date;
  if (f.unit) out.unit = f.unit;
  if (def.erklaerung) out.erklaerung = def.erklaerung;
  if (f.request_url) out.url = f.request_url;
  if (f.derived_from) out.derived_from = f.derived_from;
  return out;
}

/**
 * Dynamische Felder im Abschnitt Zone: weitere Grundnutzungen (zone.weitere.<n>.*) und die betroffenen ÖREB-Themen
 * (oereb.<thema>.betroffen mit .thema als Label und .text als Wert). Die Keys sind datengetrieben, darum nicht in FELDER.
 */
function dynamischeZoneFelder(k: Kontext): SteckbriefFeld[] {
  const { facts, T, lang } = k;
  const out: SteckbriefFeld[] = [];
  const nummern = [...new Set(facts.map((f) => f.key.match(/^zone\.weitere\.(\d+)\.bezeichnung$/)?.[1]).filter((x): x is string => !!x))].sort((a, b) => Number(a) - Number(b));
  for (const n of nummern) {
    const f = bestFact(facts, `zone.weitere.${n}.bezeichnung`);
    if (!f || f.value === null) continue;
    const anteil = bestFact(facts, `zone.weitere.${n}.anteil_prozent`)?.value;
    const label = typeof anteil === 'number' ? fuelle(T.zone.weitereMitAnteil, { anteil: formatZahl(anteil, lang, { maximumFractionDigits: 1 }) }) : T.zone.weitere;
    out.push(toFeld(f, { label, erklaerung: T.zone.weitereErklaerung }, k));
  }
  const slugs = [...new Set(facts.map((f) => f.key.match(/^oereb\.([a-z0-9_]+)\.betroffen$/)?.[1]).filter((x): x is string => !!x))].sort();
  for (const slug of slugs) {
    const betroffen = bestFact(facts, `oereb.${slug}.betroffen`);
    if (!betroffen || betroffen.value !== true) continue;
    const themaFakt = bestFact(facts, `oereb.${slug}.thema`);
    const thema = themaFakt ? wertIn(themaFakt.key, themaFakt.value, facts, lang) : undefined;
    const text = bestFact(facts, `oereb.${slug}.text`) ?? betroffen;
    const anteil = bestFact(facts, `oereb.${slug}.anteil_prozent`)?.value;
    const laenge = bestFact(facts, `oereb.${slug}.laenge_m`)?.value;
    const zusatz =
      typeof anteil === 'number' && anteil < 100
        ? ` ${fuelle(T.zone.anteilFlaeche, { anteil: formatZahl(anteil, lang, { maximumFractionDigits: 1 }) })}`
        : typeof laenge === 'number'
          ? ` ${fuelle(T.zone.laenge, { laenge: formatZahl(laenge, lang) })}`
          : '';
    const feld = toFeld(text, { label: `${typeof thema === 'string' ? thema : slug}${zusatz}` }, k);
    if (text === betroffen) feld.value = T.zone.betroffen;
    out.push(feld);
  }
  return out;
}

/**
 * Baut aus einem Lauf den Steckbrief: Abschnitte mit Feldern, jede Zahl mit Quelle und Stand,
 * dazu die Lücken (was das Register nicht hat oder welche Quelle nicht erreichbar war) und die Quellenliste.
 * `lang` wählt die Sprache der Lesefassung (Standard de); Fakten bleiben deutsch gespeichert, die View übersetzt über Codes.
 */
export function buildSteckbrief(run: RunResult, adapters: Adapter[], opts: SteckbriefOptions = {}): Steckbrief {
  const lang: Sprache = opts.lang ?? 'de';
  const T = texte(lang);
  const manifests = new Map(adapters.map((a) => [a.manifest.id, a.manifest]));
  // Titel pro Quelle: de aus dem Manifest, sonst aus der Sprachdatei (der Vollständigkeitstest prüft, dass jeder Adapter drinsteht)
  const adapterText = (id: string) => (lang === 'de' ? undefined : T.adapter[id]);
  const titles = new Map(adapters.map((a) => [a.manifest.id, adapterText(a.manifest.id)?.titel ?? a.manifest.title]));
  titles.set('derived', T.quellen.derived);
  titles.set('owner', T.quellen.owner);
  const k: Kontext = { T, lang, facts: run.facts, titles };

  const abschnitte: SteckbriefAbschnitt[] = [];
  for (const ab of ABSCHNITTE) {
    const felder: SteckbriefFeld[] = [];
    for (const [key, def] of Object.entries(FELDER)) {
      if (def.abschnitt !== ab.id) continue;
      const f = bestFact(run.facts, key);
      if (!f || f.value === null) continue;
      felder.push(toFeld(f, feldText(T, key), k));
    }
    if (ab.id === 'zone') felder.push(...dynamischeZoneFelder(k));
    if (felder.length) abschnitte.push({ id: ab.id, titel: T.abschnitte[ab.id], felder });
  }

  // Wohnungen einzeln, nach EWID
  const ewids = [...new Set(run.facts.map((f) => f.key.match(/^wohnung\.(\d+)\./)?.[1]).filter((x): x is string => !!x))].sort((a, b) => Number(a) - Number(b));
  for (const ewid of ewids) {
    const felder: SteckbriefFeld[] = [];
    for (const suffix of Object.keys(WOHNUNG_FELDER) as Array<keyof typeof WOHNUNG_FELDER>) {
      const f = bestFact(run.facts, `wohnung.${ewid}.${suffix}`);
      if (!f || f.value === null) continue;
      felder.push(toFeld(f, { label: T.wohnung.felder[suffix] ?? suffix }, k));
    }
    if (felder.length) abschnitte.push({ id: 'wohnung', titel: ewids.length > 1 ? fuelle(T.wohnung.titelMitNr, { ewid }) : T.wohnung.titel, felder });
  }

  // Lücken
  const luecken: Luecke[] = [];
  for (const [key, def] of Object.entries(FELDER)) {
    if (!def.erwartet) continue;
    const f = bestFact(run.facts, key);
    if (f && f.value !== null) continue;
    // Der Adapter mit dem längsten passenden Präfix liefert den Key (parzelle.flaeche_grundbuch_m2 → oereb, nicht av-parzelle).
    const liefernder = adapters
      .map((a) => ({ a, p: Math.max(-1, ...a.manifest.provides.filter((p) => key.startsWith(p)).map((p) => p.length)) }))
      .filter((x) => x.p >= 0)
      .sort((x, y) => y.p - x.p)[0]?.a;
    const report = liefernder ? run.adapters.find((r) => r.adapter === liefernder.manifest.id) : undefined;
    const l: Luecke = { key, label: feldText(T, key).label, grund: 'fehlt_im_register' };
    if (liefernder) l.quelle = liefernder.manifest.id;
    if (report?.status === 'failed' || report?.status === 'open_circuit') {
      l.grund = 'quelle_nicht_erreichbar';
      if (report.error) l.detail = report.error;
    } else if (report?.status === 'skipped') {
      l.grund = 'quelle_uebersprungen';
      if (report.missing) l.detail = fuelle(T.luecken.detail.fehlendeSchluessel, { keys: report.missing.join(', ') });
    } else if (report?.status === 'disabled') {
      l.grund = 'quelle_abgeschaltet';
    } else if (report?.status === 'ausser_kanton') {
      l.grund = 'quelle_ausser_kanton';
      l.detail = fuelle(T.luecken.detail.ausserKanton, { kanton: run.keys.kanton ?? '?' });
    } else if (f && f.value === null) {
      l.detail = T.luecken.detail.feldLeer;
    }
    // Die Quelle hat statt des Werts einen Hinweis geliefert (grundbuch.kreis fehlt, grundbuch.hinweis sagt warum): Der Hinweis ist der Grund, nicht «fehlt».
    if (l.grund === 'fehlt_im_register') {
      const hinweisKey = key.replace(/\.[^.]+$/, '.hinweis');
      const hinweis = bestFact(run.facts, hinweisKey);
      if (hinweis && hinweis.key !== key && typeof hinweis.value === 'string' && hinweis.value) {
        l.grund = 'hinweis';
        l.detail = (lang === 'de' ? undefined : hinweisIn(hinweisKey, run.facts, lang)) ?? hinweis.value;
      }
    }
    // Eine Lücke pro Quelle und Grund reicht, wenn die Quelle ganz ausgefallen ist.
    if (l.grund !== 'fehlt_im_register' && luecken.some((x) => x.quelle === l.quelle && x.grund === l.grund)) continue;
    luecken.push(l);
  }

  const quellen: QuellenEintrag[] = run.adapters
    .filter((r) => r.adapter !== 'derived')
    .map((r) => {
      const m = manifests.get(r.adapter);
      const t = adapterText(r.adapter);
      const q: QuellenEintrag = {
        adapter: r.adapter,
        titel: t?.titel ?? m?.title ?? r.adapter,
        provider: t?.provider ?? m?.provider ?? '',
        attribution: t?.attribution ?? m?.attribution ?? '',
        status: r.status,
        ms: r.ms,
        experimentell: m?.status === 'experimentell',
      };
      const eigene = run.facts.filter((f) => f.source === r.adapter);
      // Ein Stand für den ganzen Adapter nur, wenn alle seine Fakten denselben tragen; sonst steht er pro Feld (naturgefahren: drei Layer, drei Stände)
      const staende = [...new Set(eigene.map((f) => f.source_date).filter((d): d is string => !!d))];
      if (staende.length === 1 && eigene.every((f) => f.source_date)) q.daten_vom = staende[0]!;
      const abgefragt = eigene[0]?.fetched_at.slice(0, 10);
      if (abgefragt) q.abgefragt_am = abgefragt;
      if (r.request_url) q.url = r.request_url;
      if (r.error) q.fehler = r.error;
      return q;
    });

  const v = (key: string) => bestFact(run.facts, key)?.value;
  const adresse: Steckbrief['adresse'] = {};
  const label = v('adresse.label') ?? v('adresse.strasse_nr');
  if (typeof label === 'string') adresse.label = label;
  if (typeof v('adresse.strasse_nr') === 'string') adresse.strasse = v('adresse.strasse_nr') as string;
  if (typeof v('adresse.plz') === 'number') adresse.plz = v('adresse.plz') as number;
  if (typeof v('adresse.ort') === 'string') adresse.ort = v('adresse.ort') as string;
  if (typeof v('adresse.gemeinde') === 'string') adresse.gemeinde = v('adresse.gemeinde') as string;
  if (typeof v('adresse.kanton') === 'string') adresse.kanton = v('adresse.kanton') as string;
  if (run.keys.egid != null) adresse.egid = run.keys.egid;
  if (run.keys.egrid) adresse.egrid = run.keys.egrid;
  if (run.keys.parzelle_nr) adresse.parzelle = run.keys.parzelle_nr;

  const attribution = [...new Set(quellen.filter((q) => q.status === 'ok' || q.status === 'cached').map((q) => q.attribution).filter(Boolean))];

  return {
    run_id: run.run_id,
    subject: run.subject,
    partial: run.partial,
    lang,
    adresse,
    abschnitte,
    luecken,
    quellen,
    attribution,
    erstellt_am: run.finished_at,
    ms: run.ms,
  };
}

/**
 * Zweite Kopfzeile des Steckbriefs: «3084 Wabern · Gemeinde Köniz · BE» aus PLZ, Ort, Gemeinde und Kanton (alle aus dem GWR,
 * darum auch bei Eingabe per EGID da). Fehlt ein Teil, fällt er weg, kein Platzhalter. Leer, wenn nichts davon bekannt ist.
 * Die App nutzt dieselbe Funktion für Seite und PDF. `lang` wählt das Wort vor der Gemeinde («Commune de Köniz»).
 */
export function adressZeile(a: Steckbrief['adresse'], lang: Sprache = 'de'): string {
  const plzOrt = [a.plz != null ? String(a.plz) : '', a.ort ?? ''].filter(Boolean).join(' ');
  return [plzOrt, a.gemeinde ? fuelle(texte(lang).text.gemeinde, { name: a.gemeinde }) : '', a.kanton ?? ''].filter(Boolean).join(' · ');
}

/** Quellenangabe eines Felds als Text: «gwr · Daten vom 12.10.2026 · abgefragt 16.10.2026», ohne Stand der Quelle nur «abgefragt …». Datum überall TT.MM.JJJJ. */
export function quellenText(f: Pick<SteckbriefFeld, 'quelle' | 'daten_vom' | 'abgefragt_am'>, lang: Sprache = 'de'): string {
  const T = texte(lang);
  return [f.quelle, f.daten_vom ? fuelle(T.quellen.datenVom, { datum: formatDatum(f.daten_vom) }) : '', fuelle(T.quellen.abgefragt, { datum: formatDatum(f.abgefragt_am) })].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Text-Ausgabe für CLI
// ---------------------------------------------------------------------------

/** Wert eines Felds als Text, Zahlen nach Sprache (de-CH 44'550, fr-CH 44 550), Bool-Werte nach Format, Daten TT.MM.JJJJ. */
export function formatWert(feld: Pick<SteckbriefFeld, 'key' | 'value' | 'unit'>, lang: Sprache = 'de'): string {
  const T = texte(lang);
  const def = FELDER[feld.key] ?? WOHNUNG_FELDER[feld.key.match(/^wohnung\.\d+\.(.+)$/)?.[1] ?? ''];
  const v = feld.value;
  if (v === null || v === undefined) return T.formate.leer;
  if (typeof v === 'boolean') return def?.format === 'betroffen' ? (v ? T.formate.betroffen : T.formate.nichtBetroffen) : v ? T.formate.ja : T.formate.nein;
  if (typeof v === 'number') {
    const f = def?.format;
    const s =
      f === 'chf' ? `CHF ${formatZahl(Math.round(v), lang)}`
      : f === 'jahr' || f === 'id' ? String(v)
      : f === 'dezimal' ? formatZahl(v, lang, { maximumFractionDigits: 1 })
      : formatZahl(v, lang);
    return feld.unit && f !== 'chf' ? `${s} ${feld.unit}` : s;
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatDatum(v);
  return String(v);
}

export function steckbriefAlsText(s: Steckbrief, opts: { quellen?: boolean; lang?: Sprache } = {}): string {
  const lang = opts.lang ?? s.lang ?? 'de';
  const T = texte(lang);
  const lines: string[] = [];
  // Kopf: Strasse (GWR, sonst das geocode-Label), darunter «3084 Wabern · Gemeinde Köniz · BE», darunter die Kennungen
  lines.push(`grundpass · ${s.adresse.strasse ?? s.adresse.label ?? s.subject}`);
  const zeile2 = adressZeile(s.adresse, lang);
  if (zeile2) lines.push(zeile2);
  lines.push(`${T.text.egid} ${s.adresse.egid ?? '?'} · ${T.text.egrid} ${s.adresse.egrid ?? '?'} · ${T.text.parzelle} ${s.adresse.parzelle ?? '?'}${s.partial ? ` · ${T.text.unvollstaendig}` : ''}`);
  lines.push('');
  for (const ab of s.abschnitte) {
    lines.push(ab.titel.toUpperCase());
    const w = Math.max(...ab.felder.map((f) => f.label.length));
    for (const f of ab.felder) {
      const src = opts.quellen === false ? '' : `   ${quellenText(f, lang)}`;
      lines.push(`  ${f.label.padEnd(w)}  ${formatWert(f, lang)}${src}`);
    }
    lines.push('');
  }
  if (s.luecken.length) {
    lines.push(T.text.luecken);
    for (const l of s.luecken) {
      lines.push(`  ${l.label}: ${T.luecken.grund[l.grund]}${l.quelle ? ` (${l.quelle})` : ''}${l.detail ? ` · ${l.detail}` : ''}`);
    }
    lines.push('');
  }
  lines.push(T.text.quellen);
  for (const q of s.quellen) {
    const stand = [q.daten_vom ? fuelle(T.quellen.datenVom, { datum: formatDatum(q.daten_vom) }) : '', q.abgefragt_am ? fuelle(T.quellen.abgefragt, { datum: formatDatum(q.abgefragt_am) }) : ''].filter(Boolean).join(' · ');
    lines.push(`  ${q.adapter.padEnd(16)} ${q.status.padEnd(13)} ${String(q.ms).padStart(5)} ms${stand ? `  ${stand}` : ''}${q.experimentell ? `  [${T.text.experimentell}]` : ''}${q.fehler ? `  ${q.fehler}` : ''}`);
  }
  lines.push('');
  lines.push(`${T.text.lauf} ${s.run_id} · ${s.ms} ms · ${s.attribution.join(' · ')}`);
  return lines.join('\n');
}
