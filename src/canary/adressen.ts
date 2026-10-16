/**
 * Die goldenen Adressen. Fünf Gebäude in drei Kantonen, Stadt und Land, die der Canary stündlich
 * durch alle Adapter schickt. Keine Personendaten: alles öffentliche Gebäude oder Geschäftsadressen.
 *
 * Beim ersten Lauf wird pro Adresse eine Baseline gespeichert (stabile Fakten). Danach meldet der Canary,
 * wenn ein Adapter ausfällt, das Schema driftet, die Antwort leer ist, die Latenz steigt oder sich ein
 * stabiler Fakt ändert (Baujahr ändert sich nicht einfach so).
 */
export type GoldeneAdresse = { name: string; adresse: string; kanton: string };

export const GOLDENE_ADRESSEN: GoldeneAdresse[] = [
  { name: 'Wabern EFH (Beispielobjekt)', adresse: 'Maygutstrasse 26, 3084 Wabern', kanton: 'BE' },
  { name: 'Baden Büro', adresse: 'Rütistrasse 1, 5400 Baden', kanton: 'AG' },
  { name: 'Klingnau', adresse: 'Wiesenweg 6, 5313 Klingnau', kanton: 'AG' },
  { name: 'Zürich City', adresse: 'Bahnhofstrasse 1, 8001 Zürich', kanton: 'ZH' },
  { name: 'Winterthur ZHAW', adresse: 'Technikumstrasse 9, 8400 Winterthur', kanton: 'ZH' },
];

/**
 * Eine öffentliche Referenzadresse pro Kanton (Rathaus, Regierungsgebäude, Stadthaus des Hauptorts, kein Wohnhaus) für den
 * ÖREB-Kataster: Inventar der kantonalen Dienste (16.10.2026), Fixtures test/fixtures/oereb-<kanton>.json bzw. .xml, Live-Test und der
 * tägliche Kantons-Canary (src/canary/kantone.ts, nur geocode, gwr und oereb). Getrennt von den goldenen Adressen: keine Baseline,
 * kein Drift. Reihenfolge amtlich. Kantone ohne nutzbaren Dienst (kantone.ts, kein_dienst) stehen trotzdem hier, damit der Canary
 * meldet, sobald sich dort etwas ändert.
 * Ausnahme SO: Der Kataster des Kantons führt die Nutzungsplanung der Stadt Solothurn noch als Thema ohne Daten (Rathaus,
 * Barfüssergasse 24, und Hauptgasse 69, geprüft 16.10.2026), darum das Stadthaus Olten (GWR 1220 Bürogebäude), wo die Zone kommt.
 */
export const KANTONS_ADRESSEN: GoldeneAdresse[] = [
  { name: 'Zürich Stadthaus', adresse: 'Stadthausquai 17, 8001 Zürich', kanton: 'ZH' },
  { name: 'Bern Rathaus', adresse: 'Rathausplatz 2, 3011 Bern', kanton: 'BE' },
  { name: 'Luzern Rathaus', adresse: 'Kornmarkt 3, 6004 Luzern', kanton: 'LU' },
  { name: 'Altdorf Rathaus', adresse: 'Rathausplatz 1, 6460 Altdorf', kanton: 'UR' },
  { name: 'Schwyz Rathaus', adresse: 'Hauptplatz 1, 6430 Schwyz', kanton: 'SZ' },
  { name: 'Sarnen Rathaus', adresse: 'St. Antonistrasse 4, 6060 Sarnen', kanton: 'OW' },
  { name: 'Stans Rathaus', adresse: 'Dorfplatz 2, 6370 Stans', kanton: 'NW' },
  { name: 'Glarus Gemeindehaus', adresse: 'Gemeindehausplatz 5, 8750 Glarus', kanton: 'GL' },
  { name: 'Zug Regierungsgebäude', adresse: 'Seestrasse 2, 6300 Zug', kanton: 'ZG' },
  { name: 'Fribourg Hôtel de Ville', adresse: "Place de l'Hôtel-de-Ville 3, 1700 Fribourg", kanton: 'FR' },
  { name: 'Olten Stadthaus', adresse: 'Dornacherstrasse 1, 4600 Olten', kanton: 'SO' },
  { name: 'Basel Rathaus', adresse: 'Marktplatz 9, 4001 Basel', kanton: 'BS' },
  { name: 'Liestal Regierungsgebäude', adresse: 'Rathausstrasse 2, 4410 Liestal', kanton: 'BL' },
  { name: 'Schaffhausen Regierungsgebäude', adresse: 'Beckenstube 7, 8200 Schaffhausen', kanton: 'SH' },
  { name: 'Herisau Regierungsgebäude', adresse: 'Obstmarkt 1, 9100 Herisau', kanton: 'AR' },
  { name: 'Appenzell Rathaus', adresse: 'Marktgasse 2, 9050 Appenzell', kanton: 'AI' },
  { name: 'St. Gallen Regierungsgebäude', adresse: 'Klosterhof 1, 9000 St. Gallen', kanton: 'SG' },
  { name: 'Chur Rathaus', adresse: 'Poststrasse 33, 7000 Chur', kanton: 'GR' },
  { name: 'Aarau Rathaus', adresse: 'Rathausgasse 1, 5000 Aarau', kanton: 'AG' },
  { name: 'Frauenfeld Rathaus', adresse: 'Rathausplatz 1, 8500 Frauenfeld', kanton: 'TG' },
  { name: 'Bellinzona Palazzo Civico', adresse: 'Piazza Nosetto 5, 6500 Bellinzona', kanton: 'TI' },
  { name: 'Lausanne Hôtel de Ville', adresse: 'Place de la Palud 2, 1003 Lausanne', kanton: 'VD' },
  { name: 'Sion Hôtel de Ville', adresse: 'Rue du Grand-Pont 12, 1950 Sion', kanton: 'VS' },
  { name: 'Neuchâtel Hôtel de Ville', adresse: "Rue de l'Hôtel-de-Ville 1, 2000 Neuchâtel", kanton: 'NE' },
  { name: 'Genève Hôtel de Ville', adresse: "Rue de l'Hôtel-de-Ville 2, 1204 Genève", kanton: 'GE' },
  { name: 'Delémont Hôtel du Parlement', adresse: "Rue de l'Hôpital 2, 2800 Delémont", kanton: 'JU' },
];

/** Fakten, die sich an einem Gebäude praktisch nie ändern. Ändern sie sich, stimmt etwas nicht (oder das Register wurde korrigiert). */
export const STABILE_KEYS = ['gebaeude.egid', 'parzelle.egrid', 'parzelle.nummer', 'gebaeude.klasse_code', 'gebaeude.bauperiode_code', 'gebaeude.baujahr', 'adresse.bfs_nr'];

/** Latenz, ab der ein Adapter als langsam gemeldet wird. */
export const LATENZ_WARN_MS = 5000;
