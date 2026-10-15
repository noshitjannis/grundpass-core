import type { Adapter, KeyName } from '../types.ts';

export type Plan = {
  /** Adapter-IDs pro Stufe. Stufe 0 läuft sofort, Stufe 1 sobald Stufe 0 ihre Keys geliefert hat usw. */
  stages: string[][];
  /** Adapter, die mit diesen Eingabe-Keys nie laufen können, mit dem fehlenden Key. */
  unreachable: Array<{ adapter: string; missing: string[] }>;
  /** Welche Keys am Ende theoretisch verfügbar sind. */
  keys: KeyName[];
};

function needMet(need: string, available: Set<string>): boolean {
  return need.split('|').some((k) => available.has(k.trim()));
}

/**
 * Berechnet aus den Manifesten den Ablaufplan für eine gegebene Eingabe.
 * Das ist die statische Sicht (nur Manifeste, keine echten Daten), die der Resolver zur Laufzeit
 * dynamisch nachvollzieht. Nützlich für /v1/sources, die Doku und zum Erkennen von Lücken:
 * Ein Adapter, der einen Key braucht, den niemand liefert, taucht in `unreachable` auf.
 */
export function planFor(adapters: Adapter[], inputKeys: KeyName[]): Plan {
  const available = new Set<string>(inputKeys);
  const remaining = new Map(adapters.map((a) => [a.manifest.id, a] as const));
  const stages: string[][] = [];

  // Kantons-Einschränkung zählt wie ein Bedarf an `kanton`.
  const needsOf = (a: Adapter) => [...a.manifest.needs, ...(a.manifest.cantons?.length ? ['kanton'] : [])];

  for (let guard = 0; guard < 50 && remaining.size > 0; guard++) {
    const stage: string[] = [];
    for (const [id, a] of remaining) {
      if (needsOf(a).every((n) => needMet(n, available))) stage.push(id);
    }
    if (stage.length === 0) break;
    for (const id of stage) {
      const a = remaining.get(id)!;
      for (const y of a.manifest.yields) available.add(y);
      remaining.delete(id);
    }
    stages.push(stage);
  }

  const unreachable = [...remaining.values()].map((a) => ({
    adapter: a.manifest.id,
    missing: needsOf(a).filter((n) => !needMet(n, available)),
  }));

  return { stages, unreachable, keys: [...available] as KeyName[] };
}
