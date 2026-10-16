# Einen Adapter schreiben

Ein Adapter ist eine Datei. Er kennt keinen anderen Adapter. Der Resolver findet über das Manifest heraus, wann er laufen kann.

## In sechs Schritten

1. **Echte Antwort holen.** Bevor du Code schreibst: Die Quelle einmal mit einem echten Objekt abfragen und die Antwort als `test/fixtures/<quelle>-<objekt>.json` speichern. Mit `_hinweis` dazu, woher und von wann. Der Adapter entsteht auf dieser Antwort, nicht aus dem Gedächtnis.

2. **Datei anlegen:** `src/adapters/<id>.ts`

```ts
import { z } from 'zod';
import { EmptyResultError } from '../errors.ts';
import { geoResultsSchema, identifyUrl, nullableNumberish } from '../http/geoadmin.ts';
import type { Adapter, AdapterOutput, LV95 } from '../types.ts';

const attrs = z.object({ wert: nullableNumberish });   // nur die Felder, die du liest

export const meineQuelle: Adapter = {
  manifest: {
    id: 'meine-quelle',               // kebab-case, wird `source` in jedem Fakt
    title: 'Meine Quelle',
    provider: 'Amt XY',
    needs: ['lv95_bau'],              // oder ['egid'], ['egrid'], ['bfs_nr'], 'a|b' für oder
    yields: [],                       // Keys, die du lieferst (nur Doku/Plan)
    provides: ['meins.'],             // Präfixe deiner Fakten-Keys
    ttlDays: 90,
    version: 1,                       // erhöhen, wenn sich die gelieferten Fakten ändern (Cache)
    timeoutMs: 8000,
    cantons: ['AG', 'ZH'],            // weglassen, wenn schweizweit
    license: 'OGD, Quellenangabe Pflicht',
    attribution: '© Amt XY',
    endpoint: 'https://…',
    status: 'experimentell',          // 'verifiziert' erst nach grünem Live-Test
  },
  async resolve(ctx): Promise<AdapterOutput> {
    const point = ctx.keys.lv95_bau as LV95;
    const url = identifyUrl(['ch.xy.layer'], point);
    const { data } = await ctx.http.json(url, geoResultsSchema, { timeoutMs: this.manifest.timeoutMs });
    const hit = data.results[0];
    if (!hit) throw new EmptyResultError(url, 'nichts am Punkt');   // Lücke, kein Ausfall
    const a = attrs.parse(hit.attributes);                            // wirft bei Drift → SchemaDriftError-Pfad
    return {
      facts: [{ key: 'meins.wert', value: a.wert, unit: 'm2', request_url: url }],
      keys: {},                                                       // falls du neue Keys lieferst
    };
  },
};
```

3. **Eintragen** in `src/adapters/index.ts` (Import + in `adapters`).

4. **Test** in `test/adapters.test.ts`: Fixture-Route in `test/helpers/fixtures.ts` ergänzen, ein `it` pro Verhalten (normal, leer, Drift).

5. **Feldkatalog**: Die Keys, die im Steckbrief erscheinen sollen, in `src/views/felder.ts` eintragen (Label, Abschnitt, Erklärung für Laien, `erwartet` wenn eine fehlende Angabe eine Lücke ist).

6. **Doku**: Abschnitt in `docs/QUELLEN.md` (Tabelle wie bei den anderen), Zeile im Changelog von `docs/ARCHITEKTUR.md`. Im selben Commit.

## Regeln

- **Keine Zahl ohne `request_url`.** Jeder Fakt muss nachprüfbar sein.
- **`EmptyResultError`** für "Quelle hat nichts zu diesem Objekt". Zählt nicht für den Breaker.
- **Codes nur mappen, wenn sicher.** Lesbarer Wert `null` plus Rohcode, nie raten.
- **Confidence < 1** für alles, was du selbst berechnest oder interpretierst (z.B. Fläche aus Geometrie 0.95, Lesehilfen 0.8).
- **`source_date`** setzen, wenn die Quelle ein eigenes Stand-Datum kennt. Es wird `daten_vom` im Steckbrief, getrennt vom Abrufdatum `abgefragt_am`.
  Entweder einmal für den ganzen Lauf (`AdapterOutput.source_date`, z.B. GWR-Exportdatum) oder pro Fakt (`facts[].source_date`, z.B. naturgefahren:
  drei Layer mit drei Datenständen aus der geo.admin-Legende). Der Wert am Fakt geht vor. Steht das Datum nicht in der Antwort, sondern nur auf der
  Metadaten-Seite des Layers, kommt es als Konstante mit der URL im Kommentar in den Adapter; ohne Datum gibt es kein `daten_vom`, nie das Abrufdatum als Ersatz.
- **Nicht in einen anderen Adapter greifen.** Brauchst du etwas, das ein anderer liefert, deklariere es in `needs` als Key. Fehlt der Key als Typ, erweitere `Keys` in `src/types.ts` und `yields` beim Lieferanten.
- **Kein `fetch` direkt.** Immer `ctx.http`, damit Timeout, Retry, User-Agent und Tests funktionieren.
- **Raster-Layer**: `identify` geht nicht, `wmsFeatureInfoUrl` benutzen und `ctx.http.text` parsen.
- **Status `experimentell`** bis der Live-Test die Form bestätigt hat. Dann auf `verifiziert`.
- **`version` erhöhen**, wenn dein Adapter neue Fakten liefert oder alte wegfallen. Gecachte Läufe der alten Version gelten dann nicht mehr. Ohne Bump fehlen neue Fakten bis zum Ablauf der TTL.
- **Kantonale Quellen**: Basis-URL und kantonale Regeln in eine Tabelle neben dem Adapter (Beispiel `src/adapters/oereb/kantone.ts`), `cantons` im Manifest. Jeder Kanton braucht eine eigene Fixture und einen Live-Fall. Antwort ohne Inhalt (204) ist `EmptyResultError`; die Fixture-Route dafür hat `body: null`.

## Wie der Resolver deinen Adapter einordnet

- Deine `needs` erfüllt → läuft in der frühestmöglichen Stufe, parallel zu allen anderen, deren `needs` dann erfüllt sind.
- `cantons` gesetzt → wartet zusätzlich auf `kanton`; passt der Kanton nicht → `ausser_kanton`.
- Fehler → `failed` mit Klasse, der Lauf geht weiter. Nach 3 Fehlern in Folge 15 Minuten Pause (Breaker).
- Innerhalb `ttlDays` kommt der letzte gute Stand aus dem Store, dein Code läuft nicht.
