/**
 * Circuit Breaker pro Adapter.
 * Nach `threshold` Fehlern in Folge geht der Breaker für `cooldownMs` auf. Solange er offen ist,
 * wird der Adapter gar nicht erst aufgerufen (Status `open_circuit`). Nach Ablauf darf genau ein
 * Versuch durch (halb offen); gelingt er, ist der Breaker wieder zu.
 *
 * Läuft im Prozess-Speicher. Bei mehreren Instanzen hat jede ihren eigenen Breaker, das ist in Ordnung.
 */
export type BreakerState = {
  failures: number;
  openedAt: number | null;
  halfOpenInFlight: boolean;
  lastError?: string;
  lastFailureAt?: number;
  lastSuccessAt?: number;
};

export type BreakerOptions = {
  threshold?: number;
  cooldownMs?: number;
  now?: () => number;
};

export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>();
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.threshold = opts.threshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 15 * 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private state(id: string): BreakerState {
    let s = this.states.get(id);
    if (!s) {
      s = { failures: 0, openedAt: null, halfOpenInFlight: false };
      this.states.set(id, s);
    }
    return s;
  }

  /** Darf der Adapter jetzt laufen? */
  canRun(id: string): boolean {
    const s = this.state(id);
    if (s.openedAt === null) return true;
    if (this.now() - s.openedAt < this.cooldownMs) return false;
    // Cooldown vorbei: genau einen Versuch zulassen.
    if (s.halfOpenInFlight) return false;
    s.halfOpenInFlight = true;
    return true;
  }

  recordSuccess(id: string): void {
    const s = this.state(id);
    s.failures = 0;
    s.openedAt = null;
    s.halfOpenInFlight = false;
    s.lastSuccessAt = this.now();
  }

  recordFailure(id: string, error?: string): void {
    const s = this.state(id);
    s.failures += 1;
    s.lastFailureAt = this.now();
    if (error) s.lastError = error;
    s.halfOpenInFlight = false;
    if (s.failures >= this.threshold) s.openedAt = this.now();
  }

  isOpen(id: string): boolean {
    const s = this.state(id);
    return s.openedAt !== null && this.now() - s.openedAt < this.cooldownMs;
  }

  snapshot(): Record<string, BreakerState & { open: boolean }> {
    const out: Record<string, BreakerState & { open: boolean }> = {};
    for (const [id, s] of this.states) out[id] = { ...s, open: this.isOpen(id) };
    return out;
  }

  reset(id?: string): void {
    if (id) this.states.delete(id);
    else this.states.clear();
  }
}
