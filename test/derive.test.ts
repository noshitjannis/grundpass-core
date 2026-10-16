import { describe, expect, it } from 'vitest';
import { deriveFacts, IGW_BAHN, IGW_STRASSE } from '../src/resolver/derive.ts';
import type { Fact } from '../src/types.ts';

const ctx = { subject: 'egid:1', run_id: 'r1', fetched_at: '2026-10-15T10:00:00.000Z' };
const f = (key: string, value: Fact['value'], source = 'test', confidence = 1): Fact => ({ subject: 'egid:1', key, value, source, fetched_at: ctx.fetched_at, confidence, run_id: 'r0' });
const v = (facts: Fact[], key: string) => facts.find((x) => x.key === key);

describe('derive', () => {
  it('Lärm-Grenzwerte kommen aus der Empfindlichkeitsstufe (LSV Anhang 3), nicht pauschal', () => {
    for (const [es, [tag, nacht]] of Object.entries(IGW_STRASSE)) {
      const out = deriveFacts([f('laerm.empfindlichkeitsstufe', es, 'oereb')], ctx);
      expect(v(out, 'laerm.strasse.grenzwert_tag_db')).toMatchObject({ value: tag, unit: 'dB', source: 'derived', confidence: 1, derived_from: ['laerm.empfindlichkeitsstufe'] });
      expect(v(out, 'laerm.strasse.grenzwert_nacht_db')?.value).toBe(nacht);
    }
    expect(IGW_STRASSE).toEqual({ I: [55, 45], II: [60, 50], III: [65, 55], IV: [70, 60] });
  });

  it('ohne Stufe gibt es keinen Grenzwert, auch nicht ES II als Annahme', () => {
    const out = deriveFacts([f('laerm.strasse.tag_db', 67.2, 'laerm-strasse')], ctx);
    expect(out.some((x) => x.key.startsWith('laerm.strasse.grenzwert'))).toBe(false);
  });

  it('Bahn-Grenzwerte (LSV Anhang 4) kommen aus der Stufe, aber nur, wenn am Punkt ein Bahnpegel kartiert ist', () => {
    expect(IGW_BAHN).toEqual({ I: [55, 45], II: [60, 50], III: [65, 55], IV: [70, 60] });
    for (const [es, [tag, nacht]] of Object.entries(IGW_BAHN)) {
      const out = deriveFacts([f('laerm.empfindlichkeitsstufe', es, 'oereb'), f('laerm.bahn.tag_db', 52.3, 'laerm-bahn')], ctx);
      expect(v(out, 'laerm.bahn.grenzwert_tag_db')).toMatchObject({ value: tag, unit: 'dB', source: 'derived', confidence: 1, derived_from: ['laerm.empfindlichkeitsstufe'] });
      expect(v(out, 'laerm.bahn.grenzwert_nacht_db')?.value).toBe(nacht);
    }
    // Stufe da, aber kein Bahnpegel: kein Bahn-Grenzwert (die Strassen-Grenzwerte bleiben)
    const ohnePegel = deriveFacts([f('laerm.empfindlichkeitsstufe', 'II', 'oereb')], ctx);
    expect(ohnePegel.some((x) => x.key.startsWith('laerm.bahn.'))).toBe(false);
    expect(v(ohnePegel, 'laerm.strasse.grenzwert_tag_db')?.value).toBe(60);
    // Nur Nachtpegel reicht
    const nurNacht = deriveFacts([f('laerm.empfindlichkeitsstufe', 'III', 'oereb'), f('laerm.bahn.nacht_db', 40, 'laerm-bahn')], ctx);
    expect(v(nurNacht, 'laerm.bahn.grenzwert_nacht_db')?.value).toBe(55);
    // Pegel da, aber keine Stufe: kein Grenzwert, keine Annahme
    const ohneStufe = deriveFacts([f('laerm.bahn.tag_db', 52.3, 'laerm-bahn')], ctx);
    expect(ohneStufe.some((x) => x.key.startsWith('laerm.bahn.grenzwert'))).toBe(false);
  });

  it('bebauter Anteil rechnet mit der Grundbuchfläche, wenn vorhanden, sonst mit der Geometrie', () => {
    const mitGrundbuch = deriveFacts([f('gebaeude.grundflaeche_m2', 139), f('parzelle.flaeche_m2', 764, 'av-parzelle', 0.95), f('parzelle.flaeche_grundbuch_m2', 761, 'oereb')], ctx);
    expect(v(mitGrundbuch, 'parzelle.bebauter_anteil_prozent')).toMatchObject({ value: 18.3, derived_from: ['gebaeude.grundflaeche_m2', 'parzelle.flaeche_grundbuch_m2'] });
    const nurGeometrie = deriveFacts([f('gebaeude.grundflaeche_m2', 139), f('parzelle.flaeche_m2', 764, 'av-parzelle', 0.95)], ctx);
    expect(v(nurGeometrie, 'parzelle.bebauter_anteil_prozent')).toMatchObject({ value: 18.2, derived_from: ['gebaeude.grundflaeche_m2', 'parzelle.flaeche_m2'] });
  });
});
