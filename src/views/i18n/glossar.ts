import { TABELLEN } from '../../codes/gwr.ts';
import { SPRACHEN, type Sprache } from '../../types.ts';
import { ABSCHNITTE, FELDER } from '../felder.ts';
import { TEXTE } from './index.ts';

/**
 * Erzeugt docs/GLOSSAR.md aus den Sprachdateien: jeder Begriff de/fr/it/en mit Quelle. Web, PDF und Feldkatalog lesen dieselben
 * Dateien, darum ist das Glossar nie eine zweite Wahrheit. `pnpm glossar` schreibt die Datei, ein Test prüft, dass sie aktuell ist.
 */

/** Quelle der amtlichen Begriffe nach Präfix des Fakten-Keys. Englisch ist überall eigene Übertragung (klares Englisch, Schweizer Begriff in Klammern). */
const QUELLE_NACH_PRAEFIX: Array<[RegExp, string]> = [
  [/^adresse\./, 'BFS (Gemeindenummer), swisstopo (amtliches Gebäudeadressverzeichnis)'],
  [/^gebaeude\.|^wohnung(en)?\./, 'GWR-Merkmalskatalog 4.3 (BFS, housing-stat.ch; de nach 4.2, Stand der gespeicherten Fakten)'],
  [/^parzelle\.(flaeche_grundbuch|hinweis|egrid)|^grundbuch\./, 'swisstopo, amtliche Vermessung und Grundbuch (geo.admin-Layer geometa-grundbuch, de/fr/it); ÖREBKV für die Grundbuchfläche'],
  [/^parzelle\.|^vermessung\./, 'swisstopo, amtliche Vermessung (geo.admin-Layer amtliche-vermessung und geometa-nfgeom, de/fr/it)'],
  [/^zone\.|^oereb\./, 'ÖREBKV (SR 510.622.4, fedlex de/fr/it), Weisung ÖREB-Webservice, Themennamen der kantonalen ÖREB-Dienste (VD, GE, JU, TI), ARE-Glossar Nutzungsplanung (de/fr)'],
  [/^laerm\./, 'LSV (SR 814.41, fedlex de/fr/it: Empfindlichkeitsstufe, Immissionsgrenzwert, Anhang 3 und 4), BAFU-Layer sonBASE und Eisenbahnlärm (geo.admin, de/fr/it)'],
  [/^oev\./, 'ARE, ÖV-Güteklassen (geo.admin-Layer gueteklassen_oev, de/fr; it und en eigene Übertragung)'],
  [/^radon\./, 'BAG, Radonkarte (geo.admin-Layer radonkarte, de/fr/it); Einstufung ist eine Lesehilfe von grundpass'],
  [/^solar\./, 'BFE, Sonnendach.ch (geo.admin-Layer solarenergie-eignung-daecher, klasse_text de/fr/it/en)'],
  [/^naturgefahr\./, 'BAFU (geo.admin-Layer gefaehrdungskarte-oberflaechenabfluss, aquaprotect_100, gefahren-gefaehrdungszonen, de/fr/it)'],
  [/^kulturgut\./, 'BABS, KGS-Inventar (geo.admin-Layer kulturgueter, de/fr/it)'],
];

export function quelleFuer(key: string): string {
  return QUELLE_NACH_PRAEFIX.find(([re]) => re.test(key))?.[1] ?? 'grundpass (eigene Wortwahl)';
}

const zelle = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const kopf = (erste: string, letzte = 'Quelle') => `| ${erste} | de | fr | it | en | ${letzte} |\n|---|---|---|---|---|---|`;
const zeile = (erste: string, werte: Record<Sprache, string | undefined>, letzte: string) => `| ${zelle(erste)} | ${SPRACHEN.map((s) => zelle(werte[s])).join(' | ')} | ${zelle(letzte)} |`;

function proSprache<T>(f: (s: Sprache) => T): Record<Sprache, T> {
  return Object.fromEntries(SPRACHEN.map((s) => [s, f(s)])) as Record<Sprache, T>;
}

function flach(o: unknown, praefix = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[praefix, o]];
  if (!o || typeof o !== 'object') return [];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flach(v, praefix ? `${praefix}.${k}` : k));
}

export function glossarMarkdown(): string {
  const out: string[] = [];
  out.push('# grundpass · Glossar de / fr / it / en');
  out.push('');
  out.push('Alle Begriffe der Lesefassung in den vier Sprachen, mit Quelle. Erzeugt aus `src/views/i18n/*.ts` und `src/codes/gwr.ts` mit `pnpm glossar`;');
  out.push('Web, PDF und Feldkatalog lesen dieselben Dateien, darum stehen hier dieselben Wörter. Deutsch ist die Quellsprache. Amtliche Begriffe in fr und it');
  out.push('stammen aus amtlichen Quellen (Spalte Quelle). Englisch hat keine amtliche Quelle: klares Englisch, der Schweizer Begriff beim ersten Vorkommen in Klammern.');
  out.push('Datenwerte (Zonenbezeichnungen, Gemeinde-, Stellen- und Quellennamen) werden nicht übersetzt und stehen nicht hier.');
  out.push('');
  out.push('Offene Übertragungen ohne amtlichen Beleg (eigene Wahl, markiert «eigene Übertragung»): it «utilizzazione di base» für Grundnutzung, die Wortlaute der');
  out.push('ÖV-Klassen A bis D in it und en, Sonnendach-Klasse 5 («hervorragend»: der BFE-Dienst schreibt in allen Sprachen «Top»), Radon-Einstufung (Lesehilfe von grundpass).');
  out.push('');

  out.push('## Abschnitte des Steckbriefs');
  out.push('');
  out.push(kopf('Abschnitt'));
  for (const ab of ABSCHNITTE) out.push(zeile(ab.id, proSprache((s) => TEXTE[s].abschnitte[ab.id]), 'grundpass'));
  out.push('');

  out.push('## Feldkatalog: Labels');
  out.push('');
  out.push(kopf('Fakten-Key'));
  for (const key of Object.keys(FELDER)) out.push(zeile(key, proSprache((s) => TEXTE[s].felder[key]?.label), quelleFuer(key)));
  out.push('');

  out.push('## Feldkatalog: Erklärungen');
  out.push('');
  out.push(kopf('Fakten-Key'));
  for (const key of Object.keys(FELDER)) {
    if (!FELDER[key]?.erklaerung) continue;
    out.push(zeile(key, proSprache((s) => TEXTE[s].felder[key]?.erklaerung), quelleFuer(key)));
  }
  out.push('');

  out.push('## Wohnungsfelder');
  out.push('');
  out.push(kopf('Feld'));
  for (const k of Object.keys(TEXTE.de.wohnung.felder)) out.push(zeile(k, proSprache((s) => TEXTE[s].wohnung.felder[k]), quelleFuer('wohnung.')));
  out.push(zeile('titel', proSprache((s) => TEXTE[s].wohnung.titel), quelleFuer('wohnung.')));
  out.push(zeile('titelMitNr', proSprache((s) => TEXTE[s].wohnung.titelMitNr), quelleFuer('wohnung.')));
  out.push('');

  out.push('## GWR-Codes');
  out.push('');
  for (const t of TABELLEN) {
    out.push(`### ${t.name} (${t.merkmal})`);
    out.push('');
    out.push(kopf('Code'));
    const quelle = t.name.includes('grundpass') ? 'grundpass (eigene Wortwahl)' : 'GWR-Merkmalskatalog 4.3 (BFS); de nach 4.2';
    for (const [code, t4] of Object.entries(t.tabelle)) out.push(zeile(code, { de: t4[0], fr: t4[1], it: t4[2], en: t4[3] }, quelle));
    out.push('');
  }

  const bloecke: Array<[string, (t: (typeof TEXTE)['de']) => unknown, string]> = [
    ['Werte aus Codes: ÖV-Güteklasse', (t) => t.werte.oev, quelleFuer('oev.')],
    ['Werte aus Codes: Solareignung', (t) => t.werte.solar, quelleFuer('solar.')],
    ['Werte aus Codes: Radon-Einstufung', (t) => t.werte.radon, quelleFuer('radon.')],
    ['Werte aus Codes: KGS-Kategorie', (t) => t.werte.kgs, quelleFuer('kulturgut.')],
    ['Werte aus Codes: Grundstücksart (amtliche Vermessung, DM.01)', (t) => t.werte.parzelleArt, quelleFuer('parzelle.art')],
    ['Hinweistexte aus Codes', (t) => t.hinweise, 'grundpass (Wortlaut), Begriffe wie oben'],
    ['Dynamische Zeilen im Abschnitt Zone', (t) => t.zone, quelleFuer('zone.')],
    ['Formate', (t) => t.formate, 'grundpass'],
    ['Lückengründe', (t) => t.luecken, 'grundpass'],
    ['Quellenzeilen', (t) => t.quellen, 'grundpass'],
    ['Textausgabe und Kopfzeile', (t) => t.text, 'grundpass'],
  ];
  for (const [titel, pick, quelle] of bloecke) {
    out.push(`## ${titel}`);
    out.push('');
    out.push(kopf('Schlüssel'));
    const schluessel = flach(pick(TEXTE.de)).map(([k]) => k);
    for (const k of schluessel) out.push(zeile(k, proSprache((s) => Object.fromEntries(flach(pick(TEXTE[s])))[k]), quelle));
    out.push('');
  }

  out.push('## Quellen (Adapter): Titel, Datenhalter, Pflicht-Quellenangabe');
  out.push('');
  out.push(kopf('Adapter · Feld'));
  for (const id of Object.keys(TEXTE.de.adapter)) {
    for (const feld of ['titel', 'provider', 'attribution'] as const) {
      out.push(zeile(`${id} · ${feld}`, proSprache((s) => TEXTE[s].adapter[id]?.[feld]), 'Manifest des Adapters (de), amtliche Kurzbezeichnungen der Ämter (fr OFS, OFEV, OFPP, OFEN, OFSP; it UST, UFAM, UFPP, UFE, UFSP; en FSO, FOEN, FOCP, SFOE, FOPH)'));
    }
  }
  out.push('');
  return out.join('\n');
}
