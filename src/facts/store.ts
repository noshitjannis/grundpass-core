import type { AdapterRunStatus, Fact, Keys, RunResult } from '../types.ts';

/** Ein Adapter-Lauf, wie er im Store landet. Fakten hängen über run_id + source daran. */
export type AdapterRunRecord = {
  run_id: string;
  adapter: string;
  subject: string | null;
  status: AdapterRunStatus;
  ms: number;
  cache_hit: boolean;
  error?: string;
  error_kind?: string;
  keys?: Partial<Keys>;
  request_url?: string;
  fetched_at: string;
  facts: Fact[];
};

export type CachedAdapterRun = {
  run_id: string;
  fetched_at: string;
  facts: Fact[];
  keys: Partial<Keys>;
  request_url?: string;
};

export type RunSummary = {
  run_id: string;
  subject: string | null;
  partial: boolean;
  created_at: string;
};

/**
 * Der Fakten-Store. Drei Aufgaben:
 *  1. Cache: letzter erfolgreicher Lauf pro (Subject, Adapter), damit innerhalb der TTL nichts neu abgefragt wird.
 *  2. Gedächtnis: alle Fakten mit Herkunft, der aktuelle Stand pro (Key, Source).
 *  3. Snapshots: ganze Läufe für Diffs ("was hat sich seit letztem Monat geändert") und Canary-Vergleiche.
 */
export interface FactStore {
  init(): Promise<void>;
  close(): Promise<void>;

  /** Letzter Lauf mit Status `ok` für dieses Subject und diesen Adapter. Für den Cache. */
  latestAdapterRun(subject: string, adapter: string): Promise<CachedAdapterRun | null>;
  saveAdapterRun(rec: AdapterRunRecord): Promise<void>;

  saveRun(result: RunResult): Promise<void>;
  getRun(run_id: string): Promise<RunResult | null>;
  listRuns(subject: string, limit?: number): Promise<RunSummary[]>;

  /** Aktueller Stand: jüngster Fakt pro (key, source). */
  latestFacts(subject: string): Promise<Fact[]>;

  getSnapshot<T = unknown>(name: string): Promise<T | null>;
  setSnapshot(name: string, value: unknown): Promise<void>;
}
