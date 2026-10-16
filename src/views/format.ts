import type { Sprache } from '../types.ts';

/**
 * Zahlen und Daten in der Lesefassung, pro Sprache in der Schweizer Variante.
 *
 * Zahlen über Intl: de-CH und it-CH gruppieren mit Apostroph (44'550), en-CH ebenso; fr-CH gruppiert mit einem geschützten
 * schmalen Leerzeichen (44 550, U+202F), wie es die Bundeskanzlei für französische Texte vorgibt. Node (ICU) liefert für fr-CH
 * den Apostroph, darum wird die Gruppierung über formatToParts ersetzt. Dezimaltrennzeichen aus Intl: Punkt in de, it, en,
 * Komma in fr (33,2 dB). Vierstellige Zahlen gruppiert it-CH nicht (CLDR: 1235, aber 10'000), de-CH, fr-CH und en-CH schon.
 *
 * Daten überall TT.MM.JJJJ, ohne Intl: Die vier Sprachen schreiben das Datum in der Schweiz gleich. Einheiten (m², kWh/a, dB)
 * bleiben unverändert.
 */
export const LOCALE: Record<Sprache, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };

/** Geschütztes schmales Leerzeichen als Tausendertrennzeichen im Französischen. */
export const FR_GRUPPE = ' ';

export function formatZahl(v: number, sprache: Sprache, opts: { maximumFractionDigits?: number; minimumFractionDigits?: number } = {}): string {
  const nf = new Intl.NumberFormat(LOCALE[sprache], { maximumFractionDigits: opts.maximumFractionDigits ?? 0, minimumFractionDigits: opts.minimumFractionDigits ?? 0 });
  if (sprache !== 'fr') return nf.format(v);
  return nf
    .formatToParts(v)
    .map((p) => (p.type === 'group' ? FR_GRUPPE : p.value))
    .join('');
}

/** «2026-10-12» oder «2026-10-12T08:00:00Z» → «12.10.2026». Alles andere unverändert. */
export function formatDatum(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Platzhalter `{name}` in einem Text ersetzen. Fehlt ein Parameter, bleibt der Platzhalter sichtbar stehen (kein stiller Default). */
export function fuelle(text: string, params: Record<string, string | number | undefined>): string {
  return text.replace(/\{(\w+)\}/g, (ganz, name: string) => {
    const v = params[name];
    return v === undefined || v === null ? ganz : String(v);
  });
}
