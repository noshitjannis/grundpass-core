import type { Sprache } from '../types.ts';

/**
 * Codetabellen des eidg. Gebäude- und Wohnungsregisters (GWR), viersprachig.
 * Quelle de: Merkmalskatalog 4.2 (heutiger Stand der gespeicherten Fakten). Quelle fr, it, en: Merkmalskatalog 4.3 des BFS
 * (https://www.housing-stat.ch/catalog/<lang>/4.3/final, Daten unter catalog/data/4.3/<lang>.html, gelesen 16.10.2026); wo 4.3
 * ein Wort anders setzt als 4.2 (Englisch «Hot air pump» für die Warmwasser-Wärmepumpe), steht klares Englisch.
 *
 * Die Adapter speichern den deutschen Text (Quellsprache, API-stabil) und den Rohcode; die View übersetzt über den Code
 * (`gebaeudeKlasse(code, sprache)`). Regel aus CLAUDE.md: Nur mappen, was sicher ist. Unbekannte Codes kommen als `null`
 * zurück und der Rohcode wird separat als Fakt geführt. Nie raten.
 */

/** Ein Eintrag: [de, fr, it, en]. Das Tupel erzwingt, dass jede Sprache jeden Code hat. */
export type T4 = readonly [de: string, fr: string, it: string, en: string];
const IDX: Record<Sprache, 0 | 1 | 2 | 3> = { de: 0, fr: 1, it: 2, en: 3 };

const t = (m: Record<number, T4>) => (code: number | null | undefined, sprache: Sprache = 'de'): string | null =>
  code == null ? null : (m[code]?.[IDX[sprache]] ?? null);

/** GSTAT Gebäudestatus */
export const GSTAT: Record<number, T4> = {
  1001: ['projektiert', 'en projet', 'in progetto', 'planned'],
  1002: ['bewilligt', 'autorisé', 'autorizzato', 'authorised'],
  1003: ['im Bau', 'en construction', 'in costruzione', 'under construction'],
  1004: ['bestehend', 'existant', 'esistente', 'existing'],
  1005: ['nicht nutzbar', 'non utilisable', 'non utilizzabile', 'disused'],
  1007: ['abgebrochen', 'démoli', 'demolito', 'demolished'],
  1008: ['nicht realisiert', 'non réalisé', 'non realizzato', 'not realised'],
};
export const gebaeudeStatus = t(GSTAT);

/** GKAT Gebäudekategorie */
export const GKAT: Record<number, T4> = {
  1010: ['Provisorische Unterkunft', 'Habitation provisoire', 'Abitazione provvisoria', 'Temporary accommodation'],
  1020: ['Gebäude mit ausschliesslicher Wohnnutzung', "Bâtiment exclusivement à usage d'habitation", 'Edificio ad uso esclusivamente abitativo', 'Building for residential use only'],
  1030: ['Wohngebäude mit Nebennutzung', "Autre bâtiment d'habitation (bâtiment d'habitation à usage annexe)", 'Altro edificio abitativo (con utilizzazione accessoria)', 'Other residential building (with subsidiary use)'],
  1040: ['Gebäude mit teilweiser Wohnnutzung', "Bâtiment partiellement à usage d'habitation", 'Edificio ad uso parzialmente abitativo', 'Building with partial residential use'],
  1060: ['Gebäude ohne Wohnnutzung', "Bâtiment sans usage d'habitation", 'Edificio ad uso non abitativo', 'Non-residential building'],
  1080: ['Sonderbau', 'Construction particulière', 'Costruzione speciale', 'Special construction'],
};
export const gebaeudeKategorie = t(GKAT);

/** GKLAS Gebäudeklasse */
export const GKLAS: Record<number, T4> = {
  1110: ['Gebäude mit einer Wohnung', 'Maisons à un logement', 'Edifici ad una abitazione', 'Single-dwelling buildings'],
  1121: ['Gebäude mit zwei Wohnungen', 'Maisons à deux logements', 'Edifici a due abitazioni', 'Two-dwelling buildings'],
  1122: ['Gebäude mit drei oder mehr Wohnungen', 'Immeubles à trois logements et plus', 'Edifici a tre e più abitazioni', 'Buildings with three or more dwellings'],
  1130: ['Wohngebäude für Gemeinschaften', 'Habitat communautaire', 'Residenze per collettività', 'Community residences'],
  1211: ['Hotelgebäude', 'Hôtels', 'Alberghi', 'Hotels'],
  1212: ['Andere Gebäude für kurzfristige Beherbergung', "Autres bâtiments d'hébergement de tourisme", 'Altri edifici per abitazione di breve durata', 'Other short-stay accommodation buildings'],
  1220: ['Bürogebäude', 'Immeubles de bureaux', 'Fabbricati per uffici', 'Office buildings'],
  1230: ['Gross- und Einzelhandelsgebäude', 'Bâtiments commerciaux', "Fabbricati per il commercio all'ingrosso e al dettaglio", 'Wholesale and retail trade buildings'],
  1231: ['Restaurants und Bars in Gebäuden ohne Wohnnutzung', 'Restaurants et bars dans des bâtiments sans usage résidentiel', 'Ristoranti e bar in edifici non residenziali', 'Restaurants and bars in non-residential buildings'],
  1241: ['Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen', 'Gares, aérogares, centraux téléphoniques', 'Stazioni, terminal, centrali telefoniche', 'Rail stations, air terminals, telephone exchange buildings'],
  1242: ['Garagengebäude', 'Garages', 'Fabbricati per garage', 'Garage buildings'],
  1251: ['Industriegebäude', 'Bâtiments industriels', 'Fabbricati industriali', 'Industrial buildings'],
  1252: ['Behälter, Silos und Lagergebäude', 'Réservoirs, silos et entrepôts', 'Serbatoi, silos e depositi', 'Reservoirs, silos and warehouses'],
  1261: ['Gebäude für Kultur- und Freizeitzwecke', 'Bâtiments à usage culturel, récréatif, éducatif ou sanitaire', 'Edifici destinati ad attività ricreative o culturali', 'Buildings for cultural or recreational purposes'],
  1262: ['Museen und Bibliotheken', 'Musées et bibliothèques', 'Musei e biblioteche', 'Museums and libraries'],
  1263: ['Schul- und Hochschulgebäude, Forschungseinrichtungen', "Bâtiments pour l'enseignement et la recherche", 'Edifici scolastici, universitari ed edifici di ricerca', 'School, university and research buildings'],
  1264: ['Krankenhäuser und Facheinrichtungen des Gesundheitswesens', 'Hôpitaux et établissements de santé', 'Edifici per fini ospedalieri e di assistenza sociale', 'Hospital or institutional care buildings'],
  1265: ['Sporthallen', 'Salles de sport', 'Sale sportive', 'Sports halls'],
  1271: ['Landwirtschaftliche Betriebsgebäude', "Bâtiment d'exploitation agricole", 'Fabbricati rurali non residenziali', 'Agricultural buildings'],
  1272: ['Kirchen und sonstige Kultgebäude', 'Edifices cultuels et religieux', 'Edifici utilizzati come luoghi di culto e per attività religiose', 'Buildings used as places of worship and for religious activities'],
  1273: ['Denkmäler oder unter Denkmalschutz stehende Bauwerke', 'Monuments historiques ou classés', 'Monumenti storici o protetti', 'Historic or protected monuments'],
  1274: ['Sonstige Hochbauten, anderweitig nicht genannt', 'Autres bâtiments non classés ailleurs', 'Altri edifici, n.c.a.', 'Other buildings not elsewhere classified'],
  1275: ['Andere Gebäude für die kollektive Unterkunft', "Autres bâtiments pour l'hébergement collectif", 'Altri edifici che ospitano collettività', 'Other buildings for collective households'],
  1276: ['Gebäude für die Tierhaltung', "Bâtiments pour la garde d'animaux", 'Edifici per la tenuta di animali', 'Buildings for keeping animals'],
  1277: ['Gebäude für den Pflanzenbau', 'Bâtiments pour la culture végétale', 'Edifici per le colture vegetali', 'Buildings for growing crops'],
  1278: ['Andere landwirtschaftliche Gebäude', "Autres bâtiments d'exploitation agricole", 'Altri fabbricati rurali non residenziali', 'Other agricultural buildings'],
};
export const gebaeudeKlasse = t(GKLAS);

/** Kurzform der Gebäudeklasse für Laien (eigene Wortwahl von grundpass, kein amtlicher Begriff). */
export const GKLAS_KURZ: Record<number, T4> = {
  1110: ['Einfamilienhaus', 'Maison individuelle', 'Casa unifamiliare', 'Single-family house'],
  1121: ['Zweifamilienhaus', 'Maison à deux logements', 'Casa bifamiliare', 'Two-family house'],
  1122: ['Mehrfamilienhaus', "Immeuble d'habitation", 'Casa plurifamiliare', 'Apartment building'],
  1130: ['Wohnheim', 'Habitat communautaire', 'Residenza collettiva', 'Residential home'],
  1220: ['Bürogebäude', 'Immeuble de bureaux', 'Edificio per uffici', 'Office building'],
  1230: ['Geschäftshaus', 'Bâtiment commercial', 'Edificio commerciale', 'Commercial building'],
  1242: ['Garage', 'Garage', 'Garage', 'Garage'],
  1251: ['Industriegebäude', 'Bâtiment industriel', 'Edificio industriale', 'Industrial building'],
  1252: ['Lagergebäude', 'Entrepôt', 'Deposito', 'Warehouse'],
  1271: ['Landwirtschaftsgebäude', 'Bâtiment agricole', 'Edificio agricolo', 'Agricultural building'],
};
export const gebaeudeKlasseKurz = t(GKLAS_KURZ);

/** GBAUP Bauperiode. Nur gesetzt, wenn das Baujahr (GBAUJ) nicht bekannt ist. */
export const GBAUP: Record<number, T4> = {
  8011: ['vor 1919', 'avant 1919', 'prima del 1919', 'before 1919'],
  8012: ['1919 bis 1945', 'de 1919 à 1945', 'dal 1919 al 1945', '1919 to 1945'],
  8013: ['1946 bis 1960', 'de 1946 à 1960', 'dal 1946 al 1960', '1946 to 1960'],
  8014: ['1961 bis 1970', 'de 1961 à 1970', 'dal 1961 al 1970', '1961 to 1970'],
  8015: ['1971 bis 1980', 'de 1971 à 1980', 'dal 1971 al 1980', '1971 to 1980'],
  8016: ['1981 bis 1985', 'de 1981 à 1985', 'dal 1981 al 1985', '1981 to 1985'],
  8017: ['1986 bis 1990', 'de 1986 à 1990', 'dal 1986 al 1990', '1986 to 1990'],
  8018: ['1991 bis 1995', 'de 1991 à 1995', 'dal 1991 al 1995', '1991 to 1995'],
  8019: ['1996 bis 2000', 'de 1996 à 2000', 'dal 1996 al 2000', '1996 to 2000'],
  8020: ['2001 bis 2005', 'de 2001 à 2005', 'dal 2001 al 2005', '2001 to 2005'],
  8021: ['2006 bis 2010', 'de 2006 à 2010', 'dal 2006 al 2010', '2006 to 2010'],
  8022: ['2011 bis 2015', 'de 2011 à 2015', 'dal 2011 al 2015', '2011 to 2015'],
  8023: ['nach 2015', 'à partir de 2016', 'a partire dal 2016', 'from 2016 onwards'],
};
export const bauperiode = t(GBAUP);

/** Grobe Jahresmitte der Bauperiode, für Berechnungen. Kein Fakt, nur Hilfsgrösse, sprachunabhängig. */
const GBAUP_MITTE: Record<number, string> = {
  8011: '1910',
  8012: '1932',
  8013: '1953',
  8014: '1965',
  8015: '1975',
  8016: '1983',
  8017: '1988',
  8018: '1993',
  8019: '1998',
  8020: '2003',
  8021: '2008',
  8022: '2013',
  8023: '2018',
};
export const bauperiodeMitte = (code: number | null | undefined): string | null => (code == null ? null : (GBAUP_MITTE[code] ?? null));

/** GWAERZH1/2 Wärmeerzeuger Heizung */
export const GWAERZH: Record<number, T4> = {
  7400: ['Kein Wärmeerzeuger', 'Pas de générateur de chaleur', 'Senza generatore di calore', 'No heat generator'],
  7410: ['Wärmepumpe für ein Gebäude', 'Pompe à chaleur pour un seul bâtiment', 'Pompa di calore per un solo edificio', 'Heat pump for a single building'],
  7411: ['Wärmepumpe für mehrere Gebäude', 'Pompe à chaleur pour plusieurs bâtiments', 'Pompa di calore per più edifici', 'Heat pump for several buildings'],
  7420: ['Thermische Solaranlage für ein Gebäude', 'Installation solaire thermique pour un seul bâtiment', 'Impianto solare termico per un solo edificio', 'Solar thermal system for a single building'],
  7421: ['Thermische Solaranlage für mehrere Gebäude', 'Installation solaire thermique pour plusieurs bâtiments', 'Impianto solare termico per più edifici', 'Solar thermal system for several buildings'],
  7430: ['Heizkessel (generisch) für ein Gebäude', 'Chaudière (générique) pour un seul bâtiment', 'Caldaia (generica) per un solo edificio', 'Boiler (generic) for a single building'],
  7431: ['Heizkessel (generisch) für mehrere Gebäude', 'Chaudière (générique) pour plusieurs bâtiments', 'Caldaia (generica) per più edifici', 'Boiler (generic) for several buildings'],
  7432: ['Heizkessel nicht kondensierend für ein Gebäude', 'Chaudière standard pour un seul bâtiment', 'Caldaia standard per un solo edificio', 'Standard boiler for a single building'],
  7433: ['Heizkessel nicht kondensierend für mehrere Gebäude', 'Chaudière standard pour plusieurs bâtiments', 'Caldaia standard per più edifici', 'Standard boiler for several buildings'],
  7434: ['Heizkessel kondensierend für ein Gebäude', 'Chaudière à condensation pour un seul bâtiment', 'Caldaia a condensazione per un solo edificio', 'Condensing boiler for a single building'],
  7435: ['Heizkessel kondensierend für mehrere Gebäude', 'Chaudière à condensation pour plusieurs bâtiments', 'Caldaia a condensazione per più edifici', 'Condensing boiler for several buildings'],
  7436: ['Ofen', 'Poêle', 'Stufa', 'Stove'],
  7440: ['Wärmekraftkopplungsanlage für ein Gebäude', 'Installation couplage chaleur-force pour un seul bâtiment', 'Impianto di cogenerazione per un solo edificio', 'Combined heat and power system for a single building'],
  7441: ['Wärmekraftkopplungsanlage für mehrere Gebäude', 'Installation couplage chaleur-force pour plusieurs bâtiments', 'Impianto di cogenerazione per più edifici', 'Combined heat and power system for several buildings'],
  7450: ['Elektrospeicher-Zentralheizung für ein Gebäude', 'Chauffage central électrique pour un seul bâtiment', 'Riscaldamento centrale elettrico per un solo edificio', 'Electric central heating for a single building'],
  7451: ['Elektrospeicher-Zentralheizung für mehrere Gebäude', 'Chauffage central électrique pour plusieurs bâtiments', 'Riscaldamento centrale elettrico per più edifici', 'Electric central heating for several buildings'],
  7452: ['Elektro direkt', 'Chauffage électrique direct (y compris radiateur infrarouge)', 'Radiatori elettrici (compresi quelli a infrarossi)', 'Direct electric heating (including infrared heaters)'],
  7460: ['Wärmetauscher (auch Fernwärme) für ein Gebäude', 'Echangeur de chaleur (y compris pour chauffage à distance) pour un seul bâtiment', 'Scambiatore di calore (anche per teleriscaldamento) per un solo edificio', 'Heat exchanger (including for district heating) for a single building'],
  7461: ['Wärmetauscher (auch Fernwärme) für mehrere Gebäude', 'Echangeur de chaleur (y compris pour chauffage à distance) pour plusieurs bâtiments', 'Scambiatore di calore (anche per teleriscaldamento) per più edifici', 'Heat exchanger (including for district heating) for several buildings'],
  7499: ['Andere', 'Autre', 'Altro', 'Other'],
};
export const waermeerzeugerHeizung = t(GWAERZH);

/** GENH1/2 und GENW1/2 Energie- oder Wärmequelle */
export const GENH: Record<number, T4> = {
  7500: ['Keine', 'Aucune', 'Nessuna', 'None'],
  7501: ['Luft', 'Air', 'Aria', 'Air'],
  7510: ['Erdwärme (generisch)', 'Géothermie (générique)', 'Geotermia (generica)', 'Geothermal energy (generic)'],
  7511: ['Erdwärmesonde', 'Sonde géothermique', 'Sonda geotermica', 'Geothermal probe'],
  7512: ['Erdregister', 'Serpentin géothermique', 'Serpentina geotermica', 'Geothermal loop'],
  7513: ['Wasser (Grundwasser, Oberflächenwasser, Abwasser)', 'Eau (nappe phréatique, eaux superficielles, eaux résiduelles)', 'Acqua (falda freatica, acque di superficie, acque residue)', 'Water (groundwater, surface water, waste water)'],
  7520: ['Gas', 'Gaz', 'Gas', 'Gas'],
  7530: ['Heizöl', 'Mazout', 'Olio da riscaldamento', 'Heating oil'],
  7540: ['Holz (generisch)', 'Bois (générique)', 'Legna (generica)', 'Wood (generic)'],
  7541: ['Holz (Stückholz)', 'Bois (bûches)', 'Legna (ceppi)', 'Wood (logs)'],
  7542: ['Holz (Pellets)', 'Bois (granulés, pellets)', 'Legna (pellet)', 'Wood (pellets)'],
  7543: ['Holz (Schnitzel)', 'Bois (bois déchiqueté, copeaux)', 'Legna (cippato, trucioli)', 'Wood (chips)'],
  7550: ['Abwärme (innerhalb des Gebäudes)', 'Rejets thermiques (dans le bâtiment)', "Scarichi termici (nell'edificio)", 'Waste heat (within the building)'],
  7560: ['Elektrizität', 'Electricité', 'Elettricità', 'Electricity'],
  7570: ['Sonne (thermisch)', 'Soleil (thermique)', 'Sole (termico)', 'Solar (thermal)'],
  7580: ['Fernwärme (generisch)', 'Chaleur produite à distance (générique)', 'Calore prodotto a distanza (generico)', 'District heating (generic)'],
  7581: ['Fernwärme (Hochtemperatur)', 'Chaleur produite à distance (haute température)', 'Calore prodotto a distanza (alta temperatura)', 'District heating (high temperature)'],
  7582: ['Fernwärme (Niedertemperatur)', 'Chaleur produite à distance (basse température)', 'Calore prodotto a distanza (bassa temperatura)', 'District heating (low temperature)'],
  7598: ['Unbestimmt', 'Indéterminée', 'Indeterminata', 'Indeterminate'],
  7599: ['Andere', 'Autre', 'Altro', 'Other'],
};
export const energietraeger = t(GENH);

/** GWAERZW1/2 Wärmeerzeuger Warmwasser */
export const GWAERZW: Record<number, T4> = {
  7600: ['Kein Wärmeerzeuger für Warmwasser', "Pas de générateur de chaleur pour l'eau chaude", "Senza generatore di calore per l'acqua calda", 'No heat generator for hot water'],
  7610: ['Wärmepumpe', 'Pompe à chaleur', 'Pompa di calore', 'Heat pump'],
  7620: ['Thermische Solaranlage', 'Installation solaire thermique', 'Impianto solare termico', 'Solar thermal system'],
  7630: ['Heizkessel (generisch)', 'Chaudière (générique)', 'Caldaia (generica)', 'Boiler (generic)'],
  7632: ['Heizkessel nicht kondensierend', 'Chaudière standard', 'Caldaia standard', 'Standard boiler'],
  7634: ['Heizkessel kondensierend', 'Chaudière à condensation', 'Caldaia a condensazione', 'Condensing boiler'],
  7640: ['Wärmekraftkopplungsanlage', 'Installation couplage chaleur-force', 'Impianto di cogenerazione', 'Combined heat and power system'],
  7650: ['Zentraler Elektroboiler', 'Boiler électrique central', 'Boiler centrale elettrico', 'Central electric boiler'],
  7651: ['Kleinboiler', 'Petit boiler', 'Piccolo boiler', 'Small boiler'],
  7660: ['Wärmetauscher (auch Fernwärme)', 'Echangeur de chaleur (y compris pour la chaleur à distance)', 'Scambiatore di calore (anche per teleriscaldamento)', 'Heat exchanger (including for district heating)'],
  7699: ['Andere', 'Autre', 'Altro', 'Other'],
};
export const waermeerzeugerWarmwasser = t(GWAERZW);

/** WSTAT Wohnungsstatus */
export const WSTAT: Record<number, T4> = {
  3001: ['projektiert', 'en projet', 'in progetto', 'planned'],
  3002: ['bewilligt', 'autorisé', 'autorizzato', 'authorised'],
  3003: ['im Bau', 'en construction', 'in costruzione', 'under construction'],
  3004: ['bestehend', 'existant', 'esistente', 'existing'],
  3005: ['nicht nutzbar', 'non utilisable', 'non utilizzabile', 'disused'],
  3007: ['aufgehoben', 'éliminé', 'eliminato', 'removed'],
  3008: ['nicht realisiert', 'non réalisé', 'non realizzato', 'not realised'],
};
export const wohnungStatus = t(WSTAT);

/** WSTWK Stockwerk. 3100 = Parterre, 3101.. = Obergeschosse, 3401.. = Untergeschosse. Ordnungszahlen pro Sprache. */
const STOCKWERK: Record<Sprache, { parterre: string; stock: (n: number) => string; untergeschoss: (n: number) => string }> = {
  de: { parterre: 'Parterre', stock: (n) => `${n}. Stock`, untergeschoss: (n) => `${n}. Untergeschoss` },
  fr: { parterre: 'Rez-de-chaussée', stock: (n) => `${n}${n === 1 ? 'er' : 'e'} étage`, untergeschoss: (n) => `${n}${n === 1 ? 'er' : 'e'} sous-sol` },
  it: { parterre: 'Pianterreno', stock: (n) => `${n}° piano`, untergeschoss: (n) => `${n}° sotterraneo` },
  en: { parterre: 'Ground floor', stock: (n) => `${ordinalEn(n)} floor`, untergeschoss: (n) => `${ordinalEn(n)} basement level` },
};
function ordinalEn(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${(['th', 'st', 'nd', 'rd'] as const)[n % 10 > 3 ? 0 : n % 10]}`;
}
export function stockwerk(code: number | null | undefined, sprache: Sprache = 'de'): string | null {
  if (code == null) return null;
  const s = STOCKWERK[sprache];
  if (code === 3100) return s.parterre;
  if (code > 3100 && code < 3200) return s.stock(code - 3100);
  if (code > 3400 && code < 3500) return s.untergeschoss(code - 3400);
  return null;
}

/** Kurzfassungen der Heizung (eigene Wortwahl von grundpass), Schlüssel = Code von `heizungKurzCode`. */
export const HEIZUNG_KURZ: Record<string, T4> = {
  keine: ['Keine Heizung', 'Pas de chauffage', 'Nessun riscaldamento', 'No heating'],
  waermepumpe_luft: ['Wärmepumpe (Luft)', 'Pompe à chaleur (air)', 'Pompa di calore (aria)', 'Heat pump (air)'],
  waermepumpe_erdsonde: ['Wärmepumpe (Erdsonde)', 'Pompe à chaleur (sonde géothermique)', 'Pompa di calore (sonda geotermica)', 'Heat pump (geothermal probe)'],
  waermepumpe_erdwaerme: ['Wärmepumpe (Erdwärme)', 'Pompe à chaleur (géothermie)', 'Pompa di calore (geotermia)', 'Heat pump (geothermal)'],
  waermepumpe_wasser: ['Wärmepumpe (Wasser)', 'Pompe à chaleur (eau)', 'Pompa di calore (acqua)', 'Heat pump (water)'],
  waermepumpe: ['Wärmepumpe', 'Pompe à chaleur', 'Pompa di calore', 'Heat pump'],
  fernwaerme: ['Fernwärme', 'Chauffage à distance', 'Teleriscaldamento', 'District heating'],
  oel: ['Ölheizung', 'Chauffage au mazout', 'Riscaldamento a olio', 'Oil heating'],
  gas: ['Gasheizung', 'Chauffage au gaz', 'Riscaldamento a gas', 'Gas heating'],
  pellets: ['Pelletheizung', 'Chauffage à pellets', 'Riscaldamento a pellet', 'Pellet heating'],
  holz: ['Holzheizung', 'Chauffage au bois', 'Riscaldamento a legna', 'Wood heating'],
  elektro: ['Elektroheizung', 'Chauffage électrique', 'Riscaldamento elettrico', 'Electric heating'],
  solarthermie: ['Solarthermie', 'Solaire thermique', 'Solare termico', 'Solar thermal'],
};

/**
 * Code der Kurzfassung aus Erzeuger und Energieträger (Beispiel: Heizkessel + Heizöl = oel). null, wenn die Kombination keine
 * sichere Kurzfassung hat. Die Texte dazu stehen in HEIZUNG_KURZ; `heizungKurz` liefert sie in der gewünschten Sprache.
 */
export function heizungKurzCode(erzeuger: number | null | undefined, traeger: number | null | undefined): string | null {
  if (erzeuger == null && traeger == null) return null;
  if (erzeuger === 7400) return 'keine';
  if (erzeuger != null && erzeuger >= 7410 && erzeuger <= 7411) {
    if (traeger === 7501) return 'waermepumpe_luft';
    if (traeger === 7511) return 'waermepumpe_erdsonde';
    if (traeger === 7510 || traeger === 7512) return 'waermepumpe_erdwaerme';
    if (traeger === 7513) return 'waermepumpe_wasser';
    return 'waermepumpe';
  }
  if (erzeuger != null && erzeuger >= 7460 && erzeuger <= 7461) return 'fernwaerme';
  if (traeger != null && traeger >= 7580 && traeger <= 7582) return 'fernwaerme';
  if (traeger === 7530) return 'oel';
  if (traeger === 7520) return 'gas';
  if (traeger != null && traeger >= 7540 && traeger <= 7543) {
    if (traeger === 7542) return 'pellets';
    return 'holz';
  }
  if (traeger === 7560 || (erzeuger != null && erzeuger >= 7450 && erzeuger <= 7452)) return 'elektro';
  if (erzeuger != null && erzeuger >= 7420 && erzeuger <= 7421) return 'solarthermie';
  return null;
}

/** Lesbare Kurzfassung der Heizung für Laien, in der gewünschten Sprache. */
export function heizungKurz(erzeuger: number | null | undefined, traeger: number | null | undefined, sprache: Sprache = 'de'): string | null {
  const code = heizungKurzCode(erzeuger, traeger);
  return code ? (HEIZUNG_KURZ[code]?.[IDX[sprache]] ?? null) : null;
}

/** Text zu einem Code der Kurzfassung (für die View, die nur den Code-Fakt kennt). */
export function heizungKurzText(code: string | null | undefined, sprache: Sprache = 'de'): string | null {
  return code ? (HEIZUNG_KURZ[code]?.[IDX[sprache]] ?? null) : null;
}

/** Alle Tabellen mit ihrem Namen, für das Glossar (docs/GLOSSAR.md) und Vollständigkeitstests. */
export const TABELLEN: Array<{ name: string; merkmal: string; tabelle: Record<string | number, T4> }> = [
  { name: 'Gebäudestatus', merkmal: 'GSTAT', tabelle: GSTAT },
  { name: 'Gebäudekategorie', merkmal: 'GKAT', tabelle: GKAT },
  { name: 'Gebäudeklasse', merkmal: 'GKLAS', tabelle: GKLAS },
  { name: 'Gebäudetyp (Kurzform, grundpass)', merkmal: 'GKLAS', tabelle: GKLAS_KURZ },
  { name: 'Bauperiode', merkmal: 'GBAUP', tabelle: GBAUP },
  { name: 'Wärmeerzeuger Heizung', merkmal: 'GWAERZH1/2', tabelle: GWAERZH },
  { name: 'Energie-/Wärmequelle', merkmal: 'GENH1/2, GENW1/2', tabelle: GENH },
  { name: 'Wärmeerzeuger Warmwasser', merkmal: 'GWAERZW1/2', tabelle: GWAERZW },
  { name: 'Wohnungsstatus', merkmal: 'WSTAT', tabelle: WSTAT },
  { name: 'Heizung (Kurzform, grundpass)', merkmal: 'GWAERZH1 + GENH1', tabelle: HEIZUNG_KURZ },
];
