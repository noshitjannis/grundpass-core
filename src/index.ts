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
export { buildSteckbrief, steckbriefAlsText, adressZeile, quellenText, type Steckbrief, type SteckbriefAbschnitt, type SteckbriefFeld, type Luecke, type QuellenEintrag } from './views/steckbrief.ts';
export { FELDER, ABSCHNITTE } from './views/felder.ts';
export { runCanary, type CanaryReport } from './canary/run.ts';
export { runKantonsCanary, type KantonsCanaryReport, type KantonsCanaryEintrag, type KantonsBefund } from './canary/kantone.ts';
export { GOLDENE_ADRESSEN, KANTONS_ADRESSEN, type GoldeneAdresse } from './canary/adressen.ts';
export { OEREB_KANTONE, OEREB_KANTONE_ALLE, OEREB_KANTONE_ANGEBUNDEN, oerebKantoneZaehlung, type OerebKanton, type OerebStatus, type OerebSprache } from './adapters/oereb/kantone.ts';
export { createApp } from './api/app.ts';
export * from './types.ts';
export * from './errors.ts';
export * as gwrCodes from './codes/gwr.ts';
