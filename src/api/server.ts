import { serve } from '@hono/node-server';
import { Core } from '../core.ts';
import { createApp } from './app.ts';

const core = await Core.create();
const app = createApp(core);
const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, () => {
  core.log.info('grundpass-core läuft', { port, adapters: core.registry.enabled().map((a) => a.manifest.id) });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await core.close();
    process.exit(0);
  });
}
