# grundpass · Design-Prototyp und Mapping zum Core

Der Prototyp entstand am 14./15.10.2026 als Claude-Design-Canvas. Hier liegt er als Dateien, damit die App
(separates Repo `grundpass-app`, SvelteKit) daraus gebaut werden kann. **Dieser Ordner ist Referenz für die App,
nicht Teil des Core.** Er zieht nach `grundpass-app/design/` um, sobald das Repo existiert.

## Dateien

| Datei | Was |
|---|---|
| `vorschau/index.html` | Startseite, 390 px, im Browser direkt öffnen |
| `vorschau/resultat.html` | Steckbrief-Seite (Startzustand: Gate noch nicht gewählt, Wohnfläche fehlt) |
| `vorschau/pass.html` | Der Pass als A4-Seite (PDF-Export) |
| `vorschau/dag.html` | Resolver-DAG, Architekturbild |
| `quelle/*.dc.html` | Original-Artboards im Design-Component-Format. `{{accent}}` = Akzentfarbe, `<sc-if value="{{x}}">` = Zustand, `href="Resultat.dc.html"` = Navigation. Interaktive Logik steht im `<script type="text/x-dc">` am Ende jeder Datei. |
| `quelle/canvas.json` | Layout der Artboards auf dem Canvas |

Die Vorschau-Dateien sind aus den Quellen generiert (Zustände auf Startzustand reduziert, Events entfernt). Die Quellen sind massgebend.

## Vibe in einem Satz

swisstopo trifft Indie-Tool: weiss, viel Luft, Zahlen in Monospace, Quelle und Stand an jeder Zahl, ein echter Mensch im Footer, keine Stockfotos, keine Verläufe, keine „Jetzt kostenlos!“-Knöpfe. Ehrlich darüber, wer dahintersteht (Footer: „Ein Projekt der AV Schmid Immobilien AG“ bzw. künftig „ein Angebot von vugg.ch“), aber nicht corporate.

## Tokens

| Token | Wert |
|---|---|
| Schrift Text | IBM Plex Sans 400/500/600 |
| Schrift Zahlen, Labels, Meta | IBM Plex Mono 400/500 |
| Text | `#141414` |
| Text sekundär | `#3d3d3d` |
| Text gedämpft (Quellen, Stand) | `#5c5c5c` |
| Linien | `#e3e3e0`, Trennlinien in Listen `#ececea` |
| Fläche gedämpft | `#f4f4f2`, Karte `#f7f7f5` |
| Akzent (CTA, Parzelle, Pass-Stempel) | `#d8232a` (Schweizer Rot). Alternativen im Prototyp: `#141414`, `#1f4e9c` |
| Akzent hell (Hinweisbox Baureserve) | `#fbe9e8`, Parzellenfüllung `#f3c6c3` |
| Radius | 4 px Inputs/Buttons, 6 px Karten, 3 px Chips |
| Seitenrand mobil | 20 px |
| Touch-Ziele | 44 px, Haupt-CTA 52 px |
| Max. Breite | 760 px zentriert |

Kein Dark Mode im Prototyp. Wenn, dann später mit denselben Tokens.

## Seitenstruktur

### Startseite (`index.html`)
1. Header: Wortmarke `grundpass` (Mono) + Versions-Chip (`v0.4`), Links „Warum?“ und „Quellen“.
2. Hero: Overline Mono uppercase, H1 32 px „Gib eine Adresse ein. Wir zeigen dir, was der Bund über das Grundstück weiss.“, ein Satz Erklärung.
3. Adressfeld (Mono, 52 px) + roter CTA „Steckbrief anzeigen“ + Beispiel-Link.
4. „Was du siehst“: 6 Karten im 2er-Grid (Gebäude, Parzelle, Zone, Lage, Sonne, Risiken), nummeriert 01–06.
5. „Quellen, alle offen“: Liste Quelle · Halter · Rhythmus, Mono.
6. „Warum gibt es das?“: grauer Block, drei Sätze, der wichtigste Text der Seite.
7. Changelog: vier Zeilen, Mono. Signal: hier arbeitet jemand mit Freude.
8. Footer: Avatar-Initialen, Name, Telefon; Zeile „Gebaut in Baden · Code auf GitHub · kein Tracking, keine Cookies“; Betreiber, Impressum, Datenschutz.

### Resultat (`resultat.html`)
1. Header mit „Neue Adresse“.
2. Kopf: Chip, H1 Adresse, Gemeinde, Mono-Zeile EGID · EGRID · Parzelle.
3. Lageplan (SVG-Platzhalter, in der App: swisstopo-Kacheln, Parzelle rot umrandet).
4. Karten 01–06, jede mit `<dl>` Label/Wert, Erklärung in einem Satz, Quelle + Stand als Mono-Fusszeile.
   - Lücken werden als Wert gezeigt („fehlt im Register“), nicht versteckt. Darunter ein Eingabefeld „Weisst du die Wohnfläche?“ → wird Fakt mit `source: owner`.
   - Zone ist die hervorgehobene Karte (1.5 px Rahmen) mit Hinweisbox „Baureserve wahrscheinlich“. Das ist App-Logik, nicht Core.
5. Umfeld-Kacheln (3er-Grid): Ø Baujahr Strasse, Baugesuche, Verkäufe.
6. Gate „Und was ist es wert?“: zwei Buttons. Eigentümer:in → Preisspanne + E-Mail + drei Follow-ups (Wert verfolgen, Potenzial prüfen lassen, PDF). Käufer:in → Suchprofil (Region, Budget, E-Mail).
7. Footer wie Startseite, Zeile „Stimmt etwas nicht?“.

### Pass (`pass.html`, A4 794×1123)
Doppelter Rahmen, Guilloche-Muster sehr leicht in Akzentfarbe, Kopf „Schweizerische Eidgenossenschaft · Grundstück / Grundpass / Property passport“ mit Pass-Nr. `GP-<parzelle>-<4 Ziffern>`. Links Parzellenplan als „Passbild“ und Parzellenumriss als „Unterschrift“. Rechts Felder zweisprachig DE/EN. Darunter Register-Stempel (doppelter Rahmen, leicht gedreht, Quelle + Datum), Kennzahlen-Zeile, Vermerke-Box, MRZ-Zeile in Mono, Mikroschrift. Pflicht: „Ausgestellt von grundpass.ch · kein Amt“ und „Kein amtliches Dokument“ müssen stehen bleiben.

## Mapping Core-API → Seite

`GET /v1/steckbrief?adresse=…` liefert `Steckbrief` (siehe `src/views/steckbrief.ts`). So landet er auf der Seite:

| Seite | Quelle im Steckbrief |
|---|---|
| Kopf: Adresse, Gemeinde, Kanton, EGID, EGRID, Parzelle | `adresse.{label, gemeinde, kanton, egid, egrid, parzelle}` |
| Karte 01 Gebäude | `abschnitte[id=gebaeude]` + `abschnitte[id=heizung]`. Felder: `gebaeude.baujahr` oder `gebaeude.bauperiode`, `gebaeude.klasse_kurz`, `gebaeude.geschosse`, `wohnungen.zimmer_total`, `gebaeude.heizung.kurz`, `wohnungen.flaeche_total_m2` |
| Lücke „fehlt im Register“ | `luecken[]` mit `grund = fehlt_im_register`; Eingabefeld nur bei `key in {wohnungen.flaeche_total_m2, gebaeude.baujahr}` |
| Karte 02 Parzelle | `abschnitte[id=parzelle]` + `parzelle.bebauter_anteil_prozent` aus `abgeleitet`; „Lage: Eckparzelle“ ist noch kein Core-Fakt |
| Karte 03 Zone | **noch kein Adapter** (ÖREB). Bis dahin Karte mit Zustand „Quelle folgt“ oder ausblenden. Baureserve-Hinweis ist App-Heuristik aus `bebauter_anteil_prozent`, Zone, AZ |
| Karte 04 Lage | `oev.gueteklasse`, `oev.gueteklasse_text`, `laerm.strasse.tag_db`, `laerm.strasse.grenzwert_wohnzone_tag_db`; Erklärungssatz aus `erklaerung` |
| Karte 05 Sonne | `solar.klasse_text`, `solar.einstrahlung_max_kwh_m2a`, `solar.stromertrag_kwh_a`, `solar.finanzertrag_chf_a`. Hinweis: Der Prototyp zeigt „Sonnenstunden“, das gibt es im Datensatz nicht; stattdessen Einstrahlung kWh/m²/a |
| Karte 06 Risiken | `radon.wahrscheinlichkeit_prozent`, `radon.einstufung`; Hochwasser/Oberflächenabfluss **noch kein Adapter** |
| Quelle + Stand pro Karte | jedes Feld hat `quelle_titel`, `stand`, `url`; pro Karte die Quelle des ersten Feldes |
| Umfeld-Kacheln | **noch kein Core-Fakt** (Avendo bzw. Amtsblatt). Erst einbauen, wenn Daten da sind |
| Gate, Preisspanne, Suchprofil, E-Mail | App. Preis via Avendo-API, Lead ins CRM. Nichts davon berührt den Core |
| Pass-Felder | gleiche Keys wie oben; `Daten erneuern bis` = `erstellt_am` + 6 Monate; Stempel = `quellen[]` mit `status in {ok, cached}` und `stand` |
| Footer „Quellen“ | `attribution[]` |
| Status `partial` (HTTP 206) | Banner „Nicht alle Quellen erreichbar“ + `luecken[]` mit `grund != fehlt_im_register` |

## Was die App zusätzlich braucht (nicht im Core)

- Routing-Regel Mandat / Direktankauf / Property Butler
- Avendo-Preis, Lead-Übergabe ins CRM, E-Mail „Wert verfolgen“ (Monats-Diff aus `/v1/lauf`)
- Baureserve-Heuristik (Zone, AZ, bebauter Anteil) mit klarer Kennzeichnung als Einschätzung
- swisstopo-Karte (WMTS `ch.swisstopo.pixelkarte-grau` oder `ch.kantone.cadastralwebmap-farbe`) mit Parzellengeometrie aus `av-parzelle` (Geometrie müsste der Core dafür als Fakt mitgeben: offen)
- PDF-Export des Passes (Server-Render, A4)
- Einwilligung vor dem Speichern der E-Mail (nDSG), kein Tracking
