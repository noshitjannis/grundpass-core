/** Fehlerklassen, damit Resolver und Canary sauber unterscheiden können, was kaputt ist. */

export class HttpError extends Error {
  readonly kind = 'http' as const;
  constructor(
    message: string,
    readonly url: string,
    readonly status: number,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class TimeoutError extends Error {
  readonly kind = 'timeout' as const;
  constructor(
    readonly url: string,
    readonly timeoutMs: number,
  ) {
    super(`Timeout nach ${timeoutMs} ms: ${url}`);
    this.name = 'TimeoutError';
  }
}

/** Die Quelle antwortet, aber nicht mehr in der Form, die wir kennen. Der wichtigste Alarm. */
export class SchemaDriftError extends Error {
  readonly kind = 'schema' as const;
  constructor(
    readonly url: string,
    readonly issues: string,
  ) {
    super(`Schema-Drift bei ${url}: ${issues}`);
    this.name = 'SchemaDriftError';
  }
}

/** Die Quelle antwortet korrekt, hat aber nichts zu diesem Objekt. Kein Fehler der Quelle, aber eine Lücke. */
export class EmptyResultError extends Error {
  readonly kind = 'empty' as const;
  constructor(
    readonly url: string,
    message = 'Keine Treffer',
  ) {
    super(`${message}: ${url}`);
    this.name = 'EmptyResultError';
  }
}

export type ErrorKind = 'http' | 'schema' | 'timeout' | 'empty' | 'other';

export function errorKind(err: unknown): ErrorKind {
  if (err && typeof err === 'object' && 'kind' in err) {
    const k = (err as { kind: unknown }).kind;
    if (k === 'http' || k === 'schema' || k === 'timeout' || k === 'empty') return k;
  }
  return 'other';
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
