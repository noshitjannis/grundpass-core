import { OEREB_KANTONE, type OerebStatus } from '../adapters/oereb/kantone.ts';
import type { Core } from '../core.ts';
import { KANTONS_ADRESSEN, type GoldeneAdresse } from './adressen.ts';
import { createNtfySink, type AlertSink } from './alert.ts';

/**
 * Befund pro Kanton:
 *  - ok: ÖREB-Adapter ok und zone.bezeichnung da
 *  - leer: Dienst antwortet, aber ohne Zone (ok ohne zone.bezeichnung) oder EGRID dem Kataster unbekannt (failed, empty)
 *  - failed: Dienst antwortet nicht, nicht rechtzeitig oder nicht in bekannter Form (http, timeout, schema, other)
 *  - vorgelagert: geocode oder gwr lieferten nichts, der ÖREB-Adapter kam nicht dran (skipped)
 *  - falscher_kanton: die Referenzadresse geocodiert in einen anderen Kanton als eingetragen
 *  - kein_dienst: Kanton steht in kantone.ts als kein_dienst, der Adapter läuft dort nicht (ausser_kanton), kein Alarm
 */
export type KantonsBefund = 'ok' | 'leer' | 'failed' | 'vorgelagert' | 'falscher_kanton' | 'kein_dienst';

export type KantonsCanaryEintrag = {
  kanton: string;
  name: string;
  adresse: string;
  /** Status aus kantone.ts. */
  erwartet: OerebStatus;
  /** Status des ÖREB-Adapters im Lauf (ok, failed, skipped, ausser_kanton …). */
  status: string;
  befund: KantonsBefund;
  ms: number;
  /** 1 oder 2: Ein zweiter Versuch folgt nach `retryNachMs`, wenn der erste an Timeout, 429 oder 5xx scheiterte. */
  versuche: number;
  /** Befund und Fehler des ersten Versuchs, wenn es einen zweiten gab. */
  erster_fehler?: string;
  zone?: string;
  erkennung?: string;
  error_kind?: string;
  fehler?: string;
};

export type KantonsCanaryReport = {
  /** true, wenn kein Alarm (jeder angebundene Kanton liefert eine Zone). */
  ok: boolean;
  gestartet: string;
  dauer_ms: number;
  kantone: KantonsCanaryEintrag[];
  /** Ein Satz pro Kanton mit Befund und Fehlerart, so geht er auch an ntfy. */
  alarme: string[];
  benachrichtigt: boolean;
};

export type KantonsCanaryOptions = {
  adressen?: GoldeneAdresse[];
  sink?: AlertSink;
  notify?: boolean;
  /** Wartezeit vor dem zweiten Versuch bei Timeout, 429 oder 5xx. Standard 60 s; Tests setzen 0. */
  retryNachMs?: number;
  /** Warten, injizierbar für Tests. */
  warten?: (ms: number) => Promise<void>;
};

export const RETRY_NACH_MS = 60_000;

/**
 * Vorübergehender Fehler: Timeout (Kaltstart eines Dienstes, GL brauchte 58 s), HTTP 429 (Rate-Limit, GIS Daten AG beim zweiten
 * Aufruf) oder 5xx (ZG antwortete am 16.10.2026 zweimal mit HTTP 500 und war eine Minute später wieder da). Genau dafür gibt es
 * einen zweiten Versuch nach `retryNachMs`; erst wenn auch der scheitert, wird alarmiert. Andere Fehler (schema, empty, 4xx ausser
 * 429) wiederholen sich sofort und bekommen keinen zweiten Versuch.
 */
export function vorueberGehend(e: Pick<KantonsCanaryEintrag, 'befund' | 'error_kind' | 'fehler'>): boolean {
  if (e.befund !== 'failed') return false;
  if (e.error_kind === 'timeout') return true;
  if (e.error_kind === 'http' && /^HTTP (429|5\d\d)\b/.test(e.fehler ?? '')) return true;
  return false;
}

async function pruefe(core: Core, g: GoldeneAdresse): Promise<KantonsCanaryEintrag> {
  const erwartet = OEREB_KANTONE[g.kanton]?.status ?? 'kein_dienst';
  const e: KantonsCanaryEintrag = { kanton: g.kanton, name: g.name, adresse: g.adresse, erwartet, status: '?', befund: 'failed', ms: 0, versuche: 1 };
  try {
    const run = await core.resolve({ adresse: g.adresse }, { useCache: false });
    e.ms = run.ms;
    const r = run.adapters.find((a) => a.adapter === 'oereb');
    e.status = r?.status ?? 'fehlt';
    if (r?.error_kind) e.error_kind = r.error_kind;
    if (r?.error) e.fehler = r.error;
    const zone = run.facts.find((f) => f.key === 'zone.bezeichnung' && f.source === 'oereb')?.value;
    const erkennung = run.facts.find((f) => f.key === 'zone.erkennung' && f.source === 'oereb')?.value;
    if (typeof zone === 'string' && zone) e.zone = zone;
    if (typeof erkennung === 'string') e.erkennung = erkennung;
    if (run.keys.kanton && run.keys.kanton !== g.kanton) {
      e.befund = 'falscher_kanton';
      e.fehler = `GWR nennt Kanton ${run.keys.kanton}`;
    } else if (erwartet === 'kein_dienst') {
      e.befund = 'kein_dienst';
    } else if (r?.status === 'ok' || r?.status === 'cached') {
      e.befund = e.zone ? 'ok' : 'leer';
    } else if (r?.status === 'failed') {
      e.befund = r.error_kind === 'empty' ? 'leer' : 'failed';
    } else if (r?.status === 'skipped' || r?.status === 'nicht_anwendbar') {
      e.befund = 'vorgelagert';
      const vor = run.adapters.find((a) => (a.adapter === 'geocode' || a.adapter === 'gwr') && a.status !== 'ok' && a.status !== 'cached');
      if (vor) e.fehler = `${vor.adapter}: ${vor.error ?? vor.status}`;
    } else {
      e.befund = 'failed';
    }
  } catch (err) {
    e.befund = 'failed';
    e.fehler = String(err).slice(0, 300);
  }
  return e;
}

/**
 * Kantons-Canary: alle KANTONS_ADRESSEN ohne Cache durch den übergebenen Core. Der Aufrufer baut ihn mit nur drei Adaptern
 * (geocode, gwr, oereb), Memory-Store und einem Breaker mit hoher Schwelle (src/canary/kantone-cli.ts), damit ein paar kaputte
 * Kantone nicht die restlichen in open_circuit schicken. Keine Baseline, kein Drift: Es zählt, ob jeder angebundene Kanton eine Zone
 * liefert. Scheitert ein Kanton an Timeout, 429 oder 5xx, folgt nach `retryNachMs` (60 s) genau ein zweiter Versuch; erst wenn auch
 * der scheitert, zählt der Kanton als Alarm (`versuche` 2, `erster_fehler`). Alarm (ntfy, NTFY_TOPIC) mit Kanton und Fehlerart, sobald
 * ein Kanton failed, leer, vorgelagert oder im falschen Kanton ist; error, wenn ein Dienst kaputt ist, warn, wenn nur Zonen fehlen.
 * Kantone mit Status kein_dienst erzeugen nie einen Alarm. Keine Deduplikation: Der Lauf ist täglich (GitHub Action canary-kantone.yml),
 * eine Meldung pro Tag ist gewollt.
 */
export async function runKantonsCanary(core: Core, opts: KantonsCanaryOptions = {}): Promise<KantonsCanaryReport> {
  const adressen = opts.adressen ?? KANTONS_ADRESSEN;
  const sink = opts.sink ?? createNtfySink({ log: core.log });
  const retryNachMs = opts.retryNachMs ?? RETRY_NACH_MS;
  const warten = opts.warten ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const t0 = Date.now();
  const gestartet = new Date().toISOString();
  const kantone: KantonsCanaryEintrag[] = [];
  const alarme: string[] = [];

  for (const g of adressen) {
    let e = await pruefe(core, g);
    if (vorueberGehend(e)) {
      core.log.warn('kantons-canary: vorübergehender Fehler, zweiter Versuch', { kanton: g.kanton, error_kind: e.error_kind, fehler: e.fehler, nach_ms: retryNachMs });
      await warten(retryNachMs);
      const erster = e;
      e = await pruefe(core, g);
      e.versuche = 2;
      e.erster_fehler = `${erster.error_kind ?? erster.befund}: ${erster.fehler ?? ''}`.trim();
    }
    kantone.push(e);
    if (e.befund !== 'ok' && e.befund !== 'kein_dienst') {
      const zweiter = e.versuche === 2 ? ` · auch im 2. Versuch nach ${Math.round(retryNachMs / 1000)} s` : '';
      alarme.push(`${e.kanton} (${e.name}): ${e.befund}${e.error_kind ? ` · ${e.error_kind}` : ''}${e.fehler ? ` · ${e.fehler.slice(0, 160)}` : ''}${zweiter}`);
    }
  }

  const report: KantonsCanaryReport = { ok: alarme.length === 0, gestartet, dauer_ms: Date.now() - t0, kantone, alarme, benachrichtigt: false };
  if (alarme.length && (opts.notify ?? true)) {
    const schwere = kantone.some((e) => e.befund === 'failed' || e.befund === 'vorgelagert' || e.befund === 'falscher_kanton') ? 'error' : 'warn';
    await sink(`grundpass Kantone: ${alarme.length} von ${kantone.length} mit Befund`, alarme.join('\n'), schwere);
    report.benachrichtigt = true;
  }
  core.log.info('kantons-canary fertig', { ok: report.ok, alarme: alarme.length, dauer_ms: report.dauer_ms });
  return report;
}
