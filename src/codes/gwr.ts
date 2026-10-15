/**
 * Codetabellen des eidg. Gebäude- und Wohnungsregisters (GWR), Merkmalskatalog 4.2.
 * Quelle: BFS, https://www.housing-stat.ch/de/help/42.html
 *
 * Regel aus CLAUDE.md: Nur mappen, was sicher ist. Unbekannte Codes kommen als `null` zurück
 * und der Rohcode wird separat als Fakt geführt. Nie raten.
 */

const t = (m: Record<number, string>) => (code: number | null | undefined): string | null =>
  code == null ? null : (m[code] ?? null);

/** GSTAT Gebäudestatus */
export const gebaeudeStatus = t({
  1001: 'projektiert',
  1002: 'bewilligt',
  1003: 'im Bau',
  1004: 'bestehend',
  1005: 'nicht nutzbar',
  1007: 'abgebrochen',
  1008: 'nicht realisiert',
});

/** GKAT Gebäudekategorie */
export const gebaeudeKategorie = t({
  1010: 'Provisorische Unterkunft',
  1020: 'Gebäude mit ausschliesslicher Wohnnutzung',
  1030: 'Wohngebäude mit Nebennutzung',
  1040: 'Gebäude mit teilweiser Wohnnutzung',
  1060: 'Gebäude ohne Wohnnutzung',
  1080: 'Sonderbau',
});

/** GKLAS Gebäudeklasse */
export const gebaeudeKlasse = t({
  1110: 'Gebäude mit einer Wohnung',
  1121: 'Gebäude mit zwei Wohnungen',
  1122: 'Gebäude mit drei oder mehr Wohnungen',
  1130: 'Wohngebäude für Gemeinschaften',
  1211: 'Hotelgebäude',
  1212: 'Andere Gebäude für kurzfristige Beherbergung',
  1220: 'Bürogebäude',
  1230: 'Gross- und Einzelhandelsgebäude',
  1231: 'Restaurants und Bars in Gebäuden ohne Wohnnutzung',
  1241: 'Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen',
  1242: 'Garagengebäude',
  1251: 'Industriegebäude',
  1252: 'Behälter, Silos und Lagergebäude',
  1261: 'Gebäude für Kultur- und Freizeitzwecke',
  1262: 'Museen und Bibliotheken',
  1263: 'Schul- und Hochschulgebäude, Forschungseinrichtungen',
  1264: 'Krankenhäuser und Facheinrichtungen des Gesundheitswesens',
  1265: 'Sporthallen',
  1271: 'Landwirtschaftliche Betriebsgebäude',
  1272: 'Kirchen und sonstige Kultgebäude',
  1273: 'Denkmäler oder unter Denkmalschutz stehende Bauwerke',
  1274: 'Sonstige Hochbauten, anderweitig nicht genannt',
  1275: 'Andere Gebäude für die kollektive Unterkunft',
  1276: 'Gebäude für die Tierhaltung',
  1277: 'Gebäude für den Pflanzenbau',
  1278: 'Andere landwirtschaftliche Gebäude',
});

/** Kurzform der Gebäudeklasse für Laien. */
export const gebaeudeKlasseKurz = t({
  1110: 'Einfamilienhaus',
  1121: 'Zweifamilienhaus',
  1122: 'Mehrfamilienhaus',
  1130: 'Wohnheim',
  1220: 'Bürogebäude',
  1230: 'Geschäftshaus',
  1242: 'Garage',
  1251: 'Industriegebäude',
  1252: 'Lagergebäude',
  1271: 'Landwirtschaftsgebäude',
});

/** GBAUP Bauperiode. Nur gesetzt, wenn das Baujahr (GBAUJ) nicht bekannt ist. */
export const bauperiode = t({
  8011: 'vor 1919',
  8012: '1919 bis 1945',
  8013: '1946 bis 1960',
  8014: '1961 bis 1970',
  8015: '1971 bis 1980',
  8016: '1981 bis 1985',
  8017: '1986 bis 1990',
  8018: '1991 bis 1995',
  8019: '1996 bis 2000',
  8020: '2001 bis 2005',
  8021: '2006 bis 2010',
  8022: '2011 bis 2015',
  8023: 'nach 2015',
});

/** Grobe Jahresmitte der Bauperiode, für Berechnungen. Kein Fakt, nur Hilfsgrösse. */
export const bauperiodeMitte = t({
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
});

/** GWAERZH1/2 Wärmeerzeuger Heizung */
export const waermeerzeugerHeizung = t({
  7400: 'Kein Wärmeerzeuger',
  7410: 'Wärmepumpe für ein Gebäude',
  7411: 'Wärmepumpe für mehrere Gebäude',
  7420: 'Thermische Solaranlage für ein Gebäude',
  7421: 'Thermische Solaranlage für mehrere Gebäude',
  7430: 'Heizkessel (generisch) für ein Gebäude',
  7431: 'Heizkessel (generisch) für mehrere Gebäude',
  7432: 'Heizkessel nicht kondensierend für ein Gebäude',
  7433: 'Heizkessel nicht kondensierend für mehrere Gebäude',
  7434: 'Heizkessel kondensierend für ein Gebäude',
  7435: 'Heizkessel kondensierend für mehrere Gebäude',
  7436: 'Ofen',
  7440: 'Wärmekraftkopplungsanlage für ein Gebäude',
  7441: 'Wärmekraftkopplungsanlage für mehrere Gebäude',
  7450: 'Elektrospeicher-Zentralheizung für ein Gebäude',
  7451: 'Elektrospeicher-Zentralheizung für mehrere Gebäude',
  7452: 'Elektro direkt',
  7460: 'Wärmetauscher (auch Fernwärme) für ein Gebäude',
  7461: 'Wärmetauscher (auch Fernwärme) für mehrere Gebäude',
  7499: 'Andere',
});

/** GENH1/2 und GENW1/2 Energie- oder Wärmequelle */
export const energietraeger = t({
  7500: 'Keine',
  7501: 'Luft',
  7510: 'Erdwärme (generisch)',
  7511: 'Erdwärmesonde',
  7512: 'Erdregister',
  7513: 'Wasser (Grundwasser, Oberflächenwasser, Abwasser)',
  7520: 'Gas',
  7530: 'Heizöl',
  7540: 'Holz (generisch)',
  7541: 'Holz (Stückholz)',
  7542: 'Holz (Pellets)',
  7543: 'Holz (Schnitzel)',
  7550: 'Abwärme (innerhalb des Gebäudes)',
  7560: 'Elektrizität',
  7570: 'Sonne (thermisch)',
  7580: 'Fernwärme (generisch)',
  7581: 'Fernwärme (Hochtemperatur)',
  7582: 'Fernwärme (Niedertemperatur)',
  7598: 'Unbestimmt',
  7599: 'Andere',
});

/** GWAERZW1/2 Wärmeerzeuger Warmwasser */
export const waermeerzeugerWarmwasser = t({
  7600: 'Kein Wärmeerzeuger für Warmwasser',
  7610: 'Wärmepumpe',
  7620: 'Thermische Solaranlage',
  7630: 'Heizkessel (generisch)',
  7632: 'Heizkessel nicht kondensierend',
  7634: 'Heizkessel kondensierend',
  7640: 'Wärmekraftkopplungsanlage',
  7650: 'Zentraler Elektroboiler',
  7651: 'Kleinboiler',
  7660: 'Wärmetauscher (auch Fernwärme)',
  7699: 'Andere',
});

/** WSTAT Wohnungsstatus */
export const wohnungStatus = t({
  3001: 'projektiert',
  3002: 'bewilligt',
  3003: 'im Bau',
  3004: 'bestehend',
  3005: 'nicht nutzbar',
  3007: 'aufgehoben',
  3008: 'nicht realisiert',
});

/** WSTWK Stockwerk. 3100 = Parterre, 3101.. = Obergeschosse, 3401.. = Untergeschosse. */
export function stockwerk(code: number | null | undefined): string | null {
  if (code == null) return null;
  if (code === 3100) return 'Parterre';
  if (code > 3100 && code < 3200) return `${code - 3100}. Stock`;
  if (code > 3400 && code < 3500) return `${code - 3400}. Untergeschoss`;
  return null;
}

/**
 * Lesbare Kurzfassung der Heizung für Laien. Kombiniert Erzeuger und Energieträger.
 * Beispiel: Heizkessel + Heizöl = "Ölheizung".
 */
export function heizungKurz(erzeuger: number | null | undefined, traeger: number | null | undefined): string | null {
  if (erzeuger == null && traeger == null) return null;
  if (erzeuger === 7400) return 'Keine Heizung';
  if (erzeuger != null && erzeuger >= 7410 && erzeuger <= 7411) {
    if (traeger === 7501) return 'Wärmepumpe (Luft)';
    if (traeger === 7511) return 'Wärmepumpe (Erdsonde)';
    if (traeger === 7510 || traeger === 7512) return 'Wärmepumpe (Erdwärme)';
    if (traeger === 7513) return 'Wärmepumpe (Wasser)';
    return 'Wärmepumpe';
  }
  if (erzeuger != null && erzeuger >= 7460 && erzeuger <= 7461) return 'Fernwärme';
  if (traeger != null && traeger >= 7580 && traeger <= 7582) return 'Fernwärme';
  if (traeger === 7530) return 'Ölheizung';
  if (traeger === 7520) return 'Gasheizung';
  if (traeger != null && traeger >= 7540 && traeger <= 7543) {
    if (traeger === 7542) return 'Pelletheizung';
    return 'Holzheizung';
  }
  if (traeger === 7560 || (erzeuger != null && erzeuger >= 7450 && erzeuger <= 7452)) return 'Elektroheizung';
  if (erzeuger != null && erzeuger >= 7420 && erzeuger <= 7421) return 'Solarthermie';
  return null;
}
