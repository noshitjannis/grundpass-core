/**
 * Feldkatalog: Welche Fakten-Keys im Steckbrief erscheinen, unter welchem Label, in welchem Abschnitt,
 * mit welcher Erklärung für Laien. Keys, die hier fehlen, bleiben in /v1/fakten sichtbar, aber nicht im Steckbrief.
 *
 * Erklärungen sind kurz und sachlich. Keine Bewertung, keine Empfehlung. Das macht die App.
 */

export type AbschnittId = 'adresse' | 'gebaeude' | 'heizung' | 'wohnungen' | 'parzelle' | 'zone' | 'solar' | 'oev' | 'laerm' | 'radon' | 'abgeleitet';

export const ABSCHNITTE: Array<{ id: AbschnittId; titel: string }> = [
  { id: 'adresse', titel: 'Adresse' },
  { id: 'gebaeude', titel: 'Gebäude' },
  { id: 'heizung', titel: 'Heizung und Warmwasser' },
  { id: 'wohnungen', titel: 'Wohnungen' },
  { id: 'parzelle', titel: 'Parzelle' },
  { id: 'zone', titel: 'Zone und Kataster' },
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
  'parzelle.flaeche_grundbuch_m2': { label: 'Parzellenfläche', abschnitt: 'parzelle', erwartet: true, format: 'int', erklaerung: 'Amtliche Fläche laut Grundbuch, aus dem ÖREB-Kataster des Kantons.' },
  'parzelle.flaeche_m2': { label: 'Parzellenfläche (aus Geometrie)', abschnitt: 'parzelle', format: 'int', erklaerung: 'Aus der Geometrie der amtlichen Vermessung berechnet. Zweitquelle, massgebend ist die Grundbuchfläche.' },
  'parzelle.art': { label: 'Grundstücksart', abschnitt: 'parzelle' },
  'parzelle.hinweis_vermessung': { label: 'Hinweis Vermessung', abschnitt: 'parzelle', erklaerung: 'Die amtliche Vermessung findet unter dem Gebäudepunkt eine andere Parzelle als das Gebäuderegister nennt. Zone und Grundbuchfläche folgen der Parzelle aus dem Register (EGRID), die Fläche aus der Geometrie gehört zur Parzelle unter dem Punkt.' },
  'parzelle.geoportal_url': { label: 'Kantonales Geoportal', abschnitt: 'parzelle' },

  'zone.bezeichnung': { label: 'Zone', abschnitt: 'zone', erwartet: true, erklaerung: 'Grundnutzung laut ÖREB-Kataster, so wie Gemeinde oder Kanton sie bezeichnen. Was eine Zone konkret erlaubt (Geschosse, Ausnützung, Nutzung), steht im Baureglement der Gemeinde, nicht im Kataster. Liegt die Parzelle in mehreren Zonen, ist das die mit dem grössten Anteil.' },
  'zone.code': { label: 'Zonencode', abschnitt: 'zone', format: 'id', erklaerung: 'Kennung der Zone im kantonalen Datenmodell. Nur ein Code, keine Aussage für Laien.' },
  'zone.anteil_prozent': { label: 'Anteil an der Parzelle', abschnitt: 'zone', format: 'int', erklaerung: 'Wie viel der Parzellenfläche in dieser Zone liegt. Unter 100 % heisst: Die Parzelle hat mehrere Zonen, siehe weitere Zonen.' },
  'zone.anzahl': { label: 'Zonen auf der Parzelle', abschnitt: 'zone', format: 'int' },
  'zone.baureglement_url': { label: 'Baureglement', abschnitt: 'zone', erklaerung: 'Das kommunale Baureglement bzw. die Bau- und Nutzungsordnung. Dort stehen Ausnützungsziffer, Geschosszahl und Abstände. Der ÖREB-Kataster enthält sie nicht.' },
  'oereb.belastungen_anzahl': { label: 'Weitere Einträge im Kataster', abschnitt: 'zone', format: 'int', erklaerung: 'Andere öffentlich-rechtliche Eigentumsbeschränkungen, die diese Parzelle betreffen: überlagernde Pläne, Baulinien, Gewässerraum, Grundwasserschutz, belastete Standorte und Ähnliches. Jeder Eintrag steht einzeln darunter.' },
  'oereb.aenderungen_hangig_anzahl': { label: 'Hängige Änderungen', abschnitt: 'zone', format: 'int', erklaerung: 'Einträge im Kataster, die noch nicht rechtskräftig sind (laufende Planänderungen mit Vorwirkung).' },
  'oereb.auszug_pdf_url': { label: 'Amtlicher Auszug (PDF)', abschnitt: 'zone', erklaerung: 'Der offizielle ÖREB-Katasterauszug des Kantons zu dieser Parzelle, mit allen Rechtsgrundlagen.' },

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

  'laerm.strasse.tag_db': { label: 'Strassenlärm Tag', abschnitt: 'laerm', format: 'dezimal', erklaerung: 'Beurteilungspegel Lr des Strassenverkehrs am Tag (6 bis 22 Uhr) am Gebäudepunkt. Modellrechnung des BAFU (sonBASE, Stand 2021), keine Messung. Zum Vergleich: In einer reinen Wohnzone (ES II) gilt tags ein Grenzwert von 60 dB.' },
  'laerm.strasse.nacht_db': { label: 'Strassenlärm Nacht', abschnitt: 'laerm', format: 'dezimal', erklaerung: 'Beurteilungspegel Lr in der Nacht (22 bis 6 Uhr), gleiche Quelle. In einer reinen Wohnzone (ES II) gilt nachts 50 dB.' },
  'laerm.empfindlichkeitsstufe': { label: 'Empfindlichkeitsstufe', abschnitt: 'laerm', erwartet: true, erklaerung: 'ES I bis IV aus dem ÖREB-Kataster. Sie legt fest, wie viel Lärm an diesem Ort zulässig ist: ES I Erholungszonen, ES II Wohnzonen, ES III Misch- und Gewerbezonen, ES IV Industrie. Daraus ergeben sich die Grenzwerte unten.' },
  'laerm.strasse.grenzwert_tag_db': { label: 'Grenzwert Tag', abschnitt: 'laerm', format: 'int', erklaerung: 'Immissionsgrenzwert der Lärmschutz-Verordnung (Anhang 3, Strassenverkehr) für die Empfindlichkeitsstufe dieser Parzelle. Liegt der Pegel darüber, gilt der Ort als lärmbelastet.' },
  'laerm.strasse.grenzwert_nacht_db': { label: 'Grenzwert Nacht', abschnitt: 'laerm', format: 'int' },
  'laerm.empfindlichkeitsstufe_text': { label: 'Eintrag im Kataster', abschnitt: 'laerm' },

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
