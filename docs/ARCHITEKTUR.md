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
   ├──► av-parzelle   (braucht EGRID, sonst Gebäudepunkt)  Parzelle des Registers mit Geometrie, Fläche
   ├──► sonnendach    (braucht Gebäudepunkt)       Solarpotenzial
   ├──► oev-gueteklasse                            A bis D
   ├──► radon                                      Wahrscheinlichkeit in %
   ├──► laerm-strasse                              dB Tag/Nacht (Strasse)
   ├──► laerm-bahn                                 dB Tag/Nacht (Eisenbahn), sonst Hinweis «keine Bahnlärm-Belastung kartiert»
   ├──► naturgefahren                              Oberflächenabfluss ja/nein, Aquaprotect HQ100 ja/nein, Erdbebenzone SIA 261
   ├──► kulturgueter                               KGS-Inventar: betroffen ja/nein, Objekt, Kategorie, Distanz
   ├──► oereb         (braucht EGRID + Kanton; 24 Kantone, JSON oder XML, Tabelle in adapters/oereb/kantone.ts)   Zone mit Erkennungsregel, Grundbuchfläche, Lärm-ES, weitere Beschränkungen, zuständige Stellen
   └──► zustaendige-stellen (braucht Gebäudepunkt)   Grundbuchamt, Nachführungsgeometer
   │
   ▼
derived ──► bebauter Anteil, Gebäudealter, Wohnfläche total, Lärm-Grenzwerte Strasse und Bahn aus der Empfindlichkeitsstufe
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
| **Manifest** | `id, title, provider, needs, yields, provides, ttlDays, version, timeoutMs, cantons, license, attribution, endpoint, status, notes`. |
| **Lauf (Run)** | Ein Durchgang des Resolvers für eine Eingabe. Hat `run_id`, Bericht pro Adapter, alle Fakten, `partial`-Flag. |
| **Steckbrief** | View über die Fakten eines Laufs: Abschnitte mit Feldern, Lücken, Quellenliste, Attribution. |
| **Canary** | Zwei Stufen: der Canary über fünf goldene Adressen (Vercel-Cron, alle Adapter, Baseline, Drift, Latenz) und der Kantons-Canary über 26 Referenzadressen (GitHub Action täglich, nur geocode, gwr und oereb, keine Baseline). Beide alarmieren per ntfy. |

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
    geoadmin.ts       URL-Bauer für SearchServer, find, identify, WMS GetFeatureInfo + gemeinsame Schemas, Parser für GetFeatureInfo als text/plain
  codes/gwr.ts        GWR-Codetabellen (nur sichere Codes)
  adapters/           ein Adapter pro Datei, index.ts = Liste
    oereb/kantone.ts  Kantonstabelle des ÖREB-Adapters: 26 Einträge mit Basis, Sprache, Format (json, xml), Grundnutzungs-Muster, Status, Prüfdatum, Notizen, Timeout
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
    adressen.ts       goldene Adressen, Kantons-Referenzadressen (26), stabile Keys
    run.ts            runCanary (goldene Adressen, Baseline)
    kantone.ts        runKantonsCanary (26 Kantone, nur geocode, gwr, oereb)
    alert.ts          ntfy
    cli.ts            pnpm canary
    kantone-cli.ts    pnpm canary:kantone
scripts/
  oereb-fixture.ts    verkleinert eine rohe ÖREB-Aufzeichnung (JSON oder XML) zur Fixture (Geometrien, Bilder, Rechtsvorschriften bis auf eine raus)
test/
  fixtures/           echte Antwortformen (15. und 16.10.2026), eine Datei pro Quelle, oereb-<kanton>.json bzw. .xml (SO, SH) pro angebundenem Kanton
  helpers/fixtures.ts fakeFetch: URL-Prädikat → Fixture
  *.test.ts           offline
  live/               nur mit LIVE=1 (aufzeichnungen/ gitignored)
.github/workflows/
  check.yml           Typecheck und Tests bei Push, täglich Live-Tests
  canary-kantone.yml  täglich pnpm canary:kantone, Alarm über NTFY_TOPIC (Repository-Secret)
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
2. Subject bekannt, letzter `ok`-Lauf jünger als `ttlDays` und von derselben Manifest-`version`? → `cached`, Fakten und Keys aus dem Store, kein Aufruf. Andere Version → Cache verworfen, Adapter läuft neu (sonst fehlten neue Fakten bis zum Ablauf der TTL).
3. Sonst `resolve(ctx)` mit Timeout (`timeoutMs`, Standard 10 s). Fakten bekommen `subject`, `source`, `fetched_at`, `run_id`, `confidence` (Standard 1) und `source_date`, wenn der Adapter einen Stand kennt: am einzelnen Fakt (`facts[].source_date`, geht vor) oder für den ganzen Lauf (`AdapterOutput.source_date`).
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

**av-parzelle geht seit Version 3 zuerst über die EGRID** (`find` auf `egris_egrid`) und braucht den Gebäudepunkt nur als Fallback und für die Gegenprobe: In Baden (Rütistrasse 1) liegt der GWR-Punkt auf der Nachbarparzelle 3827, das Register nennt 3258. Der Adapter liefert jetzt die Register-Parzelle und sagt in `parzelle.hinweis_vermessung`, dass der Punkt woanders liegt.

## 5. Circuit Breaker (`src/resolver/breaker.ts`)

Pro Adapter, im Prozess-Speicher. Nach 3 Fehlern in Folge 15 Minuten offen. Danach genau ein Versuch (halb offen). `empty`-Fehler zählen nicht: Eine Quelle, die korrekt "nichts" sagt, ist nicht kaputt. API-Prozesse teilen einen Breaker (`sharedBreaker`), Tests geben ihren eigenen mit.

## 6. Fakten-Store (`src/facts/`)

Drei Aufgaben: Cache, Gedächtnis, Snapshots. Interface `FactStore`, zwei Implementierungen:

- `MemoryStore`: Tests, `gp --memory`.
- `SqlStore` über ein Mini-Interface `SqlClient { query(sql, params) }`. Dahinter PGlite (Dev, Ordner `./data/grundpass`, kein Setup) oder node-postgres (`DATABASE_URL`, Prod z.B. Neon). Gleiche SQL, gleicher Code.

Tabellen:

| Tabelle | Inhalt |
|---|---|
| `adapter_runs` | ein Eintrag pro Adapter und Lauf: Status, ms, cache_hit, error, keys (jsonb), request_url, fetched_at, version (Manifest-Version des Adapters, Standard 1; Spalte wird bei `init()` per `add column if not exists` nachgezogen). Index auf (subject, adapter, status, fetched_at). |
| `facts` | ein Eintrag pro Fakt. value als jsonb. Index auf (subject, source, run_id) und (subject, key, source, fetched_at). |
| `runs` | kompletter `RunResult` als jsonb pro Lauf. Für Diffs und Debug. |
| `snapshots` | Key-Value: Canary-Baselines, letzter Canary-Report, letzter Alarm-Hash. |

**Cache-Regel:** `latestAdapterRun(subject, adapter)` liefert den jüngsten `ok`-Lauf mit seinen Fakten, Keys und seiner Adapter-Version. Ist er jünger als `ttlDays` und die Version gleich der im Manifest, wird der Adapter nicht aufgerufen. Wer einem Adapter neue Fakten gibt, erhöht `version` im Manifest (laerm-strasse steht seit 15.10.2026 auf 2, av-parzelle auf 3, oereb seit 16.10.2026 auf 4). Gecachte Fakten behalten ihre ursprüngliche `fetched_at` und `run_id` (Herkunft bleibt wahr).

**Aktueller Stand:** `latestFacts(subject)` = jüngster Fakt pro (key, source). Mehrere Quellen für denselben Key sind erlaubt (z.B. `parzelle.egrid` aus GWR und aus AV); die View wählt nach Confidence, dann Aktualität.

Datenschutz: Subject ist die EGID, nicht die Adresse. Die Eingabe-Adresse steht nur im `runs.input` des Laufs. Keine Personendaten.

## 7. Abgeleitete Fakten (`src/resolver/derive.ts`)

Quelle `derived`, `derived_from` nennt die Eingangs-Keys, Confidence 0.9 (0.6 bei Bauperioden-Mitte).

- `parzelle.bebauter_anteil_prozent` = Gebäudegrundfläche / Parzellenfläche. Amtliche Grundbuchfläche (`parzelle.flaeche_grundbuch_m2`, ÖREB) vor der Geometrie-Schätzung (`parzelle.flaeche_m2`, AV); `derived_from` sagt, welche.
- `gebaeude.alter_jahre` aus Baujahr oder Mitte der Bauperiode
- `wohnungen.flaeche_total_m2`, `wohnungen.zimmer_total` über alle Wohnungen
- `laerm.strasse.grenzwert_tag_db`, `.grenzwert_nacht_db` aus `laerm.empfindlichkeitsstufe` (ÖREB) nach LSV Anhang 3, Strassenverkehr: ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60. Gesetzestabelle, keine Schätzung, darum Confidence 1. Ohne Stufe kein Grenzwert (bis 15.10.2026 nahm der Lärm-Adapter pauschal ES II an).
- `laerm.bahn.grenzwert_tag_db`, `.grenzwert_nacht_db` aus derselben Stufe nach LSV Anhang 4 Ziff. 2, Eisenbahn: ES I 55/45, ES II 60/50, ES III 65/55, ES IV 70/60 (gegengeprüft am 16.10.2026 im konsolidierten Gesetzestext vom 1.4.2026, Fundstelle im Kommentar von `derive.ts`). Nur, wenn am Punkt ein Bahnpegel (`laerm.bahn.tag_db` oder `.nacht_db`) kartiert ist: Ein Grenzwert ohne Pegel daneben sagt nichts.

Nur Rechnung, keine Meinung. Baureserve, Preis, Empfehlungen gehören in die App.

## 8. Fakten-Keys (Konvention)

Kleingeschrieben, Punkt-getrennt, Einheit im Namen. Präfixe:

`adresse.` · `gebaeude.` · `gebaeude.heizung.` · `gebaeude.warmwasser.` · `wohnung.<ewid>.` · `wohnungen.` · `parzelle.` · `zone.` (mit `zone.erkennung`, `zone.hinweis`, `zone.weitere.<n>.`, `zone.zustaendig`) · `oereb.<thema>.` (mit `.zustaendig`; `oereb.nutzungsplanung_ueberlagernd.` bzw. nach Regel 3 `oereb.nutzungsplanung_weitere.`) · `oereb.kataster_` · `kulturgut.kgs.` · `solar.` · `oev.` · `radon.` · `laerm.strasse.` · `laerm.bahn.` (mit `laerm.bahn.hinweis`) · `laerm.empfindlichkeitsstufe` · `laerm.zustaendig` · `naturgefahr.oberflaechenabfluss.` · `naturgefahr.hochwasser.` · `naturgefahr.erdbeben.` · `grundbuch.` · `vermessung.geometer_`

Datengetriebene Keys (`wohnung.<ewid>.*`, `zone.weitere.<n>.*`, `oereb.<thema>.*`) stehen nicht im Feldkatalog, die Steckbrief-View bildet sie nach Muster. `parzelle.geometrie_geojson` steht bewusst nicht im Katalog: ein Fakt für Programme (Lageplan), nicht für die Lesefassung.

Codes aus Registern kommen doppelt: lesbar (`gebaeude.klasse`) und roh (`gebaeude.klasse_code`). Unbekannte Codes: lesbar `null`, roh gesetzt. Die vollständige Liste pro Quelle steht in `docs/QUELLEN.md`.

## 9. Steckbrief (`src/views/`)

`felder.ts` ist der Katalog: welcher Key unter welchem Label in welchem Abschnitt, mit Laien-Erklärung, und ob er `erwartet` ist. `buildSteckbrief(run, adapters)` baut daraus:

- `abschnitte`: Adresse, Gebäude, Heizung, Wohnungen, Parzelle, Zone und Kataster, Ortsbild und Denkmal (KGS-Inventar), Sonne, ÖV, Lärm (Strasse und Bahn mit je eigenen Grenzwerten), Naturgefahren (Oberflächenabfluss, Aquaprotect HQ100, Erdbebenzone), Radon, Zuständige Stellen (Grundbuchamt, Nachführungsgeometer, ÖREB-Katasterstelle), Berechnet, plus eine Karte pro Wohnung. Ein Abschnitt erscheint nur, wenn er mindestens ein Feld hat. Im Abschnitt Zone hängt die View datengetriebene Zeilen an: weitere Grundnutzungen (`zone.weitere.<n>.*`, Label mit Anteil) und jedes betroffene ÖREB-Thema (`oereb.<thema>.betroffen`, Label aus `.thema`, Wert aus `.text`, Anteil oder Länge in Klammern). `zone.hinweis` («Hinweis zur Zone») steht direkt unter der Zone, wenn der Kataster die Grundnutzung nicht kennzeichnet und der Adapter sie aus dem grössten Flächenanteil abgeleitet hat; `zone.erkennung` ist ein Fakt für Programme und steht nicht im Katalog.
- `adresse`: `label` (geocode, bei EGID die Strasse aus dem GWR), `strasse`, `plz`, `ort`, `gemeinde`, `kanton` (alle GWR, darum auch bei Eingabe per EGID), `egid`, `egrid`, `parzelle`. `adressZeile(adresse)` macht daraus die zweite Kopfzeile «3084 Wabern · Gemeinde Köniz · BE»; fehlende Teile fallen weg, kein Platzhalter. Dieselbe Funktion nutzt die App für Seite und PDF.
- Jedes Feld: `value`, `unit`, `quelle`, `quelle_titel`, `daten_vom` (= `source_date` der Quelle, nur wenn vorhanden), `abgefragt_am` (= Tag von `fetched_at`, immer), `url`, `confidence`. Zwei getrennte Angaben, nie das Abrufdatum als Ersatz für den Datenstand (bis 16.10.2026 war das ein Feld `stand`).
- Formate im Feldkatalog (`format`): `int`, `dezimal`, `chf`, `jahr`, `id` für Zahlen; `bool` gibt ja/nein; `betroffen` gibt «betroffen» / «nicht betroffen» (naturgefahr.oberflaechenabfluss.betroffen, naturgefahr.hochwasser.aquaprotect_100, kulturgut.kgs.betroffen). Die App formatiert mit denselben Regeln.
- `luecken`: jeder `erwartet`e Key ohne Wert, mit Grund: `fehlt_im_register`, `quelle_nicht_erreichbar`, `quelle_uebersprungen`, `quelle_abgeschaltet`, `quelle_ausser_kanton` (Adapter gilt nicht für diesen Kanton, `detail` nennt ihn), `hinweis` (die Quelle liefert statt des Werts einen Hinweis: fehlt `grundbuch.kreis`, steht der Text von `grundbuch.hinweis` in `detail`; fehlt `laerm.bahn.tag_db`, der Text von `laerm.bahn.hinweis` «keine Bahnlärm-Belastung kartiert»; allgemein `<präfix>.hinweis` zum fehlenden Key). Welcher Adapter einen Key liefert, entscheidet das längste passende `provides`-Präfix (`parzelle.flaeche_grundbuch_m2` gehört zu oereb, nicht zu av-parzelle).
- `quellen`: Status pro Adapter, `daten_vom` (nur wenn alle Fakten des Adapters denselben `source_date` tragen; naturgefahren hat drei Layer-Stände, dort steht er pro Feld), `abgefragt_am`, ms, Fehler, `experimentell`-Flag.
- `attribution`: Pflicht-Quellenangaben der genutzten Quellen, aus den Manifesten.

`steckbriefAlsText` ist die Terminal-Ausgabe der CLI: Kopf in drei Zeilen (`grundpass · Maygutstrasse 26`, `3084 Wabern · Gemeinde Köniz · BE`, Kennungen), pro Feld die Quellenzeile `gwr · Daten vom 2026-10-12 · abgefragt 2026-10-16` (ohne Datenstand nur `abgefragt …`, Hilfsfunktion `quellenText`), im Block QUELLEN dasselbe pro Adapter.

## 10. API (`src/api/app.ts`)

| Route | Was |
|---|---|
| `GET /v1/steckbrief?adresse=…` oder `?egid=…` (`&nocache=1`) | Lauf + Steckbrief. HTTP 206 wenn `partial`. |
| `GET /v1/fakten?egid=…` | aktueller Stand aus dem Store, ohne neuen Lauf, plus letzte Läufe |
| `GET /v1/lauf/:run_id` | kompletter Lauf |
| `GET /v1/sources` | Manifeste, Plan ab `adresse`, Schalter, Breaker |
| `GET /v1/status` | `ok` / `degraded`, offene Breaker, letzter Canary pro Adapter |
| `POST /internal/canary` | Canary auslösen. `Authorization: Bearer $CANARY_TOKEN`. `?baseline=erneuern` setzt die Baseline aller Adressen neu, `&adresse=<Name>` (mehrfach) nur die genannten. |
| `POST /internal/adapters/:id/on|off` | Adapter schalten, Breaker zurücksetzen. Gleicher Token. |

Hono, läuft auf Node (`pnpm dev`). Der Core ist eine Library, die App kann ihn auch direkt importieren statt über HTTP.

## 11. CLI

```
pnpm gp "Maygutstrasse 26, 3084 Wabern"     Steckbrief als Text, pro Zeile Quelle, Daten vom (wenn bekannt) und abgefragt am
pnpm gp --egid 1271632
Optionen: --json  --lauf (mit --json: ganzer Lauf)  --nocache  --memory  --ohne-quellen
Exit-Code 1, wenn partial.
pnpm canary [--no-notify] [--baseline-erneuern [Name …]]   Baseline neu setzen: ohne Namen alle, sonst z.B. "Baden Büro"
pnpm canary:kantone [--no-notify] [ZH BE …]                 26 Kantons-Referenzadressen durch geocode, gwr, oereb; Exit 1, wenn ein angebundener Kanton keine Zone liefert
```

## 12. Canary und Alarm (`src/canary/`)

Fünf goldene Adressen (BE, AG, AG, ZH, ZH) laufen ohne Cache durch alle Adapter.

Alarm, wenn: ein Adapter `failed` (Klasse `http`, `schema`, `timeout` = error; `empty` = warn), `open_circuit`, `skipped`, Latenz über 5 s (warn), oder ein stabiler Fakt gegenüber der Baseline abweicht (warn). Stabile Keys: `gebaeude.egid`, `parzelle.egrid`, `parzelle.nummer`, `gebaeude.klasse_code`, `gebaeude.bauperiode_code`, `gebaeude.baujahr`, `adresse.bfs_nr`.

Beim ersten Lauf pro Adresse wird die Baseline gesetzt (`snapshots: canary:baseline:<adresse>`). Sie wird nie von selbst nachgezogen: Korrigiert ein Register oder ein Adapter einen stabilen Fakt (Baden: av-parzelle Version 3 meldet 3258 statt 3827), meldet jeder Lauf dieselbe Drift. Dann explizit erneuern: `runCanary(core, { baselineErneuern: true })` oder mit einer Liste von Namen, CLI `pnpm canary --baseline-erneuern [Name …]`, API `POST /internal/canary?baseline=erneuern[&adresse=Name]` (gleicher Token). Für die betroffenen Adressen wird die Baseline mit den aktuellen stabilen Fakten überschrieben, es gibt in diesem Lauf keinen Drift-Alarm, im Report steht `baseline_neu: true` pro Adresse und `baseline_erneuert` mit den Namen. Benachrichtigung über ntfy.sh (`NTFY_TOPIC`), dedupliziert über einen Hash der Alarmliste: dieselbe Störung meldet nur einmal, nach Erholung meldet sie wieder. Report liegt in `snapshots: canary:last` und speist `/v1/status`.

Auslösen: `pnpm canary` (Cron auf dem Server) oder `POST /internal/canary` (z.B. Vercel Cron).

**Kantons-Canary** (`src/canary/kantone.ts`, `pnpm canary:kantone`, GitHub Action `.github/workflows/canary-kantone.yml`, täglich 05:41 UTC). Die Vercel-Function schafft 26 Adressen nicht in einem Aufruf, darum eine zweite Stufe im Core-Repo: alle `KANTONS_ADRESSEN` ohne Cache durch einen Core mit nur drei Adaptern (geocode, gwr, oereb), Memory-Store, Breaker mit Schwelle 1000 (ein paar kaputte Kantone dürfen die restlichen nicht in open_circuit schicken). Keine Baseline, kein Drift. Befund pro Kanton: `ok` (Zone da), `leer` (Dienst antwortet, aber keine Zone, oder EGRID dem Kataster unbekannt), `failed` (http, timeout, schema, other), `vorgelagert` (geocode oder gwr ohne Ergebnis), `falscher_kanton` (Referenzadresse geocodiert in einen anderen Kanton), `kein_dienst` (Kanton steht in `kantone.ts` als kein_dienst, Adapter läuft nicht, nie ein Alarm). Vorübergehende Fehler (`vorueberGehend`: Timeout, HTTP 429, HTTP 5xx) bekommen nach 60 s (`retryNachMs`, Tests setzen 0) genau einen zweiten Versuch; erst wenn auch der scheitert, zählt der Kanton als Alarm, mit `versuche: 2`, `erster_fehler` und dem Zusatz «auch im 2. Versuch nach 60 s» in der Meldung. Anlass: Am 16.10.2026 antwortete ZG zweimal mit HTTP 500 (07:11 und 07:33 UTC) und war eine Minute später wieder da; beide Läufe waren rot. Alles ausser `ok` und `kein_dienst` ist ein Alarm mit Kanton und Fehlerart; eine ntfy-Nachricht pro Lauf (`NTFY_TOPIC` als Repository-Secret, ohne Secret nur Log), Schwere error bei failed/vorgelagert/falscher_kanton, sonst warn. Ein grüner Lauf schickt keine Nachricht. Keine Deduplikation: Der Lauf ist täglich, eine Meldung pro Tag ist gewollt. Exit 1, sobald ein Alarm vorliegt, damit die Action rot wird. Referenzadresse für SO ist das Stadthaus Olten, weil der Kataster die Nutzungsplanung der Stadt Solothurn noch ohne Daten führt (QUELLEN.md).

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

- Offline (`pnpm test`): Fixtures aus `test/fixtures/`, `fakeFetch` bildet URLs auf Fixtures ab (Antwort ohne Inhalt per `body: null`, z.B. 204; Text-Antworten als `{ _hinweis, body }` über `fixtureText`). 147 Tests: Adapter einzeln (laerm-bahn: Wabern und Zürich, leer mit Hinweis, nur ein Pegel, Hinweis wird Lücke; naturgefahren: Wabern leer mit Z1b, Zürich betroffen mit Z1a, ohne Zone, Drift, text/plain-Parser, `source_date` pro Fakt aus den Layer-Datenständen und Version 2; kulturgueter: Wabern leer ohne Lücke, Zytglogge mit zwei Treffern, Treffer ausserhalb 15 m, Drift, Kategorie und Nummer; av-parzelle per EGRID, Baden-Gegenprobe, Fallback am Punkt; ÖREB mit vier Fixtures vom 15.10.2026 (Wabern, Baden, Zürich, Winterthur) und 24 Kantons-Fixtures der Referenzadressen vom 16.10.2026 (pro Kanton Zone, Erkennungsregel, Confidence, Grundbuchfläche, Lärmstufe, Themenzahl, Abfrage-URL mit GEOMETRY, WITHIMAGES, LANG im Format des Kantons, Hinweis nur mit Code; SO und SH als XML, dazu das Rathaus Solothurn mit ThemeWithoutData und hinweis_code thema_ohne_daten, SH mit Regel 2 über die ARE-Systematik im TypeCode, parseXml und Schema-Drift bei ungültigem XML, HTML oder JSON auf einem XML-Kanton), dazu die drei Dialekte und XML (erkenneForm, normalisiereBaum), FR mit .NET-Datum und Zahlen-Enums, UR und OW als GeoShop mit OtherLegend und summierten Teilflächen, LU und AR nach Regel 3, GE und BS mit eigenen Mustern, GR mit kantonalem Zonenplan-Thema, erkenneGrundnutzung, textIn, parseStufe fr/it, 204, Drift, Kanton ohne Eintrag oder ohne Dienst, zuständige Stellen aus dem Extract; zustaendige-stellen: Wabern eindeutig, Zürich mit Hinweis, Baden mit doppeltem Kreis, nur leere Einträge, Stellvertreter), Resolver (Stufen, Cache, Breaker, Kanton, Timeout, Ende-zu-Ende Wabern mit zwölf Adaptern), derived (Grenzwerte Strasse und Bahn je ES, Bahn nur mit Pegel, Grundbuchfläche vor Geometrie), Store (Memory und PGlite), API (zwölf Quellen, Abschnitte naturgefahren und ortsbild), Canary (goldene Adressen und Kantons-Canary: ok, leer bei 204, failed bei 500, kein_dienst, falscher Kanton, vorgelagert, zweiter Versuch bei 5xx, 429 und Timeout mit Alarm erst danach, kein zweiter Versuch bei 404).
- Live (`pnpm test:live`, braucht Netz): Wabern gegen echte APIs, zeichnet rohe Antworten nach `test/live/aufzeichnungen/` auf (gitignored), darunter die WMS-GetFeatureInfo-Antworten für Lärm in drei INFO_FORMATs, die ÖREB-Extracts von Wabern, Baden und Zürich und seit 16.10.2026 die Extracts aller 26 Kantons-Referenzadressen (`oereb-<kanton>.json` bzw. `.xml`; angebundene Kantone müssen Zone, Grundbuchfläche und Themenzahl liefern, kein_dienst-Kantone bleiben `ausser_kanton`, ein eigener Fall prüft, dass NE 403 und VS im Timeout scheitern und SO und SH auf extract/json weiterhin 415 bzw. 500 geben, ein weiterer, dass die Stadt Solothurn die Nutzungsplanung noch als ThemeWithoutData führt); prüft `versions/json` aller angebundenen Kantone (mit oder ohne Hülle, «extract-2.0» oder «2.0»; SO und SH über `versions/xml`) und den 204-Fall in ZH; Baden (Rütistrasse 1) belegt av-parzelle per EGRID: Parzelle 3258, 395 m², Hinweis auf 3827; die fünf goldenen Adressen belegen zustaendige-stellen (Wabern und Baden eindeutig, Zürich und Winterthur mit Hinweis, Aufzeichnung `stellen-golden.json`) und seit 16.10.2026 laerm-bahn, naturgefahren und kulturgueter (Aufzeichnung `neue-quellen-golden.json`; der Zytglogge in Bern belegt einen KGS-Treffer); die drei Datenstände im naturgefahren-Adapter werden gegen die geo.admin-Legendenseiten geprüft (`legendeUrl`).

## 15. Konfiguration (Env)

| Variable | Wirkung |
|---|---|
| `DATABASE_URL` | Postgres statt PGlite |
| `PGLITE_DIR` | Ordner für PGlite, Standard `./data/grundpass` |
| `NTFY_TOPIC`, `NTFY_URL` | Alarme. Ohne Topic nur Log. Für den Kantons-Canary als Repository-Secret `NTFY_TOPIC` in GitHub. |
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
- **ÖREB: Grundnutzung über eine Regelkette, nie geraten.** Erst die Kennzeichnung des Kantons (SubCode oder Subthema-Text, Confidence 1), dann ein TypeCode-Muster nach der MGDM-Systematik des Bundes (0.95), zuletzt der grösste Flächenanteil (0.8) mit sichtbarem Hinweis `zone.hinweis` und den übrigen Einträgen als «weitere Einträge» statt «überlagernd». Welche Regel griff, steht in `zone.erkennung` (QUELLEN.md, Abschnitt oereb).
- **ÖREB: drei JSON-Dialekte und XML normalisieren statt vier Adapter.** openoereb, GeoShop (XML nach JSON), .NET-Serialisierung und das XML von SO und SH (`parseXml` mit fast-xml-parser, Werte als Strings wie bei GeoShop) werden vor dem Zod-Schema auf eine Form gebracht (`erkenneForm`, `normalisiereBaum`); der Rest des Adapters kennt nur openoereb. Das Format steht pro Kanton in `kantone.ts` (`format`), ebenso ein eigener Timeout (GL 90 s). Das Nutzungsplanungs-Thema ist pro Kanton konfigurierbar (GR führt den Zonenplan als kantonales Thema).
- **ÖREB: Hinweistexte tragen einen Code.** `zone.hinweis` kommt mit `zone.hinweis_code` (`flaechenanteil`, `thema_ohne_daten`), damit Sprachfassungen aus dem Code entstehen können; der deutsche Text bleibt der gespeicherte Fakt.
- **ÖREB: Kantone ohne nutzbaren Dienst sind sichtbar, nicht still.** `kein_dienst` mit Notiz in `kantone.ts`, Status `ausser_kanton` im Lauf, Text in der App. Kein Fallback auf einen anderen Dienst.
- **AV per EGRID, Punkt nur als Fallback.** Das Gebäuderegister nennt die Parzelle; die amtliche Vermessung soll deren Geometrie liefern, nicht die unter einem Punkt, der auch mal daneben liegt (Baden). Der Widerspruch der Register bleibt als Hinweis sichtbar, statt still korrigiert zu werden.
- **Zuständige Stellen ohne Raten.** Der Grundbuch-Layer ist auf Gemeindeebene aufgelöst. Nennt er mehrere Kreise (Zürich 11, Winterthur 3), gibt es nur die Zahl und einen Hinweis, keinen ersten Treffer. Der Name des Geometers ist eine Person und bleibt draussen; Firma, Adresse, Telefon und Mail sind Amtskontakte.
- **AGPL für den Core, App privat.** Entscheid vom 15.10.2026.

## 17. Was bewusst noch fehlt

- ÖREB-Kataster in VS (Dienst antwortet nicht) und NE (Extracts nur für registrierte Nutzer). Gründe und Stand in `adapters/oereb/kantone.ts` und QUELLEN.md. Die Nutzungsplanung der Stadt Solothurn steht noch nicht im Kataster des Kantons (ThemeWithoutData). Ausnützungsziffer bleibt auch mit ÖREB eine Lücke (steht im Baureglement).
- Naturgefahren mit Gefahrenstufen (Hochwasser, Rutschung, Sturz, Lawine), Altlasten, Denkmalschutz, Erdwärmesonden-Zulässigkeit: kantonal. Teile davon kommen schon über den ÖREB-Kataster (belastete Standorte, Gewässerraum, Baulinien; in BE auch Naturgefahren und Denkmalschutzobjekte als kantonale Themen), der Rest braucht eigene Adapter. Die Bundesübersichten (Oberflächenabfluss, Aquaprotect, Erdbebenzonen) und das KGS-Inventar sind seit 16.10.2026 drin.
- ISOS (Ortsbilder) und Fernwärme-Verfügbarkeit: geprüft am 16.10.2026 und bewusst ausgelassen, weil die Bundeslayer nur Punkte liefern (QUELLEN.md, Kandidaten).
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
- **2026-10-15 · Cache kennt die Adapter-Version** Manifest-Feld `version` (Standard 1), gespeichert in `adapter_runs.version` (Spalte wird bei bestehenden Datenbanken nachgezogen). Ein gecachter Lauf gilt nur bei gleicher Version. Anlass: Nach dem Geometrie-Fakt blieb Wabern auf Staging 90 Tage ohne Lageplan, weil der av-parzelle-Lauf gecacht war. av-parzelle und laerm-strasse auf Version 2. Nachtrag cf13781: Version auch bei ok- und failed-Läufen speichern. 67 Tests.
- **2026-10-15 · av-parzelle: Geometrie als Fakt** `parzelle.geometrie_geojson` (GeoJSON-String in LV95, Confidence 1) für den Lageplan der App. Bewusst ohne Eintrag im Feldkatalog, darum nicht im Steckbrief, aber in `/v1/fakten` und im Store. 64 Tests.
- **2026-10-15 · Commit-Regel in CLAUDE.md** Commit nur, wenn `pnpm check` mit Exit-Code 0 endet, nie per Ausgabetext wie «passed» (so rutschte am 15.10.2026 ein roter Test in einen Push). Dazu der Hinweis, dass `manifest.version` steigt, sobald ein Adapter seine Fakten-Keys oder deren Bedeutung ändert (Regel in ADAPTER-SCHREIBEN.md). Kein Code-Change.
- **2026-10-15 · av-parzelle per EGRID (Version 3)** Hauptweg ist jetzt `find` auf `egris_egrid` (live bestätigt: das Feld ist durchsuchbar, Antwort in derselben GeoJSON-Form wie identify), der Punkt-identify nur noch Fallback ohne EGRID oder bei in der AV unbekannter EGRID. Anlass Baden, Rütistrasse 1: Der GWR-Gebäudepunkt liegt auf Parzelle 3827 (236 m²), das Register nennt 3258 (394 m²), der Lageplan zeichnete die falsche Parzelle. Jetzt kommt 3258 mit Geometrie (Shoelace 395 m²). Gegenprobe ohne Netz: Even-Odd-Test, ob der Gebäudepunkt in der Geometrie liegt; wenn nicht, eine identify-Abfrage, und `parzelle.hinweis_vermessung` benennt die Parzelle unter dem Punkt (Confidence der Fakten bleibt 1; im Fallback mit fremder Parzelle weiterhin 0.8). `needs` ist `egrid|lv95_bau`, `findUrl` kann `geometryFormat`. Drei neue Fixtures (find Baden, find Wabern, identify am Baden-Punkt), Live-Test mit Baden. 72 Tests. Der Canary wird für Baden einmal `parzelle.nummer` 3258 statt der Baseline melden, das ist die Korrektur.
- **2026-10-16 · Zuständige Stellen** Neuer Adapter `zustaendige-stellen` (swisstopo, Amtliche Vermessung: Layer geometa-grundbuch und geometa-nfgeom, ein identify am Gebäudepunkt): Grundbuchamt mit Adresse, Telefon, E-Mail und Grundbuchführung, Nachführungsgeometer mit Firma und Kontakt (Personenname bleibt draussen). Mehrere Grundbuchkreise in der Gemeinde (Zürich 11, Winterthur 3): nur `grundbuch.kreise_anzahl` und `grundbuch.hinweis`; gleicher Kreis mit gleichem Kontakt zählt einmal (Baden). Live an den fünf goldenen Adressen bestätigt, darum verifiziert. ÖREB-Adapter Version 2: `zone.zustaendig`, `laerm.zustaendig`, `oereb.<thema>.zustaendig` (je mit `_url`) aus `ResponsibleOffice`, `oereb.kataster_stelle` und `.kataster_adresse` aus `PLRCadastreAuthority`. Steckbrief: neuer Abschnitt «Zuständige Stellen» zwischen Radon und Berechnet (auch `oereb.kataster_url` steht jetzt dort), `zone.zustaendig` und `laerm.zustaendig` als Zeile «Zuständig». Neuer Lücken-Grund `hinweis`: fehlt `grundbuch.kreis`, trägt die Lücke den Text von `grundbuch.hinweis`. Drei Fixtures, 80 Tests, Live-Test über alle fünf Adressen. Canary: `STABILE_KEYS` unverändert.
- **2026-10-16 · Canary-Baseline erneuern** `runCanary` kennt die Option `baselineErneuern` (true oder Liste von Adressnamen): Baseline wird mit dem aktuellen Stand überschrieben, kein Drift-Alarm in diesem Lauf, `baseline_neu: true` pro Adresse, `baseline_erneuert` im Report. CLI `pnpm canary --baseline-erneuern [Name …]`, API `POST /internal/canary?baseline=erneuern[&adresse=Name]` mit dem bestehenden Token. Anlass: Baden meldete nach av-parzelle Version 3 bei jedem Lauf 3258 gegen die Baseline 3827. Test im Canary. 81 Tests.
- **2026-10-16 · Bahnlärm, Naturgefahren, Kulturgüter** Drei neue Adapter am Gebäudepunkt, alle geo.admin, alle live an den fünf goldenen Adressen bestätigt und darum verifiziert. `laerm-bahn` (BAFU, WMS GetFeatureInfo wie laerm-strasse): `laerm.bahn.tag_db`, `.nacht_db`; ohne kartierten Bahnlärm kein Wert, sondern `laerm.bahn.hinweis` «keine Bahnlärm-Belastung kartiert», das die View als Lücke mit Grund `hinweis` zeigt. derived: `laerm.bahn.grenzwert_tag_db`, `.grenzwert_nacht_db` nach LSV Anhang 4 Ziff. 2 (im Gesetzestext gegengeprüft), nur mit Bahnpegel. `naturgefahren` (BAFU, drei GetFeatureInfo als text/plain, neuer Parser in `geoadmin.ts`, weil JSON die ganze Zonengeometrie mitschickt): `naturgefahr.oberflaechenabfluss.betroffen`, `naturgefahr.hochwasser.aquaprotect_100`, `naturgefahr.erdbeben.zone`; die Fliesstiefen-Klasse des Oberflächenabflusses gibt der Dienst nicht heraus, darum nur ja/nein. `kulturgueter` (BABS, identify Toleranz 15 m, Distanz rechnerisch): `kulturgut.kgs.betroffen` (false ist ein Fakt, keine Lücke), bei Treffer Name, Kategorie (A/B aus dem Code, roh dazu), Nummer, Objektart, Distanz. Neue Abschnitte «Ortsbild und Denkmal» (nach Zone) und «Naturgefahren» (nach Lärm); Lärm-Labels «Grenzwert Strasse/Bahn». Ausgelassen nach Prüfung: ISOS (nur Ortsbild-Punkte, Perimeter nicht abfragbar) und Fernwärme (`ch.bfe.fernwaerme-angebot` ist das ARA-Wärmepotenzial, `ch.bfe.thermische-netze` eine Punktliste ohne Versorgungsgebiet), beides in QUELLEN.md. Canary `STABILE_KEYS` unverändert. 100 Tests, Live-Test mit Aufzeichnung `neue-quellen-golden.json`.
- **2026-10-16 · Stand pro Fakt, Kopfzeile, Format betroffen** `source_date` gilt jetzt pro Fakt: Der Resolver nimmt `facts[].source_date` vor `AdapterOutput.source_date` (Store und View konnten das Feld schon, nur der Resolver kopierte den Lauf-Wert). `naturgefahren` Version 2 trägt pro Layer den Datenstand der geo.admin-Legendenseite (Oberflächenabfluss 2018-05-22, Aquaprotect 2008-12-18, Erdbebenzonen 2026-04-13, Konstante `DATENSTAND`, URL im Kommentar, Live-Test gegen die Legenden). Steckbrief: `stand` ist weg, pro Feld `daten_vom` (nur mit Datenstand) und `abgefragt_am`, pro Quelle `daten_vom` nur bei einem einheitlichen Stand; Textausgabe `gwr · Daten vom 2026-10-12 · abgefragt 2026-10-16`. Kopf neu dreizeilig mit `adressZeile` («3084 Wabern · Gemeinde Köniz · BE» aus `adresse.plz`, `.ort`, `.gemeinde`, `.kanton`, auch per EGID; fehlende Teile fallen weg), `adresse` im JSON mit `strasse`, `plz`, `ort`. Feldkatalog: Format `betroffen` («betroffen» / «nicht betroffen») für Oberflächenabfluss, Aquaprotect und KGS; Labels «Oberflächenabfluss bei Starkregen», «Hochwasser 100-jährlich (Aquaprotect)». 101 Tests.
- **2026-10-16 · Erklärung Aquaprotect im Wortlaut des Formats** Die Laien-Erklärung sagt «nicht betroffen» statt «nein», passend zum Format `betroffen`; auch in QUELLEN.md. Kein Code-Change sonst.
- **2026-10-16 · ÖREB-Kataster für alle 26 Kantone inventarisiert, 22 angebunden** Inventar über den swisstopo-Layer `ch.swisstopo-vd.stand-oerebkataster` an je einer öffentlichen Referenzadresse pro Kanton (`KANTONS_ADRESSEN`, Rathaus oder Regierungsgebäude des Hauptorts), Basis aus `oereb_extract_url`, bestätigt über `versions/json`. `adapters/oereb/kantone.ts` hat jetzt 26 Einträge mit Basis, Sprache, Grundnutzungs-Muster, Status (`verifiziert`, `experimentell`, `kein_dienst`), Prüfdatum und Notizen; `manifest.cantons` sind die 22 angebundenen. Abfrage mit `GEOMETRY=false&WITHIMAGES=false&LANG=<sprache>`, Timeout 30 s. Der Adapter (Version 3) erkennt drei JSON-Dialekte an der Hülle und normalisiert sie vor dem Schema: openoereb, GeoShop (UR, OW, NW: XML nach JSON, Zonenbezeichnung aus `Map.OtherLegend`) und .NET (LU, FR, VD, GE: `LocalisedText` nach Kontext umbenannt, Sprache und Lawstatus aus Zahlen, `/Date(ms)/`). Grundnutzung über eine Regelkette: Kennzeichnung durch den Kanton (SubCode oder Subthema-Text, auch fr «affectation primaire»; eigene Muster für BS und TI) → TypeCode-Muster (ARE-Systematik für AG, ZH, ZG, SG; JU im TypeCode; GR mit eigenem Zonenplan-Thema `ch.GR.NutzungsplanungZpGgp` und Codes `f1xxxx`/`f4xxxx`) → grösster Flächenanteil mit Confidence 0.8 und `zone.hinweis` (LU, SZ, BL, AR, AI); `zone.erkennung` nennt die Regel, nach Regel 3 heissen die übrigen Einträge `oereb.nutzungsplanung_weitere` und `zone.anzahl` fehlt. Teilflächen derselben Festlegung werden summiert (UR Kernzone 1 aus drei Stücken, ZH Lärmstufe 97 + 3 = 100). `textIn(sprache)` statt `textDe` (Kantonssprache, de, fr, it, rm, erster), `parseStufe` liest fr und it. Nicht angebunden mit Grund: SO und SH (nur XML), VS (antwortet nicht), NE (Extracts nur für registrierte Nutzer); GR lieferte vormittags ein Zertifikat für *.gr.ch, mittags eines für *.geo.gr.ch und ist seither angebunden. 22 Fixtures `oereb-<kanton>.json` (echte Antworten, verkleinert mit `scripts/oereb-fixture.ts`), 140 Tests, Live-Test über alle 26 (ein Extract-Aufruf pro Kanton, GIS Daten AG antwortet beim zweiten mit 429) plus Versionen und die bekannten Fehlerarten der vier. Neuer Kantons-Canary `pnpm canary:kantone` (nur geocode, gwr, oereb, Memory-Store, keine Baseline, ntfy mit Kanton und Fehlerart) als tägliche GitHub Action `canary-kantone.yml` mit Repository-Secret `NTFY_TOPIC`. Feldkatalog: `zone.hinweis` («Hinweis zur Zone»). Exporte für die App: `OEREB_KANTONE`, `OEREB_KANTONE_ANGEBUNDEN`, `oerebKantoneZaehlung`, `KANTONS_ADRESSEN`, `runKantonsCanary`.
- **2026-10-16 · Kantons-Canary** Die Vercel-Function schafft 26 Adressen nicht in einem Aufruf, darum eine zweite Stufe im Core-Repo: `runKantonsCanary` (`src/canary/kantone.ts`) schickt alle `KANTONS_ADRESSEN` ohne Cache durch einen Core mit nur geocode, gwr und oereb (Memory-Store, Breaker-Schwelle 1000), ohne Baseline und Drift, und meldet per ntfy pro Kanton den Befund mit Fehlerart (`failed`, `leer`, `vorgelagert`, `falscher_kanton`; `kein_dienst` ist erwartet und still). CLI `pnpm canary:kantone [--no-notify] [ZH BE …]` (Exit 1 bei Alarm), tägliche GitHub Action `.github/workflows/canary-kantone.yml` (05:41 UTC) mit Repository-Secret `NTFY_TOPIC`. Erster Lauf 16.10.2026: 22 ok, 4 kein Dienst, 88 s. Drei Tests (ok, leer bei 204 und failed bei 500, kein_dienst/falscher Kanton/vorgelagert). 140 Tests.
- **2026-10-16 · GitHub Actions liefen nie** Beide Workflows gaben `pnpm/action-setup@v4` eine `version: 10` mit, während `package.json` `packageManager: pnpm@10.28.0` setzt; die Action bricht bei zwei Angaben ab («Multiple versions of pnpm specified»), jeder `check`-Lauf seit dem 16.10.2026 morgens war nach 10 s rot. `version` entfernt, die Action liest `packageManager`. Kein Code-Change sonst.
- **2026-10-16 · SO und SH über XML, Kantons-Canary mit zweitem Versuch** Der ÖREB-Adapter (Version 4) liest `extract/xml`, wenn `kantone.ts` für den Kanton `format: 'xml'` sagt: `parseXml` (fast-xml-parser, Präfixe weg, Werte als Strings, Validierung vorab) liefert die Baumform des GeoShop-Dialekts, `erkenneForm` erkennt die Hülle (`xml`), danach dieselbe Normalisierung und Regelkette. SO per SubCode `ch.SO.NutzungsplanungGrundnutzung` (Regel 1), SH per ARE-Systematik im dritten Segment des TypeCodes `sh.sha.142.0.17_inKraft` (Regel 2); beide verifiziert, damit 24 von 26 Kantonen angebunden (kein_dienst nur noch VS, NE), die App zählt das aus dem Core. Neu `zone.hinweis_code` (`flaechenanteil`, `thema_ohne_daten`): Die Stadt Solothurn führt die Nutzungsplanung im Kataster noch als ThemeWithoutData, darum dort kein Zonenfakt, sondern der Hinweis, und die SO-Referenzadresse ist das Stadthaus Olten. Summierte Anteile sind auf 100 begrenzt (Olten: zwei Gestaltungsplan-Perimeter zu 100 und 20.4 %). Timeout pro Kanton (`timeoutMs`, GL 90 s wegen Kaltstart), das Manifest trägt das Maximum. Kantons-Canary: Die roten Läufe vom 16.10.2026 (07:11 und 07:33 UTC) kamen von ZG mit HTTP 500, nicht von GL oder NW; jetzt bei Timeout, 429 und 5xx genau ein zweiter Versuch nach 60 s, Alarm erst danach (`versuche`, `erster_fehler`), kein_dienst nie ein Alarm. Fixtures `oereb-so.xml`, `oereb-so-solothurn.xml`, `oereb-sh.xml` (Skript kann XML), Live-Test schreibt `.xml`, prüft `versions/xml` und die JSON-Probe der beiden. 147 Tests.
