#!/usr/bin/env tsx
import { writeFileSync } from 'node:fs';
import { glossarMarkdown } from '../src/views/i18n/glossar.ts';

/** `pnpm glossar`: schreibt docs/GLOSSAR.md aus den Sprachdateien. Der Test in test/i18n.test.ts verlangt, dass die Datei aktuell ist. */
const ziel = 'docs/GLOSSAR.md';
const text = glossarMarkdown();
writeFileSync(ziel, text + '\n');
console.log(`${ziel}: ${text.split('\n').length} Zeilen`);
