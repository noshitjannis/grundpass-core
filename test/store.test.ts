import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgliteMemoryStore, MemoryStore } from '../src/facts/index.ts';
import type { FactStore } from '../src/facts/store.ts';
import type { Fact } from '../src/types.ts';

const mkFact = (over: Partial<Fact>): Fact => ({
  subject: 'egid:1',
  key: 'k',
  value: 1,
  source: 'a',
  fetched_at: '2026-01-01T00:00:00.000Z',
  confidence: 1,
  run_id: 'r1',
  ...over,
});

function suite(name: string, make: () => Promise<FactStore>) {
  describe(name, () => {
    let store: FactStore;
    beforeAll(async () => {
      store = await make();
    });
    afterAll(async () => {
      await store.close();
    });

    it('latestAdapterRun liefert nur ok-Läufe mit ihren Fakten und Keys', async () => {
      await store.saveAdapterRun({
        run_id: 'r1', adapter: 'a', subject: 'egid:1', status: 'ok', ms: 5, cache_hit: false, keys: { egrid: 'X' },
        request_url: 'u1', fetched_at: '2026-01-01T00:00:00.000Z',
        facts: [mkFact({ key: 'a.x', value: 1 }), mkFact({ key: 'a.y', value: 'zwei', unit: 'm2' })],
      });
      await store.saveAdapterRun({
        run_id: 'r2', adapter: 'a', subject: 'egid:1', status: 'failed', ms: 5, cache_hit: false, error: 'x',
        fetched_at: '2026-01-02T00:00:00.000Z', facts: [],
      });
      const hit = await store.latestAdapterRun('egid:1', 'a');
      expect(hit?.run_id).toBe('r1');
      expect(hit?.keys).toEqual({ egrid: 'X' });
      expect(hit?.facts.map((f) => f.key).sort()).toEqual(['a.x', 'a.y']);
      expect(hit?.facts.find((f) => f.key === 'a.y')?.value).toBe('zwei');
      expect(hit?.facts.find((f) => f.key === 'a.y')?.unit).toBe('m2');
      expect(await store.latestAdapterRun('egid:1', 'b')).toBeNull();
      expect(await store.latestAdapterRun('egid:2', 'a')).toBeNull();
    });

    it('latestFacts gibt den jüngsten Fakt pro (key, source)', async () => {
      await store.saveAdapterRun({
        run_id: 'r3', adapter: 'a', subject: 'egid:1', status: 'ok', ms: 1, cache_hit: false, fetched_at: '2026-02-01T00:00:00.000Z',
        facts: [mkFact({ run_id: 'r3', key: 'a.x', value: 99, fetched_at: '2026-02-01T00:00:00.000Z' })],
      });
      const latest = await store.latestFacts('egid:1');
      const ax = latest.filter((f) => f.key === 'a.x');
      expect(ax).toHaveLength(1);
      expect(ax[0]?.value).toBe(99);
      expect(latest.find((f) => f.key === 'a.y')?.value).toBe('zwei');
    });

    it('Snapshots überschreiben sich per Name', async () => {
      await store.setSnapshot('canary', { a: 1 });
      await store.setSnapshot('canary', { a: 2 });
      expect(await store.getSnapshot('canary')).toEqual({ a: 2 });
      expect(await store.getSnapshot('nix')).toBeNull();
    });

    it('derived_from überlebt den Store', async () => {
      await store.saveAdapterRun({
        run_id: 'r4', adapter: 'derived', subject: 'egid:1', status: 'ok', ms: 0, cache_hit: false, fetched_at: '2026-03-01T00:00:00.000Z',
        facts: [mkFact({ run_id: 'r4', key: 'd.q', source: 'derived', value: 0.5, derived_from: ['a.x', 'a.y'], fetched_at: '2026-03-01T00:00:00.000Z' })],
      });
      const latest = await store.latestFacts('egid:1');
      expect(latest.find((f) => f.key === 'd.q')?.derived_from).toEqual(['a.x', 'a.y']);
    });
  });
}

suite('MemoryStore', async () => new MemoryStore());
suite('SqlStore (PGlite im Speicher)', () => createPgliteMemoryStore());
