import type { Fact, Keys, RunResult } from '../types.ts';
import type { AdapterRunRecord, CachedAdapterRun, FactStore, RunSummary } from './store.ts';

/**
 * Minimaler SQL-Client. PGlite (Dev) und node-postgres (Prod) erfüllen beide dieses Interface,
 * darum gibt es nur eine SQL-Implementierung des Stores.
 */
export interface SqlClient {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  close?(): Promise<void>;
}

export const SCHEMA_SQL = `
create table if not exists adapter_runs (
  id bigserial primary key,
  run_id text not null,
  adapter text not null,
  subject text,
  status text not null,
  ms integer,
  cache_hit boolean not null default false,
  error text,
  error_kind text,
  keys jsonb,
  request_url text,
  fetched_at timestamptz not null
);
create index if not exists adapter_runs_lookup on adapter_runs (subject, adapter, status, fetched_at desc);

create table if not exists facts (
  id bigserial primary key,
  run_id text not null,
  subject text not null,
  key text not null,
  value jsonb,
  unit text,
  source text not null,
  fetched_at timestamptz not null,
  request_url text,
  confidence real not null default 1,
  source_date text,
  derived_from jsonb
);
create index if not exists facts_subject on facts (subject, source, run_id);
create index if not exists facts_latest on facts (subject, key, source, fetched_at desc);

create table if not exists runs (
  run_id text primary key,
  subject text,
  input jsonb,
  result jsonb not null,
  partial boolean not null default false,
  created_at timestamptz not null
);
create index if not exists runs_subject on runs (subject, created_at desc);

create table if not exists snapshots (
  name text primary key,
  value jsonb,
  updated_at timestamptz not null
);
`;

type FactRow = {
  run_id: string;
  subject: string;
  key: string;
  value: unknown;
  unit: string | null;
  source: string;
  fetched_at: string | Date;
  request_url: string | null;
  confidence: number;
  source_date: string | null;
  derived_from: string[] | null;
};

function rowToFact(r: FactRow): Fact {
  const f: Fact = {
    subject: r.subject,
    key: r.key,
    value: r.value as Fact['value'],
    source: r.source,
    fetched_at: new Date(r.fetched_at).toISOString(),
    confidence: Number(r.confidence),
    run_id: r.run_id,
  };
  if (r.unit) f.unit = r.unit;
  if (r.request_url) f.request_url = r.request_url;
  if (r.source_date) f.source_date = r.source_date;
  if (r.derived_from && r.derived_from.length) f.derived_from = r.derived_from;
  return f;
}

/** Store auf Postgres-kompatiblem SQL. Funktioniert mit PGlite und mit node-postgres. */
export class SqlStore implements FactStore {
  constructor(private readonly db: SqlClient) {}

  async init(): Promise<void> {
    // Einzeln ausführen: PGlite erlaubt keine Mehrfach-Statements in einer Query.
    for (const stmt of SCHEMA_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
      await this.db.query(stmt);
    }
  }

  async close(): Promise<void> {
    await this.db.close?.();
  }

  async latestAdapterRun(subject: string, adapter: string): Promise<CachedAdapterRun | null> {
    const { rows } = await this.db.query<{ run_id: string; fetched_at: string | Date; keys: Partial<Keys> | null; request_url: string | null }>(
      `select run_id, fetched_at, keys, request_url from adapter_runs
       where subject = $1 and adapter = $2 and status = 'ok'
       order by fetched_at desc limit 1`,
      [subject, adapter],
    );
    const hit = rows[0];
    if (!hit) return null;
    const facts = await this.db.query<FactRow>(
      `select * from facts where run_id = $1 and source = $2 and subject = $3 order by key`,
      [hit.run_id, adapter, subject],
    );
    const out: CachedAdapterRun = {
      run_id: hit.run_id,
      fetched_at: new Date(hit.fetched_at).toISOString(),
      facts: facts.rows.map(rowToFact),
      keys: hit.keys ?? {},
    };
    if (hit.request_url) out.request_url = hit.request_url;
    return out;
  }

  async saveAdapterRun(rec: AdapterRunRecord): Promise<void> {
    await this.db.query(
      `insert into adapter_runs (run_id, adapter, subject, status, ms, cache_hit, error, error_kind, keys, request_url, fetched_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        rec.run_id,
        rec.adapter,
        rec.subject,
        rec.status,
        rec.ms,
        rec.cache_hit,
        rec.error ?? null,
        rec.error_kind ?? null,
        rec.keys ? JSON.stringify(rec.keys) : null,
        rec.request_url ?? null,
        rec.fetched_at,
      ],
    );
    for (const f of rec.facts) {
      await this.db.query(
        `insert into facts (run_id, subject, key, value, unit, source, fetched_at, request_url, confidence, source_date, derived_from)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          f.run_id,
          f.subject,
          f.key,
          JSON.stringify(f.value),
          f.unit ?? null,
          f.source,
          f.fetched_at,
          f.request_url ?? null,
          f.confidence,
          f.source_date ?? null,
          f.derived_from ? JSON.stringify(f.derived_from) : null,
        ],
      );
    }
  }

  async saveRun(result: RunResult): Promise<void> {
    await this.db.query(
      `insert into runs (run_id, subject, input, result, partial, created_at) values ($1,$2,$3,$4,$5,$6)
       on conflict (run_id) do update set result = excluded.result, partial = excluded.partial`,
      [result.run_id, result.subject, JSON.stringify(result.input), JSON.stringify(result), result.partial, result.started_at],
    );
  }

  async getRun(run_id: string): Promise<RunResult | null> {
    const { rows } = await this.db.query<{ result: RunResult }>(`select result from runs where run_id = $1`, [run_id]);
    return rows[0]?.result ?? null;
  }

  async listRuns(subject: string, limit = 20): Promise<RunSummary[]> {
    const { rows } = await this.db.query<{ run_id: string; subject: string | null; partial: boolean; created_at: string | Date }>(
      `select run_id, subject, partial, created_at from runs where subject = $1 order by created_at desc limit $2`,
      [subject, limit],
    );
    return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
  }

  async latestFacts(subject: string): Promise<Fact[]> {
    const { rows } = await this.db.query<FactRow>(
      `select distinct on (key, source) * from facts where subject = $1 order by key, source, fetched_at desc`,
      [subject],
    );
    return rows.map(rowToFact);
  }

  async getSnapshot<T = unknown>(name: string): Promise<T | null> {
    const { rows } = await this.db.query<{ value: T }>(`select value from snapshots where name = $1`, [name]);
    return rows[0]?.value ?? null;
  }

  async setSnapshot(name: string, value: unknown): Promise<void> {
    await this.db.query(
      `insert into snapshots (name, value, updated_at) values ($1,$2,now())
       on conflict (name) do update set value = excluded.value, updated_at = now()`,
      [name, JSON.stringify(value)],
    );
  }
}
