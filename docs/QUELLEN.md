# grundpass-core · Quellen

Jede Quelle: Endpoint, was wir lesen, was daraus wird, Lizenz, TTL, Status. Status `verifiziert` heisst:
gegen eine echte Antwort gebaut, Fixture in `test/fixtures/`, Unit-Test grün. `experimentell` heisst: Form noch nicht live bestätigt.

Die Bundesquellen laufen über die Bundes-Geodateninfrastruktur (geo.admin.ch), ohne API-Key, mit Quellenangabe als Pflicht.
Der ÖREB-Kataster kommt direkt von den kantonalen Webservices (Abschnitt oereb), ebenfalls ohne API-Key.
Datensätze und genaue Lizenztexte: opendata.swiss bzw. die Layer-Metadaten unter `https://api3.geo.admin.ch/rest/services/api/MapServer/<layer>`.

Allgemeine Erkenntnisse (15.10.2026):
- `SearchServer` liefert `attrs.y` = Ost, `attrs.x` = Nord. Vertauscht gegenüber LV95-Konvention. Seit dem ersten Stand zusätzlich `attrs.geom_quadindex`, `attrs.geom_st_box2d`, `attrs.links[]` (href, rel, title); `weight` ist 1 statt 100. Wir lesen davon nichts.
- `find` ist ohne `contains=false` eine Teilstring-Suche: `searchText=1271632` auf dem GWR traf auch EGID 191271632 (Gossau SG). `findUrl` setzt darum `contains=false` (bestätigt 15.10.2026: genau ein Treffer). Fixture `gwr-find-teilstring.json` belegt den Fall.
- Das GWR liefert `egid`, `edid` und `stroffiziel` als Strings, die übrigen Zahlenfelder als Zahlen. Nicht auf Typen verlassen, `nullableNumberish` fängt beides.
- `identify` mit `tolerance=0` braucht weder `imageDisplay` noch `mapExtent`. Mit Toleranz > 0 beides.
- `identify` mit `geometryFormat=geojson` liefert GeoJSON-Features: Attribute in `properties`, nicht `attributes`, Geometrie als GeoJSON. Ohne `geometryFormat` kommt Esri-JSON mit `attributes` und `geometry.rings`. Zwei Schemas in `src/http/geoadmin.ts`.
- `find` kann dasselbe: mit `returnGeometry=true&geometryFormat=geojson` kommen GeoJSON-Features in derselben Form wie bei `identify`. Durchsuchbar ist zum Beispiel `egris_egrid` der amtlichen Vermessung (bestätigt 15.10.2026 an Baden und Wabern). Unbekannter Suchwert: `{"results": []}` mit HTTP 200.
- Reine Raster-Layer sind per `identify` nicht abfragbar (4xx). Nur WMS GetFeatureInfo.
- Bei Fehlern antwortet api3 teils mit HTML, nicht JSON. Der Client wirft dann `SchemaDriftError`.
- WMS GetFeatureInfo (wms.geo.admin.ch) kann `application/json`, `text/plain` und `application/vnd.ogc.gml`, aber kein `text/html` (ServiceException InvalidFormat). Raster-Werte stehen in `features[0].properties.value_0`, als String.
- WMS GetFeatureInfo auf Flächenlayer (16.10.2026): `application/json` schickt die ganze Geometrie des getroffenen Polygons mit (Erdbebenzonen: 5 bis 8 MB pro Antwort, Aquaprotect 80 KB). `text/plain` nennt nur Layer, Feature-ID und Attribute («Erdbebenzone_SIA_261 = 'Z1b'»), ohne Treffer «Search returned no results.». Parser `parseWmsFeatureInfoText` in `src/http/geoadmin.ts`. Layer, die als Treffer nur «Feature <id>:» ohne Attribute liefern (Oberflächenabfluss, Aquaprotect), sagen nur «drin oder nicht drin».
- `layersConfig?lang=de` (api3) nennt pro Layer `tooltip` (identify möglich) und `type` (`wmts` = Raster oder Vektor-Kacheln, `wms`). Ein Layer kann unter einem irreführenden Namen laufen: `ch.bfe.fernwaerme-angebot` ist «Potenzial Wärmenutzung ARA», nicht Fernwärme (siehe Kandidaten).

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
| Status | verifiziert · Fixture `searchserver-wabern.json` (echte Antwort vom 15.10.2026) |

Gelesene Felder: `results[].attrs.{label, detail, origin, featureId, x, y, lat, lon, num}`. Erster Treffer mit `origin=address`. Kein Treffer → `EmptyResultError`.

---

## gwr · Gebäude- und Wohnungsregister

| | |
|---|---|
| Datenhalter | BFS |
| Endpoint | `GET https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.bfs.gebaeude_wohnungs_register&searchField=egid&searchText=<EGID>&returnGeometry=false&contains=false` |
| braucht | `egid` |
| liefert Keys | `egrid`, `lv95_bau` (gkode/gkodn), `bfs_nr` (ggdenr), `kanton` (gdekt), `parzelle_nr` (lparz) |
| source_date | `gexpdat` (Exportdatum des Registers) |
| TTL | 30 Tage |
| Status | verifiziert · Fixture `gwr-1271632.json` (echte Antwort vom 15.10.2026 mit contains=false), `gwr-find-teilstring.json` (dieselbe Abfrage ohne contains=false, zwei Treffer) |

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

Treffer-Auswahl: Der Adapter nimmt den Treffer, dessen `egid` exakt der gesuchten entspricht. Gibt es keinen, ist das `EmptyResultError` (Lücke), nie ein anderes Gebäude. Der frühere Fallback auf `results[0]` hätte bei einer nicht existierenden EGID, die als Teilstring in einer anderen vorkommt, ein falsches Gebäude geliefert.

---

## av-parzelle · Amtliche Vermessung

| | |
|---|---|
| Datenhalter | swisstopo (Aggregation), Kantone (Daten) |
| Endpoint | Hauptweg: `GET …/MapServer/find?layer=ch.swisstopo-vd.amtliche-vermessung&searchField=egris_egrid&searchText=<EGRID>&returnGeometry=true&geometryFormat=geojson&contains=false&sr=2056`. Fallback ohne EGRID (oder EGRID in der AV unbekannt): `GET …/MapServer/identify?geometry=<E>,<N>&geometryType=esriGeometryPoint&layers=all:ch.swisstopo-vd.amtliche-vermessung&tolerance=0&sr=2056&returnGeometry=true&geometryFormat=geojson` am Gebäudepunkt. Dieselbe identify-Abfrage ist im Hauptweg die Gegenprobe, wenn der Gebäudepunkt nicht in der gefundenen Parzelle liegt. |
| braucht | `egrid` oder `lv95_bau` (Manifest: `egrid|lv95_bau`) |
| liefert Keys | `egrid`, `bfs_nr`, `kanton`, `parzelle_nr` |
| Fakten | `parzelle.nummer`, `.egrid`, `.nummerierungsbereich` (identnd), `.bfs_nr`, `.kanton`, `.art`, `.geoportal_url`, `.flaeche_m2` (berechnet, Confidence 0.95), `.geometrie_geojson` (GeoJSON-String in LV95, Confidence 1, nicht im Feldkatalog; für den Lageplan der App), `.treffer_am_punkt` (nur im Fallback, bei mehreren Treffern), `.hinweis_vermessung` (nur bei Widerspruch zum GWR) |
| TTL | 90 Tage |
| Version | 3 (15.10.2026: Hauptweg per EGRID; 2: Geometrie und Hinweis) |
| Status | verifiziert 15.10.2026, beide Wege · Fixtures `av-parzelle-find-3258.json` (find per EGRID, Baden), `av-parzelle-find-5711.json` (find per EGRID, Wabern), `av-parzelle-5711.json` (identify am Punkt, Wabern), `av-parzelle-3827-punkt.json` (identify am Gebäudepunkt von Baden), `av-parzelle-5711-esrijson.json` (identify ohne geometryFormat, als Drift-Fall) |

**Antwortform** (find und identify gleich, geometryFormat=geojson): `results[]` sind GeoJSON-Features `{ type: "Feature", featureId, id, layerBodId, layerName: "OpenData-AV", bbox, geometry, properties }`. Gelesene Felder: `properties.{bfsnr, ak, number, identnd, egris_egrid, realestate_type, geoportal_url}`, `geometry` (GeoJSON Polygon/MultiPolygon). Daneben `properties.name` und `properties.label` (beide die Nummer), die wir nicht lesen. Die erste Fassung las `attributes` (Esri-Form) und fiel live mit Schema-Drift aus; die Esri-Form ist jetzt ein Testfall für Drift. Unbekannte EGRID: `{"results": []}` mit HTTP 200, kein Fehler.

**Warum per EGRID (seit Version 3).** Bis Version 2 fragte der Adapter nur den Gebäudepunkt ab. In Baden, Rütistrasse 1 (EGID 534491), liegt der GWR-Gebäudepunkt (2665322.862 / 1258605.675) laut amtlicher Vermessung auf Parzelle 3827 (CH189083957747, 236 m²), das Gebäuderegister nennt 3258 (CH959983779505, laut ÖREB 394 m²). Der Lageplan zeichnete darum die Nachbarparzelle. Jetzt liefert `find` auf `egris_egrid` die 3258 mit Geometrie (43 Stützpunkte, Shoelace 394.67 m², Fakt 395 m²). Das Feld ist durchsuchbar, bestätigt 15.10.2026 an Baden und Wabern (Wabern: byte-gleiche Geometrie wie identify am Punkt, 764 m²).

**Gegenprobe.** Liegt der Gebäudepunkt nicht in der gefundenen Geometrie (Even-Odd-Test über alle Ringe, kein Netzaufruf), folgt genau eine `identify`-Abfrage am Punkt. Nennt sie die Register-Parzelle nicht (Baden: nur 3827), sagt `parzelle.hinweis_vermessung`: «Der Gebäudepunkt aus dem Gebäuderegister liegt laut amtlicher Vermessung auf Parzelle 3827 (CH189083957747), nicht auf 3258 (CH959983779505). Gezeigt wird die Parzelle aus dem Gebäuderegister.» Die Fakten bleiben die der Register-Parzelle mit Confidence 1, der Hinweis trägt die `request_url` der Punkt-Abfrage. Liegt der Punkt in der Parzelle (Wabern), bleibt es bei einer Anfrage. Punkt auf der Grenze: identify nennt beide Parzellen, kein Hinweis.

**Fallback.** Ohne EGRID, oder wenn die AV die EGRID nicht kennt: identify am Gebäudepunkt wie bis Version 2. Mehrere Treffer (Punkt auf Grenze): bevorzugt die EGRID aus dem GWR, `parzelle.treffer_am_punkt` nennt die Zahl. Ist die Parzelle unter dem Punkt eine andere als die GWR-EGRID, tragen die AV-Fakten Confidence 0.8 (die Geometrie bleibt 1) und der Hinweis benennt beide; die Keys behält das GWR (erster Schreiber), darum folgen ÖREB-Zone und Grundbuchfläche der Register-Parzelle. Fällt das GWR aus, fehlen EGRID und Gebäudepunkt zugleich, der Adapter wird `skipped`.

Die API liefert keine Fläche; wir rechnen Shoelace in LV95-Metern, Löcher abgezogen. Wabern, Parzelle 5711: 7 Stützpunkte, 764.39 m² (Fakt: 764 m², Confidence 0.95).

---

## sonnendach · Solarpotenzial Dächer

| | |
|---|---|
| Datenhalter | BFE, swisstopo |
| Endpoint | `identify` auf `ch.bfe.solarenergie-eignung-daecher`, tolerance=0 (Segment unter dem Punkt), dann tolerance=20 mit `imageDisplay=100,100,96` und `mapExtent` (100 m um den Punkt; alle Segmente des Gebäudes) |
| braucht | `lv95_bau` |
| Fakten | `solar.klasse` (1–5), `.klasse_text`, `.segmente`, `.segmente_vollstaendig`, `.dachflaeche_m2`, `.einstrahlung_max_kwh_m2a`, `.stromertrag_kwh_a`, `.stromertrag_winter_kwh_a`, `.finanzertrag_chf_a`, `.waermeertrag_kwh_a`, `.bestes_segment.{ausrichtung_grad, neigung_grad, flaeche_m2}`, `.waermebedarf_heizung_kwh_a`, `.waermebedarf_warmwasser_kwh_a`, `.building_id` |
| source_date | `datum_aenderung` |
| TTL | 180 Tage |
| Status | verifiziert 15.10.2026 (Punkt und Umkreis) · Fixtures `sonnendach-point.json`, `sonnendach-wide.json`, beide echte Antworten |

Gelesene Felder: `klasse, klasse_text, flaeche, ausrichtung, neigung, mstrahlung, gstrahlung, stromertrag, stromertrag_winterhalbjahr, stromertrag_sommerhalbjahr, finanzertrag, waermeertrag, bedarf_heizung, bedarf_warmwasser, gwr_egid, building_id, df_nummer, datum_aenderung`. Die Antwort enthält daneben Monatsreihen (`monate`, `monats_ertrag`, `heizgradtage`, `a_param`, `b_param`, `c_param`) und Solarthermie-Parameter (`flaeche_kollektoren`, `volumen_speicher`, `duschgaenge`, `dg_heizung`, `dg_waermebedarf`), die wir nicht lesen. Pseudo-Treffer `featureId -99` (Hinweistext) wird ignoriert. Segmente desselben Gebäudes: gleiche `gwr_egid` oder `building_id`. Klasse: 1 gering, 2 mittel, 3 gut, 4 sehr gut, 5 hervorragend. Ausrichtung: 0 = Süd, negativ Ost, positiv West.

**Vollständigkeit (15.10.2026, Wabern):** tolerance=20 liefert 6 Treffer: die 4 Segmente des Gebäudes (df_nummer 1 bis 4, Dachfläche total 240 m², Stromertrag 44 550 kWh/a) und 2 Segmente des Nachbarhauses (gwr_egid 1271643), die der Filter entfernt. tolerance=30 liefert byte-identisch dasselbe. `find` auf `building_id` oder `gwr_egid` läuft in ein 504 Gateway Timeout nach rund 60 s, ist also nicht brauchbar. `solar.segmente_vollstaendig` ist nur true, wenn die df_nummer der gefundenen Segmente lückenlos 1 bis n sind (Sonnendach nummeriert die Dachflächen eines Gebäudes so, beobachtet an zwei Gebäuden); fällt die Umkreis-Abfrage aus oder fehlt eine Nummer, ist es false. Bei sehr grossen Gebäuden kann der 20-m-Umkreis um den GWR-Punkt zu klein sein, das zeigt dann dieses Flag.

**Bestes Segment** (`solar.bestes_segment.*`, `solar.klasse`): höchste Klasse, bei Gleichstand höhere Einstrahlung (`mstrahlung`), dann grössere Fläche. Ohne diese Regel hinge die Auswahl von der Reihenfolge in der API-Antwort ab (in Wabern kam die 44-m²-Fläche vor der besseren 75-m²-Fläche).

---

## oev-gueteklasse · ÖV-Güteklassen

| | |
|---|---|
| Datenhalter | ARE |
| Endpoint | `identify` auf `ch.are.gueteklassen_oev`, tolerance=0 |
| braucht | `lv95_bau` |
| Fakten | `oev.gueteklasse` (A, B, C, D oder `keine`), `oev.gueteklasse_text` |
| TTL | 180 Tage |
| Status | verifiziert · Fixture `oev-radon.json` (echte Antworten vom 15.10.2026) |

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
| Status | verifiziert · Fixture `oev-radon.json` (echte Antworten vom 15.10.2026) |

Gelesene Felder: `probability_prozent`, `confidence`. Bedeutung: Wahrscheinlichkeit, dass in einem Gebäude an diesem Ort 300 Bq/m³ überschritten werden. Einstufung: < 10 % gering, < 20 % mittel, ab 20 % erhöht (grundpass, nicht BAG).

---

## laerm-strasse · Strassenlärm Tag/Nacht

| | |
|---|---|
| Datenhalter | BAFU (sonBASE). Geobasisdatensätze 120.1 (Tag) und 120.2 (Nacht) |
| Endpoint | `GET https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&LAYERS=<layer>&QUERY_LAYERS=<layer>&CRS=EPSG:2056&BBOX=<E-1.5>,<N-1.5>,<E+1.5>,<N+1.5>&WIDTH=3&HEIGHT=3&I=1&J=1&INFO_FORMAT=application/json&FEATURE_COUNT=1` für `ch.bafu.laerm-strassenlaerm_tag` und `ch.bafu.laerm-strassenlaerm_nacht` |
| braucht | `lv95_bau` |
| Fakten | `laerm.strasse.tag_db`, `.nacht_db` (Confidence 1). Die Grenzwerte zum Vergleich (`laerm.strasse.grenzwert_tag_db`, `.grenzwert_nacht_db`) sind seit 15.10.2026 derived-Fakten aus der Empfindlichkeitsstufe des ÖREB-Katasters, nicht mehr pauschal ES II aus diesem Adapter. |
| Datenstand | 31.12.2021 laut Layer-Legende (Verkehrszählungen 2021). GetFeatureInfo liefert kein Datum, darum kein `source_date`; Stand im Steckbrief ist das Abrufdatum. |
| TTL | 180 Tage |
| Status | verifiziert 15.10.2026 · Fixtures `laerm-wms.json` (Tag), `laerm-wms-nacht.json`, `laerm-wms-leer.json` (ohne kartierten Lärm) |

**Antwortform** (`application/json`), Gebäudepunkt Maygutstrasse 26, Wabern (2601737/1197338.426):

```json
{ "type": "FeatureCollection", "name": "ch.bafu.laerm-strassenlaerm_tag_full",
  "features": [ { "type": "Feature", "properties": { "value_0": "33.2" },
                  "geometry": { "type": "Point", "coordinates": [ 2601740.0, 1197340.0 ] } } ] }
```

Gelesen wird genau `features[0].properties.value_0` (String, wird zur Zahl; Zod-Schema in `src/adapters/laerm-strasse.ts`).
Wabern: Tag 33.2 dB, Nacht 24.1 dB. Gegenprobe an einer Berner Hauptstrasse (2600400/1199500): Tag 54.7 dB.
Die Feature-Geometrie ist der Mittelpunkt der getroffenen Rasterzelle, nicht der angefragte Punkt.

**Was am 15.10.2026 probiert wurde**

| Abfrage | Ergebnis |
|---|---|
| GetFeatureInfo `INFO_FORMAT=application/json` | brauchbar, siehe oben. Wird benutzt. |
| GetFeatureInfo `text/plain` | brauchbar: `ch.bafu.laerm-strassenlaerm_tag.value_0.name = '33.2'` |
| GetFeatureInfo `application/vnd.ogc.gml` | brauchbar: `<ch.bafu.laerm-strassenlaerm_tag.value_0.name>33.2</…>` |
| GetFeatureInfo `text/html` | `ServiceException code="InvalidFormat"`: Unsupported INFO_FORMAT value |
| `identify` auf api3 | Fehler, reine Raster sind nicht identify-fähig |
| `/MapServer/<layer>` (Metadaten) | 404. Die Legende `/MapServer/<layer>/legend?lang=de` liefert Beschreibung und Datenstand. |

**Kein kartierter Lärm:** `features` ist leer (geprüft am Aletschgletscher, 2646000/1141000). Der Adapter wirft `EmptyResultError`
(Lücke, zählt nicht für den Breaker). Jede andere Form (kein `value_0`, Text statt JSON) ist `SchemaDriftError`. Es wird keine Zahl geraten.

**Bedeutung:** Beurteilungspegel Lr Tag (6 bis 22 Uhr) und Lr Nacht (22 bis 6 Uhr) in dB(A) aus der flächendeckenden
Modellrechnung sonBASE, rechtlich nicht verbindlich (verbindlich sind ASTRA für Nationalstrassen und die kantonalen
Vollzugsbehörden für die übrigen Strassen). Grenzwerte: Immissionsgrenzwerte der LSV (Anhang 3) für Strassenverkehrslärm
je Empfindlichkeitsstufe, Tag/Nacht: ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60 dB. Welche Stufe gilt, sagt der
ÖREB-Kataster (`laerm.empfindlichkeitsstufe`), die passenden Grenzwerte rechnet `derive.ts`. Ohne Stufe gibt es keinen Grenzwert.

---

## laerm-bahn · Eisenbahnlärm Tag/Nacht

| | |
|---|---|
| Datenhalter | BAFU (Emissionskataster 2021, EK2021). Geobasisdatensatz 120.3 |
| Endpoint | WMS GetFeatureInfo wie laerm-strasse (3×3 px um den Gebäudepunkt, `INFO_FORMAT=application/json`, `FEATURE_COUNT=1`) für `ch.bafu.laerm-bahnlaerm_tag` und `ch.bafu.laerm-bahnlaerm_nacht` |
| braucht | `lv95_bau` |
| Fakten | `laerm.bahn.tag_db`, `.nacht_db` (Confidence 1). Ohne kartierten Bahnlärm statt der Pegel `laerm.bahn.hinweis` = «keine Bahnlärm-Belastung kartiert» (fehlt nur einer: «… (Nacht)»). Grenzwerte `laerm.bahn.grenzwert_tag_db`, `.grenzwert_nacht_db` sind derived aus der Empfindlichkeitsstufe (LSV Anhang 4), nur wenn ein Bahnpegel da ist. |
| Datenstand | 31.12.2021 laut Layer-Legende (Emissionsdaten 2021, berechnet durch die SBB für SBB, BLS, SOB, SZU, Zentralbahn, RhB; rund 4165 von 5800 km Trassen). GetFeatureInfo liefert kein Datum, darum kein `source_date`. |
| TTL | 180 Tage |
| Status | verifiziert 16.10.2026 (Live-Test an den fünf goldenen Adressen) · Fixtures `laerm-bahn-tag-wabern.json`, `laerm-bahn-nacht-wabern.json`, `laerm-bahn-tag-zuerich.json`, `laerm-bahn-nacht-zuerich.json` (echte Antworten vom 16.10.2026) |

**Antwortform** identisch zu laerm-strasse (`features[0].properties.value_0` als String, Geometrie = Mittelpunkt der Rasterzelle). Wabern (2601737/1197338): Tag 16.4, Nacht 6.2 dB. Zürich Bahnhofstrasse-Gegend (2683400/1247900): Tag 16.6, Nacht 11.9 dB. Die Karte liefert auch weit weg von Gleisen kleine Werte; wo gar nichts kartiert ist, ist `features` leer. Das ist bewusst keine `EmptyResultError` (der Adapter läuft `ok`), sondern der Fakt `laerm.bahn.hinweis`; die Steckbrief-View macht daraus die Lücke von `laerm.bahn.tag_db` (`erwartet`) mit Grund `hinweis` und dem Text als `detail`. Kein Default, keine Zahl.

**Bedeutung:** Beurteilungspegel Lr Tag (6 bis 22 Uhr) und Lr Nacht (22 bis 6 Uhr) in dB(A) für Eisenbahnlärm, gesetzlich nicht verbindlich (verbindlich: BAV). Lärm von Bahnen auf Strassen (Trams) gilt laut LSV Anhang 4 Ziff. 1 Abs. 2 als Strassenverkehrslärm und ist hier nicht drin. Immissionsgrenzwerte: LSV Anhang 4 Ziff. 2, je Empfindlichkeitsstufe Tag/Nacht: ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60 dB (gegengeprüft am 16.10.2026 im konsolidierten Text vom 1.4.2026, fedlex ELI cc/1987/338_338_338/20260401; Fundstelle im Kommentar von `src/resolver/derive.ts`).

---

## naturgefahren · Oberflächenabfluss, Aquaprotect, Erdbebenzonen

| | |
|---|---|
| Datenhalter | BAFU |
| Endpoint | WMS GetFeatureInfo (3×3 px um den Gebäudepunkt, `INFO_FORMAT=text/plain`, `FEATURE_COUNT=1`) für `ch.bafu.gefaehrdungskarte-oberflaechenabfluss`, `ch.bafu.aquaprotect_100`, `ch.bafu.gefahren-gefaehrdungszonen`; drei Anfragen parallel. api3 `identify` geht bei allen drei nicht («No GeoTable was found»). |
| braucht | `lv95_bau` |
| Fakten | `naturgefahr.oberflaechenabfluss.betroffen` (bool), `naturgefahr.hochwasser.aquaprotect_100` (bool), `naturgefahr.erdbeben.zone` (Z1a, Z1b, Z2, Z3a, Z3b, roh). Alle Confidence 1. Kein Treffer bei den Erdbebenzonen (ausserhalb der Karte): kein Zonen-Fakt, Lücke. |
| Datenstand | Oberflächenabfluss 22.05.2018, Aquaprotect 18.12.2008, Erdbebenzonen 13.04.2026 (Layer-Legenden). GetFeatureInfo liefert kein Datum, kein `source_date`. |
| TTL | 365 Tage |
| Status | verifiziert 16.10.2026 (Live-Test an den fünf goldenen Adressen) · Fixtures `naturgefahren-{oberflaechenabfluss,aquaprotect-100,erdbeben}-{wabern,zuerich}.json` (echte text/plain-Antworten vom 16.10.2026 im Feld `body`, mit `_hinweis`) |

**Antwortform** (`text/plain`), Zürich Bahnhofstrasse-Gegend (2683400/1247900):

```
GetFeatureInfo results:

Layer 'ch.bafu.gefahren-gefaehrdungszonen'
  Feature 11:
    Erdbebenzone_SIA_261 = 'Z1a'
```

Oberflächenabfluss und Aquaprotect liefern bei einem Treffer nur `Feature 8688:` bzw. `Feature 2286:` ohne Attributzeile, ohne Treffer «Search returned no results.» (Wabern bei beiden). Die drei Fliesstiefen-Klassen der Oberflächenabfluss-Legende (0 bis 0.1 m, 0.1 bis 0.25 m, ab 0.25 m) sind nur im Kartenbild; weder JSON noch GML noch text/plain tragen ein Attribut. Darum gibt es `naturgefahr.oberflaechenabfluss.klasse` nicht: Wir lesen keine Farbe aus dem Bild und raten keine Klasse. Belege: Wabern Z1b, nichts drin; Zürich Z1a, Oberflächenabfluss und HQ100 betroffen (Limmat).

**Bedeutung für Laien** (so auch im Feldkatalog): Oberflächenabfluss ist Regenwasser, das bei Starkregen über das Gelände fliesst, unabhängig von Bächen; die Karte ist eine Modellrechnung ohne Prüfung im Gelände für Ereignisse seltener als alle 100 Jahre, nicht rechtsverbindlich. Aquaprotect ist eine grobe, alte (2008) Übersicht der bei HQ100 potenziell überschwemmten Gebiete ohne Schutzbauten, gedacht für Gebiete ohne Gefahrenkarte; «nein» heisst nicht «keine Gefahr». Die Erdbebenzone (SIA 261) bestimmt die Bemessung von Tragwerken, Z1a/Z1b gering, Z3b am höchsten.

**Bewusste Lücke:** Die kantonalen Gefahrenkarten (Hochwasser, Rutschung, Sturz, Lawine) mit Gefahrenstufen gibt es nicht schweizweit in einem Layer; sie liegen bei den Kantonen (teils im ÖREB-Kataster als kantonales Thema, z.B. BE). Sie fehlen hier, das sagt die Erklärung zum Aquaprotect-Feld.

**Probiert 16.10.2026:** Erdbebenzonen als `application/json` liefern `properties.zone` plus die ganze Zonengeometrie (Wabern 8.5 MB, Zürich 5 MB), darum text/plain. `ch.bafu.gefahren-baugrundklassen` (seismische Baugrundklassen, identify-fähig, Wabern «C» nach SIA261:2003) ist nicht schweizweit (Zürich: nichts) und bleibt draussen. Die Aquaprotect-Layer 50, 250 und 500 Jahre existieren ebenfalls; wir fragen nur HQ100.

---

## kulturgueter · KGS-Inventar (Kulturgüterschutz)

| | |
|---|---|
| Datenhalter | BABS (Kulturgüterschutzinventar 2021, Objekte von nationaler Bedeutung). Geobasisdatensatz 65.1 |
| Endpoint | `GET …/MapServer/identify?geometry=<E>,<N>&geometryType=esriGeometryPoint&layers=all:ch.babs.kulturgueter&tolerance=15&sr=2056&returnGeometry=true&lang=de&imageDisplay=100,100,96&mapExtent=<100 m um den Punkt>` (1 px = 1 m, Toleranz also 15 m) |
| braucht | `lv95_bau` |
| Fakten | `kulturgut.kgs.betroffen` (bool, immer). Bei einem Treffer innerhalb 15 m zusätzlich `kulturgut.kgs.name`, `.kategorie` («A (national)» / «B (regional)», Confidence 0.8), `.kategorie_code` (roh, z.B. «A.A»), `.nummer` (aus «KGS_NR665»), `.objektart`, `.distanz_m` (Confidence 0.95), bei mehreren `.weitere_im_umkreis`. Nächster Punkt gewinnt. |
| source_date | keines; Datenstand 30.06.2026 laut Layer-Legende |
| TTL | 180 Tage |
| Status | verifiziert 16.10.2026 (Live-Test an den fünf goldenen Adressen, positiv am Zytglogge) · Fixtures `kulturgueter-wabern.json`, `kulturgueter-zuerich.json` (leer), `kulturgueter-zytglogge.json` (zwei Treffer, echte Antworten vom 16.10.2026) |

**Gelesene Felder:** `kgs_nr`, `beschreibung`, `kgs_kategorie`, `gemeinde`, `kanton`, `objektart_de_list`; Geometrie `{x, y}` (Esri-Form). Nicht gelesen: `adresse_list`, `weblinks_list`, `bemerkung_list`, `bild_nr_list`, `ehemaligegemeinde`, die fr/it-Listen. Nicht betroffen ist ein Fakt mit `false`, keine Lücke. Treffer, die die API wegen der Pixel-Toleranz liefert, aber rechnerisch weiter als 15 m liegen, fallen weg.

**Kategorie:** `kgs_kategorie` ist im ganzen Layer «A.A» (`find` auf A.A trifft, auf A.S, B.A, B, A nichts). Der erste Buchstabe ist die KGS-Kategorie (A national, B regional); der Layer enthält laut Legende nur A-Objekte. Was der zweite Teil bedeutet, ist nicht dokumentiert und wird nicht gedeutet.

**Belege 16.10.2026:** Wabern und Zürich Bahnhofstrasse-Gegend ohne Treffer. Gebäudepunkt Bim Zytglogge 3, Bern (2600698.025/1199652.118): Zeitglockenturm (KGS_NR665, 1 m) und das Haus Bim Zytglogge 1 (KGS_NR696, 9 m). Grenze des Verfahrens: Der Inventarpunkt sitzt irgendwo auf dem Objekt, der GWR-Punkt auch; beim Bundeshaus liegen sie 31 m auseinander, es wäre «nicht betroffen». Weitere Paare mit Distanz unter 15 m: Helmhaus/Wasserkirche, Rathaus und Zunfthaus zur Zimmerleuten in Zürich, Stadthaus Baden, Hauptwache und Käfigturm in Bern.

**Bewusste Lücken** (stehen so in der Erklärung des Felds): Das ISOS (Bundesinventar der schützenswerten Ortsbilder) wirkt bei Baubewilligungen über die kantonale Planung, ist über geo.admin aber nicht parzellenscharf abfragbar (siehe Kandidaten). Der kommunale oder kantonale Denkmalschutz des Gebäudes selbst steht in keinem Bundeslayer. Kulturgüterschutz ist kein Denkmalschutz im engen Sinn.

---

## oereb · ÖREB-Kataster (AG, ZH, BE)

| | |
|---|---|
| Datenhalter | Kantone, katasterführende Stellen: AG Abteilung Geoinformation (AGIS), ZH Amt für Raumentwicklung (GIS-ZH), BE Amt für Geoinformation |
| Endpoint | `GET <base>/extract/json?EGRID=<EGRID>`. Basis pro Kanton in `src/adapters/oereb/kantone.ts`: AG `https://api.geo.ag.ch/v2/oereb`, ZH `https://maps.zh.ch/oereb/v2`, BE `https://www.oereb2.apps.be.ch`. Daneben `<base>/versions/json` (nennt die Basis selbst) und `<base>/capabilities/json` (Themenliste). Norm: ÖREB-Webservice «Aufruf eines Auszugs», Version extract-2.0 (OeREBKRMtrsfr_V2_0), JSON nach openoereb-Schema. |
| braucht | `egrid`, `kanton`. Manifest `cantons: AG, ZH, BE`; andere Kantone bekommen `ausser_kanton` und im Steckbrief die Lücke `quelle_ausser_kanton`. |
| Fakten | `zone.bezeichnung`, `.code`, `.anteil_prozent`, `.anzahl`, `zone.weitere.<n>.{bezeichnung, code, anteil_prozent}`, `zone.baureglement_url`, `.baureglement_titel`, `parzelle.flaeche_grundbuch_m2` (Confidence 1), `laerm.empfindlichkeitsstufe` (I, II, III, IV), `.empfindlichkeitsstufe_text`, `.empfindlichkeitsstufe_anteil_prozent`, `oereb.<thema>.{betroffen, thema, text, anteil_prozent, laenge_m, zustaendig, zustaendig_url}`, `oereb.belastungen`, `.belastungen_anzahl`, `.aenderungen_hangig_anzahl`, `.auszug_pdf_url`, `.kataster_url`, `.kataster_stelle`, `.kataster_adresse`, `zone.zustaendig`, `.zustaendig_url`, `laerm.zustaendig`, `.zustaendig_url` |
| Version | 2 (16.10.2026: zuständige Stellen aus ResponsibleOffice und PLRCadastreAuthority) |
| source_date | `UpdateDateCS` (Stand des Katasters, nicht des Abrufs) |
| TTL | 14 Tage |
| Timeout | 20 s (Extracts brauchen 1 bis 2 s, PDFs bis 11 s, die holen wir aber nicht) |
| Status | verifiziert 15.10.2026 an fünf Parzellen in drei Kantonen · Fixtures `oereb-be-wabern.json`, `oereb-ag-baden.json`, `oereb-zh-zuerich.json`, `oereb-zh-winterthur.json` (echte Antworten, mit `_hinweis`) |

**Antwortform** (gekürzt, BE Wabern):

```json
{ "GetExtractByIdResponse": { "extract": {
    "UpdateDateCS": "2026-10-06T00:00:00",
    "RealEstate": { "EGRID": "CH586746359755", "Number": "5711", "IdentDN": "BE0200000051", "Canton": "BE",
      "MunicipalityName": "Köniz", "MunicipalityCode": 355, "LandRegistryArea": 761,
      "RestrictionOnLandownership": [ {
        "Theme": { "Code": "ch.Nutzungsplanung", "SubCode": "ch.NutzungsplanungGrundnutzung", "Text": [ { "Language": "de", "Text": "Zonenflächen der Grundnutzung" } ] },
        "LegendText": [ { "Language": "de", "Text": "Wohnzone (Art. 29 BauR), Bauklasse IIa (Art. 53 BauR)" } ],
        "TypeCode": "102_2", "Lawstatus": { "Code": "inForce" }, "AreaShare": 761, "PartInPercent": 100,
        "LegalProvisions": [ { "Title": [ { "Language": "de", "Text": "Baureglement Gemeinde Koeniz …" } ], "TextAtWeb": [ { "Language": "de", "Text": "https://oerebfiles.apps.be.ch/…/721.0_Baureglement.pdf" } ] } ] } ] },
    "ConcernedTheme": [ … ], "NotConcernedTheme": [ … ], "ThemeWithoutData": [ … ],
    "PLRCadastreAuthority": { "OfficeAtWeb": [ { "Language": "de", "Text": "https://www.be.ch/oerebk" } ] } } } }
```

Kantonale Eigenheiten, alle im Schema abgefangen: ZH nennt die Hülle `Extract` (gross) und schreibt `Theme.code` klein; AG und BE
`extract` und `Code`. Texte sind Listen `{Language, Text}`, wir nehmen `de`, sonst den ersten. Linienthemen (Baulinien) haben
`LengthShare` statt `PartInPercent`. Mit `Lawstatus.Code` ≠ `inForce` (z.B. `changeWithPreEffect`) ist ein Eintrag hängig und
zählt nur in `oereb.aenderungen_hangig_anzahl`. Antwort 204 ohne Inhalt heisst «EGRID in diesem Kataster unbekannt»
(ZH, geprüft mit der Berner EGRID) und ist `EmptyResultError`, kein Ausfall.

**Grundnutzung erkennen.** Unter `ch.Nutzungsplanung` stehen Grundnutzung (Wohnzone, Kernzone …) und überlagernde Festlegungen
(Gestaltungsplan, Kernzonenplan, Baumschutz) nebeneinander. BE kennzeichnet die Grundnutzung mit `Theme.SubCode`
`ch.NutzungsplanungGrundnutzung` (Regel gilt überall, wo ein SubCode steht). ZH und AG setzen am Eintrag keinen SubCode; dort
entscheidet der `TypeCode` nach der Code-Systematik des minimalen Geodatenmodells Nutzungsplanung (ARE, Katalog Hauptnutzung_CH):
1x Bauzonen (11 Wohn-, 12 Arbeits-, 13 Misch-, 14 Zentrums-, 15 Zonen für öffentliche Nutzungen …), 2x Landwirtschafts-,
3x Schutz-, 4x weitere Zonen; 5x und 6x sind kantonale Codes für überlagernde Festlegungen und Sondernutzungspläne
(61 Gestaltungsplan). ZH stellt ein «C» voran. Belege: AG 145101 Kernzone, 121101 Arbeitszone, 611201_2897 Gestaltungsplan,
691101 Hochhausperimeter; ZH C130701 Kernzone, C150101 Zone für öffentliche Bauten, C310206 und C320101 Freihalte- und Gewässer-
zonen, C610102 Gestaltungsplan, C690401 Kernzonenplan, C691041 Baumschutz. Weil das eine Einordnung ist, tragen zone.*-Fakten in
AG und ZH Confidence 0.95, in BE 1. Hauptzone ist die Grundnutzung mit dem grössten `PartInPercent`, die übrigen stehen als
`zone.weitere.<n>.*`. Der Legendentext wird unverändert gezeigt (Zürich: «siehe gültige Bau- und Zonenordnung der Stadt Zürich (K)»),
es wird nichts hineininterpretiert.

**Lärm-Empfindlichkeitsstufe.** Thema `ch.Laermempfindlichkeitsstufen` (BE zusätzlich `ch.BE.Regionale…`, `ch.BE.Kantonale…`).
Stufe aus der Legende («Empfindlichkeitsstufe III») oder dem TypeCode (AG `ES_III`, ZH `laermempfindlichkeitsstufen_3_0`), Eintrag mit
dem grössten Anteil zuerst. «Empfindlichkeitsstufe keine» (ZH, Gewässer) ergibt keine Stufe. Köniz führt das Thema im Kataster, die
Parzelle Wabern ist aber bei allen drei Lärm-Themen in `NotConcernedTheme`: keine Stufe, kein Grenzwert, keine Annahme.

**Weitere Themen** (`oereb.<thema>.*`): alle rechtskräftigen Einträge ausser Grundnutzung und Lärmstufen, gruppiert nach Thema.
Slug aus dem Themencode ohne `ch.` und Kantonspräfix (`ch.BE.Gewaesserschutzbereiche` → `gewaesserschutzbereiche`,
`ch.BelasteteStandorte` → `belastete_standorte`, `ch.ZH.Baulinien` → `baulinien`). Überlagernde Nutzungsplanung heisst einheitlich
`nutzungsplanung_ueberlagernd`. Pro Thema: `betroffen` true, `thema` (Name laut Kataster), `text` (Legenden, mit «; » verbunden),
`anteil_prozent` (grösster Flächenanteil) oder `laenge_m` (Summe der Linienlängen).

**Zuständige Stellen (Version 2, 16.10.2026).** Jede Beschränkung trägt `ResponsibleOffice {Name[], OfficeAtWeb[]}` (ZH zusätzlich `UID`, `Line1`, `Line2`, `Street`, `Number`, `PostalCode`, `City`), der Extract als Ganzes `PLRCadastreAuthority {Name[], OfficeAtWeb[], Street, Number, PostalCode, City}` (ZH mit `Line1`/`Line2`). Daraus: `zone.zustaendig`/`.zustaendig_url` (Stelle der Grundnutzung), `laerm.zustaendig`/`.zustaendig_url` (Stelle der Empfindlichkeitsstufe), `oereb.<thema>.zustaendig`/`.zustaendig_url` (erste Stelle der Gruppe), `oereb.kataster_stelle` und `oereb.kataster_adresse` (Street Number, PostalCode City; `Line1`/`Line2` bleiben weg; `Number` kann null sein). Alles optional im Schema, nichts bricht, wenn es fehlt. Belege: Wabern Grundnutzung → Gemeinde Köniz / koeniz.ch, Sicherheitszonenplan → Bundesamt für Zivilluftfahrt BAZL, Gewässerschutzbereiche → Amt für Wasser und Abfall des Kantons Bern; Baden → Baden / baden.ch (Zone und Lärm); Zürich → Stadt Zürich (Zone, Lärm, Baulinien); Winterthur → Stadt Winterthur, belastete Standorte und Gewässerraum → Amt für Abfall, Wasser, Energie und Luft (die Quelle hat ein Leerzeichen am Ende der URL, wird getrimmt). Katasterstellen: BE Amt für Geoinformation, Reiterstrasse 11, 3013 Bern; AG Vermessungsamt, Bahnhofplatz 3c, 5001 Aarau; ZH Amt für Raumentwicklung, Stampfenbachstrasse 12, 8090 Zürich.

**Was nicht im Kataster steht und wir darum nicht liefern:** Ausnützungsziffer, Geschosszahl, Grenzabstände, Gebäudehöhen. Das
regelt das kommunale Baureglement (BE), die Bau- und Nutzungsordnung (AG) bzw. die Bau- und Zonenordnung (ZH). Wenn der Extract
sie unter `LegalProvisions` der Hauptzone nennt, geben wir den Link als `zone.baureglement_url` weiter. In der App bleibt
«Ausnützung» eine Lücke «nicht im Kataster».

**Belege 15.10.2026**

| Parzelle | Zone | Anteil | ES | Grundbuch | weitere Themen |
|---|---|---|---|---|---|
| Wabern BE, Köniz 5711 | Wohnzone (Art. 29 BauR), Bauklasse IIa (Art. 53 BauR), Code 102_2 | 100 % | nicht im Kataster | 761 m² (AV-Geometrie: 764) | Sicherheitszonenplan (Flughafen Bern), Gewässerschutzbereich üB |
| Baden AG, 3258 | Kernzone 5 [K5], Code 145101 | 100 % | III | 394 m² | Gestaltungsplan Innenstadt Nord (überlagernd) |
| Klingnau AG, 1493 | Arbeitszone Chnochnerwies [A], Code 121101 | 100 % | III | 4308 m² | keine |
| Zürich ZH, AA5662 | siehe gültige BZO der Stadt Zürich (K), Code C130701 | 97 % (FP 3 %) | III | 513 m² | Kernzonenplan (dazu hängige Änderung), Baulinien 34 m |
| Winterthur ZH, ST9255 | Zone für öffentliche Bauten (Oe), Code C150101 | 100 % (Gewässer 0 %) | II | 26 087 m² | Gestaltungsplan, Ergänzungspläne, Baumschutz, Baulinien, belasteter Standort 1 %, Gewässerraum 8 % |

**Probiert 15.10.2026:** `www.oereb.apps.be.ch` antwortet identisch zu `www.oereb2.apps.be.ch` (beide nennen sich selbst als Basis;
die AGI-Dokumentation nennt oereb2). AG liefert auch `extract/xml` (76 KB), nicht gebraucht. `extract/pdf?EGRID=` liefert bei
allen drei Kantonen den amtlichen Auszug (BE 0.6 MB in 4.6 s, AG 0.7 MB in 5.8 s, ZH 1.1 MB in 10.7 s), das ist `oereb.auszug_pdf_url`.
Falsche Pfade (`api.geo.ag.ch/oereb/…`, `www.ag.ch/app/oereb/…`, `www.oereb.apps.be.ch/oereb/v2/…`) geben 404.
Datenstand: AG und ZH setzen `UpdateDateCS` auf den Abruftag, BE auf den letzten Datenimport (06.10.2026).

---

## zustaendige-stellen · Grundbuchamt und Nachführungsgeometer

| | |
|---|---|
| Datenhalter | swisstopo, Amtliche Vermessung Schweiz (Geometa-Layer, Daten der Kantone) |
| Endpoint | `GET …/MapServer/identify?geometry=<E>,<N>&geometryType=esriGeometryPoint&sr=2056&layers=all:ch.swisstopo-vd.geometa-grundbuch,ch.swisstopo-vd.geometa-nfgeom&tolerance=0&returnGeometry=false&lang=de` (ein Request, beide Layer) |
| braucht | `lv95_bau` |
| liefert Keys | keine |
| Fakten | Bei genau einem Grundbuchkreis: `grundbuch.kreis`, `.ortsteil` (nur wenn eindeutig), `.fuehrung`, `.adresse`, `.telefon`, `.email`. Bei mehreren: nur `grundbuch.kreise_anzahl` und `grundbuch.hinweis`. Dazu `vermessung.geometer_firma`, `.geometer_adresse`, `.geometer_telefon`, `.geometer_email`. Alle Confidence 1. |
| TTL | 90 Tage |
| Status | verifiziert 16.10.2026 (Live-Test an den fünf goldenen Adressen) · Fixtures `stellen-wabern.json`, `stellen-zuerich.json`, `stellen-baden.json` (echte Antworten vom 15.10.2026) |

**Gelesene Felder.** `ch.swisstopo-vd.geometa-grundbuch`: `ortsteil_grundbuch`, `grundbuchfuehrung_d`, `grundbuchkreis`, `adresse` (Zeilen mit «#» getrennt: «Poststrasse 25#3071 Ostermundigen» → «Poststrasse 25, 3071 Ostermundigen»), `telefon`, `email`. Nicht gelesen: `fid`, `grundbuchfuehrung_f/_i`, `bgdi_created`, `label`. `ch.swisstopo-vd.geometa-nfgeom`: `stellvertreter`, `firmenname`, `adresse`, `telefon`, `email`. Nicht gelesen: `name` (eine Person, bleibt draussen: keine Personendaten im Core), `bgdi_created`, `label`. Werte können null, «-» oder «# » sein (leere Einträge).

**Regeln.** Grundbuch-Einträge ohne Kreis oder mit «-» fliegen raus. Gleicher Kreis mit gleichem Kontakt zählt als einer (Baden: Ortsteile Baden und Turgi am selben Punkt, ein Grundbuchamt). Bleibt genau einer: Kontaktdaten als Fakten, der Ortsteil nur, wenn alle Einträge denselben nennen. Bleiben mehrere (Zürich: 21 Ortsteil-Einträge mit 11 Kreisen; Winterthur: 3 Kreise): nur `grundbuch.kreise_anzahl` und `grundbuch.hinweis` («Die Gemeinde hat N Grundbuchkreise. Die Amtliche Vermessung löst sie nicht räumlich auf, zuständig ist das Grundbuchamt bzw. Notariat des Quartiers.»), keine Kontaktdaten, kein erster Treffer. Der Layer ist nur auf Gemeindeebene aufgelöst. Bleibt keiner: `EmptyResultError`. Geometer: der Eintrag mit `stellvertreter=false` vor dem Stellvertreter.

**Belege 15./16.10.2026**

| Adresse | Grundbuch | Geometer |
|---|---|---|
| Wabern BE | Bern-Mittelland, Poststrasse 25, 3071 Ostermundigen, 031 635 93 00, gba.bemi@be.ch, eidg. Grundbuch ganz eingeführt | bbp geomatik ag, Könizstrasse 161, 3097 Liebefeld |
| Baden AG | Baden, Bahnhofstrasse 40, 5400 Baden, 056 200 09 40, gbabaden@ag.ch (zwei Ortsteil-Einträge, ein Amt) | Steinmann Ingenieure und Planer AG, Rütistrasse 2, 5400 Baden |
| Klingnau AG | Baden (Ortsteil Klingnau), gleicher Kontakt wie Baden | Reto Porta Nachführungsgeometer Kreis Zurzach, Quellenstrasse 3, 5330 Bad Zurzach |
| Zürich ZH | 11 Grundbuchkreise, Hinweis statt Kontakt | Stadt Zürich, Geomatik + Vermessung, Weberstrasse 5, 8004 Zürich |
| Winterthur ZH | 3 Grundbuchkreise, Hinweis statt Kontakt | Stadt Winterthur, Departement Bau und Mobilität, Geomatik- und Vermessungsamt, Pionierstrasse 7, 8403 Winterthur |

**Bekannt, bewusst nicht genutzt:** `ch.swisstopo-vd.stand-oerebkataster` (ÖREB-Fachstelle pro Kanton, mit Telefon). Der ÖREB-Extract nennt die Katasterstelle schon selbst (`oereb.kataster_stelle`, `.kataster_adresse`, `.kataster_url`), ein zweiter Layer dafür wäre doppelt.

---

## derived · berechnet

Keine externe Quelle. Siehe ARCHITEKTUR.md Abschnitt 7. Seit 15.10.2026 auch: Lärm-Grenzwerte aus der Empfindlichkeitsstufe
(LSV Anhang 3) und bebauter Anteil bevorzugt mit der Grundbuchfläche. Seit 16.10.2026: Bahn-Grenzwerte aus derselben Stufe
(LSV Anhang 4 Ziff. 2, gegengeprüft im Gesetzestext), nur wenn ein Bahnpegel am Punkt kartiert ist.

---

## Kandidaten (noch nicht gebaut)

| Quelle | Layer / API | Hinweis |
|---|---|---|
| ÖREB-Kataster weitere Kantone | gleiche Norm, Basis-URL je Kanton in `kantone.ts` eintragen und Fixture aufnehmen | AG, ZH, BE sind drin. Verzeichnis: cadastre.ch/oereb-webservice |
| Naturgefahren (Hochwasser, Rutsch, Sturz, Lawine) mit Gefahrenstufen | kantonal | kein Bundeslayer mit Gebäudeauflösung; Oberflächenabfluss, Aquaprotect und Erdbebenzonen sind seit 16.10.2026 drin (Adapter naturgefahren) |
| swissBUILDINGS3D | swisstopo | Gebäudehöhe, Dachform, Volumen |
| ISOS (Ortsbilder) | `ch.bak.bundesinventar-schuetzenswerte-ortsbilder` | Geprüft 16.10.2026, ausgelassen: api3 `identify` liefert nur Ortsbild-Punkte (ein Punkt pro Ortsbild, Felder name, nummer, siedlungskategorie, url; Bern Altstadt tolerance 0 leer, erst bei 2000 m «Bern, Stadt»), WMS GetFeatureInfo gibt für die Perimeter einen Serverfehler (GEOJSON-Treiber auf `…ortsbilder_perimeter`) bzw. leer. Punkt-in-Fläche ist damit nicht möglich; rechtsgültig sind laut BAK ohnehin nur die PDFs. Kantonaler Denkmalschutz: kein Bundeslayer. |
| Fernwärme-Angebot | `ch.bfe.fernwaerme-angebot`, `ch.bfe.thermische-netze` | Geprüft 16.10.2026, ausgelassen: `ch.bfe.fernwaerme-angebot` heisst «Potenzial Wärmenutzung ARA» (Wärmepotenzial der Abwasserreinigungsanlagen, Felder name, heatpotential, Datenstand 2017), nicht Fernwärme. `ch.bfe.thermische-netze` (Datenstand 14.10.2026) ist eine Punktliste der Netze (name, operator, place, energysource, power, energy, houseconnections; z.B. Holzenergieverbund Sennhof, Stadtwerk Winterthur) ohne Versorgungsgebiet; identify und GetFeatureInfo treffen am Gebäudepunkt nie. Kein Bundeslayer sagt, ob ein Gebäude Fernwärme bekommen kann. Ein «verfügbar: nein» aus einem Punktlayer wäre ein stiller Fehlwert, darum kein Adapter. |
| Altlasten | kantonale Kataster, teils Bund (`ch.bafu.kataster-belasteter-standorte*`) | |
| Erdwärmesonden-Zulässigkeit | kantonale Wärmenutzungskarten | |
| Seismische Baugrundklassen | `ch.bafu.gefahren-baugrundklassen` | identify-fähig, aber nicht schweizweit (Wabern «C», Zürich nichts) |
| Amtsblattportal | amtsblattportal.ch API | Baugesuche, Handänderungen (kantonsabhängig) |
| BFS Gemeindedaten | BFS STAT-TAB / opendata.swiss | Steuerfuss, Leerwohnungsziffer |
| Zeitreise Luftbilder | swisstopo WMTS | nur Bild, Fun Fact |
