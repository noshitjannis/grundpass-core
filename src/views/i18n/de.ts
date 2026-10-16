import type { Luecke } from '../steckbrief.ts';
import { FELDER, WOHNUNG_FELDER, type AbschnittId } from '../felder.ts';

/**
 * Deutsche Texte der Lesefassung. Deutsch ist die Quellsprache: Labels und Erklärungen des Feldkatalogs kommen aus FELDER
 * (src/views/felder.ts) und stehen hier nicht doppelt; fr, it und en führen sie vollständig in ihrer Datei. Ein Test
 * (test/i18n.test.ts) prüft, dass jeder Schlüssel aus de in fr, it und en existiert, und TypeScript erzwingt es für alles
 * ausser den Feldern über den Typ `Texte`. Kein Fallback auf Deutsch zur Laufzeit.
 *
 * Amtliche Begriffe in fr und it aus amtlichen Quellen: GWR-Merkmalskatalog 4.3 (housing-stat.ch), LSV (SR 814.41, fedlex),
 * ÖREBKV (SR 510.622.4, fedlex) und die Themennamen der kantonalen ÖREB-Dienste, ARE (ÖV-Güteklassen), BAG (Radon), swisstopo
 * (amtliche Vermessung, Grundbuch, Layer-Beschreibungen auf geo.admin.ch). Englisch ohne amtliche Quelle: klares Englisch, der
 * Schweizer Begriff beim ersten Vorkommen in Klammern. Zusammenstellung mit Quelle pro Begriff: docs/GLOSSAR.md.
 *
 * Datenwerte werden nie übersetzt: Zonenbezeichnungen in der Sprache des Kantons, Gemeinde-, Stellen- und Quellennamen amtlich.
 */
export type FeldText = { label: string; erklaerung?: string };

export type Texte = {
  /** Abschnittstitel des Steckbriefs. */
  abschnitte: Record<AbschnittId, string>;
  /** Label und Erklärung pro Fakten-Key des Feldkatalogs (alle Keys aus FELDER). */
  felder: Record<string, FeldText>;
  /** Abschnitt pro Wohnung: Titel ohne und mit Nummer (`{ewid}`), Labels der Wohnungsfelder. */
  wohnung: { titel: string; titelMitNr: string; felder: Record<keyof typeof WOHNUNG_FELDER, string> };
  /** Datengetriebene Zeilen im Abschnitt Zone. */
  zone: {
    weitere: string;
    weitereMitAnteil: string;
    weitereErklaerung: string;
    anteilFlaeche: string;
    laenge: string;
    betroffen: string;
    /** Titel der zwei Sammelthemen, die der Adapter selbst benennt (der Slug ist der Code). */
    themen: Record<'nutzungsplanung_ueberlagernd' | 'nutzungsplanung_weitere', string>;
  };
  /** Formate: Bool-Werte, leere Werte. */
  formate: { ja: string; nein: string; betroffen: string; nichtBetroffen: string; keineAngabe: string; leer: string };
  /** Lückengründe und ihre Details (`{keys}`, `{kanton}`). */
  luecken: { grund: Record<Luecke['grund'], string>; detail: { fehlendeSchluessel: string; ausserKanton: string; feldLeer: string } };
  /** Hinweistexte aus Adaptern, nach Code (die Adapter liefern `<key>_code` und Parameter als Fakten). */
  hinweise: {
    zone: Record<'flaechenanteil' | 'thema_ohne_daten', string>;
    grundbuch: Record<'mehrere_kreise', string>;
    bahn: Record<'nicht_kartiert' | 'nicht_kartiert_tag' | 'nicht_kartiert_nacht', string>;
    vermessung: Record<'egrid_unbekannt' | 'punkt_auf_anderer_parzelle' | 'punkt_auf_keiner_parzelle', string>;
  };
  /** Werte, die die View aus einem Code-Fakt rendert. */
  werte: {
    oev: Record<'A' | 'B' | 'C' | 'D' | 'keine', string>;
    solar: Record<1 | 2 | 3 | 4 | 5, string>;
    radon: Record<'gering' | 'mittel' | 'erhoeht', string>;
    kgs: Record<'A' | 'B', string>;
    /** Grundstücksarten der amtlichen Vermessung (DM.01, RealEstate.Type); unbekannte Werte bleiben, wie das Register sie nennt. */
    parzelleArt: Record<string, string>;
  };
  /** Quellenangaben: Titel der Pseudo-Quellen, Datumszeilen (`{datum}`). */
  quellen: { derived: string; owner: string; datenVom: string; abgefragt: string };
  /** Titel, Datenhalter und Pflicht-Quellenangabe pro Adapter (de steht im Manifest). */
  adapter: Record<string, { titel: string; provider: string; attribution: string }>;
  /** Textausgabe (CLI) und Kopfzeile. */
  text: { gemeinde: string; egid: string; egrid: string; parzelle: string; unvollstaendig: string; luecken: string; quellen: string; lauf: string; experimentell: string };
};

const felder: Record<string, FeldText> = Object.fromEntries(
  Object.entries(FELDER).map(([key, def]) => [key, def.erklaerung ? { label: def.label, erklaerung: def.erklaerung } : { label: def.label }]),
);

export const de: Texte = {
  abschnitte: {
    adresse: 'Adresse',
    gebaeude: 'Gebäude',
    heizung: 'Heizung und Warmwasser',
    wohnungen: 'Wohnungen',
    parzelle: 'Parzelle',
    zone: 'Zone und Kataster',
    ortsbild: 'Ortsbild und Denkmal',
    solar: 'Sonne und Dach',
    oev: 'Öffentlicher Verkehr',
    laerm: 'Lärm',
    naturgefahren: 'Naturgefahren',
    radon: 'Radon',
    stellen: 'Zuständige Stellen',
    abgeleitet: 'Berechnet',
  },
  felder,
  wohnung: {
    titel: 'Wohnung',
    titelMitNr: 'Wohnung {ewid}',
    felder: Object.fromEntries(Object.entries(WOHNUNG_FELDER).map(([k, d]) => [k, d.label])) as Record<keyof typeof WOHNUNG_FELDER, string>,
  },
  zone: {
    weitere: 'Weitere Zone',
    weitereMitAnteil: 'Weitere Zone ({anteil} %)',
    weitereErklaerung: 'Zweite Grundnutzung auf derselben Parzelle, mit ihrem Flächenanteil.',
    anteilFlaeche: '({anteil} % der Fläche)',
    laenge: '({laenge} m)',
    betroffen: 'betroffen',
    themen: {
      nutzungsplanung_ueberlagernd: 'Nutzungsplanung: überlagernde Festlegungen',
      nutzungsplanung_weitere: 'Nutzungsplanung: weitere Einträge (Grundnutzung oder überlagernd, vom Kataster nicht gekennzeichnet)',
    },
  },
  formate: { ja: 'ja', nein: 'nein', betroffen: 'betroffen', nichtBetroffen: 'nicht betroffen', keineAngabe: 'keine Angabe', leer: '–' },
  luecken: {
    grund: {
      fehlt_im_register: 'fehlt im Register',
      quelle_nicht_erreichbar: 'Quelle nicht erreichbar',
      quelle_uebersprungen: 'Quelle übersprungen',
      quelle_abgeschaltet: 'Quelle abgeschaltet',
      quelle_ausser_kanton: 'Quelle für diesen Kanton nicht angeschlossen',
      hinweis: 'siehe Hinweis',
    },
    detail: {
      fehlendeSchluessel: 'fehlende Schlüssel: {keys}',
      ausserKanton: 'für Kanton {kanton} noch nicht angeschlossen',
      feldLeer: 'Feld im Register leer',
    },
  },
  hinweise: {
    zone: {
      flaechenanteil: 'Grundnutzung aus dem grössten Flächenanteil abgeleitet, nicht aus einer Kennzeichnung des Kantons',
      thema_ohne_daten: 'Der ÖREB-Kataster des Kantons führt für diese Gemeinde noch keine Daten zur Nutzungsplanung',
    },
    grundbuch: {
      mehrere_kreise: 'Die Gemeinde hat {anzahl} Grundbuchkreise. Die Amtliche Vermessung löst sie nicht räumlich auf, zuständig ist das Grundbuchamt bzw. Notariat des Quartiers.',
    },
    bahn: {
      nicht_kartiert: 'keine Bahnlärm-Belastung kartiert',
      nicht_kartiert_tag: 'keine Bahnlärm-Belastung kartiert (Tag)',
      nicht_kartiert_nacht: 'keine Bahnlärm-Belastung kartiert (Nacht)',
    },
    vermessung: {
      egrid_unbekannt: 'Unter dem Gebäudepunkt liegt laut amtlicher Vermessung Parzelle {punkt_nummer} ({punkt_egrid}), das Gebäuderegister nennt {nummer} ({egrid}); diese EGRID kennt die amtliche Vermessung nicht. Die Fläche aus der Geometrie gehört zu {punkt_nummer}.',
      punkt_auf_anderer_parzelle: 'Der Gebäudepunkt aus dem Gebäuderegister liegt laut amtlicher Vermessung auf Parzelle {punkt_nummer} ({punkt_egrid}), nicht auf {nummer} ({egrid}). Gezeigt wird die Parzelle aus dem Gebäuderegister.',
      punkt_auf_keiner_parzelle: 'Der Gebäudepunkt aus dem Gebäuderegister liegt laut amtlicher Vermessung auf keiner Parzelle, nicht auf {nummer} ({egrid}). Gezeigt wird die Parzelle aus dem Gebäuderegister.',
    },
  },
  werte: {
    oev: { A: 'sehr gute Erschliessung', B: 'gute Erschliessung', C: 'mittelmässige Erschliessung', D: 'geringe Erschliessung', keine: 'ausserhalb der ÖV-Güteklassen, sehr geringe Erschliessung' },
    solar: { 1: 'gering', 2: 'mittel', 3: 'gut', 4: 'sehr gut', 5: 'hervorragend' },
    radon: { gering: 'gering', mittel: 'mittel', erhoeht: 'erhöht' },
    kgs: { A: 'A (national)', B: 'B (regional)' },
    parzelleArt: {
      Liegenschaft: 'Liegenschaft',
      'SelbstRecht.Baurecht': 'Baurecht (selbständiges und dauerndes Recht)',
      'SelbstRecht.Quellenrecht': 'Quellenrecht (selbständiges und dauerndes Recht)',
      'SelbstRecht.Konzessionsrecht': 'Konzessionsrecht (selbständiges und dauerndes Recht)',
      'SelbstRecht.weitere': 'Weiteres selbständiges und dauerndes Recht',
      Bergwerk: 'Bergwerk',
    },
  },
  quellen: { derived: 'Berechnet aus Registerdaten', owner: 'Angabe des Eigentümers', datenVom: 'Daten vom {datum}', abgefragt: 'abgefragt {datum}' },
  adapter: {
    geocode: { titel: 'Adresse → Gebäude', provider: 'swisstopo / BFS', attribution: '© swisstopo, BFS (amtliches Gebäudeadressverzeichnis)' },
    gwr: { titel: 'GWR Gebäude und Wohnungen', provider: 'BFS', attribution: '© BFS, Gebäude- und Wohnungsregister (GWR)' },
    'av-parzelle': { titel: 'Amtliche Vermessung: Parzelle', provider: 'swisstopo / Kantone', attribution: '© swisstopo, Kantone (amtliche Vermessung)' },
    sonnendach: { titel: 'Sonnendach: Solarpotenzial', provider: 'BFE', attribution: '© BFE, swisstopo (Sonnendach.ch)' },
    'oev-gueteklasse': { titel: 'ÖV-Güteklasse', provider: 'ARE', attribution: '© ARE (ÖV-Güteklassen)' },
    radon: { titel: 'Radonkarte', provider: 'BAG', attribution: '© BAG (Radonkarte Schweiz)' },
    'laerm-strasse': { titel: 'Strassenlärm Tag und Nacht', provider: 'BAFU', attribution: '© BAFU (sonBASE, Lärmbelastung Strasse)' },
    'laerm-bahn': { titel: 'Bahnlärm Tag und Nacht', provider: 'BAFU', attribution: '© BAFU (Lärmbelastung Eisenbahn, Emissionskataster 2021)' },
    naturgefahren: { titel: 'Naturgefahren (Bundeslayer)', provider: 'BAFU', attribution: '© BAFU (Gefährdungskarte Oberflächenabfluss, Aquaprotect, Erdbebenzonen SIA 261)' },
    kulturgueter: { titel: 'KGS-Inventar (Kulturgüterschutz)', provider: 'BABS', attribution: '© BABS (KGS-Inventar)' },
    oereb: { titel: 'ÖREB-Kataster', provider: 'Kantone (ÖREB-Kataster)', attribution: '© ÖREB-Kataster der Kantone' },
    'zustaendige-stellen': { titel: 'Zuständige Stellen', provider: 'swisstopo (Amtliche Vermessung Schweiz)', attribution: '© swisstopo (Amtliche Vermessung Schweiz)' },
  },
  text: { gemeinde: 'Gemeinde {name}', egid: 'EGID', egrid: 'EGRID', parzelle: 'Parzelle', unvollstaendig: 'UNVOLLSTÄNDIG', luecken: 'LÜCKEN', quellen: 'QUELLEN', lauf: 'Lauf', experimentell: 'experimentell' },
};
