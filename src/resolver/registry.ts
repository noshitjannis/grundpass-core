import type { Adapter } from '../types.ts';

/**
 * Die Liste der Adapter plus Schalter. Ein Adapter ist entweder aktiv oder abgeschaltet.
 * Abschalten geht per Env (GP_DISABLED_ADAPTERS=a,b) oder zur Laufzeit (Admin, Tests).
 */
export class AdapterRegistry {
  private readonly adapters = new Map<string, Adapter>();
  private readonly disabled = new Set<string>();

  constructor(adapters: Adapter[] = [], opts: { disabledFromEnv?: boolean } = {}) {
    for (const a of adapters) this.register(a);
    if (opts.disabledFromEnv ?? true) {
      for (const id of (process.env.GP_DISABLED_ADAPTERS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        this.disabled.add(id);
      }
    }
  }

  register(adapter: Adapter): void {
    const id = adapter.manifest.id;
    if (this.adapters.has(id)) throw new Error(`Adapter-ID doppelt: ${id}`);
    this.adapters.set(id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  all(): Adapter[] {
    return [...this.adapters.values()];
  }

  enabled(): Adapter[] {
    return this.all().filter((a) => !this.disabled.has(a.manifest.id));
  }

  isDisabled(id: string): boolean {
    return this.disabled.has(id);
  }

  disable(id: string): void {
    this.disabled.add(id);
  }

  enable(id: string): void {
    this.disabled.delete(id);
  }

  disabledIds(): string[] {
    return [...this.disabled];
  }
}
