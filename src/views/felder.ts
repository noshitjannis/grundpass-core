/**
 * Feldkatalog: Welche Fakten-Keys im Steckbrief erscheinen, unter welchem Label, in welchem Abschnitt,
 * mit welcher Erklärung für Laien. Keys, die hier fehlen, bleiben in /v1/fakten sichtbar, aber nicht im Steckbrief.
 *
 * Erklärungen sind kurz und sachlich. Keine Bewertung, keine Empfehlung. Das macht die App.
 */

export type AbschnittId = 'adresse' | 'gebaeude' | 'heizung' | 'wohnungen' | 'parzelle' | 'solar' | 'oev' | 'laerm' | 'radon' | 'abgeleitet';

export const ABSCHNITTE: Array<{ id: AbschnittId; titel: string }> = [
  { id: 'adresse', titel: 'Adresse' },
  { id: 'gebaeude', titel: 'Gebäude' },
  { id: 'heizung', titel: 'Heizung und Warmwasser' },
  { id: 'wohnungen', titel: 'Wohnungen' },
  { id: 'parzelle', titel: 'Parzelle' },
  { id: 'solar', titel: 'Sonne und Dach' },
  { id: 'oev', titel: 'Öffentlicher Verkehr' },
  { id: 'laerm', titel: 'Lärm' },
  { id: 'radon', titel: 'Radon' },
  { id: 'abgeleitet', titel: 'Berechnet' },
];

export type FeldDef = {
  label: string;
  abschnitt: AbschnittId;
  erklaerung?: string;
  /** Pflichtfeld für die Lückenliste: Wenn null, wird es als Lücke gemeldet. */
  erwartet?: boolean;
  /** Formatierung im Text-Output. */
  format?: 'int' | 'dezimal' | 'prozent' | 'chf' | 'text' | 'bool' | 'jahr' | 'id';
};

export const FELDER: Record<string, FeldDef> = {
  'adresse.label': { label: 'Adresse', abschnitt: 'adresse' },
  'adresse.gemeinde': { label: 'Gemeinde', abschnitt: 'adresse' },
  'adresse.bfs_nr': { label: 'BFS-Nummer', abschnitt: 'adresse', format: 'id', erklaerung: 'Amtliche Gemeindenummer des Bundesamts für Statistik.' },
  'adresse.kanton': { label: 'Kanton', abschnitt: 'adresse' },

  'gebaeude.egid': { label: 'EGID', abschnitt: 'gebaeude', format: 'id', erklaerung: 'Eidg. Gebäudeidentifikator. Schweizweit eindeutige Nummer dieses Gebäudes.' },
  'gebaeude.klasse_kurz': { label: 'Gebäudetyp', abschnitt: 'gebaeude' },
  'gebaeude.klasse': { label: 'Gebäudeklasse', abschnitt: 'gebaeude' },
  'gebaeude.kategorie': { label: 'Nutzung', abschnitt: 'gebaeude' },
  'gebaeude.status': { label: 'Status', abschnitt: 'gebaeude' },
  'gebaeude.baujahr': { label: 'Baujahr', abschnitt: 'gebaeude', erwartet: true, format: 'jahr', erklaerung: 'Fehlt oft im Register. Dann steht nur die Bauperiode.' },
  'gebaeude.bauperiode': { label: 'Bauperiode', abschnitt: 'gebaeude' },
  'gebaeude.geschosse': { label: 'Geschosse', abschnitt: 'gebaeude', format: 'int' },
  'gebaeude.wohnungen_anzahl': { label: 'Anzahl Wohnungen', abschnitt: 'gebaeude', format: 'int' },
  'gebaeude.grundflaeche_m2': { label: 'Gebäudegrundfläche', abschnitt: 'gebaeude', erwartet: true, format: 'int', erklaerung: 'Fläche, die das Gebäude am Boden einnimmt.' },
  'gebaeude.volumen_m3': { label: 'Gebäudevolumen', abschnitt: 'gebaeude', format: 'int' },
  'gebaeude.energiebezugsflaeche_m2': { label: 'Energiebezugsfläche', abschnitt: 'gebaeude', format: 'int' },
  'gebaeude.abbruchjahr': { label: 'Abbruchjahr', abschnitt: 'gebaeude', format: 'jahr' },

  'gebaeude.heizung.kurz': { label: 'Heizung', abschnitt: 'heizung', erwartet: true },
  'gebaeude.heizung.erzeuger': { label: 'Wärmeerzeuger', abschnitt: 'heizung' },
  'gebaeude.heizung.energietraeger': { label: 'Energieträger', abschnitt: 'heizung' },
  'gebaeude.heizung.stand': { label: 'Stand der Angabe', abschnitt: 'heizung', erklaerung: 'Datum, an dem die Heizungsangabe im Register zuletzt bestätigt oder geändert wurde.' },
  'gebaeude.heizung2.erzeuger': { label: 'Zweiter Wärmeerzeuger', abschnitt: 'heizung' },
  'gebaeude.heizung2.energietraeger': { label: 'Zweiter Energieträger', abschnitt: 'heizung' },
  'gebaeude.warmwasser.erzeuger': { label: 'Warmwasser', abschnitt: 'heizung' },
  'gebaeude.warmwasser.energietraeger': { label: 'Warmwasser Energieträger', abschnitt: 'heizung' },

  'wohnungen.flaeche_total_m2': { label: 'Wohnfläche total', abschnitt: 'wohnungen', erwartet: true, format: 'int', erklaerung: 'Summe der Wohnungsflächen laut Register. Nicht dasselbe wie die Nettowohnfläche im Inserat.' },
  'wohnungen.zimmer_total': { label: 'Zimmer total', abschnitt: 'wohnungen', format: 'dezimal' },

  'parzelle.nummer': { label: 'Parzellennummer', abschnitt: 'parzelle', erwartet: true },
  'parzelle.egrid': { label: 'EGRID', abschnitt: 'parzelle', erklaerung: 'Eidg. Grundstücksidentifikator. Schweizweit eindeutige Nummer des Grundstücks, steht auch im Grundbuch.' },
  'parzelle.flaeche_m2': { label: 'Parzellenfläche', abschnitt: 'parzelle', erwartet: true, format: 'int', erklaerung: 'Aus der Geometrie der amtlichen Vermessung berechnet. Massgebend ist der Grundbucheintrag.' },
  'parzelle.art': { label: 'Grundstücksart', abschnitt: 'parzelle' },
  'parzelle.geoportal_url': { label: 'Kantonales Geoportal', abschnitt: 'parzelle' },

  'solar.klasse_text': { label: 'Solareignung', abschnitt: 'solar', erwartet: true, erklaerung: 'Eignung der besten Dachfläche nach Sonnendach.ch: gering, mittel, gut, sehr gut, hervorragend.' },
  'solar.dachflaeche_m2': { label: 'Dachfläche', abschnitt: 'solar', format: 'int' },
  'solar.segmente': { label: 'Dachflächen', abschnitt: 'solar', format: 'int', erklaerung: 'Anzahl Teilflächen des Dachs im Datensatz.' },
  'solar.einstrahlung_max_kwh_m2a': { label: 'Einstrahlung (beste Fläche)', abschnitt: 'solar', format: 'int', erklaerung: 'Sonnenenergie pro Quadratmeter und Jahr. 1000 ist ein mittlerer Wert, 1300 und mehr ist sehr gut.' },
  'solar.stromertrag_kwh_a': { label: 'Möglicher Solarstrom', abschnitt: 'solar', format: 'int', erklaerung: 'Geschätzter Jahresertrag, wenn alle geeigneten Flächen belegt würden. Ein Haushalt braucht etwa 4000 bis 5000 kWh.' },
  'solar.stromertrag_winter_kwh_a': { label: 'davon im Winterhalbjahr', abschnitt: 'solar', format: 'int' },
  'solar.finanzertrag_chf_a': { label: 'Geschätzter Ertrag', abschnitt: 'solar', format: 'chf', erklaerung: 'Grobe Schätzung des BFE. Hängt stark vom Eigenverbrauch und vom Rückliefertarif ab.' },
  'solar.waermebedarf_heizung_kwh_a': { label: 'Geschätzter Heizwärmebedarf', abschnitt: 'solar', format: 'int', erklaerung: 'Modellwert des BFE aus Gebäudealter und Grösse, keine Messung.' },
  'solar.bestes_segment.ausrichtung_grad': { label: 'Ausrichtung (beste Fläche)', abschnitt: 'solar', format: 'int', erklaerung: '0 = Süd, negativ = Ost, positiv = West.' },
  'solar.bestes_segment.neigung_grad': { label: 'Neigung (beste Fläche)', abschnitt: 'solar', format: 'int' },

  'oev.gueteklasse': { label: 'ÖV-Güteklasse', abschnitt: 'oev', erwartet: true, erklaerung: 'A = sehr gut, B = gut, C = mittel, D = gering, keine = ausserhalb. Massstab des Bundes für die ÖV-Erschliessung.' },
  'oev.gueteklasse_text': { label: 'Bedeutung', abschnitt: 'oev' },

  'laerm.strasse.tag_db': { label: 'Strassenlärm Tag', abschnitt: 'laerm', format: 'dezimal', erklaerung: 'Beurteilungspegel Lr des Strassenverkehrs am Tag (6 bis 22 Uhr) am Gebäudepunkt. Modellrechnung des BAFU (sonBASE, Stand 2021), keine Messung. Zum Vergleich: 60 dB ist der Grenzwert für reine Wohnzonen.' },
  'laerm.strasse.nacht_db': { label: 'Strassenlärm Nacht', abschnitt: 'laerm', format: 'dezimal', erklaerung: 'Beurteilungspegel Lr in der Nacht (22 bis 6 Uhr), gleiche Quelle. Grenzwert reine Wohnzone: 50 dB.' },
  'laerm.strasse.grenzwert_wohnzone_tag_db': { label: 'Grenzwert Wohnzone Tag', abschnitt: 'laerm', format: 'int', erklaerung: 'Immissionsgrenzwert der Lärmschutz-Verordnung für reine Wohnzonen (Empfindlichkeitsstufe II).' },
  'laerm.strasse.grenzwert_wohnzone_nacht_db': { label: 'Grenzwert Wohnzone Nacht', abschnitt: 'laerm', format: 'int' },

  'radon.wahrscheinlichkeit_prozent': { label: 'Radon-Wahrscheinlichkeit', abschnitt: 'radon', erwartet: true, format: 'int', erklaerung: 'Wahrscheinlichkeit laut BAG-Karte, dass in einem Gebäude an diesem Ort der Referenzwert von 300 Bq/m³ überschritten wird. Keine Messung an diesem Haus.' },
  'radon.einstufung': { label: 'Einstufung', abschnitt: 'radon', erklaerung: 'Unsere Lesehilfe: unter 10 % gering, unter 20 % mittel, ab 20 % erhöht. Bei erhöht lohnt sich eine Messung im Keller, besonders vor einem Umbau.' },

  'parzelle.bebauter_anteil_prozent': { label: 'Bebauter Anteil', abschnitt: 'abgeleitet', format: 'dezimal', erklaerung: 'Gebäudegrundfläche geteilt durch Parzellenfläche. Ein tiefer Wert heisst viel freie Fläche, sagt aber nichts über die erlaubte Ausnützung.' },
  'gebaeude.alter_jahre': { label: 'Gebäudealter', abschnitt: 'abgeleitet', format: 'int', erklaerung: 'Aus Baujahr oder Mitte der Bauperiode.' },
};

/** Wohnungsfelder sind dynamisch (wohnung.<ewid>.*). */
export const WOHNUNG_FELDER: Record<string, Omit<FeldDef, 'abschnitt'>> = {
  stockwerk: { label: 'Stockwerk' },
  zimmer: { label: 'Zimmer', format: 'dezimal' },
  flaeche_m2: { label: 'Fläche', format: 'int' },
  baujahr: { label: 'Baujahr', format: 'jahr' },
  kueche: { label: 'Küche', format: 'bool' },
  status: { label: 'Status' },
};
