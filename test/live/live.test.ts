import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adapters, geocode, gwr, kulturgueter, oereb } from '../../src/adapters/index.ts';
import { DATENSTAND, legendeUrl } from '../../src/adapters/naturgefahren.ts';
import { GOLDENE_ADRESSEN, KANTONS_ADRESSEN } from '../../src/canary/adressen.ts';
import { OEREB_KANTONE, OEREB_KANTONE_ANGEBUNDEN, oerebExtractUrl, oerebTimeoutMs } from '../../src/adapters/oereb/kantone.ts';
import { HttpError, TimeoutError } from '../../src/errors.ts';
import { Core } from '../../src/core.ts';
import { createHttpClient } from '../../src/http/client.ts';
import { wmsFeatureInfoUrl } from '../../src/http/geoadmin.ts';
import { silentLogger } from '../../src/log.ts';
import { CircuitBreaker } from '../../src/resolver/breaker.ts';
import { httpFor } from '../helpers/fixtures.ts';

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
    expect(typeof v('laerm.bahn.tag_db')).toBe('number');
    expect(typeof v('naturgefahr.oberflaechenabfluss.betroffen')).toBe('boolean');
    expect(typeof v('naturgefahr.hochwasser.aquaprotect_100')).toBe('boolean');
    expect(v('naturgefahr.erdbeben.zone')).toMatch(/^Z[123][ab]?$/);
    expect(v('kulturgut.kgs.betroffen')).toBe(false);
    const ids = steckbrief.abschnitte.map((a) => a.id);
    expect(ids).toContain('naturgefahren');
    expect(ids).toContain('ortsbild');
    await core.close();
  }, 60_000);

  it('neue Quellen an den fünf goldenen Adressen: laerm-bahn, naturgefahren und kulturgueter laufen ok, Werte festgehalten', async () => {
    const core = await Core.create({ store: 'memory', log: silentLogger, breaker: new CircuitBreaker() });
    type Eintrag = { status: Record<string, string>; fehler: Record<string, string>; facts: Record<string, unknown> };
    const ergebnis: Record<string, Eintrag> = {};
    const neue = ['laerm-bahn', 'naturgefahren', 'kulturgueter'];
    for (const g of GOLDENE_ADRESSEN) {
      const { run } = await core.steckbrief({ adresse: g.adresse }, { useCache: false });
      const e: Eintrag = { status: {}, fehler: {}, facts: {} };
      for (const id of neue) {
        const r = run.adapters.find((a) => a.adapter === id);
        if (r?.status) e.status[id] = r.status;
        if (r?.error) e.fehler[id] = r.error;
      }
      for (const f of run.facts) if (neue.includes(f.source) || f.key.startsWith('laerm.bahn.')) e.facts[f.key] = f.value;
      ergebnis[g.name] = e;
    }
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    writeFileSync('test/live/aufzeichnungen/neue-quellen-golden.json', JSON.stringify(ergebnis, null, 2));
    for (const g of GOLDENE_ADRESSEN) {
      for (const id of neue) expect(ergebnis[g.name]?.status[id], `${g.name} ${id}`).toBe('ok');
      const f = ergebnis[g.name]!.facts;
      expect(typeof f['naturgefahr.oberflaechenabfluss.betroffen'], g.name).toBe('boolean');
      expect(typeof f['naturgefahr.hochwasser.aquaprotect_100'], g.name).toBe('boolean');
      expect(f['naturgefahr.erdbeben.zone'], g.name).toMatch(/^Z[123][ab]?$/);
      expect(typeof f['kulturgut.kgs.betroffen'], g.name).toBe('boolean');
      // Bahnlärm: entweder beide Pegel oder der Hinweis, nie ein Default
      const pegel = typeof f['laerm.bahn.tag_db'] === 'number' && typeof f['laerm.bahn.nacht_db'] === 'number';
      expect(pegel || typeof f['laerm.bahn.hinweis'] === 'string', `${g.name} Bahnlärm`).toBe(true);
      console.log(`${g.name}: Bahn ${String(f['laerm.bahn.tag_db'])}/${String(f['laerm.bahn.nacht_db'])} dB · Abfluss ${String(f['naturgefahr.oberflaechenabfluss.betroffen'])} · HQ100 ${String(f['naturgefahr.hochwasser.aquaprotect_100'])} · ${String(f['naturgefahr.erdbeben.zone'])} · KGS ${String(f['kulturgut.kgs.betroffen'])}`);
    }
    await core.close();
  }, 300_000);

  it('naturgefahren: die Datenstände im Adapter stimmen mit den geo.admin-Legendenseiten der drei Layer überein', async () => {
    const http = createHttpClient({ retries: 0 });
    for (const [layer, iso] of Object.entries(DATENSTAND)) {
      const { data } = await http.text(legendeUrl(layer));
      const m = data.replace(/<[^>]*>/g, ' ').match(/Datenstand\s+(\d{2})\.(\d{2})\.(\d{4})/);
      expect(m, `${layer}: Legende ohne «Datenstand TT.MM.JJJJ»`).not.toBeNull();
      expect(`${m![3]}-${m![2]}-${m![1]}`, layer).toBe(iso);
    }
  }, 60_000);

  it('kulturgueter: Zytglogge (Bim Zytglogge 3, Bern) trifft den Zeitglockenturm innerhalb von 15 m', async () => {
    const http = createHttpClient({ retries: 0 });
    const out = await kulturgueter.resolve({ keys: { lv95_bau: { e: 2600698.025, n: 1199652.118 } }, http, now: () => new Date(), log: silentLogger });
    const v = (k: string) => out.facts.find((f) => f.key === k)?.value;
    expect(v('kulturgut.kgs.betroffen')).toBe(true);
    expect(v('kulturgut.kgs.name')).toBe('Zeitglockenturm');
    expect(v('kulturgut.kgs.nummer')).toBe(665);
    expect(v('kulturgut.kgs.distanz_m')).toBeLessThanOrEqual(15);
  }, 30_000);

  it('Baden, Rütistrasse 1: av-parzelle findet per EGRID die Register-Parzelle 3258, der Gebäudepunkt liegt auf 3827', async () => {
    const core = await Core.create({ store: 'memory', log: silentLogger, breaker: new CircuitBreaker() });
    const { run } = await core.steckbrief({ adresse: 'Rütistrasse 1, 5400 Baden' }, { useCache: false });
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    writeFileSync('test/live/aufzeichnungen/baden-lauf.json', JSON.stringify(run, null, 2));
    expect(run.adapters.find((a) => a.adapter === 'av-parzelle')?.status).toBe('ok');
    const f = (k: string) => run.facts.find((x) => x.key === k && x.source === 'av-parzelle');
    expect(f('parzelle.nummer')?.value).toBe('3258');
    expect(f('parzelle.nummer')?.request_url).toContain('searchField=egris_egrid');
    expect(f('parzelle.egrid')?.value).toBe('CH959983779505');
    expect(f('parzelle.flaeche_m2')?.value).toBe(395); // Grundbuchfläche laut ÖREB: 394
    expect(f('parzelle.hinweis_vermessung')?.value).toContain('3827');
    await core.close();
  }, 60_000);

  it('zuständige Stellen an den fünf goldenen Adressen: Wabern und Baden eindeutig, Zürich mit Hinweis, Klingnau und Winterthur festgehalten', async () => {
    const core = await Core.create({ store: 'memory', log: silentLogger, breaker: new CircuitBreaker() });
    type Eintrag = { status?: string; fehler?: string; facts: Record<string, unknown> };
    const ergebnis: Record<string, Eintrag> = {};
    for (const g of GOLDENE_ADRESSEN) {
      const { run } = await core.steckbrief({ adresse: g.adresse }, { useCache: false });
      const r = run.adapters.find((a) => a.adapter === 'zustaendige-stellen');
      const e: Eintrag = { facts: Object.fromEntries(run.facts.filter((f) => f.source === 'zustaendige-stellen').map((f) => [f.key, f.value])) };
      if (r?.status) e.status = r.status;
      if (r?.error) e.fehler = r.error;
      ergebnis[g.name] = e;
    }
    mkdirSync('test/live/aufzeichnungen', { recursive: true });
    writeFileSync('test/live/aufzeichnungen/stellen-golden.json', JSON.stringify(ergebnis, null, 2));
    const v = (name: string, key: string) => ergebnis[name]?.facts[key];
    for (const g of GOLDENE_ADRESSEN) expect(ergebnis[g.name]?.status, g.name).toBe('ok');
    expect(v('Wabern EFH (Beispielobjekt)', 'grundbuch.kreis')).toBe('Bern-Mittelland');
    expect(v('Wabern EFH (Beispielobjekt)', 'grundbuch.telefon')).toBe('031 635 93 00');
    expect(v('Wabern EFH (Beispielobjekt)', 'vermessung.geometer_firma')).toBe('bbp geomatik ag');
    expect(v('Baden Büro', 'grundbuch.kreis')).toBe('Baden');
    expect(v('Baden Büro', 'grundbuch.hinweis')).toBeUndefined();
    expect(v('Zürich City', 'grundbuch.hinweis')).toContain('Grundbuchkreise');
    expect(v('Zürich City', 'grundbuch.telefon')).toBeUndefined();
    expect(v('Zürich City', 'grundbuch.kreis')).toBeUndefined();
    // Klingnau und Winterthur: nur festhalten, was kommt (Aufzeichnung), kein Erwartungswert
    for (const name of ['Klingnau', 'Winterthur ZHAW']) {
      const f = ergebnis[name]?.facts ?? {};
      console.log(`stellen ${name}: ${String(f['grundbuch.kreis'] ?? f['grundbuch.hinweis'])} · Geometer ${String(f['vermessung.geometer_firma'])}`);
    }
    await core.close();
  }, 180_000);

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

describe.skipIf(!live)('live: oereb, alle 26 Kantone', () => {
  // Die drei goldenen Parzellen der ersten Anbindung (15.10.2026): Form, Zone, Grundbuchfläche
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

  // Eine Referenzadresse pro Kanton (KANTONS_ADRESSEN): Adresse → EGID → EGRID über den Core (nur geocode und gwr), dann genau ein
  // Extract-Aufruf im Format des Kantons (json, bei SO und SH xml), aufgezeichnet als oereb-<kanton>.<format> und durch den Adapter
  // gegeben. Ein zweiter Aufruf pro Kanton lief bei GIS Daten AG (OW, NW) in ein 429. Angebundene Kantone müssen Zone, Grundbuchfläche
  // und Themenzahl liefern; kein_dienst-Kantone bleiben ausser_kanton.
  for (const g of KANTONS_ADRESSEN) {
    const k = OEREB_KANTONE[g.kanton]!;
    it(`${g.kanton} ${g.name} (${k.status}, ${k.format}): ${k.status === 'kein_dienst' ? 'Adapter läuft nicht (ausser_kanton)' : 'Extract liefert Zone, Grundbuchfläche und Themen, Rohantwort aufgezeichnet'}`, async () => {
      const core = await Core.create({ store: 'memory', adapters: [geocode, gwr, oereb], log: silentLogger, breaker: new CircuitBreaker({ threshold: 99 }) });
      try {
        core.registry.disable('oereb');
        const run = await core.resolve({ adresse: g.adresse }, { useCache: false });
        expect(run.keys.kanton, 'Kanton laut GWR').toBe(g.kanton);
        expect(run.keys.egrid, 'EGRID laut GWR').toMatch(/^CH\d{12}$/);
        if (k.status === 'kein_dienst') {
          core.registry.enable('oereb');
          const voll = await core.resolve({ adresse: g.adresse }, { useCache: false });
          expect(voll.adapters.find((a) => a.adapter === 'oereb')?.status).toBe('ausser_kanton');
          return;
        }
        const http = createHttpClient({ retries: 0 });
        const roh = await http.text(oerebExtractUrl(k, run.keys.egrid!), { timeoutMs: Math.max(60_000, oerebTimeoutMs(k)) });
        mkdirSync('test/live/aufzeichnungen', { recursive: true });
        writeFileSync(`test/live/aufzeichnungen/oereb-${g.kanton.toLowerCase()}.${k.format}`, roh.data);
        const aufgezeichnet = httpFor([{ match: () => true, body: roh.data, status: roh.status }]);
        const out = await oereb.resolve({ keys: { egrid: run.keys.egrid!, kanton: g.kanton }, http: aufgezeichnet, now: () => new Date(), log: silentLogger });
        const v = (key: string) => out.facts.find((x) => x.key === key)?.value;
        expect(typeof v('zone.bezeichnung'), 'zone.bezeichnung').toBe('string');
        expect(['subcode', 'typecode', 'flaechenanteil']).toContain(v('zone.erkennung'));
        expect(typeof v('parzelle.flaeche_grundbuch_m2'), 'parzelle.flaeche_grundbuch_m2').toBe('number');
        expect(typeof v('oereb.belastungen_anzahl'), 'oereb.belastungen_anzahl').toBe('number');
        console.log(`${g.kanton}: ${String(v('zone.bezeichnung'))} (${String(v('zone.erkennung'))}) · ${String(v('parzelle.flaeche_grundbuch_m2'))} m² · ES ${String(v('laerm.empfindlichkeitsstufe'))} · ${String(v('oereb.belastungen_anzahl'))} Themen · ${roh.ms} ms`);
      } finally {
        await core.close();
      }
    }, 180_000);
  }

  it('versions/<format>: jeder angebundene Kanton nennt extract-2.0 (VD und GE schreiben «2.0»), JSON mit oder ohne Hülle GetVersionsResponse, Liste oder einzelnes Objekt; SO und SH als XML', async () => {
    const http = createHttpClient({ retries: 1 }); // ein Netzfehler (ECONNRESET, 16.10.2026) soll nicht 24 Kantone rot machen
    const eintrag = z.object({ version: z.string(), serviceEndpointBase: z.string() });
    const liste = z.union([z.array(eintrag), eintrag]);
    const schema = z.union([z.object({ GetVersionsResponse: z.object({ supportedVersion: liste }) }), z.object({ supportedVersion: liste })]);
    for (const kt of OEREB_KANTONE_ANGEBUNDEN) {
      const k = OEREB_KANTONE[kt]!;
      if (k.format === 'xml') {
        // SO und SH beantworten versions/xml je nach Accept-Header: XML, oder mit Accept application/json ein JAXB-Abbild
        // ({"name":"{…}GetVersionsResponse","value":{"supportedVersion":[{"version":"extract-2.0"}]}}). extract/xml bleibt immer XML.
        const { data } = await http.text(`${k.base}/versions/xml`, { timeoutMs: 30_000 });
        expect(data, kt).toMatch(/(?:<(?:\w+:)?version>|"version"\s*:\s*")(?:extract-)?2\.0/);
        continue;
      }
      const { data } = await http.json(`${k.base}/versions/json`, schema, { timeoutMs: 30_000 });
      const sv = 'GetVersionsResponse' in data ? data.GetVersionsResponse.supportedVersion : data.supportedVersion;
      const versionen = (Array.isArray(sv) ? sv : [sv]).map((s) => s.version);
      expect(versionen, kt).toContainEqual(expect.stringMatching(/^(extract-)?2\.0$/));
    }
  }, 180_000);

  it('Kantone ohne Dienst scheitern noch auf die bekannte Art (sonst wäre es Zeit, sie anzubinden): NE 403, VS Timeout; SO und SH liefern weiterhin kein JSON (415, 500), darum bleibt dort XML', async () => {
    const http = createHttpClient({ retries: 0 });
    const egrid: Record<string, string> = { SO: 'CH693279640610', SH: 'CH581708547860', NE: 'CH467949877161', VS: 'CH235206308395' };
    const befund: Record<string, string> = {};
    for (const [kt, e] of Object.entries(egrid)) {
      try {
        const r = await http.text(oerebExtractUrl(OEREB_KANTONE[kt]!, e, 'json'), { timeoutMs: kt === 'VS' ? 15_000 : 30_000 });
        befund[kt] = `HTTP ${r.status}`;
      } catch (err) {
        befund[kt] = err instanceof HttpError ? `HTTP ${err.status}` : err instanceof TimeoutError ? 'timeout' : String(err).slice(0, 80);
      }
    }
    console.log(`kein_dienst und JSON-Probe: ${JSON.stringify(befund)}`);
    expect(befund.SO).toBe('HTTP 415');
    expect(befund.SH).toBe('HTTP 500');
    expect(befund.NE).toBe('HTTP 403');
    expect(befund.VS).toMatch(/timeout|fetch failed/);
  }, 180_000);

  it('SO, Stadt Solothurn: der Kataster führt die Nutzungsplanung noch als ThemeWithoutData (sonst kann die Referenzadresse zurück aufs Rathaus)', async () => {
    const http = createHttpClient({ retries: 0 });
    const out = await oereb.resolve({ keys: { egrid: 'CH693279640610', kanton: 'SO' }, http, now: () => new Date(), log: silentLogger });
    const v = (key: string) => out.facts.find((x) => x.key === key)?.value;
    console.log(`SO Solothurn Rathaus: zone ${String(v('zone.bezeichnung'))} · hinweis_code ${String(v('zone.hinweis_code'))}`);
    expect(v('zone.bezeichnung') === undefined ? v('zone.hinweis_code') : 'zone da').toBe('thema_ohne_daten');
  }, 60_000);

  it('fremde EGRID gibt in ZH 204 ohne Inhalt, der Adapter macht daraus eine Lücke', async () => {
    const http = createHttpClient({ retries: 0 });
    await expect(oereb.resolve({ keys: { egrid: 'CH586746359755', kanton: 'ZH' }, http, now: () => new Date(), log: silentLogger })).rejects.toMatchObject({ kind: 'empty' });
  }, 30_000);
});
