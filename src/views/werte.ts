import * as gwr from '../codes/gwr.ts';
import { radonEinstufungCode } from '../adapters/radon.ts';
import type { Fact, FactValue, Sprache } from '../types.ts';
import { formatZahl, fuelle } from './format.ts';
import { texte } from './i18n/index.ts';

/**
 * Werte in der Sprache der Lesefassung. Die gespeicherten Fakten sind deutsch (Quellsprache, API-stabil); wo ein Textfakt einen
 * Code-Fakt daneben hat (`gebaeude.klasse` → `gebaeude.klasse_code`, `radon.einstufung` → `radon.einstufung_code`,
 * `zone.hinweis` → `zone.hinweis_code` …), rendert die View den Text aus dem Code in der gewünschten Sprache.
 *
 * Regeln:
 *  - Deutsch gibt den gespeicherten Wert unverändert zurück.
 *  - Datenwerte werden nie übersetzt: Zonenbezeichnungen, Gemeinde-, Stellen- und Quellennamen, Themennamen des Katasters, Adressen.
 *  - Fehlt der Code-Fakt (Lauf aus dem Cache vor der Adapter-Version mit Codes), bleibt der gespeicherte deutsche Wert stehen:
 *    Das ist der Stand des Stores, kein Default. Mit den Versions-Bumps der Adapter läuft der Cache aus.
 *  - Kennt die Tabelle den Code nicht, bleibt ebenfalls der gespeicherte Wert (für de ist er aus derselben Tabelle null).
 */

function wert(facts: Fact[], key: string): FactValue | undefined {
  // Höchste Confidence, dann jüngster, wie bestFact in steckbrief.ts
  return facts
    .filter((f) => f.key === key)
    .sort((a, b) => b.confidence - a.confidence || b.fetched_at.localeCompare(a.fetched_at))[0]?.value;
}

function zahl(facts: Fact[], key: string): number | null {
  const v = wert(facts, key);
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
}

function text(facts: Fact[], key: string): string | undefined {
  const v = wert(facts, key);
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Hinweistext aus Code und Parametern, in der Sprache. undefined, wenn kein Code-Fakt da ist oder der Code unbekannt ist.
 * Keys: zone.hinweis, grundbuch.hinweis, laerm.bahn.hinweis, parzelle.hinweis_vermessung.
 */
export function hinweisIn(key: string, facts: Fact[], sprache: Sprache): string | undefined {
  const T = texte(sprache);
  if (key === 'zone.hinweis') {
    const code = text(facts, 'zone.hinweis_code');
    return code && code in T.hinweise.zone ? T.hinweise.zone[code as keyof typeof T.hinweise.zone] : undefined;
  }
  if (key === 'grundbuch.hinweis') {
    const code = text(facts, 'grundbuch.hinweis_code');
    if (code !== 'mehrere_kreise') return undefined;
    const anzahl = zahl(facts, 'grundbuch.kreise_anzahl');
    return anzahl === null ? undefined : fuelle(T.hinweise.grundbuch.mehrere_kreise, { anzahl: formatZahl(anzahl, sprache) });
  }
  if (key === 'laerm.bahn.hinweis') {
    const code = text(facts, 'laerm.bahn.hinweis_code');
    return code && code in T.hinweise.bahn ? T.hinweise.bahn[code as keyof typeof T.hinweise.bahn] : undefined;
  }
  if (key === 'parzelle.hinweis_vermessung') {
    const code = text(facts, 'parzelle.hinweis_code');
    if (!code || !(code in T.hinweise.vermessung)) return undefined;
    return fuelle(T.hinweise.vermessung[code as keyof typeof T.hinweise.vermessung], {
      punkt_nummer: text(facts, 'parzelle.hinweis_punkt_nummer') ?? '?',
      punkt_egrid: text(facts, 'parzelle.hinweis_punkt_egrid') ?? '?',
      nummer: text(facts, 'parzelle.hinweis_register_nummer') ?? '?',
      egrid: text(facts, 'parzelle.hinweis_register_egrid') ?? '?',
    });
  }
  return undefined;
}

/** Der Wert eines Fakts in der Sprache der Lesefassung (siehe Regeln oben). */
export function wertIn(key: string, value: FactValue, facts: Fact[], sprache: Sprache): FactValue {
  if (sprache === 'de' || value === null) return value;
  const T = texte(sprache);
  const code = (k: string) => zahl(facts, k);
  const oder = (v: string | null | undefined): FactValue => (v === null || v === undefined ? value : v);

  switch (key) {
    case 'gebaeude.status':
      return oder(gwr.gebaeudeStatus(code('gebaeude.status_code'), sprache));
    case 'gebaeude.kategorie':
      return oder(gwr.gebaeudeKategorie(code('gebaeude.kategorie_code'), sprache));
    case 'gebaeude.klasse':
      return oder(gwr.gebaeudeKlasse(code('gebaeude.klasse_code'), sprache));
    case 'gebaeude.klasse_kurz':
      return oder(gwr.gebaeudeKlasseKurz(code('gebaeude.klasse_code'), sprache));
    case 'gebaeude.bauperiode':
      return oder(gwr.bauperiode(code('gebaeude.bauperiode_code'), sprache));
    case 'gebaeude.heizung.erzeuger':
      return oder(gwr.waermeerzeugerHeizung(code('gebaeude.heizung.erzeuger_code'), sprache));
    case 'gebaeude.heizung2.erzeuger':
      return oder(gwr.waermeerzeugerHeizung(code('gebaeude.heizung2.erzeuger_code'), sprache));
    case 'gebaeude.heizung.energietraeger':
      return oder(gwr.energietraeger(code('gebaeude.heizung.energietraeger_code'), sprache));
    case 'gebaeude.heizung2.energietraeger':
      return oder(gwr.energietraeger(code('gebaeude.heizung2.energietraeger_code'), sprache));
    case 'gebaeude.warmwasser.erzeuger':
      return oder(gwr.waermeerzeugerWarmwasser(code('gebaeude.warmwasser.erzeuger_code'), sprache));
    case 'gebaeude.warmwasser.energietraeger':
      return oder(gwr.energietraeger(code('gebaeude.warmwasser.energietraeger_code'), sprache));
    case 'gebaeude.heizung.kurz': {
      // kurz_code seit gwr Version 2; davor aus den beiden Codes, die es seit Version 1 gibt
      const kurz = text(facts, 'gebaeude.heizung.kurz_code');
      return oder(kurz ? gwr.heizungKurzText(kurz, sprache) : gwr.heizungKurz(code('gebaeude.heizung.erzeuger_code'), code('gebaeude.heizung.energietraeger_code'), sprache));
    }
    case 'oev.gueteklasse_text': {
      const k = text(facts, 'oev.gueteklasse');
      return oder(k && k in T.werte.oev ? T.werte.oev[k as keyof typeof T.werte.oev] : null);
    }
    case 'solar.klasse_text': {
      const k = code('solar.klasse');
      return oder(k !== null && k in T.werte.solar ? T.werte.solar[k as 1 | 2 | 3 | 4 | 5] : null);
    }
    case 'radon.einstufung': {
      // einstufung_code seit radon Version 2; davor aus der Wahrscheinlichkeit mit derselben Regel
      const k = text(facts, 'radon.einstufung_code') ?? radonEinstufungCode(zahl(facts, 'radon.wahrscheinlichkeit_prozent'));
      return oder(k && k in T.werte.radon ? T.werte.radon[k as keyof typeof T.werte.radon] : null);
    }
    case 'kulturgut.kgs.kategorie': {
      const k = text(facts, 'kulturgut.kgs.kategorie_code')?.charAt(0);
      return oder(k === 'A' || k === 'B' ? T.werte.kgs[k] : null);
    }
    case 'parzelle.art':
      return typeof value === 'string' ? oder(T.werte.parzelleArt[value]) : value;
    case 'grundbuch.fuehrung':
      // Der Layer führt den Wert in de, fr und it; en bleibt beim Registerwert (Datenwert, nicht übersetzt)
      return sprache === 'fr' ? oder(text(facts, 'grundbuch.fuehrung_fr')) : sprache === 'it' ? oder(text(facts, 'grundbuch.fuehrung_it')) : value;
    case 'zone.hinweis':
    case 'grundbuch.hinweis':
    case 'laerm.bahn.hinweis':
    case 'parzelle.hinweis_vermessung':
      return oder(hinweisIn(key, facts, sprache));
    case 'oereb.belastungen': {
      // Liste der Themennamen; die zwei Sammelthemen des Adapters sind Codes, die übrigen Namen stammen aus dem Kataster
      const slugs = [...new Set(facts.map((f) => f.key.match(/^oereb\.([a-z0-9_]+)\.thema$/)?.[1]).filter((s): s is string => !!s))];
      if (!slugs.length) return value;
      return slugs.map((slug) => themaIn(slug, text(facts, `oereb.${slug}.thema`) ?? slug, sprache)).join('; ');
    }
  }
  const thema = key.match(/^oereb\.([a-z0-9_]+)\.thema$/);
  if (thema && typeof value === 'string') return themaIn(thema[1]!, value, sprache);
  const wohnung = key.match(/^wohnung\.(\d+)\.(stockwerk|status)$/);
  if (wohnung) {
    const ewid = wohnung[1]!;
    if (wohnung[2] === 'stockwerk') return oder(gwr.stockwerk(code(`wohnung.${ewid}.stockwerk_code`), sprache));
    return oder(gwr.wohnungStatus(code(`wohnung.${ewid}.status_code`), sprache));
  }
  return value;
}

/** Name eines ÖREB-Themas: die zwei Sammelthemen des Adapters aus der Sprachdatei, alle anderen wie der Kataster sie nennt. */
export function themaIn(slug: string, text: string, sprache: Sprache): string {
  const T = texte(sprache);
  if (slug === 'nutzungsplanung_ueberlagernd' || slug === 'nutzungsplanung_weitere') return T.zone.themen[slug];
  return text;
}
