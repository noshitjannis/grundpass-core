import type { Adapter, AdapterRunReport, Fact, RunResult } from '../types.ts';
import { ABSCHNITTE, FELDER, WOHNUNG_FELDER, type AbschnittId, type FeldDef } from './felder.ts';

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

function bestFact(facts: Fact[], key: string): Fact | undefined {
  // Höchste Confidence, dann jüngster. `owner`-Fakten sollen Register nie überstimmen, darum Confidence zuerst.
  return facts
    .filter((f) => f.key === key)
    .sort((a, b) => b.confidence - a.confidence || b.fetched_at.localeCompare(a.fetched_at))[0];
}

function toFeld(f: Fact, def: Pick<FeldDef, 'label' | 'erklaerung'>, titles: Map<string, string>): SteckbriefFeld {
  const out: SteckbriefFeld = {
    key: f.key,
    label: def.label,
    value: f.value,
    quelle: f.source,
    quelle_titel: titles.get(f.source) ?? f.source,
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
function dynamischeZoneFelder(facts: Fact[], titles: Map<string, string>): SteckbriefFeld[] {
  const out: SteckbriefFeld[] = [];
  const nummern = [...new Set(facts.map((f) => f.key.match(/^zone\.weitere\.(\d+)\.bezeichnung$/)?.[1]).filter((x): x is string => !!x))].sort((a, b) => Number(a) - Number(b));
  for (const n of nummern) {
    const f = bestFact(facts, `zone.weitere.${n}.bezeichnung`);
    if (!f || f.value === null) continue;
    const anteil = bestFact(facts, `zone.weitere.${n}.anteil_prozent`)?.value;
    const label = typeof anteil === 'number' ? `Weitere Zone (${anteil} %)` : 'Weitere Zone';
    out.push(toFeld(f, { label, erklaerung: 'Zweite Grundnutzung auf derselben Parzelle, mit ihrem Flächenanteil.' }, titles));
  }
  const slugs = [...new Set(facts.map((f) => f.key.match(/^oereb\.([a-z0-9_]+)\.betroffen$/)?.[1]).filter((x): x is string => !!x))].sort();
  for (const slug of slugs) {
    const betroffen = bestFact(facts, `oereb.${slug}.betroffen`);
    if (!betroffen || betroffen.value !== true) continue;
    const thema = bestFact(facts, `oereb.${slug}.thema`)?.value;
    const text = bestFact(facts, `oereb.${slug}.text`) ?? betroffen;
    const anteil = bestFact(facts, `oereb.${slug}.anteil_prozent`)?.value;
    const laenge = bestFact(facts, `oereb.${slug}.laenge_m`)?.value;
    const zusatz = typeof anteil === 'number' && anteil < 100 ? ` (${anteil} % der Fläche)` : typeof laenge === 'number' ? ` (${laenge} m)` : '';
    const feld = toFeld(text, { label: `${typeof thema === 'string' ? thema : slug}${zusatz}` }, titles);
    if (text === betroffen) feld.value = 'betroffen';
    out.push(feld);
  }
  return out;
}

/**
 * Baut aus einem Lauf den Steckbrief: Abschnitte mit Feldern, jede Zahl mit Quelle und Stand,
 * dazu die Lücken (was das Register nicht hat oder welche Quelle nicht erreichbar war) und die Quellenliste.
 */
export function buildSteckbrief(run: RunResult, adapters: Adapter[]): Steckbrief {
  const titles = new Map(adapters.map((a) => [a.manifest.id, a.manifest.title]));
  titles.set('derived', 'Berechnet aus Registerdaten');
  titles.set('owner', 'Angabe des Eigentümers');
  const manifests = new Map(adapters.map((a) => [a.manifest.id, a.manifest]));

  const abschnitte: SteckbriefAbschnitt[] = [];
  for (const ab of ABSCHNITTE) {
    const felder: SteckbriefFeld[] = [];
    for (const [key, def] of Object.entries(FELDER)) {
      if (def.abschnitt !== ab.id) continue;
      const f = bestFact(run.facts, key);
      if (!f || f.value === null) continue;
      felder.push(toFeld(f, def, titles));
    }
    if (ab.id === 'zone') felder.push(...dynamischeZoneFelder(run.facts, titles));
    if (felder.length) abschnitte.push({ id: ab.id, titel: ab.titel, felder });
  }

  // Wohnungen einzeln, nach EWID
  const ewids = [...new Set(run.facts.map((f) => f.key.match(/^wohnung\.(\d+)\./)?.[1]).filter((x): x is string => !!x))].sort((a, b) => Number(a) - Number(b));
  for (const ewid of ewids) {
    const felder: SteckbriefFeld[] = [];
    for (const [suffix, def] of Object.entries(WOHNUNG_FELDER)) {
      const f = bestFact(run.facts, `wohnung.${ewid}.${suffix}`);
      if (!f || f.value === null) continue;
      felder.push(toFeld(f, def, titles));
    }
    if (felder.length) abschnitte.push({ id: 'wohnung', titel: ewids.length > 1 ? `Wohnung ${ewid}` : 'Wohnung', felder });
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
    const l: Luecke = { key, label: def.label, grund: 'fehlt_im_register' };
    if (liefernder) l.quelle = liefernder.manifest.id;
    if (report?.status === 'failed' || report?.status === 'open_circuit') {
      l.grund = 'quelle_nicht_erreichbar';
      if (report.error) l.detail = report.error;
    } else if (report?.status === 'skipped') {
      l.grund = 'quelle_uebersprungen';
      if (report.missing) l.detail = `fehlende Schlüssel: ${report.missing.join(', ')}`;
    } else if (report?.status === 'disabled') {
      l.grund = 'quelle_abgeschaltet';
    } else if (report?.status === 'ausser_kanton') {
      l.grund = 'quelle_ausser_kanton';
      l.detail = `für Kanton ${run.keys.kanton ?? '?'} noch nicht angeschlossen`;
    } else if (f && f.value === null) {
      l.detail = 'Feld im Register leer';
    }
    // Die Quelle hat statt des Werts einen Hinweis geliefert (grundbuch.kreis fehlt, grundbuch.hinweis sagt warum): Der Hinweis ist der Grund, nicht «fehlt».
    if (l.grund === 'fehlt_im_register') {
      const hinweis = bestFact(run.facts, key.replace(/\.[^.]+$/, '.hinweis'));
      if (hinweis && hinweis.key !== key && typeof hinweis.value === 'string' && hinweis.value) {
        l.grund = 'hinweis';
        l.detail = hinweis.value;
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
      const q: QuellenEintrag = {
        adapter: r.adapter,
        titel: m?.title ?? r.adapter,
        provider: m?.provider ?? '',
        attribution: m?.attribution ?? '',
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
 * Die App nutzt dieselbe Funktion für Seite und PDF.
 */
export function adressZeile(a: Steckbrief['adresse']): string {
  const plzOrt = [a.plz != null ? String(a.plz) : '', a.ort ?? ''].filter(Boolean).join(' ');
  return [plzOrt, a.gemeinde ? `Gemeinde ${a.gemeinde}` : '', a.kanton ?? ''].filter(Boolean).join(' · ');
}

/** Quellenangabe eines Felds als Text: «gwr · Daten vom 2026-10-12 · abgefragt 2026-10-16», ohne Stand der Quelle nur «abgefragt …». */
export function quellenText(f: Pick<SteckbriefFeld, 'quelle' | 'daten_vom' | 'abgefragt_am'>): string {
  return [f.quelle, f.daten_vom ? `Daten vom ${f.daten_vom}` : '', `abgefragt ${f.abgefragt_am}`].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------
// Text-Ausgabe für CLI
// ---------------------------------------------------------------------------

function fmt(feld: SteckbriefFeld): string {
  const def = FELDER[feld.key] ?? Object.values(WOHNUNG_FELDER).find((w) => w.label === feld.label);
  const v = feld.value;
  if (v === null || v === undefined) return '–';
  if (typeof v === 'boolean') return def?.format === 'betroffen' ? (v ? 'betroffen' : 'nicht betroffen') : v ? 'ja' : 'nein';
  if (typeof v === 'number') {
    const f = def?.format;
    const s =
      f === 'chf' ? `CHF ${Math.round(v).toLocaleString('de-CH')}`
      : f === 'jahr' || f === 'id' ? String(v)
      : f === 'dezimal' ? v.toLocaleString('de-CH', { maximumFractionDigits: 1 })
      : v.toLocaleString('de-CH', { maximumFractionDigits: 0 });
    return feld.unit && f !== 'chf' ? `${s} ${feld.unit}` : s;
  }
  return String(v);
}

export function steckbriefAlsText(s: Steckbrief, opts: { quellen?: boolean } = {}): string {
  const lines: string[] = [];
  // Kopf: Strasse (GWR, sonst das geocode-Label), darunter «3084 Wabern · Gemeinde Köniz · BE», darunter die Kennungen
  lines.push(`grundpass · ${s.adresse.strasse ?? s.adresse.label ?? s.subject}`);
  const zeile2 = adressZeile(s.adresse);
  if (zeile2) lines.push(zeile2);
  lines.push(`EGID ${s.adresse.egid ?? '?'} · EGRID ${s.adresse.egrid ?? '?'} · Parzelle ${s.adresse.parzelle ?? '?'}${s.partial ? ' · UNVOLLSTÄNDIG' : ''}`);
  lines.push('');
  for (const ab of s.abschnitte) {
    lines.push(ab.titel.toUpperCase());
    const w = Math.max(...ab.felder.map((f) => f.label.length));
    for (const f of ab.felder) {
      const src = opts.quellen === false ? '' : `   ${quellenText(f)}`;
      lines.push(`  ${f.label.padEnd(w)}  ${fmt(f)}${src}`);
    }
    lines.push('');
  }
  if (s.luecken.length) {
    lines.push('LÜCKEN');
    for (const l of s.luecken) {
      const grund =
        l.grund === 'fehlt_im_register' ? 'fehlt im Register'
        : l.grund === 'quelle_nicht_erreichbar' ? 'Quelle nicht erreichbar'
        : l.grund === 'quelle_uebersprungen' ? 'Quelle übersprungen'
        : l.grund === 'quelle_ausser_kanton' ? 'Quelle für diesen Kanton nicht angeschlossen'
        : l.grund === 'hinweis' ? 'siehe Hinweis'
        : 'Quelle abgeschaltet';
      lines.push(`  ${l.label}: ${grund}${l.quelle ? ` (${l.quelle})` : ''}${l.detail ? ` · ${l.detail}` : ''}`);
    }
    lines.push('');
  }
  lines.push('QUELLEN');
  for (const q of s.quellen) {
    const stand = [q.daten_vom ? `Daten vom ${q.daten_vom}` : '', q.abgefragt_am ? `abgefragt ${q.abgefragt_am}` : ''].filter(Boolean).join(' · ');
    lines.push(`  ${q.adapter.padEnd(16)} ${q.status.padEnd(13)} ${String(q.ms).padStart(5)} ms${stand ? `  ${stand}` : ''}${q.experimentell ? '  [experimentell]' : ''}${q.fehler ? `  ${q.fehler}` : ''}`);
  }
  lines.push('');
  lines.push(`Lauf ${s.run_id} · ${s.ms} ms · ${s.attribution.join(' · ')}`);
  return lines.join('\n');
}
