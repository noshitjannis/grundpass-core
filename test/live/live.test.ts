import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adapters, gwr, laermStrasse } from '../../src/adapters/index.ts';
import { Core } from '../../src/core.ts';
import { createHttpClient } from '../../src/http/client.ts';
import { wmsFeatureInfoUrl } from '../../src/http/geoadmin.ts';
import { silentLogger } from '../../src/log.ts';
import { CircuitBreaker } from '../../src/resolver/breaker.ts';

/**
 * Live-Tests gegen die echten APIs. Laufen nur mit LIVE=1 (pnpm test:live), brauchen Netz.
 * Zweck: 1. bestätigen, dass die Fixtures noch der Wirklichkeit entsprechen,
 *        2. die Antwortform der experimentellen Adapter aufzeichnen (test/live/aufzeichnungen/).
 */
const live = !!process.env.LIVE;

describe.skipIf(!live)('live: geo.admin', () => {
  it('Wabern: alle verifizierten Adapter liefern', async () => {
    const core = await Core.create({ store: 'memory', log: silentLogger, breaker: new CircuitBreaker() });
    const { steckbrief, run } = await core.steckbrief({ adresse: 'Maygutstrasse 26, 3084 Wabern' }, { useCache: false });
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    writeFileSync('test/live/aufzeichnungen/wabern-lauf.json', JSON.stringify(run, null, 2));
    writeFileSync('test/live/aufzeichnungen/wabern-steckbrief.json', JSON.stringify(steckbrief, null, 2));

    const status = Object.fromEntries(run.adapters.map((a) => [a.adapter, a.status]));
    for (const a of adapters.filter((x) => x.manifest.status === 'verifiziert')) {
      expect(status[a.manifest.id], a.manifest.id).toBe('ok');
    }
    const v = (k: string) => run.facts.find((f) => f.key === k)?.value;
    expect(v('gebaeude.egid')).toBe(1271632);
    expect(v('parzelle.egrid')).toBe('CH586746359755');
    expect(v('parzelle.nummer')).toBe('5711');
    expect(v('gebaeude.klasse_kurz')).toBe('Einfamilienhaus');
    expect(v('oev.gueteklasse')).toBe('D');
    expect(typeof v('parzelle.flaeche_m2')).toBe('number');
    expect(typeof v('solar.stromertrag_kwh_a')).toBe('number');
    // Lärm ist experimentell: Status nur protokollieren
    console.log('laerm-strasse:', status['laerm-strasse'], run.adapters.find((a) => a.adapter === 'laerm-strasse')?.error ?? '');
    await core.close();
  }, 60_000);

  it('zeichnet die rohe WMS-GetFeatureInfo-Antwort für Strassenlärm auf', async () => {
    const http = createHttpClient({ retries: 0 });
    const point = { e: 2601737, n: 1197338 };
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    for (const fmt of ['application/json', 'text/plain', 'text/html']) {
      const url = wmsFeatureInfoUrl('ch.bafu.laerm-strassenlaerm_tag', point, fmt);
      try {
        const r = await http.text(url);
        writeFileSync(`test/live/aufzeichnungen/laerm-tag.${fmt.replace('/', '-')}.txt`, `${url}\n\n${r.data}`);
        console.log(`laerm ${fmt}: ${r.status}, ${r.data.length} Zeichen`);
      } catch (err) {
        writeFileSync(`test/live/aufzeichnungen/laerm-tag.${fmt.replace('/', '-')}.txt`, `${url}\n\nFEHLER: ${String(err)}`);
        console.log(`laerm ${fmt}: FEHLER ${String(err).slice(0, 120)}`);
      }
    }
    expect(laermStrasse.manifest.status).toBe('experimentell');
  }, 60_000);

  it('GWR-Antwort hat noch alle Felder, die wir lesen', async () => {
    const http = createHttpClient({ retries: 0 });
    const out = await gwr.resolve({ keys: { egid: 1271632 }, http, now: () => new Date(), log: silentLogger });
    expect(out.keys?.egrid).toBe('CH586746359755');
    expect(out.keys?.lv95_bau).toBeTruthy();
  }, 30_000);
});
