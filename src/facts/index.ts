import { mkdirSync } from 'node:fs';
import { MemoryStore } from './memory.ts';
import { SqlStore, type SqlClient } from './sql.ts';
import type { FactStore } from './store.ts';

export type { FactStore, AdapterRunRecord, CachedAdapterRun, RunSummary } from './store.ts';
export { MemoryStore } from './memory.ts';
export { SqlStore, SCHEMA_SQL } from './sql.ts';

/**
 * Wählt den Store nach Umgebung:
 *  - DATABASE_URL gesetzt: Postgres via node-postgres (Prod, z.B. Neon).
 *  - sonst: PGlite im Ordner PGLITE_DIR (Standard ./data/grundpass). Kein Setup nötig.
 *  - `memory`: nichts persistieren (Tests, Einmal-Läufe).
 */
export async function createStore(kind: 'auto' | 'memory' | 'pglite' | 'postgres' = 'auto'): Promise<FactStore> {
  if (kind === 'memory') return new MemoryStore();
  const url = process.env.DATABASE_URL;
  if (kind === 'postgres' || (kind === 'auto' && url)) {
    if (!url) throw new Error('DATABASE_URL fehlt');
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    const client: SqlClient = {
      query: (sql, params) => pool.query(sql, params as never[]) as Promise<{ rows: never[] }>,
      close: () => pool.end(),
    };
    const store = new SqlStore(client);
    await store.init();
    return store;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || './data/grundpass';
  // PGlite legt nur den letzten Ordner an. Im frischen Klon fehlt ./data, darum rekursiv.
  mkdirSync(dir, { recursive: true });
  const pgl = new PGlite(dir);
  const client: SqlClient = {
    query: (sql, params) => pgl.query(sql, params as never[]) as Promise<{ rows: never[] }>,
    close: () => pgl.close(),
  };
  const store = new SqlStore(client);
  await store.init();
  return store;
}

/** PGlite nur im Speicher. Für Tests, die den SQL-Pfad prüfen sollen. */
export async function createPgliteMemoryStore(): Promise<FactStore> {
  const { PGlite } = await import('@electric-sql/pglite');
  const pgl = new PGlite();
  const client: SqlClient = {
    query: (sql, params) => pgl.query(sql, params as never[]) as Promise<{ rows: never[] }>,
    close: () => pgl.close(),
  };
  const store = new SqlStore(client);
  await store.init();
  return store;
}
