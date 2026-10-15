import type { Logger } from './types.ts';

const levels = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof levels;

/** Einfacher JSON-Zeilen-Logger. Level über GP_LOG_LEVEL (debug|info|warn|error), Standard info. */
export function createLogger(opts: { level?: Level; name?: string; sink?: (line: string) => void } = {}): Logger {
  const level = opts.level ?? ((process.env.GP_LOG_LEVEL as Level | undefined) ?? 'info');
  const min = levels[level] ?? 20;
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + '\n'));
  const emit = (lvl: Level, msg: string, data?: Record<string, unknown>) => {
    if (levels[lvl] < min) return;
    sink(JSON.stringify({ t: new Date().toISOString(), lvl, name: opts.name, msg, ...data }));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
