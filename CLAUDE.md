# grundpass-core · Arbeitsregeln für dieses Repo

Das Hirn von grundpass.ch. Adresse rein, Fakten mit Quelle und Stand raus.
Ein Produkt von vugg.ch (Jannis Meierhofer), genutzt von AV Schmid Immobilien AG und anderen.
Lizenz: AGPL-3.0-or-later. Die App (Routing, Preise, Leads) liegt in einem separaten, privaten Repo.

## Doku-Pflicht (wichtigste Regel)

`docs/ARCHITEKTUR.md` ist die lebende Beschreibung, was wie funktioniert. Sie ist nie veraltet.

- **Vor jedem Commit:** Prüfen, ob die Änderung etwas daran ändert, wie das System funktioniert
  (neuer Adapter, neue Fakten-Keys, geänderter Ablauf, neue Env-Variable, neuer Endpoint, neue Tabelle).
  Wenn ja: `docs/ARCHITEKTUR.md` und bei Quellen `docs/QUELLEN.md` im selben Commit nachtragen.
- **Nach jedem Commit:** Eintrag im Changelog am Ende von `docs/ARCHITEKTUR.md` (Datum, Kurzsatz, was neu oder anders ist).
- Neue Adapter werden zusätzlich in `docs/QUELLEN.md` eingetragen: Endpoint, Felder, Codes, Lizenz, TTL, Status (verifiziert/experimentell).
- Ein Commit ohne nachgeführte Doku ist unvollständig. Lieber ein Commit mehr als eine Doku-Lücke.

## Konventionen

- Sprache in Code-Kommentaren, Doku, Fakten-Keys und Commit-Messages: Deutsch (Schweizer Schreibweise, ss statt ß).
- Fakten-Keys: kleingeschrieben, Punkt-getrennt, stabil. `gebaeude.baujahr`, `parzelle.flaeche_m2`. Einheit im Key, wenn es eine gibt.
- Jeder Fakt trägt `source`, `fetched_at`, `request_url`. Keine Zahl ohne Herkunft.
- Codes (GWR etc.) nur mappen, wenn die Bedeutung sicher ist. Unsichere Codes roh durchreichen, nie raten.
- Koordinaten intern immer LV95 (EPSG:2056), `e` und `n`. WGS84 nur am Rand.
- Adapter sind reine Module mit Manifest. Kein Adapter kennt einen anderen. Abhängigkeiten laufen nur über Keys.
- Keine stillen Fallbacks: Wenn eine Quelle nichts liefert, ist das ein sichtbarer Zustand (`partial`, `failed`, `luecke`), kein Default-Wert.
- Datenschutz (nDSG): Adressen werden im Store nur als EGID-Subject gespeichert. Keine Personendaten im Core.

## Befehle

```
pnpm install
pnpm gp "Maygutstrasse 26, 3084 Wabern"   # Steckbrief im Terminal
pnpm dev                                   # API auf :3000
pnpm check                                 # Typecheck + Tests (offline, Fixtures)
pnpm test:live                             # echte APIs, braucht Netz
pnpm canary                                # 5 goldene Adressen durchlaufen
```

## Beim Schreiben eines Adapters

Lies `docs/ADAPTER-SCHREIBEN.md`. Kurzfassung: Manifest, `resolve(ctx)`, Zod-Schema auf der echten Antwort,
Fixture unter `test/fixtures/`, Unit-Test, Eintrag in `src/adapters/index.ts`, Eintrag in `docs/QUELLEN.md`.

## Was nicht hierhin gehört

Preislogik, Lead-Routing, Avendo-Anbindung, CRM, alles mit Personenbezug. Das ist die App.
