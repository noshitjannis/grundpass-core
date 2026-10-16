import { adapters as defaultAdapters } from './adapters/index.ts';
import { createStore } from './facts/index.ts';
import type { FactStore } from './facts/store.ts';
import { createHttpClient } from './http/client.ts';
import { createLogger } from './log.ts';
import { CircuitBreaker } from './resolver/breaker.ts';
import { planFor } from './resolver/plan.ts';
import { AdapterRegistry } from './resolver/registry.ts';
import { resolve as runResolve } from './resolver/run.ts';
import type { Adapter, HttpClient, Keys, Logger, RunResult, Sprache } from './types.ts';
import { buildSteckbrief, type Steckbrief } from './views/steckbrief.ts';

export type CoreOptions = {
  store?: FactStore | 'auto' | 'memory' | 'pglite' | 'postgres';
  adapters?: Adapter[];
  http?: HttpClient;
  log?: Logger;
  breaker?: CircuitBreaker;
};

export type ResolveOptions = { useCache?: boolean };
/** Optionen für den Steckbrief: Cache wie beim Lauf, `lang` für die Sprache der Lesefassung (Standard de). */
export type SteckbriefOptions = ResolveOptions & { lang?: Sprache };

/**
 * Das zusammengesetzte Hirn: Registry + Store + HTTP + Breaker.
 * API, CLI und Canary benutzen alle dieselbe Instanz.
 */
export class Core {
  readonly registry: AdapterRegistry;
  readonly breaker: CircuitBreaker;
  readonly http: HttpClient;
  readonly log: Logger;
  readonly store: FactStore;

  private constructor(store: FactStore, opts: CoreOptions) {
    this.store = store;
    this.log = opts.log ?? createLogger({ name: 'grundpass' });
    this.registry = new AdapterRegistry(opts.adapters ?? defaultAdapters);
    this.breaker = opts.breaker ?? new CircuitBreaker();
    this.http = opts.http ?? createHttpClient({ log: this.log });
  }

  static async create(opts: CoreOptions = {}): Promise<Core> {
    const store = typeof opts.store === 'object' ? opts.store : await createStore(opts.store ?? 'auto');
    return new Core(store, opts);
  }

  async resolve(input: Partial<Keys>, o: ResolveOptions = {}): Promise<RunResult> {
    const deps: Parameters<typeof runResolve>[1] = {
      registry: this.registry,
      store: this.store,
      http: this.http,
      log: this.log,
      breaker: this.breaker,
    };
    if (o.useCache !== undefined) deps.useCache = o.useCache;
    return runResolve(input, deps);
  }

  async steckbrief(input: Partial<Keys>, o: SteckbriefOptions = {}): Promise<{ steckbrief: Steckbrief; run: RunResult }> {
    const { lang, ...resolveOpts } = o;
    const run = await this.resolve(input, resolveOpts);
    return { steckbrief: buildSteckbrief(run, this.registry.all(), lang ? { lang } : {}), run };
  }

  /** Manifeste, Plan ab Adresse, Schalter und Breaker-Zustand. Für /v1/sources und die Doku. */
  sources() {
    const all = this.registry.all();
    const plan = planFor(this.registry.enabled(), ['adresse']);
    const breaker = this.breaker.snapshot();
    return {
      adapters: all.map((a) => ({
        ...a.manifest,
        enabled: !this.registry.isDisabled(a.manifest.id),
        breaker: breaker[a.manifest.id] ?? null,
      })),
      plan,
    };
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}
