import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHttpClient } from '../../src/http/client.ts';
import type { FetchLike, HttpClient } from '../../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, '..', 'fixtures', name), 'utf8'));
}

type Route = { match: (url: URL) => boolean; body: unknown | string | null; status?: number };

/**
 * Baut ein `fetch`, das URLs auf Fixtures abbildet. Jede Route ist ein Prädikat auf der URL.
 * Nicht gematchte URLs geben 599 und landen so sichtbar als Fehler im Test.
 */
export function fakeFetch(routes: Route[], calls: string[] = []): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(urlStr);
    const url = new URL(urlStr);
    const route = routes.find((r) => r.match(url));
    if (!route) return new Response(`keine Fixture-Route für ${urlStr}`, { status: 599 });
    // body null = Antwort ohne Inhalt (z.B. 204 vom ÖREB-Webservice, wenn die EGRID unbekannt ist)
    if (route.body === null) return new Response(null, { status: route.status ?? 204 });
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body);
    return new Response(body, { status: route.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as FetchLike;
}

/** Standard-Routen für den Wabern-Fall, alle acht Adapter. */
export function wabernRoutes(): Route[] {
  const oevRadon = fixture('oev-radon.json') as { results: Array<{ layerBodId: string }> };
  return [
    { match: (u) => u.pathname.endsWith('/SearchServer'), body: fixture('searchserver-wabern.json') },
    {
      match: (u) => u.pathname.endsWith('/find') && u.searchParams.get('layer') === 'ch.bfs.gebaeude_wohnungs_register',
      body: fixture('gwr-1271632.json'),
    },
    {
      // Hauptweg seit Version 3: find per EGRID
      match: (u) => u.pathname.endsWith('/find') && u.searchParams.get('layer') === 'ch.swisstopo-vd.amtliche-vermessung',
      body: fixture('av-parzelle-find-5711.json'),
    },
    {
      // Fallback und Gegenprobe: identify am Punkt
      match: (u) => u.pathname.endsWith('/identify') && u.searchParams.get('layers') === 'all:ch.swisstopo-vd.amtliche-vermessung',
      body: fixture('av-parzelle-5711.json'),
    },
    {
      match: (u) =>
        u.pathname.endsWith('/identify') &&
        u.searchParams.get('layers') === 'all:ch.bfe.solarenergie-eignung-daecher' &&
        u.searchParams.get('tolerance') === '0',
      body: fixture('sonnendach-point.json'),
    },
    {
      match: (u) =>
        u.pathname.endsWith('/identify') &&
        u.searchParams.get('layers') === 'all:ch.bfe.solarenergie-eignung-daecher' &&
        u.searchParams.get('tolerance') !== '0',
      body: fixture('sonnendach-wide.json'),
    },
    {
      match: (u) => u.pathname.endsWith('/identify') && u.searchParams.get('layers') === 'all:ch.are.gueteklassen_oev',
      body: { results: oevRadon.results.filter((r) => r.layerBodId === 'ch.are.gueteklassen_oev') },
    },
    {
      match: (u) => u.pathname.endsWith('/identify') && u.searchParams.get('layers') === 'all:ch.bag.radonkarte',
      body: { results: oevRadon.results.filter((r) => r.layerBodId === 'ch.bag.radonkarte') },
    },
    {
      match: (u) => u.hostname === 'wms.geo.admin.ch' && (u.searchParams.get('LAYERS') ?? '').includes('_tag'),
      body: fixture('laerm-wms.json'),
    },
    {
      match: (u) => u.hostname === 'wms.geo.admin.ch' && (u.searchParams.get('LAYERS') ?? '').includes('_nacht'),
      body: fixture('laerm-wms-nacht.json'),
    },
    {
      match: (u) => u.hostname === 'www.oereb2.apps.be.ch' && u.pathname === '/extract/json' && u.searchParams.get('EGRID') === 'CH586746359755',
      body: fixture('oereb-be-wabern.json'),
    },
  ];
}

export function httpFor(routes: Route[], calls: string[] = []): HttpClient {
  return createHttpClient({ fetch: fakeFetch(routes, calls), retries: 0 });
}
