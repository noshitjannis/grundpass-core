/**
 * Öffentliche API von @grundpass/core.
 *
 *   import { Core } from '@grundpass/core';
 *   const core = await Core.create();                  // Store nach Umgebung
 *   const { steckbrief } = await core.steckbrief({ adresse: 'Maygutstrasse 26, 3084 Wabern' });
 */
export { Core, type CoreOptions, type ResolveOptions } from './core.ts';
export { adapters } from './adapters/index.ts';
export { AdapterRegistry } from './resolver/registry.ts';
export { CircuitBreaker } from './resolver/breaker.ts';
export { planFor, type Plan } from './resolver/plan.ts';
export { resolve, type ResolveDeps } from './resolver/run.ts';
export { createHttpClient, type HttpClientOptions } from './http/client.ts';
export { createStore, createPgliteMemoryStore, MemoryStore, SqlStore, type FactStore } from './facts/index.ts';
export { buildSteckbrief, steckbriefAlsText, type Steckbrief, type SteckbriefAbschnitt, type SteckbriefFeld, type Luecke } from './views/steckbrief.ts';
export { FELDER, ABSCHNITTE } from './views/felder.ts';
export { runCanary, type CanaryReport } from './canary/run.ts';
export { GOLDENE_ADRESSEN } from './canary/adressen.ts';
export { createApp } from './api/app.ts';
export * from './types.ts';
export * from './errors.ts';
export * as gwrCodes from './codes/gwr.ts';
