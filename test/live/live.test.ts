import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adapters, gwr, oereb } from '../../src/adapters/index.ts';
import { OEREB_KANTONE, oerebExtractUrl } from '../../src/adapters/oereb/kantone.ts';
import { Core } from '../../src/core.ts';
import { createHttpClient } from '../../src/http/client.ts';
import { wmsFeatureInfoUrl } from '../../src/http/geoadmin.ts';
import { silentLogger } from '../../src/log.ts';
import { CircuitBreaker } from '../../src/resolver/breaker.ts';

/**
 * Live-Tests gegen die echten APIs. Laufen nur mit LIVE=1 (pnpm test:live), brauchen Netz.
 * Zweck: 1. bestätigen, dass die Fixtures noch der Wirklichkeit entsprechen,
 *        2. rohe Antworten aufzeichnen (test/live/aufzeichnungen/, gitignored) als Beleg für Fixtures und Doku.
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
    expect(typeof v('laerm.strasse.tag_db')).toBe('number');
    expect(typeof v('laerm.strasse.nacht_db')).toBe('number');
    await core.close();
  }, 60_000);

  it('zeichnet die rohen WMS-GetFeatureInfo-Antworten für Strassenlärm auf und prüft die Form', async () => {
    const http = createHttpClient({ retries: 0 });
    const point = { e: 2601737, n: 1197338.426 };
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    const bodies: Record<string, string> = {};
    for (const fmt of ['application/json', 'text/plain', 'text/html']) {
      const url = wmsFeatureInfoUrl('ch.bafu.laerm-strassenlaerm_tag', point, fmt);
      const file = `test/live/aufzeichnungen/laerm-tag.${fmt.replace('/', '-')}.txt`;
      try {
        const r = await http.text(url);
        bodies[fmt] = r.data;
        writeFileSync(file, `${url}\n\n${r.data}`);
      } catch (err) {
        writeFileSync(file, `${url}\n\nFEHLER: ${String(err)}`);
      }
    }
    // Die Form, auf die der Adapter festgezogen ist (15.10.2026): features[0].properties.value_0 als numerischer String.
    const json = JSON.parse(bodies['application/json'] ?? '{}') as { features?: Array<{ properties?: { value_0?: unknown } }> };
    expect(json.features?.[0]?.properties?.value_0).toMatch(/^-?\d+(\.\d+)?$/);
    expect(bodies['text/plain']).toContain('value_0.name');
  }, 60_000);

  it('GWR-Antwort hat noch alle Felder, die wir lesen', async () => {
    const http = createHttpClient({ retries: 0 });
    const out = await gwr.resolve({ keys: { egid: 1271632 }, http, now: () => new Date(), log: silentLogger });
    expect(out.keys?.egrid).toBe('CH586746359755');
    expect(out.keys?.lv95_bau).toBeTruthy();
  }, 30_000);
});

describe.skipIf(!live)('live: oereb (AG, ZH, BE)', () => {
  const faelle = [
    { kanton: 'BE', egrid: 'CH586746359755', zone: /Wohnzone/, name: 'wabern' },
    { kanton: 'AG', egrid: 'CH959983779505', zone: /Kernzone/, name: 'baden' },
    { kanton: 'ZH', egrid: 'CH139977917088', zone: /Zonenordnung/, name: 'zuerich' },
  ];
  for (const f of faelle) {
    it(`${f.kanton} ${f.egrid}: Extract hat noch die bekannte Form, Zone und Grundbuchfläche kommen`, async () => {
      const http = createHttpClient({ retries: 0 });
      const k = OEREB_KANTONE[f.kanton]!;
      mkdirSync('test/live/aufzeichnungen', { recursive: true });
      const roh = await http.text(oerebExtractUrl(k, f.egrid), { timeoutMs: 30_000 });
      writeFileSync(`test/live/aufzeichnungen/oereb-${f.name}.json`, roh.data);
      const out = await oereb.resolve({ keys: { egrid: f.egrid, kanton: f.kanton }, http, now: () => new Date(), log: silentLogger });
      const v = (key: string) => out.facts.find((x) => x.key === key)?.value;
      expect(v('zone.bezeichnung')).toMatch(f.zone);
      expect(typeof v('parzelle.flaeche_grundbuch_m2')).toBe('number');
      expect(typeof v('oereb.belastungen_anzahl')).toBe('number');
      expect(out.source_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }, 60_000);
  }

  it('versions/json nennt für alle drei Kantone extract-2.0 und die eingetragene Basis', async () => {
    const http = createHttpClient({ retries: 0 });
    const schema = z.object({ GetVersionsResponse: z.object({ supportedVersion: z.array(z.object({ version: z.string(), serviceEndpointBase: z.string() })) }) });
    for (const k of Object.values(OEREB_KANTONE)) {
      const { data } = await http.json(`${k.base}/versions/json`, schema, { timeoutMs: 20_000 });
      expect(data.GetVersionsResponse.supportedVersion.map((s) => s.version), k.kanton).toContain('extract-2.0');
      expect(data.GetVersionsResponse.supportedVersion[0]?.serviceEndpointBase.replace(/\/$/, ''), k.kanton).toBe(k.base);
    }
  }, 60_000);

  it('fremde EGRID gibt in ZH 204 ohne Inhalt, der Adapter macht daraus eine Lücke', async () => {
    const http = createHttpClient({ retries: 0 });
    await expect(oereb.resolve({ keys: { egrid: 'CH586746359755', kanton: 'ZH' }, http, now: () => new Date(), log: silentLogger })).rejects.toMatchObject({ kind: 'empty' });
  }, 30_000);
});
