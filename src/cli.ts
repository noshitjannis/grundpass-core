#!/usr/bin/env tsx
import { Core } from './core.ts';
import { createLogger } from './log.ts';
import { istSprache, SPRACHEN } from './types.ts';
import { steckbriefAlsText } from './views/steckbrief.ts';

/**
 * gp "<Adresse>"            Steckbrief im Terminal
 * gp --egid 1271632
 * Optionen: --json  --nocache  --memory (kein Store, nichts speichern)  --ohne-quellen  --lang de|fr|it|en (Standard de)
 */
const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const wertVon = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const egidIdx = args.indexOf('--egid');
const egid = egidIdx >= 0 ? Number(args[egidIdx + 1]) : undefined;
const langIdx = args.indexOf('--lang');
const langRaw = wertVon('--lang');
if (langRaw !== undefined && !istSprache(langRaw)) {
  console.error(`--lang muss ${SPRACHEN.join(', ')} sein`);
  process.exit(2);
}
// Ohne --egid ist egidIdx -1; dann darf Index 0 (die Adresse) nicht als EGID-Wert rausfallen. Gleiches für den Wert von --lang.
const adresse = args
  .filter((a, i) => !a.startsWith('--') && (egidIdx < 0 || i !== egidIdx + 1) && (langIdx < 0 || i !== langIdx + 1))
  .join(' ')
  .trim();

if (!adresse && !egid) {
  console.error('Verwendung: gp "Maygutstrasse 26, 3084 Wabern" [--json] [--nocache] [--memory] [--lang fr]\n            gp --egid 1271632');
  process.exit(2);
}

const core = await Core.create({ store: flag('--memory') ? 'memory' : 'auto', log: createLogger({ level: (process.env.GP_LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'error' }) });
try {
  const input = egid ? { egid } : { adresse };
  const opts: Parameters<Core['steckbrief']>[1] = {};
  if (flag('--nocache')) opts.useCache = false;
  if (langRaw !== undefined && istSprache(langRaw)) opts.lang = langRaw;
  const { steckbrief, run } = await core.steckbrief(input, opts);
  if (flag('--json')) console.log(JSON.stringify(flag('--lauf') ? run : steckbrief, null, 2));
  else console.log(steckbriefAlsText(steckbrief, { quellen: !flag('--ohne-quellen') }));
  process.exitCode = steckbrief.partial ? 1 : 0;
} finally {
  await core.close();
}
