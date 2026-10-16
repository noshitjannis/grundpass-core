import { randomUUID } from 'node:crypto';
import { errorKind, errorMessage, TimeoutError } from '../errors.ts';
import type { FactStore } from '../facts/store.ts';
import { mergeKeys, missingNeeds, normalizeAdresse, subjectFor } from '../keys.ts';
import { silentLogger } from '../log.ts';
import type { Adapter, AdapterRunReport, Fact, HttpClient, Keys, Logger, RunResult } from '../types.ts';
import { deriveFacts } from './derive.ts';
import { CircuitBreaker } from './breaker.ts';
import type { AdapterRegistry } from './registry.ts';

export type ResolveDeps = {
  registry: AdapterRegistry;
  store: FactStore;
  http: HttpClient;
  log?: Logger;
  breaker?: CircuitBreaker;
  now?: () => Date;
  /** Cache ausschalten (Canary, Debug). Standard: an. */
  useCache?: boolean;
  /** Harte Obergrenze pro Adapter, falls das Manifest nichts sagt. */
  defaultTimeoutMs?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function withTimeout<T>(p: Promise<T>, ms: number, url: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(url, ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Der Resolver. Kein fester Ablauf, sondern eine Schleife über Manifeste:
 *
 *   solange es Adapter gibt, deren `needs` erfüllt sind und die noch nicht gelaufen sind:
 *     alle davon parallel laufen lassen (eine Stufe)
 *     ihre gelieferten Keys einsammeln
 *
 * Damit ergibt sich der DAG von selbst aus den Manifesten. Ein neuer Adapter braucht nur ein Manifest,
 * der Resolver ändert sich nicht.
 *
 * Pro Adapter: Breaker prüfen, Cache prüfen (TTL aus Manifest), laufen lassen mit Timeout,
 * Fakten mit Herkunft versehen, speichern. Fehler eines Adapters stoppen nie den Lauf.
 * Was wegen fehlender Keys nie laufen konnte, steht am Ende als `skipped` im Bericht.
 */
export async function resolve(input: Partial<Keys>, deps: ResolveDeps): Promise<RunResult> {
  const log = deps.log ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const breaker = deps.breaker ?? sharedBreaker;
  const useCache = deps.useCache ?? true;
  const started = now();
  const run_id = randomUUID();

  let keys: Keys = { ...input };
  if (keys.adresse) keys.adresse = keys.adresse.trim();
  const reports = new Map<string, AdapterRunReport>();
  const facts: Fact[] = [];
  const fallbackSubject = keys.adresse ? `adresse:${normalizeAdresse(keys.adresse)}` : `lauf:${run_id}`;

  const enabled = deps.registry.enabled();
  let stage = 0;

  for (let guard = 0; guard < 50; guard++) {
    const runnable: Adapter[] = [];
    for (const a of enabled) {
      const id = a.manifest.id;
      if (reports.has(id)) continue;
      const needs = [...a.manifest.needs, ...(a.manifest.cantons?.length ? ['kanton'] : [])];
      if (missingNeeds(needs, keys).length > 0) continue;
      if (a.manifest.cantons?.length && keys.kanton && !a.manifest.cantons.includes(keys.kanton)) {
        reports.set(id, { adapter: id, status: 'ausser_kanton', ms: 0, facts_count: 0, stage });
        continue;
      }
      runnable.push(a);
    }
    if (runnable.length === 0) break;

    const stageKeys = keys; // alle Adapter einer Stufe sehen denselben Key-Stand
    const outcomes = await Promise.all(runnable.map((a) => runOne(a, stageKeys, stage)));

    for (const o of outcomes) {
      reports.set(o.report.adapter, o.report);
      facts.push(...o.facts);
      const merged = mergeKeys(keys, o.keys, o.report.adapter);
      keys = merged.keys;
      for (const c of merged.conflicts) log.warn('key-konflikt, erster schreiber gewinnt', { run_id, ...c });
    }
    stage++;
  }

  // Alles, was nie laufen konnte. Unterscheiden: hätte ein vorgelagerter Adapter den Key liefern können
  // (skipped, zählt als partial) oder konnte der Key bei dieser Eingabe gar nie entstehen (nicht_anwendbar)?
  const erreichbar = new Set<string>(Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] != null));
  for (const a of enabled) for (const y of a.manifest.yields) erreichbar.add(y);
  for (const a of deps.registry.all()) {
    const id = a.manifest.id;
    if (reports.has(id)) continue;
    if (deps.registry.isDisabled(id)) {
      reports.set(id, { adapter: id, status: 'disabled', ms: 0, facts_count: 0, stage: -1 });
      continue;
    }
    const needs = [...a.manifest.needs, ...(a.manifest.cantons?.length ? ['kanton'] : [])];
    const missing = missingNeeds(needs, keys);
    const haetteKommenKoennen = missing.some((m) => m.split('|').some((k) => erreichbar.has(k.trim())));
    reports.set(id, { adapter: id, status: haetteKommenKoennen ? 'skipped' : 'nicht_anwendbar', ms: 0, facts_count: 0, stage: -1, missing });
  }

  const subject = subjectFor(keys) ?? fallbackSubject;

  // Abgeleitete Fakten (Quelle `derived`), berechnet aus dem, was da ist.
  const derived = deriveFacts(facts, { subject, run_id, fetched_at: now().toISOString() });
  facts.push(...derived);
  if (derived.length) {
    await deps.store.saveAdapterRun({
      run_id,
      adapter: 'derived',
      subject,
      status: 'ok',
      ms: 0,
      cache_hit: false,
      fetched_at: now().toISOString(),
      facts: derived,
    });
  }

  const adapters = [...reports.values()].sort((a, b) => a.stage - b.stage || a.adapter.localeCompare(b.adapter));
  const partial = adapters.some((r) => r.status === 'failed' || r.status === 'skipped' || r.status === 'open_circuit');
  const finished = now();
  const result: RunResult = {
    run_id,
    subject,
    input,
    keys,
    facts,
    adapters,
    partial,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    ms: finished.getTime() - started.getTime(),
  };
  await deps.store.saveRun(result);
  log.info('lauf fertig', { run_id, subject, ms: result.ms, partial, adapters: adapters.map((a) => `${a.adapter}:${a.status}`) });
  return result;

  // -------------------------------------------------------------------------

  async function runOne(
    adapter: Adapter,
    stageKeys: Keys,
    stageNo: number,
  ): Promise<{ report: AdapterRunReport; facts: Fact[]; keys: Partial<Keys> | undefined }> {
    const id = adapter.manifest.id;
    const t0 = Date.now();
    const subjectNow = subjectFor(stageKeys);

    if (!breaker.canRun(id)) {
      const report: AdapterRunReport = { adapter: id, status: 'open_circuit', ms: 0, facts_count: 0, stage: stageNo, error: 'Circuit Breaker offen' };
      await deps.store.saveAdapterRun({ version: adapter.manifest.version ?? 1, run_id, adapter: id, subject: subjectNow, status: 'open_circuit', ms: 0, cache_hit: false, fetched_at: now().toISOString(), facts: [] });
      return { report, facts: [], keys: undefined };
    }

    // Cache: letzter guter Lauf jünger als TTL und von derselben Adapter-Version? Eine andere Version heisst: der Adapter
    // liefert inzwischen andere Fakten, der alte Lauf gilt nicht mehr (sonst fehlten neue Fakten bis zu 180 Tage).
    if (useCache && subjectNow) {
      const cached = await deps.store.latestAdapterRun(subjectNow, id);
      if (cached && cached.version !== (adapter.manifest.version ?? 1)) {
        log.info('cache verworfen, adapter-version geändert', { run_id, adapter: id, alt: cached.version, neu: adapter.manifest.version ?? 1 });
      } else if (cached) {
        const age = now().getTime() - new Date(cached.fetched_at).getTime();
        if (age < adapter.manifest.ttlDays * DAY_MS) {
          const report: AdapterRunReport = {
            adapter: id,
            status: 'cached',
            ms: Date.now() - t0,
            facts_count: cached.facts.length,
            stage: stageNo,
          };
          if (cached.request_url) report.request_url = cached.request_url;
          await deps.store.saveAdapterRun({ version: adapter.manifest.version ?? 1,
            run_id,
            adapter: id,
            subject: subjectNow,
            status: 'cached',
            ms: report.ms,
            cache_hit: true,
            keys: cached.keys,
            fetched_at: now().toISOString(),
            facts: [],
          });
          return { report, facts: cached.facts, keys: cached.keys };
        }
      }
    }

    const timeoutMs = adapter.manifest.timeoutMs ?? deps.defaultTimeoutMs ?? 10_000;
    try {
      const out = await withTimeout(
        adapter.resolve({ keys: stageKeys, http: deps.http, now, log }),
        timeoutMs,
        adapter.manifest.endpoint,
      );
      const nextKeys = mergeKeys(stageKeys, out.keys, id).keys;
      const subject = subjectFor(nextKeys) ?? fallbackSubject;
      const fetched_at = now().toISOString();
      const requestUrl = out.facts.find((f) => f.request_url)?.request_url;
      const outFacts: Fact[] = out.facts.map((f) => {
        const fact: Fact = {
          subject,
          key: f.key,
          value: f.value,
          source: id,
          fetched_at,
          confidence: f.confidence ?? 1,
          run_id,
        };
        if (f.unit) fact.unit = f.unit;
        if (f.request_url) fact.request_url = f.request_url;
        // Stand pro Fakt (z.B. Datenstand eines Layers) geht vor dem Stand des ganzen Laufs
        const sourceDate = f.source_date ?? out.source_date;
        if (sourceDate) fact.source_date = sourceDate;
        return fact;
      });
      breaker.recordSuccess(id);
      const report: AdapterRunReport = { adapter: id, status: 'ok', ms: Date.now() - t0, facts_count: outFacts.length, stage: stageNo };
      if (requestUrl) report.request_url = requestUrl;
      const rec: Parameters<FactStore['saveAdapterRun']>[0] = {
        version: adapter.manifest.version ?? 1,
        run_id,
        adapter: id,
        subject,
        status: 'ok',
        ms: report.ms,
        cache_hit: false,
        fetched_at,
        facts: outFacts,
      };
      if (out.keys) rec.keys = out.keys;
      if (requestUrl) rec.request_url = requestUrl;
      await deps.store.saveAdapterRun(rec);
      return { report, facts: outFacts, keys: out.keys };
    } catch (err) {
      const kind = errorKind(err);
      const msg = errorMessage(err);
      // Ein leeres Resultat ist keine Störung der Quelle, nur eine Lücke: zählt nicht für den Breaker.
      if (kind !== 'empty') breaker.recordFailure(id, msg);
      log.warn('adapter fehlgeschlagen', { run_id, adapter: id, kind, error: msg });
      const report: AdapterRunReport = {
        adapter: id,
        status: 'failed',
        ms: Date.now() - t0,
        facts_count: 0,
        stage: stageNo,
        error: msg.slice(0, 500),
        error_kind: kind,
      };
      const url = (err as { url?: string })?.url;
      if (url) report.request_url = url;
      const rec: Parameters<FactStore['saveAdapterRun']>[0] = {
        version: adapter.manifest.version ?? 1,
        run_id,
        adapter: id,
        subject: subjectNow,
        status: 'failed',
        ms: report.ms,
        cache_hit: false,
        error: report.error!,
        error_kind: kind,
        fetched_at: now().toISOString(),
        facts: [],
      };
      if (url) rec.request_url = url;
      await deps.store.saveAdapterRun(rec);
      return { report, facts: [], keys: undefined };
    }
  }
}

/** Ein Breaker pro Prozess, damit API-Requests den Zustand teilen. Tests geben ihren eigenen mit. */
export const sharedBreaker = new CircuitBreaker();
