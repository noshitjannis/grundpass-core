import { HttpError, SchemaDriftError, TimeoutError } from '../errors.ts';
import type { FetchLike, HttpClient, HttpResult, Logger } from '../types.ts';

export type HttpClientOptions = {
  fetch?: FetchLike;
  userAgent?: string;
  defaultTimeoutMs?: number;
  /** Anzahl Wiederholungen bei 5xx/Netzfehler. 0 = keine. */
  retries?: number;
  log?: Logger;
};

/**
 * Ein kleiner HTTP-Client, der genau das tut, was Adapter brauchen:
 * GET, Timeout, ein Retry bei 5xx, User-Agent, Zod-Parse mit klarer Fehlerklasse.
 * `fetch` ist injizierbar, damit Tests Fixtures statt Netz liefern.
 */
export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const f = opts.fetch ?? globalThis.fetch;
  const ua = opts.userAgent ?? process.env.GP_USER_AGENT ?? 'grundpass-core/0.1 (+https://grundpass.ch)';
  const defaultTimeout = opts.defaultTimeoutMs ?? 8000;
  const retries = opts.retries ?? 1;

  async function get(url: string, timeoutMs: number): Promise<{ res: Response; ms: number }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const t0 = Date.now();
      try {
        const res = await f(url, {
          method: 'GET',
          headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': ua },
          signal: ctrl.signal,
        });
        const ms = Date.now() - t0;
        if (res.status >= 500 && attempt < retries) {
          lastErr = new HttpError(`HTTP ${res.status}`, url, res.status);
          opts.log?.warn('http 5xx, retry', { url, status: res.status });
          continue;
        }
        return { res, ms };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          lastErr = new TimeoutError(url, timeoutMs);
        } else {
          lastErr = err;
        }
        if (attempt < retries) {
          opts.log?.warn('http fehler, retry', { url, error: String(err) });
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    async json<T>(url: string, schema: { parse(v: unknown): T }, o?: { timeoutMs?: number | undefined }): Promise<HttpResult<T>> {
      const { res, ms } = await get(url, o?.timeoutMs ?? defaultTimeout);
      const text = await res.text();
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, url, res.status, text.slice(0, 300));
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new SchemaDriftError(url, `Antwort ist kein JSON: ${text.slice(0, 120)}`);
      }
      try {
        return { data: schema.parse(raw), url, ms, status: res.status };
      } catch (err) {
        throw new SchemaDriftError(url, (err as Error).message.slice(0, 600));
      }
    },

    async text(url: string, o?: { timeoutMs?: number | undefined }): Promise<HttpResult<string>> {
      const { res, ms } = await get(url, o?.timeoutMs ?? defaultTimeout);
      const text = await res.text();
      if (!res.ok) throw new HttpError(`HTTP ${res.status}`, url, res.status, text.slice(0, 300));
      return { data: text, url, ms, status: res.status };
    },
  };
}
