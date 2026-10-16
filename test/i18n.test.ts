import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapters } from '../src/adapters/index.ts';
import { createApp } from '../src/api/app.ts';
import * as gwr from '../src/codes/gwr.ts';
import { Core } from '../src/core.ts';
import { MemoryStore } from '../src/facts/memory.ts';
import { silentLogger } from '../src/log.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { AdapterRegistry } from '../src/resolver/registry.ts';
import { resolve } from '../src/resolver/run.ts';
import { SPRACHEN, type Fact, type Sprache } from '../src/types.ts';
import { FELDER, WOHNUNG_FELDER } from '../src/views/felder.ts';
import { formatDatum, formatZahl, FR_GRUPPE, fuelle } from '../src/views/format.ts';
import { glossarMarkdown } from '../src/views/i18n/glossar.ts';
import { TEXTE } from '../src/views/i18n/index.ts';
import { adressZeile, buildSteckbrief, formatWert, quellenText, steckbriefAlsText, type Steckbrief } from '../src/views/steckbrief.ts';
import { hinweisIn, wertIn } from '../src/views/werte.ts';
import { httpFor, wabernRoutes } from './helpers/fixtures.ts';

/** Alle Blätter eines Textobjekts als [Pfad, Wert]; Fakten-Keys enthalten selbst Punkte, darum werden Pfade nie zurückgespalten. */
function blaetter(o: unknown, praefix = ''): Array<[string, unknown]> {
  if (!o || typeof o !== 'object') return [[praefix, o]];
  return Object.keys(o as object)
    .sort()
    .flatMap((k) => blaetter((o as Record<string, unknown>)[k], praefix ? `${praefix}/${k}` : k));
}
/** Alle Schlüsselpfade eines Textobjekts. */
function pfade(o: unknown): string[] {
  return blaetter(o).map(([p]) => p);
}

const ANDERE: Sprache[] = ['fr', 'it', 'en'];

describe('i18n: Vollständigkeit', () => {
  it('jeder Schlüssel aus de existiert in fr, it und en, und keine Sprache hat Schlüssel, die de nicht hat', () => {
    const deKeys = pfade(TEXTE.de);
    for (const s of ANDERE) {
      const keys = pfade(TEXTE[s]);
      const fehlt = deKeys.filter((k) => !keys.includes(k));
      const zuviel = keys.filter((k) => !deKeys.includes(k));
      expect(fehlt, `${s}: fehlende Schlüssel`).toEqual([]);
      expect(zuviel, `${s}: Schlüssel, die de nicht hat`).toEqual([]);
    }
  });

  it('kein Text ist leer, und kein Text ausser de ist wortgleich mit de, wo de ein Wort mit Umlaut oder ein deutsches Stoppwort hat', () => {
    for (const s of SPRACHEN) {
      for (const [k, v] of blaetter(TEXTE[s])) {
        expect(typeof v === 'string' && v.trim().length > 0, `${s}: ${k} leer`).toBe(true);
      }
    }
    // Stichprobe: Erklärungen mit deutschen Stoppwörtern dürfen in fr/it/en nicht einfach deutsch stehen bleiben («des» und «eine» fehlen in
    // der Liste, weil sie auch Französisch sind)
    for (const s of ANDERE) {
      for (const [key, t] of Object.entries(TEXTE[s].felder)) {
        if (t.erklaerung) expect(t.erklaerung, `${s}: ${key} klingt deutsch`).not.toMatch(/\b(und|oder|nicht|wird|laut|einer|dem|zum|zur|beim)\b/);
      }
    }
  });

  it('Feldkatalog: genau die Keys aus FELDER, Erklärung in fr/it/en genau dann, wenn de eine hat; Wohnungsfelder vollständig', () => {
    const keys = Object.keys(FELDER).sort();
    for (const s of SPRACHEN) {
      expect(Object.keys(TEXTE[s].felder).sort(), s).toEqual(keys);
      for (const key of keys) {
        const hatDe = Boolean(FELDER[key]!.erklaerung);
        expect(Boolean(TEXTE[s].felder[key]!.erklaerung), `${s}: ${key} Erklärung`).toBe(hatDe);
      }
      expect(Object.keys(TEXTE[s].wohnung.felder).sort()).toEqual(Object.keys(WOHNUNG_FELDER).sort());
    }
    // de kommt aus FELDER selbst
    expect(TEXTE.de.felder['gebaeude.baujahr']).toEqual({ label: FELDER['gebaeude.baujahr']!.label, erklaerung: FELDER['gebaeude.baujahr']!.erklaerung });
  });

  it('Adapter: jeder Adapter hat Titel, Datenhalter und Attribution in jeder Sprache; de ist das Manifest', () => {
    for (const a of adapters) {
      for (const s of SPRACHEN) {
        const t = TEXTE[s].adapter[a.manifest.id];
        expect(t, `${s}: ${a.manifest.id}`).toBeTruthy();
        expect(t!.titel.length).toBeGreaterThan(0);
        expect(t!.provider.length).toBeGreaterThan(0);
        expect(t!.attribution.startsWith('©'), `${s}: ${a.manifest.id} Attribution`).toBe(true);
      }
      expect(TEXTE.de.adapter[a.manifest.id]).toEqual({ titel: a.manifest.title, provider: a.manifest.provider, attribution: a.manifest.attribution });
    }
    expect(Object.keys(TEXTE.de.adapter).sort()).toEqual(adapters.map((a) => a.manifest.id).sort());
  });

  it('GWR-Codetabellen: jeder Code hat vier nicht leere Einträge, de ist der heutige Stand', () => {
    for (const t of gwr.TABELLEN) {
      for (const [code, t4] of Object.entries(t.tabelle)) {
        expect(t4, `${t.name} ${code}`).toHaveLength(4);
        for (const x of t4) expect(x.trim().length, `${t.name} ${code}`).toBeGreaterThan(0);
      }
    }
    expect(gwr.gebaeudeKlasse(1110)).toBe('Gebäude mit einer Wohnung');
    expect(gwr.gebaeudeKlasse(1110, 'fr')).toBe('Maisons à un logement');
    expect(gwr.gebaeudeKlasse(1110, 'it')).toBe('Edifici ad una abitazione');
    expect(gwr.gebaeudeKlasse(1110, 'en')).toBe('Single-dwelling buildings');
    expect(gwr.gebaeudeKlasseKurz(1122, 'fr')).toBe("Immeuble d'habitation");
    expect(gwr.heizungKurz(7430, 7530)).toBe('Ölheizung');
    expect(gwr.heizungKurz(7430, 7530, 'fr')).toBe('Chauffage au mazout');
    expect(gwr.heizungKurzCode(7410, 7511)).toBe('waermepumpe_erdsonde');
    expect(gwr.heizungKurzText('waermepumpe_erdsonde', 'it')).toBe('Pompa di calore (sonda geotermica)');
    expect(gwr.stockwerk(3100, 'fr')).toBe('Rez-de-chaussée');
    expect(gwr.stockwerk(3101, 'fr')).toBe('1er étage');
    expect(gwr.stockwerk(3102, 'fr')).toBe('2e étage');
    expect(gwr.stockwerk(3401, 'it')).toBe('1° sotterraneo');
    expect(gwr.stockwerk(3103, 'en')).toBe('3rd floor');
    expect(gwr.stockwerk(3111, 'en')).toBe('11th floor');
    expect(gwr.stockwerk(3105)).toBe('5. Stock');
    expect(gwr.gebaeudeStatus(9999, 'fr')).toBeNull(); // unbekannter Code: null, nie geraten
    expect(gwr.bauperiode(8023, 'en')).toBe('from 2016 onwards');
  });

  it('docs/GLOSSAR.md ist aktuell (pnpm glossar)', () => {
    expect(readFileSync('docs/GLOSSAR.md', 'utf8')).toBe(glossarMarkdown() + '\n');
  });
});

describe('i18n: Formate', () => {
  it('Zahlen nach Sprache: de-CH und it-CH mit Apostroph, fr-CH mit geschütztem schmalem Leerzeichen und Komma, en-CH mit Apostroph', () => {
    expect(formatZahl(44550, 'de')).toBe("44'550");
    expect(formatZahl(44550, 'it')).toBe("44'550");
    expect(formatZahl(44550, 'en')).toBe("44'550");
    expect(formatZahl(44550, 'fr')).toBe(`44${FR_GRUPPE}550`);
    expect(FR_GRUPPE).toBe(' ');
    expect(formatZahl(1234567.891, 'fr')).toBe(`1${FR_GRUPPE}234${FR_GRUPPE}568`);
    expect(formatZahl(33.2, 'de', { maximumFractionDigits: 1 })).toBe('33.2');
    expect(formatZahl(33.2, 'fr', { maximumFractionDigits: 1 })).toBe('33,2');
    expect(formatZahl(33.2, 'it', { maximumFractionDigits: 1 })).toBe('33.2');
    expect(formatZahl(761, 'fr')).toBe('761'); // keine Gruppierung unter 1000
  });

  it('Datum überall TT.MM.JJJJ, Platzhalter bleiben sichtbar, wenn ein Parameter fehlt', () => {
    expect(formatDatum('2026-10-12')).toBe('12.10.2026');
    expect(formatDatum('2026-10-12T08:00:00Z')).toBe('12.10.2026');
    expect(formatDatum('heute')).toBe('heute');
    expect(fuelle('Gemeinde {name}', { name: 'Köniz' })).toBe('Gemeinde Köniz');
    expect(fuelle('{a} und {b}', { a: 1 })).toBe('1 und {b}');
  });

  it('formatWert: Format betroffen und bool pro Sprache, Zahlen mit Einheit, CHF, Datum', () => {
    const f = (key: string, value: Steckbrief['abschnitte'][number]['felder'][number]['value'], unit?: string) => (unit ? { key, value, unit } : { key, value });
    expect(formatWert(f('kulturgut.kgs.betroffen', false), 'fr')).toBe('non concerné');
    expect(formatWert(f('kulturgut.kgs.betroffen', true), 'it')).toBe('interessato');
    expect(formatWert(f('wohnung.1.kueche', true), 'en')).toBe('yes');
    expect(formatWert(f('wohnung.1.kueche', false), 'fr')).toBe('non');
    expect(formatWert(f('solar.stromertrag_kwh_a', 44550, 'kWh/a'), 'fr')).toBe(`44${FR_GRUPPE}550 kWh/a`);
    expect(formatWert(f('solar.stromertrag_kwh_a', 44550, 'kWh/a'), 'de')).toBe("44'550 kWh/a");
    expect(formatWert(f('solar.finanzertrag_chf_a', 1234.5), 'de')).toBe("CHF 1'235");
    expect(formatWert(f('solar.finanzertrag_chf_a', 1234.5), 'it')).toBe('CHF 1235'); // it-CH gruppiert erst ab fünf Stellen (CLDR), 10'000 schon
    expect(formatWert(f('solar.finanzertrag_chf_a', 12345), 'it')).toBe("CHF 12'345");
    expect(formatWert(f('laerm.strasse.tag_db', 33.2, 'dB'), 'fr')).toBe('33,2 dB');
    expect(formatWert(f('gebaeude.heizung.stand', '2024-03-01'), 'en')).toBe('01.03.2024');
    expect(formatWert(f('gebaeude.baujahr', null), 'fr')).toBe('–');
  });

  it('adressZeile und quellenText pro Sprache', () => {
    const a = { plz: 3084, ort: 'Wabern', gemeinde: 'Köniz', kanton: 'BE' };
    expect(adressZeile(a)).toBe('3084 Wabern · Gemeinde Köniz · BE');
    expect(adressZeile(a, 'fr')).toBe('3084 Wabern · Commune de Köniz · BE');
    expect(adressZeile(a, 'it')).toBe('3084 Wabern · Comune di Köniz · BE');
    expect(adressZeile(a, 'en')).toBe('3084 Wabern · Municipality of Köniz · BE');
    expect(quellenText({ quelle: 'gwr', daten_vom: '2026-10-12', abgefragt_am: '2026-10-16' })).toBe('gwr · Daten vom 12.10.2026 · abgefragt 16.10.2026');
    expect(quellenText({ quelle: 'gwr', daten_vom: '2026-10-12', abgefragt_am: '2026-10-16' }, 'fr')).toBe('gwr · données du 12.10.2026 · consulté le 16.10.2026');
    expect(quellenText({ quelle: 'radon', abgefragt_am: '2026-10-16' }, 'en')).toBe('radon · retrieved 16.10.2026');
  });
});

describe('i18n: Werte aus Codes', () => {
  const fakt = (key: string, value: Fact['value'], confidence = 1): Fact => ({ subject: 'egid:1', key, value, source: 't', fetched_at: '2026-10-16T10:00:00Z', confidence, run_id: 'r' });

  it('übersetzt code-gestützte Werte, lässt Datenwerte stehen, de unverändert', () => {
    const facts = [
      fakt('gebaeude.klasse_kurz', 'Einfamilienhaus'),
      fakt('gebaeude.klasse_code', 1110),
      fakt('gebaeude.heizung.kurz', 'Ölheizung'),
      fakt('gebaeude.heizung.erzeuger_code', 7430),
      fakt('gebaeude.heizung.energietraeger_code', 7530),
      fakt('oev.gueteklasse', 'D'),
      fakt('oev.gueteklasse_text', 'geringe Erschliessung'),
      fakt('solar.klasse', 4),
      fakt('solar.klasse_text', 'sehr gut'),
      fakt('radon.wahrscheinlichkeit_prozent', 21),
      fakt('radon.einstufung', 'erhöht'),
      fakt('kulturgut.kgs.kategorie_code', 'A.A'),
      fakt('kulturgut.kgs.kategorie', 'A (national)'),
      fakt('parzelle.art', 'Liegenschaft'),
      fakt('zone.bezeichnung', 'Wohnzone (Art. 29 BauR)'),
      fakt('wohnung.1.stockwerk_code', 3100),
      fakt('wohnung.1.stockwerk', 'Parterre'),
      fakt('wohnung.1.status_code', 3004),
      fakt('wohnung.1.status', 'bestehend'),
      fakt('grundbuch.fuehrung', 'eidg. Grundbuch ganz eingeführt'),
      fakt('grundbuch.fuehrung_fr', 'Registre foncier féd. complet'),
      fakt('grundbuch.fuehrung_it', 'Registro fondiario fed. completo'),
    ];
    const w = (key: string, lang: Sprache) => wertIn(key, facts.find((f) => f.key === key)!.value, facts, lang);
    expect(w('gebaeude.klasse_kurz', 'de')).toBe('Einfamilienhaus');
    expect(w('gebaeude.klasse_kurz', 'fr')).toBe('Maison individuelle');
    expect(w('gebaeude.klasse_kurz', 'it')).toBe('Casa unifamiliare');
    expect(w('gebaeude.klasse_kurz', 'en')).toBe('Single-family house');
    expect(w('gebaeude.heizung.kurz', 'fr')).toBe('Chauffage au mazout'); // ohne kurz_code aus den beiden Codes
    expect(w('oev.gueteklasse_text', 'fr')).toBe('faible desserte');
    expect(w('oev.gueteklasse_text', 'it')).toBe('collegamento scarso');
    expect(w('solar.klasse_text', 'fr')).toBe('très bonne');
    expect(w('radon.einstufung', 'en')).toBe('elevated'); // ohne einstufung_code aus der Wahrscheinlichkeit
    expect(w('kulturgut.kgs.kategorie', 'fr')).toBe('A (importance nationale)');
    expect(w('parzelle.art', 'fr')).toBe('Bien-fonds');
    expect(w('parzelle.art', 'en')).toBe('Parcel (Liegenschaft)');
    expect(w('zone.bezeichnung', 'fr')).toBe('Wohnzone (Art. 29 BauR)'); // Datenwert, bleibt wie der Kanton ihn publiziert
    expect(w('wohnung.1.stockwerk', 'it')).toBe('Pianterreno');
    expect(w('wohnung.1.status', 'fr')).toBe('existant');
    expect(w('grundbuch.fuehrung', 'fr')).toBe('Registre foncier féd. complet');
    expect(w('grundbuch.fuehrung', 'it')).toBe('Registro fondiario fed. completo');
    expect(w('grundbuch.fuehrung', 'en')).toBe('eidg. Grundbuch ganz eingeführt'); // Registerwert, keine englische Fassung im Layer
    // Ohne Code-Fakt bleibt der gespeicherte Wert (Stand des Stores), kein Default
    expect(wertIn('gebaeude.status', 'bestehend', [fakt('gebaeude.status', 'bestehend')], 'fr')).toBe('bestehend');
    // Unbekannter Code: ebenfalls der gespeicherte Wert
    expect(wertIn('gebaeude.status', 'x', [fakt('gebaeude.status_code', 9999)], 'fr')).toBe('x');
  });

  it('Hinweistexte aus Code und Parametern in jeder Sprache', () => {
    const facts = [
      fakt('zone.hinweis_code', 'thema_ohne_daten'),
      fakt('grundbuch.hinweis_code', 'mehrere_kreise'),
      fakt('grundbuch.kreise_anzahl', 11),
      fakt('laerm.bahn.hinweis_code', 'nicht_kartiert_nacht'),
      fakt('parzelle.hinweis_code', 'punkt_auf_anderer_parzelle'),
      fakt('parzelle.hinweis_punkt_nummer', '3827'),
      fakt('parzelle.hinweis_punkt_egrid', 'CH189083957747'),
      fakt('parzelle.hinweis_register_nummer', '3258'),
      fakt('parzelle.hinweis_register_egrid', 'CH959983779505'),
    ];
    expect(hinweisIn('zone.hinweis', facts, 'fr')).toBe("Le cadastre RDPPF du canton ne contient pas encore de données sur les plans d'affectation pour cette commune");
    expect(hinweisIn('grundbuch.hinweis', facts, 'de')).toBe('Die Gemeinde hat 11 Grundbuchkreise. Die Amtliche Vermessung löst sie nicht räumlich auf, zuständig ist das Grundbuchamt bzw. Notariat des Quartiers.');
    expect(hinweisIn('grundbuch.hinweis', facts, 'en')).toContain('The municipality has 11 land registry districts.');
    expect(hinweisIn('laerm.bahn.hinweis', facts, 'it')).toBe('nessuna esposizione al rumore ferroviario cartografata (notte)');
    expect(hinweisIn('parzelle.hinweis_vermessung', facts, 'fr')).toBe('Selon la mensuration officielle, le point du bâtiment tiré du registre des bâtiments se trouve sur la parcelle 3827 (CH189083957747), et non sur 3258 (CH959983779505). La parcelle affichée est celle du registre des bâtiments.');
    expect(hinweisIn('parzelle.hinweis_vermessung', facts, 'de')).toBe('Der Gebäudepunkt aus dem Gebäuderegister liegt laut amtlicher Vermessung auf Parzelle 3827 (CH189083957747), nicht auf 3258 (CH959983779505). Gezeigt wird die Parzelle aus dem Gebäuderegister.');
    expect(hinweisIn('zone.hinweis', [], 'fr')).toBeUndefined();
  });
});

describe('i18n: Steckbrief Wabern in vier Sprachen', () => {
  /** run_id (UUID) und Millisekunden sind pro Lauf anders; für den Snapshot werden sie neutralisiert. */
  const stabil = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<run_id>').replace(/ +\d+ ms\b/g, ' <ms> ms');

  async function wabern() {
    const registry = new AdapterRegistry(adapters);
    const store = new MemoryStore();
    const run = await resolve({ adresse: 'Maygutstrasse 26, 3084 Wabern' }, { registry, store, http: httpFor(wabernRoutes()), breaker: new CircuitBreaker(), now: () => new Date('2026-10-16T10:00:00Z') });
    return run;
  }

  it('fr: Labels, Abschnitte, Lückengründe und code-gestützte Werte übersetzt, Datenwerte und Zahlen der Quelle nicht; Snapshot', async () => {
    const run = await wabern();
    const s = buildSteckbrief(run, adapters, { lang: 'fr' });
    expect(s.lang).toBe('fr');
    const geb = s.abschnitte.find((a) => a.id === 'gebaeude')!;
    expect(geb.titel).toBe('Bâtiment');
    expect(geb.felder.find((f) => f.key === 'gebaeude.klasse_kurz')).toMatchObject({ label: 'Type de bâtiment', value: 'Maison individuelle', quelle_titel: 'RegBL bâtiments et logements' });
    expect(geb.felder.find((f) => f.key === 'gebaeude.bauperiode')?.value).toBe('de 1946 à 1960');
    const heizung = s.abschnitte.find((a) => a.id === 'heizung')!;
    expect(heizung.felder.find((f) => f.key === 'gebaeude.heizung.kurz')?.value).toBe('Chauffage au mazout');
    expect(heizung.felder.find((f) => f.key === 'gebaeude.heizung.energietraeger')?.value).toBe('Mazout');
    const zone = s.abschnitte.find((a) => a.id === 'zone')!;
    expect(zone.felder.find((f) => f.key === 'zone.bezeichnung')?.value).toBe('Wohnzone (Art. 29 BauR), Bauklasse IIa (Art. 53 BauR)'); // Datenwert des Kantons
    expect(zone.felder.find((f) => f.key === 'zone.bezeichnung')?.label).toBe('Zone');
    expect(zone.felder.some((f) => f.label.startsWith('Sicherheitszonenplan'))).toBe(true); // Themenname des Katasters (de, so publiziert)
    const laerm = s.abschnitte.find((a) => a.id === 'laerm')!;
    expect(laerm.titel).toBe('Bruit');
    expect(laerm.felder.find((f) => f.key === 'laerm.strasse.tag_db')?.label).toBe('Bruit routier, jour');
    expect(s.luecken.find((l) => l.key === 'laerm.empfindlichkeitsstufe')).toMatchObject({ label: 'Degré de sensibilité au bruit', grund: 'fehlt_im_register', quelle: 'oereb' });
    expect(s.luecken.find((l) => l.key === 'gebaeude.baujahr')?.label).toBe('Année de construction');
    expect(s.quellen.find((q) => q.adapter === 'gwr')).toMatchObject({ titel: 'RegBL bâtiments et logements', provider: 'OFS' });
    expect(s.attribution).toContain('© OFS, Registre fédéral des bâtiments et des logements (RegBL)');
    const wohnung = s.abschnitte.find((a) => a.id === 'wohnung')!;
    expect(wohnung.titel).toBe('Logement');
    expect(wohnung.felder.find((f) => f.key.endsWith('.stockwerk'))?.value).toBe('Rez-de-chaussée');
    const text = steckbriefAlsText(s);
    expect(text).toContain('3084 Wabern · Commune de Köniz · BE');
    expect(text).toContain('LACUNES');
    expect(text).toContain(`44${FR_GRUPPE}550 kWh/a`); // Solarertrag mit geschütztem schmalem Leerzeichen
    expect(text).toContain('33,2 dB');
    expect(text).toContain('gwr · données du 12.10.2026 · consulté le 16.10.2026');
    await expect(stabil(text)).toMatchFileSnapshot('./__snapshots__/wabern-steckbrief-fr.txt');
  });

  it('it: Snapshot und Stichproben', async () => {
    const run = await wabern();
    const s = buildSteckbrief(run, adapters, { lang: 'it' });
    expect(s.abschnitte.find((a) => a.id === 'gebaeude')?.felder.find((f) => f.key === 'gebaeude.klasse_kurz')?.value).toBe('Casa unifamiliare');
    expect(s.abschnitte.find((a) => a.id === 'radon')?.felder.find((f) => f.key === 'radon.einstufung')?.value).toBe('elevata');
    expect(s.abschnitte.find((a) => a.id === 'ortsbild')?.felder[0]?.label).toBe('Inventario PBC (protezione dei beni culturali)');
    const text = steckbriefAlsText(s);
    expect(text).toContain('3084 Wabern · Comune di Köniz · BE');
    expect(text).toContain("44'550 kWh/a");
    expect(text).toContain('non interessato');
    await expect(stabil(text)).toMatchFileSnapshot('./__snapshots__/wabern-steckbrief-it.txt');
  });

  it('en: Stichproben und Snapshot; de bleibt unverändert zum Stand ohne lang', async () => {
    const run = await wabern();
    const en = buildSteckbrief(run, adapters, { lang: 'en' });
    expect(en.abschnitte.find((a) => a.id === 'oev')?.felder.find((f) => f.key === 'oev.gueteklasse_text')?.value).toBe('poor public transport access');
    expect(en.luecken.find((l) => l.key === 'laerm.empfindlichkeitsstufe')?.label).toBe('Noise sensitivity level');
    await expect(stabil(steckbriefAlsText(en))).toMatchFileSnapshot('./__snapshots__/wabern-steckbrief-en.txt');
    const de = buildSteckbrief(run, adapters);
    const deExplizit = buildSteckbrief(run, adapters, { lang: 'de' });
    expect(de).toEqual(deExplizit);
    expect(de.lang).toBe('de');
    expect(de.abschnitte.find((a) => a.id === 'gebaeude')?.felder.find((f) => f.key === 'gebaeude.klasse_kurz')?.value).toBe('Einfamilienhaus');
  });

  it('API: ?lang=fr liefert den Steckbrief auf Französisch mit lang, ungültige Sprache gibt 400', async () => {
    const core = await Core.create({ store: 'memory', http: httpFor(wabernRoutes()), log: silentLogger, breaker: new CircuitBreaker() });
    try {
      const app = createApp(core);
      const res = await app.request('/v1/steckbrief?egid=1271632&lang=fr');
      expect(res.status).toBe(200);
      const s = (await res.json()) as Steckbrief;
      expect(s.lang).toBe('fr');
      expect(s.abschnitte.find((a) => a.id === 'laerm')?.titel).toBe('Bruit');
      expect(s.luecken.find((l) => l.key === 'laerm.empfindlichkeitsstufe')?.label).toBe('Degré de sensibilité au bruit');
      expect((await app.request('/v1/steckbrief?egid=1271632&lang=es')).status).toBe(400);
      const ohne = (await (await app.request('/v1/steckbrief?egid=1271632')).json()) as Steckbrief;
      expect(ohne.lang).toBe('de');
      const wurzel = (await (await app.request('/')).json()) as { sprachen: string[] };
      expect(wurzel.sprachen).toEqual(['de', 'fr', 'it', 'en']);
    } finally {
      await core.close();
    }
  });
});
