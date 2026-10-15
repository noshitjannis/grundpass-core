import { describe, expect, it } from 'vitest';
import { adapters } from '../src/adapters/index.ts';
import { EmptyResultError } from '../src/errors.ts';
import { MemoryStore } from '../src/facts/memory.ts';
import { createHttpClient } from '../src/http/client.ts';
import { CircuitBreaker } from '../src/resolver/breaker.ts';
import { planFor } from '../src/resolver/plan.ts';
import { AdapterRegistry } from '../src/resolver/registry.ts';
import { resolve } from '../src/resolver/run.ts';
import type { Adapter } from '../src/types.ts';
import { fakeFetch, wabernRoutes } from './helpers/fixtures.ts';

function fakeAdapter(id: string, needs: string[], yields: Partial<Record<string, unknown>>, opts: { fail?: Error; ttlDays?: number; delay?: number } = {}): Adapter & { calls: number } {
  const a = {
    calls: 0,
    manifest: {
      id,
      title: id,
      provider: 'test',
      needs,
      yields: Object.keys(yields) as never[],
      provides: [id + '.'],
      ttlDays: opts.ttlDays ?? 30,
      license: 'test',
      attribution: 'test',
      endpoint: 'test://' + id,
      status: 'verifiziert' as const,
    },
    async resolve() {
      a.calls++;
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (opts.fail) throw opts.fail;
      return { facts: [{ key: `${id}.wert`, value: 1 }], keys: yields as never };
    },
  };
  return a;
}

const http = createHttpClient({ fetch: fakeFetch([]), retries: 0 });

describe('planFor', () => {
  it('bildet Stufen aus Manifesten und erkennt Unerreichbares', () => {
    const a = fakeAdapter('a', ['adresse'], { egid: 1 });
    const b = fakeAdapter('b', ['egid'], { egrid: 'x', lv95_bau: {} });
    const c = fakeAdapter('c', ['egrid'], {});
    const d = fakeAdapter('d', ['lv95_bau|lv95'], {});
    const e = fakeAdapter('e', ['bfs_nr'], {});
    const plan = planFor([a, b, c, d, e], ['adresse']);
    expect(plan.stages).toEqual([['a'], ['b'], ['c', 'd']]);
    expect(plan.unreachable).toEqual([{ adapter: 'e', missing: ['bfs_nr'] }]);
  });

  it('die echten Adapter sind ab Adresse alle erreichbar', () => {
    const plan = planFor(adapters, ['adresse']);
    expect(plan.unreachable).toEqual([]);
    expect(plan.stages[0]).toEqual(['geocode']);
    expect(plan.stages[1]).toEqual(['gwr']);
  });

  it('ab EGID wird geocode nie laufen, der Rest schon', () => {
    const plan = planFor(adapters, ['egid']);
    expect(plan.unreachable.map((u) => u.adapter)).toEqual(['geocode']);
  });
});

describe('resolve', () => {
  it('läuft in Stufen, parallel innerhalb der Stufe, und meldet Übersprungenes', async () => {
    const a = fakeAdapter('a', ['adresse'], { egid: 7 });
    const b = fakeAdapter('b', ['egid'], { egrid: 'CH1' });
    const c = fakeAdapter('c', ['egid'], {}, { fail: new Error('kaputt') });
    const d = fakeAdapter('d', ['egrid'], {});
    const e = fakeAdapter('e', ['bfs_nr'], {});
    const registry = new AdapterRegistry([a, b, c, d, e], { disabledFromEnv: false });
    const store = new MemoryStore();
    const r = await resolve({ adresse: 'x' }, { registry, store, http, breaker: new CircuitBreaker() });

    const byId = Object.fromEntries(r.adapters.map((x) => [x.adapter, x]));
    expect(byId.a?.status).toBe('ok');
    expect(byId.a?.stage).toBe(0);
    expect(byId.b?.stage).toBe(1);
    expect(byId.c?.status).toBe('failed');
    expect(byId.c?.error).toBe('kaputt');
    expect(byId.d?.status).toBe('ok');
    expect(byId.d?.stage).toBe(2);
    expect(byId.e?.status).toBe('nicht_anwendbar'); // bfs_nr liefert niemand, das ist kein Ausfall
    expect(byId.e?.missing).toEqual(['bfs_nr']);
    expect(r.partial).toBe(true);
    expect(r.subject).toBe('egid:7');
    expect(r.facts.every((f) => f.subject === 'egid:7')).toBe(true);
    expect(r.keys).toMatchObject({ egid: 7, egrid: 'CH1' });
    expect(await store.getRun(r.run_id)).toBeTruthy();
  });

  it('nutzt den Cache innerhalb der TTL und fragt danach neu', async () => {
    const b = fakeAdapter('b', ['egid'], { egrid: 'CH1' }, { ttlDays: 1 });
    const registry = new AdapterRegistry([b], { disabledFromEnv: false });
    const store = new MemoryStore();
    let t = new Date('2026-01-01T00:00:00Z');
    const now = () => t;
    const deps = { registry, store, http, now, breaker: new CircuitBreaker() };

    const r1 = await resolve({ egid: 7 }, deps);
    expect(r1.adapters[0]?.status).toBe('ok');
    t = new Date('2026-01-01T12:00:00Z');
    const r2 = await resolve({ egid: 7 }, deps);
    expect(r2.adapters[0]?.status).toBe('cached');
    expect(r2.keys.egrid).toBe('CH1'); // Keys kommen aus dem Cache mit
    expect(r2.facts).toHaveLength(1);
    expect(b.calls).toBe(1);
    t = new Date('2026-01-03T00:00:00Z');
    const r3 = await resolve({ egid: 7 }, deps);
    expect(r3.adapters[0]?.status).toBe('ok');
    expect(b.calls).toBe(2);
  });

  it('Circuit Breaker öffnet nach 3 Fehlern und lässt nach Cooldown einen Versuch durch', async () => {
    const c = fakeAdapter('c', ['egid'], {}, { fail: new Error('down') });
    const registry = new AdapterRegistry([c], { disabledFromEnv: false });
    const store = new MemoryStore();
    let clock = 0;
    const breaker = new CircuitBreaker({ threshold: 3, cooldownMs: 1000, now: () => clock });
    const deps = { registry, store, http, breaker, useCache: false };
    for (let i = 0; i < 3; i++) expect((await resolve({ egid: 1 }, deps)).adapters[0]?.status).toBe('failed');
    expect((await resolve({ egid: 1 }, deps)).adapters[0]?.status).toBe('open_circuit');
    expect(c.calls).toBe(3);
    clock = 2000;
    expect((await resolve({ egid: 1 }, deps)).adapters[0]?.status).toBe('failed'); // halb offen, ein Versuch
    expect(c.calls).toBe(4);
  });

  it('leere Resultate zählen nicht für den Breaker', async () => {
    const c = fakeAdapter('c', ['egid'], {}, { fail: new EmptyResultError('test://c', 'nichts') });
    const registry = new AdapterRegistry([c], { disabledFromEnv: false });
    const breaker = new CircuitBreaker({ threshold: 2 });
    const deps = { registry, store: new MemoryStore(), http, breaker, useCache: false };
    for (let i = 0; i < 4; i++) {
      const r = await resolve({ egid: 1 }, deps);
      expect(r.adapters[0]?.status).toBe('failed');
      expect(r.adapters[0]?.error_kind).toBe('empty');
    }
    expect(breaker.isOpen('c')).toBe(false);
  });

  it('abgeschaltete Adapter laufen nicht und machen den Lauf nicht partial', async () => {
    const b = fakeAdapter('b', ['egid'], {});
    const registry = new AdapterRegistry([b], { disabledFromEnv: false });
    registry.disable('b');
    const r = await resolve({ egid: 1 }, { registry, store: new MemoryStore(), http, breaker: new CircuitBreaker() });
    expect(r.adapters[0]?.status).toBe('disabled');
    expect(r.partial).toBe(false);
  });

  it('Kantons-Einschränkung: läuft nur im passenden Kanton', async () => {
    const k = fakeAdapter('k', ['egrid'], {});
    k.manifest.cantons = ['AG', 'ZH'];
    const registry = new AdapterRegistry([k], { disabledFromEnv: false });
    const deps = { registry, store: new MemoryStore(), http, breaker: new CircuitBreaker() };
    expect((await resolve({ egrid: 'x', kanton: 'BE' }, deps)).adapters[0]?.status).toBe('ausser_kanton');
    expect((await resolve({ egrid: 'x', kanton: 'AG' }, deps)).adapters[0]?.status).toBe('ok');
    expect((await resolve({ egrid: 'x' }, deps)).adapters[0]?.status).toBe('nicht_anwendbar');
  });

  it('skipped nur, wenn ein vorgelagerter Adapter den Key hätte liefern können', async () => {
    const b = fakeAdapter('b', ['egid'], { egrid: 'CH1' }, { fail: new Error('down') });
    const d = fakeAdapter('d', ['egrid'], {});
    const registry = new AdapterRegistry([b, d], { disabledFromEnv: false });
    const r = await resolve({ egid: 1 }, { registry, store: new MemoryStore(), http, breaker: new CircuitBreaker() });
    const byId = Object.fromEntries(r.adapters.map((x) => [x.adapter, x]));
    expect(byId.b?.status).toBe('failed');
    expect(byId.d?.status).toBe('skipped');
    expect(byId.d?.missing).toEqual(['egrid']);
    expect(r.partial).toBe(true);
  });

  it('Timeout pro Adapter greift', async () => {
    const slow = fakeAdapter('slow', ['egid'], {}, { delay: 200 });
    slow.manifest.timeoutMs = 20;
    const registry = new AdapterRegistry([slow], { disabledFromEnv: false });
    const r = await resolve({ egid: 1 }, { registry, store: new MemoryStore(), http, breaker: new CircuitBreaker() });
    expect(r.adapters[0]?.status).toBe('failed');
    expect(r.adapters[0]?.error_kind).toBe('timeout');
  });
});

describe('resolve, Ende zu Ende mit Fixtures (Wabern)', () => {
  it('Adresse rein, alle sieben Adapter plus derived, Subject egid:1271632', async () => {
    const calls: string[] = [];
    const h = createHttpClient({ fetch: fakeFetch(wabernRoutes(), calls), retries: 0 });
    const registry = new AdapterRegistry(adapters, { disabledFromEnv: false });
    const store = new MemoryStore();
    const r = await resolve({ adresse: 'Maygutstrasse 26, 3084 Wabern' }, { registry, store, http: h, breaker: new CircuitBreaker() });

    expect(r.subject).toBe('egid:1271632');
    expect(r.partial).toBe(false);
    expect(r.adapters.filter((a) => a.status === 'ok').map((a) => a.adapter).sort()).toEqual(
      ['av-parzelle', 'geocode', 'gwr', 'laerm-strasse', 'oev-gueteklasse', 'radon', 'sonnendach'],
    );
    const stageOf = Object.fromEntries(r.adapters.map((a) => [a.adapter, a.stage]));
    expect(stageOf.geocode).toBe(0);
    expect(stageOf.gwr).toBe(1);
    expect(stageOf['av-parzelle']).toBe(2);
    expect(stageOf.sonnendach).toBe(2);

    const v = (key: string) => r.facts.find((f) => f.key === key)?.value;
    expect(v('parzelle.flaeche_m2')).toBe(764); // echte Geometrie, Shoelace 764.39 m²
    expect(v('parzelle.bebauter_anteil_prozent')).toBe(18.2); // 139 / 764
    expect(v('gebaeude.alter_jahre')).toBeTypeOf('number');
    expect(v('wohnungen.flaeche_total_m2')).toBe(150);
    expect(r.facts.find((f) => f.key === 'parzelle.bebauter_anteil_prozent')?.derived_from).toEqual(['gebaeude.grundflaeche_m2', 'parzelle.flaeche_m2']);
    expect(r.facts.every((f) => f.source && f.fetched_at)).toBe(true);
    expect(r.facts.length).toBeGreaterThan(60);
    // Raster-Adapter fragen den Gebäudepunkt aus dem GWR ab, nicht den Adresspunkt
    const identify = calls.filter((c) => c.includes('/identify'));
    expect(identify.every((c) => c.includes('geometry=2601737'))).toBe(true);
  });
});
