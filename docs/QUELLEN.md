# grundpass-core · Quellen

Jede Quelle: Endpoint, was wir lesen, was daraus wird, Lizenz, TTL, Status. Status `verifiziert` heisst:
gegen eine echte Antwort gebaut, Fixture in `test/fixtures/`, Unit-Test grün. `experimentell` heisst: Form noch nicht live bestätigt.

Alle Quellen laufen über die Bundes-Geodateninfrastruktur (geo.admin.ch), ohne API-Key, mit Quellenangabe als Pflicht.
Datensätze und genaue Lizenztexte: opendata.swiss bzw. die Layer-Metadaten unter `https://api3.geo.admin.ch/rest/services/api/MapServer/<layer>`.

Allgemeine Erkenntnisse (15.10.2026):
- `SearchServer` liefert `attrs.y` = Ost, `attrs.x` = Nord. Vertauscht gegenüber LV95-Konvention.
- `identify` mit `tolerance=0` braucht weder `imageDisplay` noch `mapExtent`. Mit Toleranz > 0 beides.
- Reine Raster-Layer sind per `identify` nicht abfragbar (4xx). Nur WMS GetFeatureInfo.
- Bei Fehlern antwortet api3 teils mit HTML, nicht JSON. Der Client wirft dann `SchemaDriftError`.

---

## geocode · Adresse → Gebäude

| | |
|---|---|
| Datenhalter | swisstopo / BFS (amtliches Gebäudeadressverzeichnis) |
| Endpoint | `GET https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=…&type=locations&origins=address&sr=2056&limit=5` |
| braucht | `adresse` |
| liefert Keys | `egid` (aus `featureId` "EGID_EDID"), `lv95` (e = attrs.y, n = attrs.x) |
| Fakten | `adresse.label`, `adresse.eingabe`, `adresse.koordinaten.e/n/lat/lon`, `gebaeude.egid` |
| TTL | 30 Tage |
| Status | verifiziert · Fixture `searchserver-wabern.json` |

Gelesene Felder: `results[].attrs.{label, detail, origin, featureId, x, y, lat, lon, num}`. Erster Treffer mit `origin=address`. Kein Treffer → `EmptyResultError`.

---

## gwr · Gebäude- und Wohnungsregister

| | |
|---|---|
| Datenhalter | BFS |
| Endpoint | `GET https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.bfs.gebaeude_wohnungs_register&searchField=egid&searchText=<EGID>&returnGeometry=false` |
| braucht | `egid` |
| liefert Keys | `egrid`, `lv95_bau` (gkode/gkodn), `bfs_nr` (ggdenr), `kanton` (gdekt), `parzelle_nr` (lparz) |
| source_date | `gexpdat` (Exportdatum des Registers) |
| TTL | 30 Tage |
| Status | verifiziert · Fixture `gwr-1271632.json` |

**Gelesene Felder und was daraus wird**

| GWR-Feld | Fakt | Bemerkung |
|---|---|---|
| strname_deinr, dplz4, dplzname, ggdename, ggdenr, gdekt | `adresse.strasse_nr`, `.plz`, `.ort`, `.gemeinde`, `.bfs_nr`, `.kanton` | |
| gstat | `gebaeude.status` + `_code` | 1001 projektiert … 1004 bestehend … 1007 abgebrochen |
| gkat | `gebaeude.kategorie` + `_code` | 1020 reine Wohnnutzung, 1030 Wohnen mit Nebennutzung, 1040 teilweise Wohnen, 1060 ohne Wohnen |
| gklas | `gebaeude.klasse`, `.klasse_kurz`, `_code` | 1110 EFH, 1121 2 Wohnungen, 1122 MFH … |
| gbauj | `gebaeude.baujahr` | oft null |
| gbaup | `gebaeude.bauperiode` + `_code`, `bauperiode_mitte` (nur wenn baujahr fehlt) | 8011 vor 1919 … 8023 nach 2015 |
| gabbj | `gebaeude.abbruchjahr` | |
| garea | `gebaeude.grundflaeche_m2` | |
| gvol | `gebaeude.volumen_m3` | oft null |
| gebf | `gebaeude.energiebezugsflaeche_m2` | oft null |
| gastw | `gebaeude.geschosse` | |
| ganzwhg | `gebaeude.wohnungen_anzahl` | |
| gkode, gkodn | `gebaeude.koordinaten.e/n` | Gebäudepunkt LV95 |
| gwaerzh1, genh1, gwaerdath1 | `gebaeude.heizung.erzeuger`, `.energietraeger`, `.kurz`, `.stand` + Codes | 7430+7530 = Ölheizung |
| gwaerzh2, genh2 | `gebaeude.heizung2.*` | nur wenn gesetzt |
| gwaerzw1, genw1 | `gebaeude.warmwasser.erzeuger`, `.energietraeger` | |
| egrid, lparz | `parzelle.egrid`, `parzelle.nummer` | |
| ewid[], wstwk[], wstat[], wbauj[], warea[], wazim[], wkche[], wmehrg[] | `wohnung.<ewid>.{stockwerk, status, baujahr, flaeche_m2, zimmer, kueche, mehrgeschossig}` | parallele Arrays, Index = Wohnung |

Codetabellen: `src/codes/gwr.ts`. Quelle: Merkmalskatalog GWR 4.2, housing-stat.ch. Nicht gemappt (bewusst): Quellen-Codes `gksce`, `gwaersceh1` etc.

---

## av-parzelle · Amtliche Vermessung

| | |
|---|---|
| Datenhalter | swisstopo (Aggregation), Kantone (Daten) |
| Endpoint | `GET …/MapServer/identify?geometry=<E>,<N>&geometryType=esriGeometryPoint&layers=all:ch.swisstopo-vd.amtliche-vermessung&tolerance=0&sr=2056&returnGeometry=true&geometryFormat=geojson` |
| braucht | `lv95_bau` |
| liefert Keys | `egrid`, `bfs_nr`, `kanton`, `parzelle_nr` |
| Fakten | `parzelle.nummer`, `.egrid`, `.nummerierungsbereich` (identnd), `.bfs_nr`, `.kanton`, `.art`, `.geoportal_url`, `.flaeche_m2` (berechnet, Confidence 0.95), `.treffer_am_punkt` |
| TTL | 90 Tage |
| Status | verifiziert (Attribute) · Fixture `av-parzelle-5711.json` (Geometrie ist Platzhalter) |

Gelesene Felder: `bfsnr, ak, number, identnd, egris_egrid, realestate_type, geoportal_url`, `geometry` (GeoJSON Polygon/MultiPolygon). Die API liefert keine Fläche; wir rechnen Shoelace in LV95-Metern, Löcher abgezogen. Mehrere Treffer (Punkt auf Grenze): bevorzugt die EGRID aus dem GWR.

---

## sonnendach · Solarpotenzial Dächer

| | |
|---|---|
| Datenhalter | BFE, swisstopo |
| Endpoint | `identify` auf `ch.bfe.solarenergie-eignung-daecher`, tolerance=0 (Segment unter dem Punkt), dann tolerance=20 mit `imageDisplay=100,100,96` und `mapExtent` (alle Segmente) |
| braucht | `lv95_bau` |
| Fakten | `solar.klasse` (1–5), `.klasse_text`, `.segmente`, `.segmente_vollstaendig`, `.dachflaeche_m2`, `.einstrahlung_max_kwh_m2a`, `.stromertrag_kwh_a`, `.stromertrag_winter_kwh_a`, `.finanzertrag_chf_a`, `.waermeertrag_kwh_a`, `.bestes_segment.{ausrichtung_grad, neigung_grad, flaeche_m2}`, `.waermebedarf_heizung_kwh_a`, `.waermebedarf_warmwasser_kwh_a`, `.building_id` |
| source_date | `datum_aenderung` |
| TTL | 180 Tage |
| Status | verifiziert (Einzelsegment) · Fixtures `sonnendach-point.json`, `sonnendach-wide.json` (Umkreis konstruiert) |

Gelesene Felder: `klasse, klasse_text, flaeche, ausrichtung, neigung, mstrahlung, gstrahlung, stromertrag, stromertrag_winterhalbjahr, stromertrag_sommerhalbjahr, finanzertrag, waermeertrag, bedarf_heizung, bedarf_warmwasser, gwr_egid, building_id, df_nummer, datum_aenderung`. Pseudo-Treffer `featureId -99` (Hinweistext) wird ignoriert. Segmente desselben Gebäudes: gleiche `gwr_egid` oder `building_id`. Klasse: 1 gering, 2 mittel, 3 gut, 4 sehr gut, 5 hervorragend. Ausrichtung: 0 = Süd, negativ Ost, positiv West.

Offen: Ob die Umkreis-Abfrage mit Toleranz wirklich alle Segmente liefert, zeigt der Live-Test. `find` auf `gwr_egid` hat am 15.10.2026 einen Serverfehler gegeben.

---

## oev-gueteklasse · ÖV-Güteklassen

| | |
|---|---|
| Datenhalter | ARE |
| Endpoint | `identify` auf `ch.are.gueteklassen_oev`, tolerance=0 |
| braucht | `lv95_bau` |
| Fakten | `oev.gueteklasse` (A, B, C, D oder `keine`), `oev.gueteklasse_text` |
| TTL | 180 Tage |
| Status | verifiziert · Fixture `oev-radon.json` |

Gelesene Felder: `klasse_de` ("D - geringe Erschliessung"), `klasse_fr`. Kein Treffer = ausserhalb aller Güteklassen = gültiger Wert `keine`.

---

## radon · Radonkarte

| | |
|---|---|
| Datenhalter | BAG |
| Endpoint | `identify` auf `ch.bag.radonkarte`, tolerance=0 |
| braucht | `lv95_bau` |
| Fakten | `radon.wahrscheinlichkeit_prozent`, `radon.einstufung` (unsere Lesehilfe, Confidence 0.8), `radon.referenzwert_bq_m3` (300) |
| TTL | 365 Tage |
| Status | verifiziert · Fixture `oev-radon.json` |

Gelesene Felder: `probability_prozent`, `confidence`. Bedeutung: Wahrscheinlichkeit, dass in einem Gebäude an diesem Ort 300 Bq/m³ überschritten werden. Einstufung: < 10 % gering, < 20 % mittel, ab 20 % erhöht (grundpass, nicht BAG).

---

## laerm-strasse · Strassenlärm Tag/Nacht · EXPERIMENTELL

| | |
|---|---|
| Datenhalter | BAFU (sonBASE) |
| Endpoint | `GET https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=<layer>&QUERY_LAYERS=<layer>&CRS=EPSG:2056&BBOX=…&WIDTH=3&HEIGHT=3&I=1&J=1&INFO_FORMAT=application/json` für `ch.bafu.laerm-strassenlaerm_tag` und `_nacht` |
| braucht | `lv95_bau` |
| Fakten | `laerm.strasse.tag_db`, `.nacht_db` (Confidence 0.7), `.tag_roh`/`.nacht_roh` falls nicht parsebar, `.grenzwert_wohnzone_tag_db` (60), `.grenzwert_wohnzone_nacht_db` (50) |
| TTL | 180 Tage |
| Status | **experimentell** · Fixture `laerm-wms.json` ist eine Annahme |

Was bekannt ist: Die Layer-IDs stimmen (SearchServer type=layers). `identify` auf api3 liefert für diese Raster einen Fehler. Die Metadaten unter `/MapServer/ch.bafu.laerm-strassenlaerm_tag` geben 404. Die Form der GetFeatureInfo-Antwort konnte aus der Sandbox nicht abgerufen werden (URL zu lang für den Fetch-Proxy). Der Parser nimmt die erste numerische Eigenschaft in `features[0].properties` (bevorzugt `value`, `GRAY_INDEX`), sonst die erste Zahl im Text. `pnpm test:live` zeichnet die echte Antwort nach `test/live/aufzeichnungen/` auf. Danach: Fixture ersetzen, Parser festziehen, Status auf verifiziert.

Grenzwerte: Immissionsgrenzwerte der LSV für Empfindlichkeitsstufe II (reine Wohnzone), Strassenverkehrslärm.

---

## derived · berechnet

Keine externe Quelle. Siehe ARCHITEKTUR.md Abschnitt 7.

---

## Kandidaten (noch nicht gebaut)

| Quelle | Layer / API | Hinweis |
|---|---|---|
| ÖREB-Kataster (Zone, Ausnützung, Belastungen) | kantonale ÖREB-Webservices, Datenextrakt per EGRID | AG und ZH zuerst. Antwort XML/JSON je nach Kanton. |
| Gefährdungskarte Oberflächenabfluss | `ch.bafu.gefaehrdungskarte-oberflaechenabfluss` | Raster, nur WMS GetFeatureInfo (identify gibt Fehler). |
| Naturgefahren (Hochwasser, Rutsch) | kantonal | kein Bundeslayer mit Gebäudeauflösung |
| swissBUILDINGS3D | swisstopo | Gebäudehöhe, Dachform, Volumen |
| Denkmalschutz / ISOS | `ch.bak.bundesinventar-schuetzenswerte-ortsbilder` + kantonal | |
| Altlasten | kantonale Kataster, teils Bund (`ch.bafu.kataster-belasteter-standorte*`) | |
| Erdwärmesonden-Zulässigkeit | kantonale Wärmenutzungskarten | |
| Thermische Netze | `ch.bfe.thermische-netze` | Fernwärme in der Nähe |
| Amtsblattportal | amtsblattportal.ch API | Baugesuche, Handänderungen (kantonsabhängig) |
| BFS Gemeindedaten | BFS STAT-TAB / opendata.swiss | Steuerfuss, Leerwohnungsziffer |
| Zeitreise Luftbilder | swisstopo WMTS | nur Bild, Fun Fact |
