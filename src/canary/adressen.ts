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

/** Fakten, die sich an einem Gebäude praktisch nie ändern. Ändern sie sich, stimmt etwas nicht (oder das Register wurde korrigiert). */
export const STABILE_KEYS = ['gebaeude.egid', 'parzelle.egrid', 'parzelle.nummer', 'gebaeude.klasse_code', 'gebaeude.bauperiode_code', 'gebaeude.baujahr', 'adresse.bfs_nr'];

/** Latenz, ab der ein Adapter als langsam gemeldet wird. */
export const LATENZ_WARN_MS = 5000;
