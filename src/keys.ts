import type { Keys } from './types.ts';

/** Subject aller Fakten eines Objekts. Die EGID ist der einzige schweizweit eindeutige Gebäudeschlüssel. */
export function subjectFor(keys: Keys): string | null {
  return keys.egid != null ? `egid:${keys.egid}` : null;
}

/**
 * Prüft ein `needs`-Manifest gegen vorhandene Keys.
 * Ein Eintrag `a|b` ist erfüllt, wenn a oder b da ist.
 * Gibt die Liste der fehlenden Einträge zurück (leer = alles da).
 */
export function missingNeeds(needs: string[], keys: Keys): string[] {
  const missing: string[] = [];
  for (const need of needs) {
    const alternatives = need.split('|').map((s) => s.trim());
    const ok = alternatives.some((k) => keys[k as keyof Keys] !== undefined && keys[k as keyof Keys] !== null);
    if (!ok) missing.push(need);
  }
  return missing;
}

/** Erste vorhandene Alternative aus `a|b`, für Adapter, die mit Fallback-Keys arbeiten. */
export function pickKey<K extends keyof Keys>(keys: Keys, ...names: K[]): Keys[K] | undefined {
  for (const n of names) {
    const v = keys[n];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** Keys zusammenführen. Erster Schreiber gewinnt, Konflikte werden gemeldet. */
export function mergeKeys(
  base: Keys,
  incoming: Partial<Keys> | undefined,
  source: string,
): { keys: Keys; conflicts: Array<{ key: string; kept: unknown; dropped: unknown; source: string }> } {
  if (!incoming) return { keys: base, conflicts: [] };
  const conflicts: Array<{ key: string; kept: unknown; dropped: unknown; source: string }> = [];
  const out: Keys = { ...base };
  for (const [k, v] of Object.entries(incoming) as Array<[keyof Keys, Keys[keyof Keys]]>) {
    if (v === undefined || v === null) continue;
    const existing = out[k];
    if (existing === undefined || existing === null) {
      (out as Record<string, unknown>)[k] = v;
    } else if (JSON.stringify(existing) !== JSON.stringify(v)) {
      conflicts.push({ key: k, kept: existing, dropped: v, source });
    }
  }
  return { keys: out, conflicts };
}

/** Normalisiert eine Adresse für Cache und Logs: Kleinbuchstaben, Komma weg, Mehrfach-Leerzeichen weg. */
export function normalizeAdresse(s: string): string {
  return s.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}
