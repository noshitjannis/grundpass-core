import type { Logger } from '../types.ts';

export type Alarm = {
  schwere: 'warn' | 'error';
  adapter: string;
  adresse: string;
  art: 'failed' | 'schema' | 'empty' | 'timeout' | 'open_circuit' | 'skipped' | 'latenz' | 'drift';
  text: string;
};

export type AlertSink = (titel: string, text: string, schwere: 'warn' | 'error') => Promise<void>;

/**
 * ntfy.sh: Push-Benachrichtigung ohne Konto. Topic in NTFY_TOPIC, am Handy abonnieren, fertig.
 * Optional eigener Server über NTFY_URL. Ohne Topic wird nur geloggt.
 */
export function createNtfySink(opts: { topic?: string | undefined; url?: string | undefined; fetch?: typeof fetch; log?: Logger } = {}): AlertSink {
  const topic = opts.topic ?? process.env.NTFY_TOPIC;
  const base = (opts.url ?? process.env.NTFY_URL ?? 'https://ntfy.sh').replace(/\/$/, '');
  const f = opts.fetch ?? globalThis.fetch;
  return async (titel, text, schwere) => {
    if (!topic) {
      opts.log?.warn('alarm (kein NTFY_TOPIC gesetzt, nur Log)', { titel, text });
      return;
    }
    try {
      const res = await f(`${base}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          Title: titel,
          Priority: schwere === 'error' ? '4' : '3',
          Tags: schwere === 'error' ? 'rotating_light,grundpass' : 'warning,grundpass',
        },
        body: text,
      });
      if (!res.ok) opts.log?.error('ntfy antwortet nicht ok', { status: res.status });
    } catch (err) {
      opts.log?.error('ntfy nicht erreichbar', { error: String(err) });
    }
  };
}

export function formatAlarme(alarme: Alarm[]): { titel: string; text: string; schwere: 'warn' | 'error' } {
  const errors = alarme.filter((a) => a.schwere === 'error');
  const schwere = errors.length ? 'error' : 'warn';
  const adapters = [...new Set(alarme.map((a) => a.adapter))];
  const titel = `grundpass: ${errors.length ? 'Ausfall' : 'Warnung'} bei ${adapters.join(', ')}`;
  const text = alarme
    .slice(0, 12)
    .map((a) => `${a.schwere === 'error' ? '✗' : '!'} ${a.adapter} · ${a.adresse}: ${a.text}`)
    .join('\n') + (alarme.length > 12 ? `\n… und ${alarme.length - 12} weitere` : '');
  return { titel, text, schwere };
}
