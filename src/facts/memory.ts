import type { Fact, RunResult } from '../types.ts';
import type { AdapterRunRecord, CachedAdapterRun, FactStore, RunSummary } from './store.ts';

/** In-Memory-Store für Tests und Einmal-Läufe (CLI ohne Datenbank). Vergisst alles beim Beenden. */
export class MemoryStore implements FactStore {
  private adapterRuns: AdapterRunRecord[] = [];
  private facts: Fact[] = [];
  private runs = new Map<string, RunResult>();
  private snapshots = new Map<string, unknown>();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async latestAdapterRun(subject: string, adapter: string): Promise<CachedAdapterRun | null> {
    const hit = [...this.adapterRuns]
      .reverse()
      .find((r) => r.subject === subject && r.adapter === adapter && r.status === 'ok');
    if (!hit) return null;
    const out: CachedAdapterRun = {
      run_id: hit.run_id,
      fetched_at: hit.fetched_at,
      version: hit.version ?? 1,
      facts: this.facts.filter((f) => f.run_id === hit.run_id && f.source === adapter),
      keys: hit.keys ?? {},
    };
    if (hit.request_url) out.request_url = hit.request_url;
    return out;
  }

  async saveAdapterRun(rec: AdapterRunRecord): Promise<void> {
    this.adapterRuns.push({ ...rec, facts: [] });
    this.facts.push(...rec.facts);
  }

  async saveRun(result: RunResult): Promise<void> {
    this.runs.set(result.run_id, result);
  }

  async getRun(run_id: string): Promise<RunResult | null> {
    return this.runs.get(run_id) ?? null;
  }

  async listRuns(subject: string, limit = 20): Promise<RunSummary[]> {
    return [...this.runs.values()]
      .filter((r) => r.subject === subject)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit)
      .map((r) => ({ run_id: r.run_id, subject: r.subject, partial: r.partial, created_at: r.started_at }));
  }

  async latestFacts(subject: string): Promise<Fact[]> {
    const byKey = new Map<string, Fact>();
    for (const f of this.facts) {
      if (f.subject !== subject) continue;
      const k = `${f.key}::${f.source}`;
      const prev = byKey.get(k);
      if (!prev || prev.fetched_at < f.fetched_at) byKey.set(k, f);
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  async getSnapshot<T = unknown>(name: string): Promise<T | null> {
    return (this.snapshots.get(name) as T | undefined) ?? null;
  }

  async setSnapshot(name: string, value: unknown): Promise<void> {
    this.snapshots.set(name, value);
  }
}
