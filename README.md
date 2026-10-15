# grundpass-core

Das Hirn von [grundpass.ch](https://grundpass.ch). Adresse rein, Grundstücksfakten raus: Baujahr, Heizung, Wohnungen,
Parzelle, Solarpotenzial, ÖV, Radon, Lärm. Aus den offenen Registern des Bundes, jede Zahl mit Quelle, Abruf-URL und Stand.
Nichts wird geraten. Was fehlt, steht als Lücke da.

```
$ pnpm gp "Maygutstrasse 26, 3084 Wabern"

grundpass · Maygutstrasse 26 3084 Wabern · Köniz BE
EGID 1271632 · EGRID CH586746359755 · Parzelle 5711

GEBÄUDE
  Gebäudetyp          Einfamilienhaus                 gwr · 2026-10-12
  Bauperiode          1946 bis 1960                   gwr · 2026-10-12
  Gebäudegrundfläche  139 m2                          gwr · 2026-10-12

HEIZUNG UND WARMWASSER
  Heizung             Ölheizung                       gwr · 2026-10-12

PARZELLE
  Parzellenfläche     761 m2                          av-parzelle · 2026-10-15

SONNE UND DACH
  Solareignung        sehr gut                        sonnendach · 2020-04-13
  Möglicher Solarstrom 26’392 kWh/a                   sonnendach · 2020-04-13
…
LÜCKEN
  Baujahr: fehlt im Register (gwr)
```

## Was drin ist

- **Resolver**: Adapter mit Manifest (`needs`, `yields`, `ttlDays`). Der Ablauf ergibt sich aus den Manifesten, nicht aus Code. Neue Quelle = neue Datei.
- **7 Adapter**: geocode, GWR, amtliche Vermessung, Sonnendach, ÖV-Güteklasse, Radon, Strassenlärm. Alle ohne API-Key.
- **Fakten-Store**: jede Zahl mit Herkunft, TTL-Cache pro Quelle, Snapshots pro Lauf. PGlite lokal, Postgres in Prod.
- **Steckbrief-View**: Abschnitte, Laien-Erklärungen, Lücken mit Grund, Quellenliste, Attribution.
- **Robustheit**: Circuit Breaker pro Quelle, Timeout, Schema-Validierung (Zod), `partial`-Flag statt stiller Defaults.
- **Canary**: fünf goldene Adressen, stündlich, Alarm über ntfy bei Ausfall, Drift oder Latenz.
- **API** (Hono) und **CLI**.

## Loslegen

```bash
pnpm install
pnpm gp "Rütistrasse 1, 5400 Baden"      # Steckbrief im Terminal, Cache in ./data
pnpm dev                                  # API auf http://localhost:3000/v1/steckbrief?adresse=…
pnpm check                                # Typecheck + 40 Offline-Tests
pnpm test:live                            # gegen die echten APIs (braucht Netz)
pnpm canary                               # goldene Adressen durchlaufen
```

Konfiguration über `.env` (siehe `.env.example`). Ohne `.env` läuft alles lokal mit PGlite.

## Als Library

```ts
import { Core } from '@grundpass/core';

const core = await Core.create();
const { steckbrief, run } = await core.steckbrief({ adresse: 'Maygutstrasse 26, 3084 Wabern' });
```

## Doku

- [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md): wie alles zusammenhängt, lebend, mit Changelog
- [docs/QUELLEN.md](docs/QUELLEN.md): jede Quelle mit Endpoint, Feldern, Codes, TTL, Status
- [docs/ADAPTER-SCHREIBEN.md](docs/ADAPTER-SCHREIBEN.md): neue Quelle anschliessen

## Was nicht hier ist

Preise, Bewertungen, Lead-Routing, CRM. Das ist die App, ein separates Repo. Der Core sagt, was ist. Die App sagt, was man daraus macht.

## Quellen und Attribution

Daten: Bundesamt für Statistik (GWR), swisstopo und Kantone (amtliche Vermessung, Adressverzeichnis), Bundesamt für Energie (Sonnendach),
Bundesamt für Raumentwicklung (ÖV-Güteklassen), Bundesamt für Gesundheit (Radonkarte), Bundesamt für Umwelt (Lärm).
Zugriff über die Bundes-Geodateninfrastruktur, api3.geo.admin.ch. Open Government Data, Quellenangabe Pflicht.

## Lizenz

AGPL-3.0-or-later. Ein Produkt von [vugg.ch](https://vugg.ch), Jannis Meierhofer.
Wer den Core als Dienst betreibt und verändert, veröffentlicht die Änderungen. Kommerzielle Lizenzen auf Anfrage.
