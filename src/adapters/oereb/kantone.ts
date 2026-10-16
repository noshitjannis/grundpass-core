/**
 * Kantonstabelle für den ÖREB-Kataster (Kataster der öffentlich-rechtlichen Eigentumsbeschränkungen).
 *
 * Jeder Kanton betreibt einen eigenen Webservice nach der Weisung «ÖREB-Webservice (Aufruf eines Auszugs)», Version
 * extract-2.0 (Transferstruktur OeREBKRMtrsfr_V2_0). `<base>/versions/json` nennt die Basis selbst,
 * `<base>/extract/json?EGRID=<EGRID>&GEOMETRY=false&WITHIMAGES=false&LANG=<sprache>` liefert den Datenextrakt ohne
 * Geometrie und ohne Bilder (beides erlaubt die Weisung). Die Basis stammt aus dem swisstopo-Layer
 * `ch.swisstopo-vd.stand-oerebkataster` (Attribut `oereb_extract_url`, alles vor `/extract/`), bestätigt über `versions/json`.
 *
 * Inventar vom 16.10.2026 an je einer öffentlichen Referenzadresse pro Kanton (src/canary/adressen.ts, KANTONS_ADRESSEN).
 * Drei JSON-Formen sind im Umlauf, der Adapter erkennt sie an der Hülle (oereb.ts, erkenneForm):
 *  - openoereb (pyramid_oereb und Verwandte): `GetExtractByIdResponse.extract` (ZH: `Extract`, `Theme.code` klein).
 *  - GeoShop (Infogrips, UR, OW, NW): XML mechanisch nach JSON (`?xml`, `@xmlns`, `{LocalisedText: …}`-Hüllen, Zahlen als
 *    Strings); die Zonenbezeichnung steht in `Map.OtherLegend` unter demselben TypeCode, die Legende am Eintrag ist der Layer-Titel.
 *  - .NET-Serialisierung (LU: `{schemaLocation, Extract}`; FR, VD, GE «RdppfSVC.svc»: `{Item: …}`): Feldnamen von
 *    LocalisedText-Listen gehen verloren (`LocalisedText` statt LegendText, TextAtWeb, OfficeAtWeb), Sprache und Lawstatus
 *    als Zahl (0 = de bzw. inForce), Datum als `/Date(ms)/`.
 * Nur XML liefern SO und SH (extract/json: 415 bzw. 500); VS antwortet nicht; NE gibt JSON und XML nur registrierten Nutzern
 * (403). Diese vier sind `kein_dienst`: der Adapter läuft dort nicht (ausser_kanton), die App sagt, was fehlt. GR lieferte am
 * Vormittag des 16.10.2026 ein TLS-Zertifikat für *.gr.ch (deckt oereb.geo.gr.ch nicht ab), am Mittag eines für *.geo.gr.ch;
 * seither angebunden.
 *
 * Grundnutzung erkennen (Regelkette, Reihenfolge immer gleich, pro Kanton nur die Muster):
 *  1. Kennzeichnung durch den Kanton: `Theme.SubCode` oder der Subthema-Text (`Theme.Text`, bei GeoShop der Layer-Titel) passt
 *     auf `grundnutzungRegel.kennzeichnung` (Standard GRUNDNUTZUNG_KENNZEICHNUNG) → zone.erkennung «subcode», Confidence 1.
 *     Beobachtet: BE `ch.NutzungsplanungGrundnutzung…`, TG `ch.TG.NutzungsplanungGrundnutzung`, FR/VD `ch.XX.Affectationsprimaires`,
 *     GE `ch.GE.Zonedaffectationprimaire`, ZH und GL im Theme.Text («…: Grundnutzungen» / «…: Grundnutzung»), UR/OW/NW im
 *     Layer-Titel («Grundnutzung (Sarnen)»), BS mit eigenem Muster (`ch.BS.Zonenplan`), TI mit eigenem Muster («Piano zone»).
 *  2. `TypeCode` passt auf `grundnutzungRegel.typeCode` → «typecode», Confidence 0.95. Code-Systematik des minimalen
 *     Geodatenmodells Nutzungsplanung (ARE, Katalog Hauptnutzung_CH): 1x Bauzonen (11 Wohn-, 12 Arbeits-, 13 Misch-,
 *     14 Zentrums-, 15 Zonen für öffentliche Nutzungen …), 2x Landwirtschafts-, 3x Schutz-, 4x weitere Zonen; 5x und 6x sind
 *     überlagernde Festlegungen und Sondernutzungspläne. AG 145101, ZG 150101, SG 1504001, ZH mit «C» davor (C150101);
 *     JU kennzeichnet im TypeCode (`r73_affectations_primaires_…`).
 *  3. Fallback im Adapter: unter ch.Nutzungsplanung der Eintrag mit dem grössten Flächenanteil → «flaechenanteil», Confidence 0.8,
 *     Fakt zone.hinweis. Gilt für LU, SZ, BL, AR, AI (Kataster kennzeichnet nichts, TypeCodes ohne erkennbare Systematik).
 *  Keine Beschränkung ch.Nutzungsplanung → keine Zone (Lücke), nie geraten.
 *
 * Sprache: `sprache` ist LANG der Anfrage und die erste Wahl beim Lesen mehrsprachiger Texte (Reihenfolge Kantonssprache, de, fr,
 * it, rm, erster Eintrag). FR und VS fragen de an und fallen auf fr zurück, BE de, GR de, TI it. Zonenbezeichnungen bleiben in der
 * Sprache des Dienstes.
 */
export type OerebSprache = 'de' | 'fr' | 'it';
export type OerebStatus = 'verifiziert' | 'experimentell' | 'kein_dienst';

export type GrundnutzungRegel = {
  /** Themencode der Nutzungsplanung. Standard NUTZUNGSPLANUNG_THEMA (Bundesthema ch.Nutzungsplanung); GR führt den Zonenplan als kantonales Thema. */
  thema?: RegExp;
  /** Regel 1: Muster auf SubCode oder Subthema-Text. Fehlt es, gilt GRUNDNUTZUNG_KENNZEICHNUNG. */
  kennzeichnung?: RegExp;
  /** Regel 2: Muster auf den TypeCode. Fehlt es, wird Regel 2 übersprungen. */
  typeCode?: RegExp;
};

export type OerebKanton = {
  kanton: string;
  /** serviceEndpointBase laut `<base>/versions/json`, ohne Schrägstrich am Ende. */
  base: string;
  sprache: OerebSprache;
  grundnutzungRegel: GrundnutzungRegel;
  status: OerebStatus;
  /** Tag der letzten Live-Prüfung (ISO-Datum). */
  geprueft_am: string;
  /** Form des Dienstes, Besonderheiten, bei kein_dienst: was genau fehlt. Die App zeigt die Notiz bei kein_dienst. */
  notizen: string;
};

/** Das Bundesthema der Nutzungsplanung; alle Kantone ausser GR führen die Zone darunter. */
export const NUTZUNGSPLANUNG_THEMA = /^ch\.Nutzungsplanung$/;

/** Regel 1, kantonsübergreifend: de «Grundnutzung» (BE, TG, ZH, GL, UR, OW, NW), fr «affectation(s) primaire(s)» (FR, VD, GE). it nicht beobachtet. */
export const GRUNDNUTZUNG_KENNZEICHNUNG = /Grundnutzung|affectations?\s*primaires?/i;

/** ARE-Systematik: 1x bis 4x sind Grundnutzung, 5x und 6x überlagernd. Mindestens vierstellig, damit kurze Codes nicht zufällig passen. */
const ARE_TYPECODE = /^[1-4]\d{3,}/;

/** Der Text, den der Adapter als zone.hinweis setzt, wenn Regel 3 greift. */
export const GRUNDNUTZUNG_HINWEIS = 'Grundnutzung aus dem grössten Flächenanteil abgeleitet, nicht aus einer Kennzeichnung des Kantons';

export const OEREB_KANTONE: Record<string, OerebKanton> = {
  ZH: {
    kanton: 'ZH',
    base: 'https://maps.zh.ch/oereb/v2',
    sprache: 'de',
    grundnutzungRegel: { typeCode: /^C[1-4]\d{3,}/ },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb, Hülle «Extract», Theme.code klein. Theme.Text «…: Grundnutzungen» greift als Regel 1, der TypeCode (C130701) als Regel 2. Stadt und Kanton laufen über dieselbe Basis.',
  },
  BE: {
    kanton: 'BE',
    base: 'https://www.oereb2.apps.be.ch',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. SubCode ch.NutzungsplanungGrundnutzung (Köniz), in der Stadt Bern ch.NutzungsplanungGrundnutzungNutzungszonen und …Bauklassen. Datenstand UpdateDateCS ist der letzte Import. www.oereb.apps.be.ch antwortet identisch.',
  },
  LU: {
    kanton: 'LU',
    base: 'https://svc.geo.lu.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: '.NET-Form ohne Hülle ({schemaLocation, Extract}), Legende als LocalisedText, Flächen als Strings. Keine Kennzeichnung der Grundnutzung (TypeCodes 3900 Weitere Mischzone, 7010 Ortsbildschutzzone, beide 100 %): Regel 3. Antwort dauert rund 10 s.',
  },
  UR: {
    kanton: 'UR',
    base: 'https://prozessor-oereb.ur.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'GeoShop (Lisag AG). Layer-Titel «… Nutzungsplanung Grundnutzung Altdorf» greift als Regel 1, Zonenbezeichnung aus Map.OtherLegend. Eine Zone kommt in mehreren Teilflächen, der Adapter summiert gleiche TypeCodes. Antwort dauert rund 12 s.',
  },
  SZ: {
    kanton: 'SZ',
    base: 'https://map.geo.sz.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Keine Kennzeichnung, TypeCode mit Punkten (14.1.1 Kernzone A), an der Referenzparzelle nur ein Eintrag: Regel 3.',
  },
  OW: {
    kanton: 'OW',
    base: 'https://www.gis-daten.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'GeoShop (GIS Daten AG, gleiche Basis wie NW). Layer-Titel «Grundnutzung (Sarnen)» greift als Regel 1, Zonenbezeichnung aus Map.OtherLegend. Laufende Änderungen als eigene Themen ch.NutzungsplanungAenderungOhneVorwirkung.',
  },
  NW: {
    kanton: 'NW',
    base: 'https://www.gis-daten.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'GeoShop (GIS Daten AG, gleiche Basis wie OW). Layer-Titel «Grundnutzung Stans» greift als Regel 1, Zonenbezeichnung aus Map.OtherLegend.',
  },
  GL: {
    kanton: 'GL',
    base: 'https://map.geo.gl.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Theme.Text «Nutzungsplanung (kantonal/kommunal): Grundnutzung» greift als Regel 1; Überlagerungen und Linien sind eigene Themen ch.GL.*. versions/json nennt die Basis mit http, der Dienst läuft über https. Erster Abruf nach Ruhe dauerte 58 s (Kaltstart), danach 4 s.',
  },
  ZG: {
    kanton: 'ZG',
    base: 'https://oereb.zg.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: { typeCode: ARE_TYPECODE },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. ARE-Systematik im TypeCode (150101 Zone des öffentlichen Interesses, 512001 Ortsbildschutz, 532201 Gefahrenzone, 691001 Fundstätte): Regel 2. Der swisstopo-Layer nennt /ors als Basis, versions/json /oereb; beide liefern dasselbe.',
  },
  FR: {
    kanton: 'FR',
    base: 'https://maps.fr.ch/RDPPF_ws/RdppfSVC.svc',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: '.NET-Form ({Item: …}), Sprache und Lawstatus als Zahl, Datum als /Date(ms)/. SubCode ch.FR.Affectationsprimaires greift als Regel 1. LANG=de liefert deutsche Themen- und Legendentexte, Zonenbezeichnungen bleiben französisch (Fallback fr).',
  },
  SO: {
    kanton: 'SO',
    base: 'https://geo.so.ch/api/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'kein_dienst',
    geprueft_am: '2026-10-16',
    notizen: 'Der Dienst liefert nur XML: extract/json antwortet 415 Unsupported Media Type, versions/json 500; extract/xml und versions/xml funktionieren (126 KB). Ein XML-Pfad fehlt im Adapter.',
  },
  BS: {
    kanton: 'BS',
    base: 'https://api.oereb.bs.ch',
    sprache: 'de',
    grundnutzungRegel: { kennzeichnung: /^ch\.BS\.Zonenplan$/ },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Grundnutzung ist der Eintrag mit SubCode ch.BS.Zonenplan (TypeCode z.B. SU), der Wohnanteilplan (ch.2701.Wohnanteilplan) ist überlagernd: eigenes Muster für Regel 1.',
  },
  BL: {
    kanton: 'BL',
    base: 'https://oereb.geo.bl.ch',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Keine Kennzeichnung, TypeCodes ohne ARE-Systematik (104000 Kernzone, 257003 Bauten der Schutzkategorie A): Regel 3.',
  },
  SH: {
    kanton: 'SH',
    base: 'https://oereb.geo.sh.ch',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'kein_dienst',
    geprueft_am: '2026-10-16',
    notizen: 'Gleiche Software wie SO, nur XML: extract/json und versions/json antworten 500 (Server Error), extract/xml und versions/xml funktionieren (128 KB). Ein XML-Pfad fehlt im Adapter.',
  },
  AR: {
    kanton: 'AR',
    base: 'https://oereb.ar.ch/ktar/wsgi/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. TypeCode ist kein Code, sondern der String `{"de": "Wohnzone W2"}` (JSON-Objekt im String; der Adapter nimmt den Text). Keine Kennzeichnung: Regel 3. Viele Teilflächen pro Zone (21 Einträge, 16 Lärmstufen), der Adapter summiert. versions/json nennt einen internen Host (pyramid-oereb-ar.live.geoportal.ch), die öffentliche Basis ist oereb.ar.ch. Extract 480 KB.',
  },
  AI: {
    kanton: 'AI',
    base: 'https://oereb.ai.ch/ktai/wsgi/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Alle Einträge tragen SubCode ch.NutzungsplanungKommunal, Grundnutzung (Oe) und Überlagerungen (Ortsbildschutz, Archäologie) sind nicht unterscheidbar, TypeCodes sind Kürzel: Regel 3. versions/json nennt einen internen Host, die öffentliche Basis ist oereb.ai.ch.',
  },
  SG: {
    kanton: 'SG',
    base: 'https://oereb.geo.sg.ch/ktsg/wsgi/oereb',
    sprache: 'de',
    grundnutzungRegel: { typeCode: ARE_TYPECODE },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. ARE-Systematik siebenstellig (1504001 Zone für öffentliche Bauten, 5903001 bestimmte Nutzungsart Art. 28oct): Regel 2. versions/json nennt einen internen Host, die öffentliche Basis ist oereb.geo.sg.ch.',
  },
  GR: {
    kanton: 'GR',
    base: 'https://oereb.geo.gr.ch/oereb',
    sprache: 'de',
    grundnutzungRegel: { thema: /^ch\.GR\.NutzungsplanungZpGgp$/, typeCode: /^\d{4}[A-Z]-f[14]\d{4}-/ },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Kein Bundesthema ch.Nutzungsplanung: Der Zonenplan ist das kantonale Thema ch.GR.NutzungsplanungZpGgp (Genereller Erschliessungsplan ch.GR.NutzungsplanungGep, Folgeplanungen ch.GR.NutzungsplanungFp sind eigene Themen). TypeCode <BFS>F-f<Code>-…: Grundnutzung mit f1xxxx (Zentrums-, Wohnzonen, Zone für öffentliche Bauten) und f4xxxx (übriges Gemeindegebiet), überlagernd f2xxxx (Schutz), f5xxxx (Quartierplan), f8xxxx (Gefahren, Archäologie), belegt an sechs Parzellen in Chur, St. Moritz und Thusis; f3xxxx nicht beobachtet, dann greift Regel 3. Zertifikat: am 16.10.2026 vormittags für *.gr.ch (deckte den Host nicht ab), mittags für *.geo.gr.ch.',
  },
  AG: {
    kanton: 'AG',
    base: 'https://api.geo.ag.ch/v2/oereb',
    sprache: 'de',
    grundnutzungRegel: { typeCode: ARE_TYPECODE },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. ARE-Systematik im TypeCode (145101 Kernzone, 121101 Arbeitszone, 611201 Gestaltungsplan, 8291 Denkmalschutzobjekt als Punkt): Regel 2.',
  },
  TG: {
    kanton: 'TG',
    base: 'https://map.geo.tg.ch/services/oereb',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. SubCode ch.TG.NutzungsplanungGrundnutzung greift als Regel 1; Frauenfeld kennzeichnet auch die Ortsbildschutzzone so (TypeCode leer), beide zu 100 %.',
  },
  TI: {
    kanton: 'TI',
    base: 'https://crdpp.geo.ti.ch/oereb2',
    sprache: 'it',
    grundnutzungRegel: { kennzeichnung: /Piano (delle )?zone\b/i },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb, alles unter ch.Nutzungsplanung mit einem SubCode pro Plan (ch.TI.ch08d8qu…), Theme.Text «PR <Gemeinde> / Piano zone», «/ Piano traffico», «/ Piano paesaggio» …: eigenes Muster «Piano zone» für Regel 1. Bellinzona Altstadt: «Comparto soggetto a Piano Particolareggiato» (300 KB Extract).',
  },
  VD: {
    kanton: 'VD',
    base: 'https://www.rdppf.vd.ch/ws/RdppfSVC.svc',
    sprache: 'fr',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: '.NET-Form wie FR ({Item: …}). SubCode ch.VD.Affectationsprimaires greift als Regel 1. versions/json schreibt «2.0» statt «extract-2.0». Anteile mit vielen Dezimalen (99.948…), der Adapter rundet auf eine.',
  },
  VS: {
    kanton: 'VS',
    base: 'https://rdppf.apps.vs.ch',
    sprache: 'de',
    grundnutzungRegel: {},
    status: 'kein_dienst',
    geprueft_am: '2026-10-16',
    notizen: 'rdppf.apps.vs.ch antwortet nicht: versions/json und / laufen in den Timeout (60 s, auch mit HTTP/1.1 und Browser-User-Agent), HTTP/2 bricht nach 79 s mit INTERNAL_ERROR ab. DNS zeigt auf csvslb-oinfra.vs.ch. Später erneut prüfen.',
  },
  NE: {
    kanton: 'NE',
    base: 'https://sitn.ne.ch/crdppf',
    sprache: 'fr',
    grundnutzungRegel: {},
    status: 'kein_dienst',
    geprueft_am: '2026-10-16',
    notizen: 'extract/json und extract/xml antworten 403 «Extract permissions»: Der Zugang ist registrierten Nutzern vorbehalten, Anmeldung über sitn@ne.ch. versions/json ist offen (extract-2.0).',
  },
  GE: {
    kanton: 'GE',
    base: 'https://ge.ch/terecadastrews/RdppfSVC.svc',
    sprache: 'fr',
    grundnutzungRegel: {},
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: '.NET-Form wie FR ({Item: …}). SubCode ch.GE.Zonedaffectationprimaire greift als Regel 1 (Zone 1); die Synthese ch.GE.Zonesdaffectationsynthse mit derselben Zone zählt als überlagernd. versions/json schreibt «2.0».',
  },
  JU: {
    kanton: 'JU',
    base: 'https://geo.jura.ch/crdppf_server',
    sprache: 'fr',
    grundnutzungRegel: { typeCode: /^r73_affectations_primaires_/ },
    status: 'verifiziert',
    geprueft_am: '2026-10-16',
    notizen: 'openoereb. Kein SubCode, die Kennzeichnung steckt im TypeCode (r73_affectations_primaires_Centre_CA, r73_zones_superpose_…, r73_contenus_ponctuels_…): Regel 2. Lärmstufe als «Degré de sensibilité au bruit III» / DS_III.',
  },
};

/** Alle 26 Kantone in amtlicher Reihenfolge. */
export const OEREB_KANTONE_ALLE = Object.keys(OEREB_KANTONE);

/** Kantone, in denen der Adapter läuft (verifiziert oder experimentell). Steht im Manifest als `cantons`. */
export const OEREB_KANTONE_ANGEBUNDEN = OEREB_KANTONE_ALLE.filter((k) => OEREB_KANTONE[k]!.status !== 'kein_dienst');

/** Zählung für Doku und App («ÖREB-Kataster in 22 Kantonen»), nie hartcodiert. */
export function oerebKantoneZaehlung(): { total: number; angebunden: number; verifiziert: number; experimentell: number; kein_dienst: number } {
  const z = { total: OEREB_KANTONE_ALLE.length, angebunden: 0, verifiziert: 0, experimentell: 0, kein_dienst: 0 };
  for (const k of Object.values(OEREB_KANTONE)) {
    z[k.status]++;
    if (k.status !== 'kein_dienst') z.angebunden++;
  }
  return z;
}

/**
 * Extract-URL. JSON (und XML) ohne Geometrie und Bilder, in der Kantonssprache; der PDF-Auszug ist der amtliche und kommt ohne Parameter.
 */
export function oerebExtractUrl(k: OerebKanton, egrid: string, format: 'json' | 'xml' | 'pdf' = 'json'): string {
  if (format === 'pdf') return `${k.base}/extract/pdf?EGRID=${encodeURIComponent(egrid)}`;
  const p = new URLSearchParams({ EGRID: egrid, GEOMETRY: 'false', WITHIMAGES: 'false', LANG: k.sprache });
  return `${k.base}/extract/${format}?${p}`;
}
