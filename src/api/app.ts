import { Hono } from 'hono';
import { runCanary } from '../canary/run.ts';
import type { Core } from '../core.ts';
import { subjectFor } from '../keys.ts';
import type { CanaryReport } from '../canary/run.ts';

/**
 * Die HTTP-Schicht. Dünn: Eingabe prüfen, Core aufrufen, JSON zurück.
 *
 *   GET  /v1/steckbrief?adresse=…   oder ?egid=…    (&nocache=1)
 *   GET  /v1/fakten?egid=…           aktueller Stand aus dem Store, ohne neuen Lauf
 *   GET  /v1/lauf/:run_id            kompletter Lauf (Debug, Diff)
 *   GET  /v1/sources                 Manifeste, Plan, Schalter, Breaker
 *   GET  /v1/status                  Gesundheit: letzter Canary, Breaker
 *   POST /internal/canary            Canary auslösen (Bearer CANARY_TOKEN); ?baseline=erneuern[&adresse=Name] setzt die Baseline neu
 *   POST /internal/adapters/:id/:on  Adapter ein/aus (Bearer CANARY_TOKEN)
 */
export function createApp(core: Core) {
  const app = new Hono();

  app.get('/', (c) =>
    c.json({
      name: 'grundpass-core',
      version: '0.1.0',
      endpoints: ['/v1/steckbrief?adresse=', '/v1/steckbrief?egid=', '/v1/fakten?egid=', '/v1/lauf/:run_id', '/v1/sources', '/v1/status'],
      lizenz: 'AGPL-3.0-or-later',
    }),
  );

  app.get('/v1/steckbrief', async (c) => {
    const adresse = c.req.query('adresse')?.trim();
    const egidRaw = c.req.query('egid')?.trim();
    const nocache = c.req.query('nocache') === '1';
    const input: Parameters<Core['steckbrief']>[0] = {};
    if (egidRaw) {
      const egid = Number(egidRaw);
      if (!Number.isInteger(egid) || egid <= 0) return c.json({ error: 'egid muss eine positive Ganzzahl sein' }, 400);
      input.egid = egid;
    } else if (adresse) {
      if (adresse.length < 5 || adresse.length > 200) return c.json({ error: 'adresse: 5 bis 200 Zeichen' }, 400);
      input.adresse = adresse;
    } else {
      return c.json({ error: 'adresse oder egid angeben' }, 400);
    }
    const { steckbrief } = await core.steckbrief(input, nocache ? { useCache: false } : {});
    return c.json(steckbrief, steckbrief.partial ? 206 : 200);
  });

  app.get('/v1/fakten', async (c) => {
    const egid = Number(c.req.query('egid'));
    if (!Number.isInteger(egid) || egid <= 0) return c.json({ error: 'egid muss eine positive Ganzzahl sein' }, 400);
    const subject = subjectFor({ egid })!;
    const facts = await core.store.latestFacts(subject);
    if (!facts.length) return c.json({ error: 'noch kein Lauf für diese EGID', subject }, 404);
    const runs = await core.store.listRuns(subject, 10);
    return c.json({ subject, facts, runs });
  });

  app.get('/v1/lauf/:run_id', async (c) => {
    const run = await core.store.getRun(c.req.param('run_id'));
    if (!run) return c.json({ error: 'Lauf nicht gefunden' }, 404);
    return c.json(run);
  });

  app.get('/v1/sources', (c) => c.json(core.sources()));

  app.get('/v1/status', async (c) => {
    const last = await core.store.getSnapshot<CanaryReport>('canary:last');
    const breaker = core.breaker.snapshot();
    const offen = Object.entries(breaker).filter(([, s]) => s.open).map(([id]) => id);
    const adapters = core.registry.all().map((a) => {
      const id = a.manifest.id;
      const h = last?.adapter_gesundheit[id];
      return {
        id,
        titel: a.manifest.title,
        status_manifest: a.manifest.status,
        enabled: !core.registry.isDisabled(id),
        breaker_offen: breaker[id]?.open ?? false,
        letzter_canary: h ? `${h.ok}/${h.total}` : null,
      };
    });
    const zustand = offen.length || (last && !last.ok) ? 'degraded' : 'ok';
    return c.json({ zustand, breaker_offen: offen, adapters, letzter_canary: last ? { gestartet: last.gestartet, ok: last.ok, alarme: last.alarme.length } : null });
  });

  const auth = (c: { req: { header(n: string): string | undefined } }) => {
    const token = process.env.CANARY_TOKEN;
    if (!token) return false;
    return c.req.header('authorization') === `Bearer ${token}`;
  };

  app.post('/internal/canary', async (c) => {
    if (!auth(c)) return c.json({ error: 'nicht erlaubt' }, 401);
    // ?baseline=erneuern setzt die Baseline aller Adressen neu, mit &adresse=Name (mehrfach möglich) nur die genannten
    const opts: Parameters<typeof runCanary>[1] = {};
    if (c.req.query('baseline') === 'erneuern') {
      const namen = c.req.queries('adresse') ?? [];
      opts.baselineErneuern = namen.length ? namen : true;
    }
    const report = await runCanary(core, opts);
    return c.json(report, report.ok ? 200 : 500);
  });

  app.post('/internal/adapters/:id/:on', (c) => {
    if (!auth(c)) return c.json({ error: 'nicht erlaubt' }, 401);
    const id = c.req.param('id');
    if (!core.registry.get(id)) return c.json({ error: 'unbekannter Adapter' }, 404);
    if (c.req.param('on') === 'on') core.registry.enable(id);
    else core.registry.disable(id);
    core.breaker.reset(id);
    return c.json({ id, enabled: !core.registry.isDisabled(id) });
  });

  app.onError((err, c) => {
    core.log.error('api fehler', { error: String(err), path: c.req.path });
    return c.json({ error: 'interner Fehler' }, 500);
  });

  return app;
}
