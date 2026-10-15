# grundpass-core · Architektur

Lebende Beschreibung, was wie funktioniert. Wird mit jedem Commit nachgeführt (Regel in `CLAUDE.md`).
Stand: siehe Changelog am Ende.

## 1. Was das Ding tut

Adresse rein, Fakten raus. Jeder Fakt trägt Quelle, Abruf-URL und Stand. Nichts wird geraten, Lücken werden benannt.

```
"Maygutstrasse 26, 3084 Wabern"
   │
   ▼
geocode ──► EGID 1271632, Adresspunkt LV95
   │
   ▼
gwr ──────► EGRID, Gebäudepunkt LV95, BFS-Nr, Kanton, Parzellen-Nr  +  ~45 Fakten (Baujahr, Heizung, Wohnungen …)
   │
   ├──► av-parzelle   (braucht Gebäudepunkt)       Parzellenfläche, Geometrie
   ├──► sonnendach    (braucht Gebäudepunkt)       Solarpotenzial
   ├──► oev-gueteklasse                            A bis D
   ├──► radon                                      Wahrscheinlichkeit in %
   ├──► laerm-strasse                              dB Tag/Nacht
   └──► oereb         (braucht EGRID + Kanton; AG, ZH, BE)   Zone, Grundbuchfläche, Lärm-ES, weitere Beschränkungen
   │
   ▼
derived ──► bebauter Anteil, Gebäudealter, Wohnfläche total, Lärm-Grenzwerte aus der Empfindlichkeitsstufe
   │
   ▼
Fakten-Store (Postgres/PGlite)  ──►  Steckbrief (Abschnitte, Lücken, Quellen)  ──►  API / CLI / Pass
```

Die Stufen oben sind nicht fest verdrahtet. Sie ergeben sich zur Laufzeit aus den Manifesten (Abschnitt 4).

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| **Key** | Schlüssel, über den Adapter zusammenhängen: `adresse`, `egid`, `egrid`, `lv95`, `lv95_bau`, `bfs_nr`, `kanton`, `parzelle_nr`. Typ `Keys` in `src/types.ts`. |
| **Fakt** | Atomare Aussage: `key`, `value`, `unit`, `source`, `fetched_at`, `request_url`, `confidence`, `run_id`, optional `source_date`, `derived_from`. |
| **Subject** | Wem ein Fakt gehört: immer `egid:<EGID>`. Ohne EGID (Adresse nicht gefunden) `adresse:<normalisiert>`. |
| **Adapter** | Modul mit Manifest + `resolve(ctx)`. Macht aus Keys Fakten und neue Keys. Kennt keinen anderen Adapter. |
| **Manifest** | `id, title, provider, needs, yields, provides, ttlDays, timeoutMs, cantons, license, attribution, endpoint, status, notes`. |
| **Lauf (Run)** | Ein Durchgang des Resolvers für eine Eingabe. Hat `run_id`, Bericht pro Adapter, alle Fakten, `partial`-Flag. |
| **Steckbrief** | View über die Fakten eines Laufs: Abschnitte mit Feldern, Lücken, Quellenliste, Attribution. |
| **Canary** | Regelmässiger Lauf (Cron, auf Vercel täglich) über fünf goldene Adressen, vergleicht mit Baseline, alarmiert. |

## 3. Ordnerstruktur

```
src/
  types.ts            alle Typen (Keys, Fact, Adapter, Manifest, RunResult)
  errors.ts           HttpError, TimeoutError, SchemaDriftError, EmptyResultError
  keys.ts             subjectFor, missingNeeds (a|b-Syntax), mergeKeys, pickKey
  log.ts              JSON-Zeilen-Logger
  core.ts             Core: Registry + Store + HTTP + Breaker zusammengesteckt
  index.ts            öffentliche API des Pakets
  cli.ts              gp "<Adresse>"
  http/
    client.ts         fetch mit Timeout, Retry (1x bei 5xx), User-Agent, Zod-Parse
    geoadmin.ts       URL-Bauer für SearchServer, find, identify, WMS GetFeatureInfo + gemeinsame Schemas
  codes/gwr.ts        GWR-Codetabellen (nur sichere Codes)
  adapters/           ein Adapter pro Datei, index.ts = Liste
    oereb/kantone.ts  Kantonstabelle des ÖREB-Adapters (Basis-URL, Regel für die Grundnutzung, Confidence)
  resolver/
    registry.ts       Liste + Schalter (GP_DISABLED_ADAPTERS, Laufzeit)
    plan.ts           statischer Plan aus Manifesten (Stufen, Unerreichbares)
    run.ts            der Resolver (Abschnitt 4)
    breaker.ts        Circuit Breaker pro Adapter
    derive.ts         berechnete Fakten
  facts/
    store.ts          Interface FactStore
    memory.ts         In-Memory (Tests, --memory)
    sql.ts            SqlStore + Schema (PGlite und node-postgres)
    index.ts          createStore nach Umgebung
  views/
    felder.ts         Feldkatalog: Key → Label, Abschnitt, Erklärung, erwartet
    steckbrief.ts     buildSteckbrief, steckbriefAlsText
  api/
    app.ts            Hono-Routen
    server.ts         Node-Server
  canary/
    adressen.ts       goldene Adressen, stabile Keys
    run.ts            runCanary
    alert.ts          ntfy
    cli.ts            pnpm canary
test/
  fixtures/           echte Antwortformen (15.10.2026), eine Datei pro Quelle
  helpers/fixtures.ts fakeFetch: URL-Prädikat → Fixture
  *.test.ts           offline
  live/               nur mit LIVE=1
docs/
  ARCHITEKTUR.md      diese Datei
  QUELLEN.md          jede Quelle: Endpoint, Felder, Codes, Lizenz, TTL, Status
  ADAPTER-SCHREIBEN.md Anleitung
```

Der Design-Prototyp (Start, Resultat, Pass, DAG, Mapping Steckbrief → Seite) lag kurz unter `docs/design/` und ist am 15.10.2026 nach `grundpass-app/design/` umgezogen. Er ist Referenz für die App, nicht Teil des Core.

## 4. Der Resolver (`src/resolver/run.ts`)

Kein fester Ablauf. Eine Schleife:

```
keys = Eingabe
solange es aktive Adapter gibt, die noch nicht gelaufen sind und deren `needs` in `keys` erfüllt sind:
    diese Adapter parallel laufen lassen        ← eine Stufe
    gelieferte Keys einsammeln (erster Schreiber gewinnt, Konflikt wird geloggt)
danach: alle nicht gelaufenen Adapter einordnen (skipped / nicht_anwendbar / disabled)
derived-Fakten rechnen
Lauf speichern
```

**needs-Syntax:** Liste von Key-Namen. `a|b` heisst a oder b. Eine Kantons-Einschränkung (`cantons`) zählt wie ein zusätzlicher Bedarf an `kanton`.

**Pro Adapter in einer Stufe:**
1. Breaker offen? → `open_circuit`, kein Aufruf.
2. Subject bekannt und letzter `ok`-Lauf jünger als `ttlDays`? → `cached`, Fakten und Keys aus dem Store, kein Aufruf.
3. Sonst `resolve(ctx)` mit Timeout (`timeoutMs`, Standard 10 s). Fakten bekommen `subject`, `source`, `fetched_at`, `run_id`, `confidence` (Standard 1).
4. Erfolg → Breaker zurücksetzen, `adapter_runs` + `facts` speichern.
5. Fehler → Klasse bestimmen (`http`, `schema`, `timeout`, `empty`, `other`), Breaker zählen (ausser bei `empty`), Fehlerlauf speichern. Der Lauf geht weiter.

**Status pro Adapter im Bericht:**

| Status | Bedeutung | zählt als `partial` |
|---|---|---|
| `ok` | gelaufen, Fakten geliefert | nein |
| `cached` | aus dem Store innerhalb TTL | nein |
| `failed` | Fehler, siehe `error_kind` | ja |
| `skipped` | Keys fehlen, weil ein vorgelagerter Adapter ausgefallen ist | ja |
| `nicht_anwendbar` | Keys fehlen, die bei dieser Eingabe nie entstehen (z.B. `geocode` bei Eingabe per EGID) | nein |
| `open_circuit` | Breaker offen | ja |
| `disabled` | per Flag abgeschaltet | nein |
| `ausser_kanton` | Adapter gilt nicht in diesem Kanton | nein |

**Subject:** `egid:<EGID>` sobald die EGID bekannt ist. Der geocode-Adapter liefert sie selbst, darum bekommen schon seine Fakten das EGID-Subject (Subject wird nach dem Merge seiner Keys bestimmt).

**Raster-Adapter brauchen `lv95_bau`** (Gebäudepunkt aus dem GWR), nicht den Adresspunkt. Grund: Der Adresspunkt liegt am Eingang und kann ausserhalb des Dachpolygons (Sonnendach) oder auf der Strassenparzelle (AV) liegen. Fällt das GWR aus, werden sie `skipped`. Das ist gewollt und sichtbar.

## 5. Circuit Breaker (`src/resolver/breaker.ts`)

Pro Adapter, im Prozess-Speicher. Nach 3 Fehlern in Folge 15 Minuten offen. Danach genau ein Versuch (halb offen). `empty`-Fehler zählen nicht: Eine Quelle, die korrekt "nichts" sagt, ist nicht kaputt. API-Prozesse teilen einen Breaker (`sharedBreaker`), Tests geben ihren eigenen mit.

## 6. Fakten-Store (`src/facts/`)

Drei Aufgaben: Cache, Gedächtnis, Snapshots. Interface `FactStore`, zwei Implementierungen:

- `MemoryStore`: Tests, `gp --memory`.
- `SqlStore` über ein Mini-Interface `SqlClient { query(sql, params) }`. Dahinter PGlite (Dev, Ordner `./data/grundpass`, kein Setup) oder node-postgres (`DATABASE_URL`, Prod z.B. Neon). Gleiche SQL, gleicher Code.

Tabellen:

| Tabelle | Inhalt |
|---|---|
| `adapter_runs` | ein Eintrag pro Adapter und Lauf: Status, ms, cache_hit, error, keys (jsonb), request_url, fetched_at. Index auf (subject, adapter, status, fetched_at). |
| `facts` | ein Eintrag pro Fakt. value als jsonb. Index auf (subject, source, run_id) und (subject, key, source, fetched_at). |
| `runs` | kompletter `RunResult` als jsonb pro Lauf. Für Diffs und Debug. |
| `snapshots` | Key-Value: Canary-Baselines, letzter Canary-Report, letzter Alarm-Hash. |

**Cache-Regel:** `latestAdapterRun(subject, adapter)` liefert den jüngsten `ok`-Lauf mit seinen Fakten und Keys. Ist er jünger als `ttlDays`, wird der Adapter nicht aufgerufen. Gecachte Fakten behalten ihre ursprüngliche `fetched_at` und `run_id` (Herkunft bleibt wahr).

**Aktueller Stand:** `latestFacts(subject)` = jüngster Fakt pro (key, source). Mehrere Quellen für denselben Key sind erlaubt (z.B. `parzelle.egrid` aus GWR und aus AV); die View wählt nach Confidence, dann Aktualität.

Datenschutz: Subject ist die EGID, nicht die Adresse. Die Eingabe-Adresse steht nur im `runs.input` des Laufs. Keine Personendaten.

## 7. Abgeleitete Fakten (`src/resolver/derive.ts`)

Quelle `derived`, `derived_from` nennt die Eingangs-Keys, Confidence 0.9 (0.6 bei Bauperioden-Mitte).

- `parzelle.bebauter_anteil_prozent` = Gebäudegrundfläche / Parzellenfläche. Amtliche Grundbuchfläche (`parzelle.flaeche_grundbuch_m2`, ÖREB) vor der Geometrie-Schätzung (`parzelle.flaeche_m2`, AV); `derived_from` sagt, welche.
- `gebaeude.alter_jahre` aus Baujahr oder Mitte der Bauperiode
- `wohnungen.flaeche_total_m2`, `wohnungen.zimmer_total` über alle Wohnungen
- `laerm.strasse.grenzwert_tag_db`, `.grenzwert_nacht_db` aus `laerm.empfindlichkeitsstufe` (ÖREB) nach LSV Anhang 3, Strassenverkehr: ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60. Gesetzestabelle, keine Schätzung, darum Confidence 1. Ohne Stufe kein Grenzwert (bis 15.10.2026 nahm der Lärm-Adapter pauschal ES II an).

Nur Rechnung, keine Meinung. Baureserve, Preis, Empfehlungen gehören in die App.

## 8. Fakten-Keys (Konvention)

Kleingeschrieben, Punkt-getrennt, Einheit im Namen. Präfixe:

`adresse.` · `gebaeude.` · `gebaeude.heizung.` · `gebaeude.warmwasser.` · `wohnung.<ewid>.` · `wohnungen.` · `parzelle.` · `zone.` (mit `zone.weitere.<n>.`) · `oereb.<thema>.` · `solar.` · `oev.` · `radon.` · `laerm.strasse.` · `laerm.empfindlichkeitsstufe`

Datengetriebene Keys (`wohnung.<ewid>.*`, `zone.weitere.<n>.*`, `oereb.<thema>.*`) stehen nicht im Feldkatalog, die Steckbrief-View bildet sie nach Muster. `parzelle.geometrie_geojson` steht bewusst nicht im Katalog: ein Fakt für Programme (Lageplan), nicht für die Lesefassung.

Codes aus Registern kommen doppelt: lesbar (`gebaeude.klasse`) und roh (`gebaeude.klasse_code`). Unbekannte Codes: lesbar `null`, roh gesetzt. Die vollständige Liste pro Quelle steht in `docs/QUELLEN.md`.

## 9. Steckbrief (`src/views/`)

`felder.ts` ist der Katalog: welcher Key unter welchem Label in welchem Abschnitt, mit Laien-Erklärung, und ob er `erwartet` ist. `buildSteckbrief(run, adapters)` baut daraus:

- `abschnitte`: Adresse, Gebäude, Heizung, Wohnungen, Parzelle, Zone und Kataster, Sonne, ÖV, Lärm, Radon, Berechnet, plus eine Karte pro Wohnung. Im Abschnitt Zone hängt die View datengetriebene Zeilen an: weitere Grundnutzungen (`zone.weitere.<n>.*`, Label mit Anteil) und jedes betroffene ÖREB-Thema (`oereb.<thema>.betroffen`, Label aus `.thema`, Wert aus `.text`, Anteil oder Länge in Klammern).
- Jedes Feld: `value`, `unit`, `quelle`, `quelle_titel`, `stand` (= `source_date` der Quelle, sonst Abrufdatum), `url`, `confidence`.
- `luecken`: jeder `erwartet`e Key ohne Wert, mit Grund: `fehlt_im_register`, `quelle_nicht_erreichbar`, `quelle_uebersprungen`, `quelle_abgeschaltet`, `quelle_ausser_kanton` (Adapter gilt nicht für diesen Kanton, `detail` nennt ihn). Welcher Adapter einen Key liefert, entscheidet das längste passende `provides`-Präfix (`parzelle.flaeche_grundbuch_m2` gehört zu oereb, nicht zu av-parzelle).
- `quellen`: Status pro Adapter, Stand, ms, Fehler, `experimentell`-Flag.
- `attribution`: Pflicht-Quellenangaben der genutzten Quellen, aus den Manifesten.

`steckbriefAlsText` ist die Terminal-Ausgabe der CLI.

## 10. API (`src/api/app.ts`)

| Route | Was |
|---|---|
| `GET /v1/steckbrief?adresse=…` oder `?egid=…` (`&nocache=1`) | Lauf + Steckbrief. HTTP 206 wenn `partial`. |
| `GET /v1/fakten?egid=…` | aktueller Stand aus dem Store, ohne neuen Lauf, plus letzte Läufe |
| `GET /v1/lauf/:run_id` | kompletter Lauf |
| `GET /v1/sources` | Manifeste, Plan ab `adresse`, Schalter, Breaker |
| `GET /v1/status` | `ok` / `degraded`, offene Breaker, letzter Canary pro Adapter |
| `POST /internal/canary` | Canary auslösen. `Authorization: Bearer $CANARY_TOKEN` |
| `POST /internal/adapters/:id/on|off` | Adapter schalten, Breaker zurücksetzen. Gleicher Token. |

Hono, läuft auf Node (`pnpm dev`). Der Core ist eine Library, die App kann ihn auch direkt importieren statt über HTTP.

## 11. CLI

```
pnpm gp "Maygutstrasse 26, 3084 Wabern"     Steckbrief als Text, Quelle und Stand pro Zeile
pnpm gp --egid 1271632
Optionen: --json  --lauf (mit --json: ganzer Lauf)  --nocache  --memory  --ohne-quellen
Exit-Code 1, wenn partial.
```

## 12. Canary und Alarm (`src/canary/`)

Fünf goldene Adressen (BE, AG, AG, ZH, ZH) laufen ohne Cache durch alle Adapter.

Alarm, wenn: ein Adapter `failed` (Klasse `http`, `schema`, `timeout` = error; `empty` = warn), `open_circuit`, `skipped`, Latenz über 5 s (warn), oder ein stabiler Fakt gegenüber der Baseline abweicht (warn). Stabile Keys: `gebaeude.egid`, `parzelle.egrid`, `parzelle.nummer`, `gebaeude.klasse_code`, `gebaeude.bauperiode_code`, `gebaeude.baujahr`, `adresse.bfs_nr`.

Beim ersten Lauf pro Adresse wird die Baseline gesetzt (`snapshots: canary:baseline:<adresse>`). Benachrichtigung über ntfy.sh (`NTFY_TOPIC`), dedupliziert über einen Hash der Alarmliste: dieselbe Störung meldet nur einmal, nach Erholung meldet sie wieder. Report liegt in `snapshots: canary:last` und speist `/v1/status`.

Auslösen: `pnpm canary` (Cron auf dem Server) oder `POST /internal/canary` (z.B. Vercel Cron).

## 13. Fehlerklassen

| Klasse | Wann | Breaker | Canary |
|---|---|---|---|
| `http` | Status ≥ 400 nach Retry | zählt | error |
| `timeout` | Abbruch nach `timeoutMs` | zählt | error |
| `schema` | Antwort passt nicht mehr zum Zod-Schema (Quelle hat umgebaut) | zählt | error |
| `empty` | Quelle korrekt, aber nichts zu diesem Objekt | zählt nicht | warn |
| `other` | alles andere | zählt | error |

`schema` ist der wichtigste Alarm: Die Quelle lebt, aber unsere Annahme stimmt nicht mehr. Dann Fixture neu aufnehmen, Schema anpassen.

## 14. Tests

- Offline (`pnpm test`): Fixtures aus `test/fixtures/`, `fakeFetch` bildet URLs auf Fixtures ab (Antwort ohne Inhalt per `body: null`, z.B. 204). 64 Tests: Adapter einzeln (ÖREB mit vier Kantons-Fixtures, 204, Drift, Kanton ohne Eintrag), Resolver (Stufen, Cache, Breaker, Kanton, Timeout, Ende-zu-Ende Wabern mit acht Adaptern), derived (Grenzwerte je ES, Grundbuchfläche vor Geometrie), Store (Memory und PGlite), API, Canary.
- Live (`pnpm test:live`, braucht Netz): Wabern gegen echte APIs, zeichnet rohe Antworten nach `test/live/aufzeichnungen/` auf (gitignored), darunter die WMS-GetFeatureInfo-Antworten für Lärm in drei INFO_FORMATs und die ÖREB-Extracts von Wabern, Baden und Zürich; prüft `versions/json` der drei Kantone und den 204-Fall in ZH.

## 15. Konfiguration (Env)

| Variable | Wirkung |
|---|---|
| `DATABASE_URL` | Postgres statt PGlite |
| `PGLITE_DIR` | Ordner für PGlite, Standard `./data/grundpass` |
| `NTFY_TOPIC`, `NTFY_URL` | Alarme. Ohne Topic nur Log. |
| `CANARY_TOKEN` | schützt `/internal/*`. Ohne Token sind diese Routen zu. |
| `GP_DISABLED_ADAPTERS` | kommagetrennt abschalten |
| `GP_USER_AGENT` | User-Agent gegenüber den Quellen |
| `GP_LOG_LEVEL` | debug, info, warn, error |
| `PORT` | API-Port, Standard 3000 |

## 16. Entscheidungen (kurz begründet)

- **Manifest-Schleife statt fest verdrahtetem DAG.** Neuer Adapter = neue Datei. Der Resolver bleibt gleich. Der DAG in der Doku ist eine Folge der Manifeste, nicht umgekehrt.
- **Fakten-Tabelle statt Objekt-Tabelle.** Quelle und Stand an jeder Zahl sind das Produktversprechen. Mehrere Quellen pro Key sind normal. Views sind billig, Schemaänderungen nicht.
- **Raster brauchen den Gebäudepunkt.** Präzision vor Verfügbarkeit, siehe Abschnitt 4.
- **`empty` ist kein Ausfall.** Sonst öffnet jede Adresse ohne Sonnendach den Breaker für alle.
- **PGlite für Dev.** Null Setup, gleiche SQL wie Prod. `pg` nur bei `DATABASE_URL`.
- **Hono statt SvelteKit-Routes im Core.** Der Core ist Library. Die App (SvelteKit) importiert ihn direkt oder spricht HTTP.
- **Deutsch im Code.** Fakten-Keys und Doku sind Deutsch, weil die Quellen, die Nutzer und das Team Deutsch sind. Englische Keys würden nur übersetzen, was das GWR schon deutsch benennt.
- **Codes nur mappen, wenn sicher.** Lieber `null` plus Rohcode als eine falsche Beschriftung.
- **ÖREB: Zonentext der Gemeinde, keine Deutung.** `zone.bezeichnung` ist der Legendentext aus dem Kataster. Ob «W2» zwei Geschosse heisst, steht im Baureglement; wir verlinken es (`zone.baureglement_url`), statt es zu interpretieren. Die Ausnützungsziffer steht nicht im Kataster und bleibt eine Lücke.
- **ÖREB: Grundnutzung per SubCode, sonst per Code-Systematik.** BE kennzeichnet sie, ZH und AG nicht. Dort entscheidet die MGDM-Systematik des Bundes (1x bis 4x Hauptnutzung), belegt an vier Extracts, mit Confidence 0.95 statt 1 (QUELLEN.md, Abschnitt oereb).
- **AGPL für den Core, App privat.** Entscheid vom 15.10.2026.

## 17. Was bewusst noch fehlt

- ÖREB-Kataster für die übrigen 23 Kantone: gleiche Norm (extract-2.0), Basis-URL in `adapters/oereb/kantone.ts` eintragen, Fixture aufnehmen, Grundnutzungs-Regel prüfen. Ausnützungsziffer bleibt auch mit ÖREB eine Lücke (steht im Baureglement).
- Naturgefahren, Altlasten, Denkmalschutz, Erdwärmesonden-Zulässigkeit: kantonal. Teile davon kommen schon über den ÖREB-Kataster (belastete Standorte, Gewässerraum, Baulinien; in BE auch Naturgefahren und Denkmalschutzobjekte als kantonale Themen), der Rest braucht eigene Adapter.
- Amtsblatt (Baugesuche, Handänderungen).
- Batch-Modus über den GWR-Dump (Gemeinde-Scan).
- Monats-Diff zweier Läufe als eigene View (die Daten dafür liegen in `runs`).
- Eingabe per Koordinaten ohne Adresse/EGID (würde einen Reverse-Lookup EGID aus Punkt brauchen).

## Changelog

- **2026-10-15 · v0.1.0** Erster Stand. Resolver, Breaker, Fakten-Store (Memory, PGlite, Postgres), 7 Adapter (geocode, gwr, av-parzelle, sonnendach, oev-gueteklasse, radon, laerm-strasse experimentell), derived-Fakten, Steckbrief-View mit Lücken und Quellen, Hono-API, CLI `gp`, Canary mit ntfy, 40 Offline-Tests auf echten Antwortformen, Live-Test-Skelett.
- **2026-10-15 · Design-Prototyp im Repo** `docs/design/`: Artboards als Quelle (`quelle/*.dc.html`) und als eigenständige HTML-Vorschau (`vorschau/*.html`), dazu `README.md` mit Tokens, Seitenstruktur und dem Mapping Steckbrief-API → Karten. Kein Code-Change am Core.
- **2026-10-15 · laerm-strasse verifiziert** Live-Test zeigt die Form von WMS GetFeatureInfo: `application/json` liefert `features[0].properties.value_0` als String (Wabern: Tag 33.2, Nacht 24.1 dB), `text/html` wird abgelehnt, ohne kartierten Lärm ist `features` leer. Parser auf ein Zod-Schema für genau dieses Feld festgezogen (keine Suche nach der ersten Zahl mehr, keine `_roh`-Fakten), leere Antwort ist `empty`, andere Form ist `schema`. Confidence der dB-Fakten 1, Status verifiziert. Fixtures echt: `laerm-wms.json`, `laerm-wms-nacht.json`, `laerm-wms-leer.json`. Bedeutung und Datenstand (Lr Tag/Nacht, sonBASE, 31.12.2021) in QUELLEN.md. 42 Tests.
- **2026-10-15 · sonnendach: Umkreis live bestätigt** Für Wabern liefert tolerance=20 alle 4 Segmente (df_nummer 1 bis 4) plus 2 vom Nachbarhaus, tolerance=30 dasselbe, `find` auf building_id/gwr_egid gibt 504. Fixtures `sonnendach-point.json` und `sonnendach-wide.json` sind jetzt echte Antworten (unter dem Punkt liegt df_nummer 4, Klasse 2). `solar.segmente_vollstaendig` prüft, ob die df_nummer lückenlos 1 bis n sind, statt nur, ob der Umkreis-Aufruf geklappt hat. Bestes Segment deterministisch: Klasse, dann Einstrahlung, dann Fläche (vorher API-Reihenfolge; in Wabern wurde die 44-m²- statt der 75-m²-Fläche gezeigt). 45 Tests.
- **2026-10-15 · av-parzelle: echte GeoJSON-Form** Live fiel der Adapter mit Schema-Drift aus: `identify` mit `geometryFormat=geojson` liefert GeoJSON-Features mit `properties`, nicht `attributes`. Neues Schema `geoJsonResultsSchema` in `src/http/geoadmin.ts`, Adapter liest `properties`. Fixture `av-parzelle-5711.json` ist jetzt die echte Antwort mit echter Geometrie (7 Stützpunkte, 764 m² statt Platzhalter-Rechteck 761 m²), `av-parzelle-5711-esrijson.json` belegt die Esri-Form als Drift-Fall. 47 Tests.
- **2026-10-15 · Fixtures auf echte Antworten, GWR-find exakt** `gwr-1271632.json`, `searchserver-wabern.json` und `oev-radon.json` sind jetzt die unveränderten Live-Antworten (GWR: `egid`, `edid`, `stroffiziel` als Strings; SearchServer: zusätzlich `links[]`, `geom_quadindex`, `geom_st_box2d`, `weight` 1). Dabei aufgefallen: `find` ist ohne `contains=false` eine Teilstring-Suche, searchText 1271632 traf auch EGID 191271632 (Gossau SG). `findUrl` setzt jetzt `contains=false`, der GWR-Adapter filtert auf die exakte EGID und hat keinen Fallback auf `results[0]` mehr (kein Treffer = Lücke). Fixture `gwr-find-teilstring.json` belegt den Fall. 50 Tests.
- **2026-10-15 · CLI und PGlite-Ordner** `gp "<Adresse>"` verschluckte das erste Argument, wenn kein `--egid` gesetzt war (Filter auf `egidIdx + 1` bei `egidIdx = -1`), und zeigte nur die Verwendung. PGlite legte `./data/grundpass` nicht an, solange `./data` fehlte (frischer Klon): jetzt `mkdirSync` rekursiv. Beides beim ersten `pnpm gp` im frischen Klon aufgefallen.
- **2026-10-15 · Design-Prototyp umgezogen** `docs/design/` ist jetzt `grundpass-app/design/` (eigenes, privates Repo). Der Core enthält keine UI-Referenz mehr.
- **2026-10-15 · ÖREB-Adapter (AG, ZH, BE)** Neuer Adapter `oereb` mit Kantonstabelle `adapters/oereb/kantone.ts`: Datenextrakt extract-2.0 per EGRID von den kantonalen Webservices (AG `api.geo.ag.ch/v2/oereb`, ZH `maps.zh.ch/oereb/v2`, BE `www.oereb2.apps.be.ch`), alle JSON, kein XML-Parser nötig. Fakten: `zone.*` (Grundnutzung mit grösstem Anteil als Hauptzone, weitere als `zone.weitere.<n>.*`, Baureglement-Link), `parzelle.flaeche_grundbuch_m2` (amtlich, Confidence 1, jetzt «Parzellenfläche» im Katalog, Shoelace als Zweitquelle), `laerm.empfindlichkeitsstufe` (I bis IV, nur wenn der Kataster sie führt; Wabern: nicht), `oereb.<thema>.*` für alle weiteren betroffenen Themen, `oereb.auszug_pdf_url`. Grundnutzung in BE per SubCode, in ZH und AG per MGDM-Code-Systematik (Confidence 0.95). Live an fünf Parzellen bestätigt, darum gleich `verifiziert`. Lärm-Grenzwerte sind jetzt derived aus der Stufe (LSV Anhang 3), der Lärm-Adapter nimmt kein ES II mehr an. Steckbrief: Abschnitt «Zone und Kataster» mit datengetriebenen Zeilen, Lücken-Grund `quelle_ausser_kanton`, Adapter-Zuordnung über das längste Präfix. Fixture-Helfer kann 204 ohne Body. 62 Tests, Live-Test deckt die drei Kantone ab. `src/cli.ts` ist ausführbar (Shebang).
- **2026-10-15 · av-parzelle: Widerspruch zum GWR sichtbar** Liegt unter dem Gebäudepunkt eine andere Parzelle als die EGRID aus dem GWR (Baden, Rütistrasse 1: AV 3827 mit 236 m², GWR 3258 mit 394 m² laut ÖREB), tragen die AV-Fakten Confidence 0.8 und `parzelle.hinweis_vermessung` sagt es im Steckbrief. Vorher stand die Nachbarparzelle still in der Karte. 63 Tests.
- **2026-10-15 · av-parzelle: Geometrie als Fakt** `parzelle.geometrie_geojson` (GeoJSON-String in LV95, Confidence 1) für den Lageplan der App. Bewusst ohne Eintrag im Feldkatalog, darum nicht im Steckbrief, aber in `/v1/fakten` und im Store. 64 Tests.
