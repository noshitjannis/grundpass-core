/**
 * Kantonstabelle für den ÖREB-Kataster (Kataster der öffentlich-rechtlichen Eigentumsbeschränkungen).
 *
 * Jeder Kanton betreibt einen eigenen Webservice nach der Bundesnorm «ÖREB-Webservice (Aufruf eines Auszugs)»,
 * Version extract-2.0 (Transferstruktur OeREBKRMtrsfr_V2_0). `<base>/versions/json` nennt die Basis selbst,
 * `<base>/extract/json?EGRID=<EGRID>` liefert den Datenextrakt ohne Geometrie. Alle drei Kantone liefern JSON im
 * openoereb-Schema, darum braucht es keinen XML-Parser. Live geprüft am 15.10.2026 (versions, capabilities, extract, pdf).
 *
 * Grundnutzung erkennen: Unter dem Thema ch.Nutzungsplanung stehen neben der Grundnutzung (Wohnzone, Kernzone …) oft
 * überlagernde Einträge (Gestaltungsplan, Kernzonenplan, Baumschutz). Welche Einträge Grundnutzung sind, zeigt jeder
 * Kanton anders:
 *  - BE kennzeichnet sie mit Theme.SubCode «ch.NutzungsplanungGrundnutzung» (universelle Regel, gilt überall).
 *  - ZH und AG setzen am Eintrag keinen SubCode. Ihr TypeCode folgt der Code-Systematik des minimalen Geodatenmodells
 *    Nutzungsplanung des Bundes (ARE, Katalog Hauptnutzung_CH): 1x Bauzonen (11 Wohn-, 12 Arbeits-, 13 Misch-,
 *    14 Zentrums-, 15 Zonen für öffentliche Nutzungen …), 2x Landwirtschafts-, 3x Schutz-, 4x weitere Zonen.
 *    5x und 6x sind kantonale Codes für überlagernde Festlegungen und Sondernutzungspläne (61 Gestaltungsplan).
 *    ZH stellt ein «C» voran (C150101 Zone für öffentliche Bauten, C610102 Kantonaler Gestaltungsplan), AG nicht
 *    (145101 Kernzone, 121101 Arbeitszone, 611201_2897 Gestaltungsplan). Belegt an vier Extracts (test/fixtures/oereb-*).
 *    Weil das eine Einordnung über die Code-Systematik ist, tragen zone.*-Fakten dort Confidence 0.95, in BE 1.
 */
export type OerebKanton = {
  kanton: string;
  /** serviceEndpointBase laut `<base>/versions/json`. */
  base: string;
  format: 'json';
  /** TypeCode-Muster für Grundnutzung, wenn der Kanton sie nicht per SubCode kennzeichnet. */
  grundnutzungTypeCode?: RegExp;
  /** Confidence der zone.*-Fakten. */
  zoneConfidence: number;
};

/** SubCode-Regel für Grundnutzung, kantonsübergreifend (BE: ch.NutzungsplanungGrundnutzung, ZH in ConcernedTheme: ch.ZH.NutzungsplanungGrundnutzung). */
export const GRUNDNUTZUNG_SUBCODE = /Grundnutzung/;

export const OEREB_KANTONE: Record<string, OerebKanton> = {
  AG: { kanton: 'AG', base: 'https://api.geo.ag.ch/v2/oereb', format: 'json', grundnutzungTypeCode: /^[1-4]\d{3,}/, zoneConfidence: 0.95 },
  ZH: { kanton: 'ZH', base: 'https://maps.zh.ch/oereb/v2', format: 'json', grundnutzungTypeCode: /^C[1-4]\d{3,}/, zoneConfidence: 0.95 },
  // Offiziell dokumentierter Host des Amts für Geoinformation (www.oereb2.apps.be.ch); www.oereb.apps.be.ch antwortet identisch.
  BE: { kanton: 'BE', base: 'https://www.oereb2.apps.be.ch', format: 'json', zoneConfidence: 1 },
};

export const OEREB_KANTONE_LISTE = Object.keys(OEREB_KANTONE);

export function oerebExtractUrl(k: OerebKanton, egrid: string, format: 'json' | 'xml' | 'pdf' = k.format): string {
  return `${k.base}/extract/${format}?EGRID=${encodeURIComponent(egrid)}`;
}
