#!/usr/bin/env tsx
import { Core } from '../core.ts';
import { runCanary } from './run.ts';

/** `pnpm canary` – alle goldenen Adressen durchlaufen und das Resultat zeigen. Exit 1 bei Fehlern. */
const core = await Core.create();
try {
  const r = await runCanary(core, { notify: !process.argv.includes('--no-notify') });
  for (const a of r.adressen) {
    console.log(`${a.partial ? '!' : '✓'} ${a.name.padEnd(28)} ${String(a.ms).padStart(5)} ms  ${a.adapters.map((x) => `${x.adapter}:${x.status}`).join(' ')}${a.baseline_neu ? '  (Baseline gesetzt)' : ''}`);
    for (const d of a.drift) console.log(`    drift ${d.key}: ${JSON.stringify(d.vorher)} → ${JSON.stringify(d.nachher)}`);
  }
  console.log('');
  for (const [id, h] of Object.entries(r.adapter_gesundheit)) console.log(`  ${id.padEnd(16)} ${h.ok}/${h.total}`);
  if (r.alarme.length) {
    console.log('\nALARME');
    for (const al of r.alarme) console.log(`  ${al.schwere.toUpperCase().padEnd(5)} ${al.adapter} · ${al.adresse}: ${al.text}`);
  }
  console.log(`\n${r.ok ? 'OK' : 'FEHLER'} · ${r.dauer_ms} ms${r.benachrichtigt ? ' · benachrichtigt' : ''}`);
  process.exitCode = r.ok ? 0 : 1;
} finally {
  await core.close();
}
