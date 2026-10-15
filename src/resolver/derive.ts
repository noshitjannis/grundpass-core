import type { Fact } from '../types.ts';

type Ctx = { subject: string; run_id: string; fetched_at: string };

function latest(facts: Fact[], key: string): Fact | undefined {
  // Jüngster Fakt mit höchster Confidence zu diesem Key.
  return facts
    .filter((f) => f.key === key && f.value !== null)
    .sort((a, b) => b.confidence - a.confidence || b.fetched_at.localeCompare(a.fetched_at))[0];
}

function num(f: Fact | undefined): number | null {
  return f && typeof f.value === 'number' ? f.value : null;
}

/**
 * Abgeleitete Fakten: berechnet aus Registerfakten, nie aus der Luft.
 * Quelle ist immer `derived`, `derived_from` nennt die Eingangs-Keys, Confidence liegt unter 1.
 *
 * Hier gehört nur hin, was rein rechnerisch ist. Heuristiken mit Meinung (Baureserve ja/nein,
 * Preis) gehören in die App, nicht in den Core.
 */
export function deriveFacts(facts: Fact[], ctx: Ctx): Fact[] {
  const out: Fact[] = [];
  const mk = (key: string, value: Fact['value'], unit: string | undefined, from: string[], confidence = 0.9): Fact => {
    const f: Fact = { subject: ctx.subject, key, value, source: 'derived', fetched_at: ctx.fetched_at, confidence, run_id: ctx.run_id, derived_from: from };
    if (unit) f.unit = unit;
    return f;
  };

  // Bebauter Anteil = Gebäudegrundfläche / Parzellenfläche
  const grund = num(latest(facts, 'gebaeude.grundflaeche_m2'));
  const parz = num(latest(facts, 'parzelle.flaeche_m2'));
  if (grund != null && parz != null && parz > 0) {
    out.push(mk('parzelle.bebauter_anteil_prozent', Math.round((grund / parz) * 1000) / 10, '%', ['gebaeude.grundflaeche_m2', 'parzelle.flaeche_m2']));
  }

  // Gebäudealter aus Baujahr oder Bauperioden-Mitte
  const jahr = new Date(ctx.fetched_at).getFullYear();
  const baujahr = num(latest(facts, 'gebaeude.baujahr'));
  if (baujahr != null) {
    out.push(mk('gebaeude.alter_jahre', jahr - baujahr, 'Jahre', ['gebaeude.baujahr']));
  } else {
    const mitte = num(latest(facts, 'gebaeude.bauperiode_mitte'));
    if (mitte != null) out.push(mk('gebaeude.alter_jahre', jahr - mitte, 'Jahre', ['gebaeude.bauperiode_mitte'], 0.6));
  }

  // Wohnfläche total und Zimmer total über alle Wohnungen
  const flaechen = facts.filter((f) => /^wohnung\.\d+\.flaeche_m2$/.test(f.key) && typeof f.value === 'number');
  if (flaechen.length) {
    out.push(mk('wohnungen.flaeche_total_m2', flaechen.reduce((s, f) => s + (f.value as number), 0), 'm2', flaechen.map((f) => f.key)));
  }
  const zimmer = facts.filter((f) => /^wohnung\.\d+\.zimmer$/.test(f.key) && typeof f.value === 'number');
  if (zimmer.length) {
    out.push(mk('wohnungen.zimmer_total', zimmer.reduce((s, f) => s + (f.value as number), 0), undefined, zimmer.map((f) => f.key)));
  }

  return out;
}
