import type { Fact } from '../types.ts';

type Ctx = { subject: string; run_id: string; fetched_at: string };

/** LSV Anhang 3, Immissionsgrenzwerte Strassenverkehrslärm in dB(A), [Tag, Nacht] je Empfindlichkeitsstufe. */
export const IGW_STRASSE: Record<string, [number, number]> = { I: [55, 45], II: [60, 50], III: [65, 55], IV: [70, 60] };

/**
 * LSV Anhang 4 Ziff. 2 (SR 814.41, «Belastungsgrenzwerte für Eisenbahnlärm»), Immissionsgrenzwerte Lr in dB(A), [Tag, Nacht]
 * je Empfindlichkeitsstufe. Gegengeprüft am 16.10.2026 im konsolidierten Gesetzestext, Fassung vom 1.4.2026:
 * https://www.fedlex.admin.ch/eli/cc/1987/338_338_338/de (fedlex.data.admin.ch/eli/cc/1987/338_338_338/20260401, Anhang 4 Ziff. 2):
 * ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60. Dieselbe Tabelle nennt Planungswerte (50/40, 55/45, 60/50, 65/55) und
 * Alarmwerte (65/60, 70/65, 70/65, 75/70); wir zeigen nur die Immissionsgrenzwerte. Lärm von Bahnen auf Strassen (Tram) zählt
 * laut Anhang 4 Ziff. 1 Abs. 2 als Strassenverkehrslärm (Anhang 3).
 */
export const IGW_BAHN: Record<string, [number, number]> = { I: [55, 45], II: [60, 50], III: [65, 55], IV: [70, 60] };

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

  // Bebauter Anteil = Gebäudegrundfläche / Parzellenfläche. Amtliche Grundbuchfläche (ÖREB) vor Geometrie-Schätzung (AV).
  const grund = num(latest(facts, 'gebaeude.grundflaeche_m2'));
  const parzKey = latest(facts, 'parzelle.flaeche_grundbuch_m2') ? 'parzelle.flaeche_grundbuch_m2' : 'parzelle.flaeche_m2';
  const parz = num(latest(facts, parzKey));
  if (grund != null && parz != null && parz > 0) {
    out.push(mk('parzelle.bebauter_anteil_prozent', Math.round((grund / parz) * 1000) / 10, '%', ['gebaeude.grundflaeche_m2', parzKey]));
  }

  // Immissionsgrenzwerte Strassenverkehrslärm (LSV Anhang 3, Tag/Nacht) aus der Empfindlichkeitsstufe des ÖREB-Katasters.
  // Gesetzestabelle, keine Schätzung, darum Confidence 1. Ohne Stufe gibt es keinen Grenzwert (früher pauschal ES II).
  const es = latest(facts, 'laerm.empfindlichkeitsstufe');
  const igw = typeof es?.value === 'string' ? IGW_STRASSE[es.value] : undefined;
  if (igw) {
    out.push(mk('laerm.strasse.grenzwert_tag_db', igw[0], 'dB', ['laerm.empfindlichkeitsstufe'], 1));
    out.push(mk('laerm.strasse.grenzwert_nacht_db', igw[1], 'dB', ['laerm.empfindlichkeitsstufe'], 1));
  }

  // Immissionsgrenzwerte Eisenbahnlärm (LSV Anhang 4 Ziff. 2) aus derselben Stufe, aber nur, wenn am Punkt ein Bahnpegel kartiert
  // ist: Ein Grenzwert ohne Pegel daneben sagt nichts. Ohne Stufe wie bei der Strasse kein Grenzwert.
  const igwBahn = typeof es?.value === 'string' ? IGW_BAHN[es.value] : undefined;
  const bahnPegel = latest(facts, 'laerm.bahn.tag_db') ?? latest(facts, 'laerm.bahn.nacht_db');
  if (igwBahn && bahnPegel) {
    out.push(mk('laerm.bahn.grenzwert_tag_db', igwBahn[0], 'dB', ['laerm.empfindlichkeitsstufe'], 1));
    out.push(mk('laerm.bahn.grenzwert_nacht_db', igwBahn[1], 'dB', ['laerm.empfindlichkeitsstufe'], 1));
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
