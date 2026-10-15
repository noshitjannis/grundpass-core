#!/usr/bin/env tsx
import { Core } from './core.ts';
import { createLogger } from './log.ts';
import { steckbriefAlsText } from './views/steckbrief.ts';

/**
 * gp "<Adresse>"            Steckbrief im Terminal
 * gp --egid 1271632
 * Optionen: --json  --nocache  --memory (kein Store, nichts speichern)  --ohne-quellen
 */
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const egidIdx = args.indexOf('--egid');
const egid = egidIdx >= 0 ? Number(args[egidIdx + 1]) : undefined;
const adresse = args.filter((a, i) => !a.startsWith('--') && i !== egidIdx + 1).join(' ').trim();

if (!adresse && !egid) {
  console.error('Verwendung: gp "Maygutstrasse 26, 3084 Wabern" [--json] [--nocache] [--memory]\n            gp --egid 1271632');
  process.exit(2);
}

const core = await Core.create({ store: flag('--memory') ? 'memory' : 'auto', log: createLogger({ level: (process.env.GP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'error' }) });
try {
  const input = egid ? { egid } : { adresse };
  const { steckbrief, run } = await core.steckbrief(input, flag('--nocache') ? { useCache: false } : {});
  if (flag('--json')) console.log(JSON.stringify(flag('--lauf') ? run : steckbrief, null, 2));
  else console.log(steckbriefAlsText(steckbrief, { quellen: !flag('--ohne-quellen') }));
  process.exitCode = steckbrief.partial ? 1 : 0;
} finally {
  await core.close();
}
