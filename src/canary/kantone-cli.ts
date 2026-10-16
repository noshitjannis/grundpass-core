#!/usr/bin/env tsx
import { geocode, gwr, oereb } from '../adapters/index.ts';
import { Core } from '../core.ts';
import { createLogger } from '../log.ts';
import { CircuitBreaker } from '../resolver/breaker.ts';
import { KANTONS_ADRESSEN } from './adressen.ts';
import { runKantonsCanary } from './kantone.ts';

/**
 * `pnpm canary:kantone [--no-notify] [ZH BE …]` – alle Kantons-Referenzadressen durch geocode, gwr und oereb, Memory-Store,
 * keine Baseline. Exit 1, sobald ein angebundener Kanton keine Zone liefert. Läuft täglich als GitHub Action (canary-kantone.yml).
 */
const argv = process.argv.slice(2);
const nur = argv.filter((a) => /^[A-Z]{2}$/.test(a));
const core = await Core.create({
  store: 'memory',
  adapters: [geocode, gwr, oereb],
  breaker: new CircuitBreaker({ threshold: 1000 }),
  log: createLogger({ level: (process.env.GP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'warn' }),
});
try {
  const r = await runKantonsCanary(core, { notify: !argv.includes('--no-notify'), ...(nur.length ? { adressen: KANTONS_ADRESSEN.filter((a) => nur.includes(a.kanton)) } : {}) });
  for (const e of r.kantone) {
    const zeichen = e.befund === 'ok' ? '✓' : e.befund === 'kein_dienst' ? '·' : '✗';
    const zone = e.zone ? `${e.zone}${e.erkennung ? ` (${e.erkennung})` : ''}` : '';
    console.log(`${zeichen} ${e.kanton} ${e.name.padEnd(30)} ${String(e.ms).padStart(6)} ms  ${e.befund.padEnd(14)} ${zone}${e.fehler ? `  ${e.fehler.slice(0, 120)}` : ''}`);
  }
  const zaehl = (b: string) => r.kantone.filter((e) => e.befund === b).length;
  console.log(`\nok ${zaehl('ok')} · leer ${zaehl('leer')} · failed ${zaehl('failed')} · vorgelagert ${zaehl('vorgelagert')} · falscher Kanton ${zaehl('falscher_kanton')} · kein Dienst ${zaehl('kein_dienst')}`);
  if (r.alarme.length) {
    console.log('\nALARME');
    for (const a of r.alarme) console.log(`  ${a}`);
  }
  console.log(`\n${r.ok ? 'OK' : 'FEHLER'} · ${r.dauer_ms} ms${r.benachrichtigt ? ' · benachrichtigt' : ''}`);
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await core.close();
}
