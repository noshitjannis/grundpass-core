import { createHash } from 'node:crypto';
import type { Core } from '../core.ts';
import type { Fact } from '../types.ts';
import { GOLDENE_ADRESSEN, LATENZ_WARN_MS, STABILE_KEYS, type GoldeneAdresse } from './adressen.ts';
import { createNtfySink, formatAlarme, type Alarm, type AlertSink } from './alert.ts';

export type CanaryAdapterStatus = {
  adapter: string;
  status: string;
  ms: number;
  error_kind?: string;
  error?: string;
};

export type CanaryAdresseReport = {
  name: string;
  adresse: string;
  subject: string | null;
  ms: number;
  partial: boolean;
  adapters: CanaryAdapterStatus[];
  drift: Array<{ key: string; vorher: unknown; nachher: unknown }>;
  baseline_neu: boolean;
};

export type CanaryReport = {
  ok: boolean;
  gestartet: string;
  dauer_ms: number;
  adressen: CanaryAdresseReport[];
  alarme: Alarm[];
  /** Pro Adapter: wie viele der Adressen ok/cached waren. */
  adapter_gesundheit: Record<string, { ok: number; total: number }>;
  benachrichtigt: boolean;
};

type Baseline = Record<string, Fact['value']>;

function stabile(facts: Fact[]): Baseline {
  const out: Baseline = {};
  for (const k of STABILE_KEYS) {
    const f = facts.filter((x) => x.key === k).sort((a, b) => b.confidence - a.confidence)[0];
    if (f && f.value !== null) out[k] = f.value;
  }
  return out;
}

/**
 * Der Canary: alle goldenen Adressen ohne Cache durch den Resolver, Ergebnis gegen Baseline prüfen,
 * Alarme sammeln, einmal benachrichtigen (dedupliziert über einen Hash der Alarmliste).
 */
export async function runCanary(
  core: Core,
  opts: { adressen?: GoldeneAdresse[]; sink?: AlertSink; notify?: boolean } = {},
): Promise<CanaryReport> {
  const adressen = opts.adressen ?? GOLDENE_ADRESSEN;
  const sink = opts.sink ?? createNtfySink({ log: core.log });
  const t0 = Date.now();
  const gestartet = new Date().toISOString();
  const alarme: Alarm[] = [];
  const reports: CanaryAdresseReport[] = [];
  const gesundheit: Record<string, { ok: number; total: number }> = {};

  for (const g of adressen) {
    const run = await core.resolve({ adresse: g.adresse }, { useCache: false });
    const adapters: CanaryAdapterStatus[] = run.adapters
      .filter((r) => r.status !== 'disabled' && r.status !== 'ausser_kanton')
      .map((r) => {
        const s: CanaryAdapterStatus = { adapter: r.adapter, status: r.status, ms: r.ms };
        if (r.error_kind) s.error_kind = r.error_kind;
        if (r.error) s.error = r.error;
        return s;
      });

    for (const a of adapters) {
      const h = (gesundheit[a.adapter] ??= { ok: 0, total: 0 });
      h.total++;
      if (a.status === 'ok' || a.status === 'cached') h.ok++;
      if (a.status === 'failed') {
        const art = (a.error_kind as Alarm['art'] | undefined) ?? 'failed';
        alarme.push({ schwere: art === 'empty' ? 'warn' : 'error', adapter: a.adapter, adresse: g.name, art, text: a.error ?? a.status });
      } else if (a.status === 'open_circuit') {
        alarme.push({ schwere: 'error', adapter: a.adapter, adresse: g.name, art: 'open_circuit', text: 'Circuit Breaker offen' });
      } else if (a.status === 'skipped') {
        alarme.push({ schwere: 'warn', adapter: a.adapter, adresse: g.name, art: 'skipped', text: 'übersprungen, Schlüssel fehlen (vorgelagerte Quelle ausgefallen)' });
      } else if (a.ms > LATENZ_WARN_MS) {
        alarme.push({ schwere: 'warn', adapter: a.adapter, adresse: g.name, art: 'latenz', text: `${a.ms} ms` });
      }
    }

    // Drift gegen Baseline
    const key = `canary:baseline:${g.adresse}`;
    const jetzt = stabile(run.facts);
    const baseline = await core.store.getSnapshot<Baseline>(key);
    const drift: CanaryAdresseReport['drift'] = [];
    let baselineNeu = false;
    if (!baseline) {
      if (Object.keys(jetzt).length) {
        await core.store.setSnapshot(key, jetzt);
        baselineNeu = true;
      }
    } else {
      for (const [k, v] of Object.entries(baseline)) {
        if (k in jetzt && JSON.stringify(jetzt[k]) !== JSON.stringify(v)) {
          drift.push({ key: k, vorher: v, nachher: jetzt[k] });
          alarme.push({ schwere: 'warn', adapter: 'drift', adresse: g.name, art: 'drift', text: `${k}: ${JSON.stringify(v)} → ${JSON.stringify(jetzt[k])}` });
        }
      }
    }

    reports.push({ name: g.name, adresse: g.adresse, subject: run.subject, ms: run.ms, partial: run.partial, adapters, drift, baseline_neu: baselineNeu });
  }

  const report: CanaryReport = {
    ok: alarme.every((a) => a.schwere !== 'error'),
    gestartet,
    dauer_ms: Date.now() - t0,
    adressen: reports,
    alarme,
    adapter_gesundheit: gesundheit,
    benachrichtigt: false,
  };

  // Benachrichtigen, aber nicht jede Stunde dasselbe.
  if (alarme.length && (opts.notify ?? true)) {
    const hash = createHash('sha1').update(JSON.stringify(alarme.map((a) => [a.adapter, a.adresse, a.art]))).digest('hex');
    const last = await core.store.getSnapshot<{ hash: string }>('canary:last_alarm');
    if (last?.hash !== hash) {
      const { titel, text, schwere } = formatAlarme(alarme);
      await sink(titel, text, schwere);
      await core.store.setSnapshot('canary:last_alarm', { hash, at: gestartet });
      report.benachrichtigt = true;
    }
  } else if (!alarme.length) {
    // Alles gut: Alarm-Hash löschen, damit der nächste Fehler wieder meldet.
    await core.store.setSnapshot('canary:last_alarm', { hash: '', at: gestartet });
  }

  await core.store.setSnapshot('canary:last', report);
  core.log.info('canary fertig', { ok: report.ok, alarme: alarme.length, dauer_ms: report.dauer_ms });
  return report;
}
