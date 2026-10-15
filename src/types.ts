/**
 * Zentrale Typen von grundpass-core.
 *
 * Drei Begriffe tragen alles:
 *  - Keys:   die Schlüssel, über die Adapter zusammenhängen (egid, egrid, lv95, bfs_nr ...).
 *  - Fakt:   eine atomare Aussage mit Quelle und Stand. Nie ohne Herkunft.
 *  - Adapter: ein Modul mit Manifest, das aus Keys Fakten (und neue Keys) macht.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export type LV95 = { e: number; n: number };

/** Alle Schlüssel, die im Lauf entstehen können. Jeder Adapter sagt im Manifest, welche er braucht und welche er liefert. */
export type Keys = {
  /** Freitext-Adresse, Eingabe des Nutzers. */
  adresse?: string;
  /** Eidg. Gebäudeidentifikator. Subject aller Fakten. */
  egid?: number;
  /** Eidg. Grundstücksidentifikator (Parzelle). */
  egrid?: string;
  /** Adresspunkt (Eingang) in LV95. */
  lv95?: LV95;
  /** Gebäudekoordinate aus dem GWR in LV95. Besser für Raster-Abfragen als der Adresspunkt. */
  lv95_bau?: LV95;
  /** BFS-Gemeindenummer. */
  bfs_nr?: number;
  /** Kantonskürzel, z.B. "AG". */
  kanton?: string;
  /** Parzellennummer (nur innerhalb der Gemeinde eindeutig). */
  parzelle_nr?: string;
};

export type KeyName = keyof Keys;

// ---------------------------------------------------------------------------
// Fakten
// ---------------------------------------------------------------------------

export type FactValue = string | number | boolean | null;

export type Fact = {
  /** Subject, zu dem der Fakt gehört. Immer `egid:<EGID>`, sobald die EGID bekannt ist. */
  subject: string;
  /** Stabiler, punkt-getrennter Key. Beispiel `gebaeude.baujahr`. */
  key: string;
  value: FactValue;
  /** Einheit, falls sinnvoll. Beispiel `m2`, `dB`, `kWh/a`. */
  unit?: string;
  /** Adapter-ID, die den Fakt geliefert hat. `derived` für berechnete Fakten, `owner` für Nutzereingaben. */
  source: string;
  /** ISO-Zeitpunkt des Abrufs. */
  fetched_at: string;
  /** Die exakte URL, die abgefragt wurde. Macht jeden Fakt nachprüfbar. */
  request_url?: string;
  /** 0..1. Registerdaten 1.0, abgeleitete Werte tiefer, Nutzereingaben am tiefsten. */
  confidence: number;
  /** Lauf, in dem der Fakt entstanden ist. */
  run_id: string;
  /** Optionaler Stand der Quelle selbst (z.B. GWR-Exportdatum), wenn die Quelle ihn mitliefert. */
  source_date?: string;
  /** Bei `source: derived`: die Keys, aus denen der Wert berechnet wurde. */
  derived_from?: string[];
};

/** Was ein Adapter zurückgibt: Fakten ohne Lauf-Metadaten, plus neue Keys. */
export type AdapterOutput = {
  facts: Array<Omit<Fact, 'subject' | 'source' | 'fetched_at' | 'run_id' | 'confidence'> & { confidence?: number }>;
  keys?: Partial<Keys>;
  /** Stand der Quelle, falls bekannt. */
  source_date?: string;
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type AdapterStatusLevel = 'verifiziert' | 'experimentell';

export type AdapterManifest = {
  /** Eindeutige ID, kebab-case. Wird als `source` in jedem Fakt gespeichert. */
  id: string;
  /** Anzeigename. */
  title: string;
  /** Datenhalter, z.B. "BFS", "swisstopo", "BFE". */
  provider: string;
  /**
   * Benötigte Keys. Jeder Eintrag ist ein Key-Name oder eine Oder-Liste mit `|`.
   * Beispiel: `['egid']` oder `['lv95_bau|lv95']`.
   */
  needs: string[];
  /** Keys, die der Adapter liefern kann. Nur Doku und Plan, nicht erzwungen. */
  yields: KeyName[];
  /** Präfixe der Fakten-Keys, die der Adapter liefert. Nur Doku. */
  provides: string[];
  /** Cache-Dauer in Tagen. Innerhalb der TTL wird nicht neu abgefragt. */
  ttlDays: number;
  /** Timeout pro Aufruf in Millisekunden. */
  timeoutMs?: number;
  /** Kantone, in denen der Adapter gilt. Leer = ganze Schweiz. */
  cantons?: string[];
  /** Lizenz der Daten. */
  license: string;
  /** Pflicht-Attribution laut Lizenz. */
  attribution: string;
  /** Basis-Endpoint, nur Doku. */
  endpoint: string;
  /** verifiziert = gegen echte Antwort gebaut und getestet. experimentell = noch ohne Live-Bestätigung. */
  status: AdapterStatusLevel;
  /** Freitext für Doku und Status-Seite. */
  notes?: string;
};

export type FetchLike = typeof fetch;

export type AdapterContext = {
  keys: Readonly<Keys>;
  /** HTTP-Client mit Timeout, Retry, User-Agent und Zod-Validierung. */
  http: HttpClient;
  now: () => Date;
  log: Logger;
};

export type Adapter = {
  manifest: AdapterManifest;
  resolve(ctx: AdapterContext): Promise<AdapterOutput>;
};

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export type HttpResult<T> = {
  data: T;
  url: string;
  ms: number;
  status: number;
};

export interface HttpClient {
  /** GET + JSON + Zod-Parse. Wirft HttpError oder SchemaDriftError. */
  json<T>(url: string, schema: { parse(v: unknown): T }, opts?: { timeoutMs?: number | undefined }): Promise<HttpResult<T>>;
  /** GET als Text. */
  text(url: string, opts?: { timeoutMs?: number | undefined }): Promise<HttpResult<string>>;
}

// ---------------------------------------------------------------------------
// Lauf und Bericht
// ---------------------------------------------------------------------------

export type AdapterRunStatus =
  | 'ok'
  | 'cached'
  | 'failed'
  | 'skipped' // Keys fehlen, weil ein vorgelagerter Adapter nichts geliefert hat
  | 'nicht_anwendbar' // Keys fehlen, die bei dieser Eingabe nie entstehen können (z.B. geocode bei Eingabe per EGID)
  | 'disabled' // per Flag abgeschaltet
  | 'open_circuit' // Circuit Breaker offen
  | 'ausser_kanton'; // Adapter gilt nicht für diesen Kanton

export type AdapterRunReport = {
  adapter: string;
  status: AdapterRunStatus;
  ms: number;
  /** Welche Keys beim Skip gefehlt haben. */
  missing?: string[];
  error?: string;
  /** Fehlerklasse für Alarme: http, schema, timeout, empty, other. */
  error_kind?: 'http' | 'schema' | 'timeout' | 'empty' | 'other';
  request_url?: string;
  facts_count: number;
  /** Stufe, in der der Adapter gelaufen ist (0-basiert). */
  stage: number;
};

export type RunResult = {
  run_id: string;
  subject: string | null;
  input: Partial<Keys>;
  keys: Keys;
  facts: Fact[];
  adapters: AdapterRunReport[];
  /** true, wenn mindestens ein Adapter failed/skipped/open_circuit ist. */
  partial: boolean;
  started_at: string;
  finished_at: string;
  ms: number;
};

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type Logger = {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
};
