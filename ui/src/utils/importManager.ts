import { ProgressChannel } from "./apiClient";
import { apiClient } from "./apiClient";

// ==========================================
// Wire types — mirror src-tauri/src/import.rs
// ==========================================

export type ImportFormat = "sql" | "csv" | "json";
export type ConflictStrategy = "error" | "skip" | "update";
export type OnErrorMode = "abort" | "skipRow";
export type TxMode = "perStatement" | "atomicBatch" | "singleTransaction";
export type SourceEncoding = "utf8" | "tis620" | "windows1252";

export type InferredType =
  | "integer"
  | "bigint"
  | "double"
  | "boolean"
  | "date"
  | "timestamp"
  | "json"
  | "text";

export interface CsvOptions {
  delimiter: string;
  quote: string;
  hasHeader: boolean;
  /** Extra spelling of NULL in the source; `\N` is always honoured. */
  nullLiteral: string | null;
  encoding: SourceEncoding;
}

export interface ColumnMapping {
  source: string;
  /** `null` leaves the column out of the INSERT. */
  target: string | null;
  /** Declared SQL type, used only when creating the table. */
  sqlType: string | null;
  valueType: InferredType;
}

export interface ImportRequest {
  filePath: string;
  format: ImportFormat;
  targetTable: string | null;
  createTable: boolean;
  truncateFirst: boolean;
  columns: ColumnMapping[];
  csv: CsvOptions;
  batchSize: number;
  conflict: ConflictStrategy;
  onError: OnErrorMode;
  txMode: TxMode;
  dryRun: boolean;
  maxErrors: number;
}

export interface ImportFileInfo {
  path: string;
  name: string;
  sizeBytes: number;
  format: ImportFormat;
  delimiter: string;
  /** False for a Thai CSV out of Excel, which is CP874 rather than UTF-8. */
  looksUtf8: boolean;
}

export interface PreviewColumn {
  name: string;
  inferredType: InferredType;
  nullable: boolean;
  samples: string[];
}

export interface SqlPreview {
  kind: "sql";
  statements: { sql: string; line: number }[];
  estimatedStatements: number;
  /** True when the whole file fitted in the preview window. */
  exact: boolean;
  dialectHints: string[];
  skippedVersionComments: number;
  /** psql directives (`\restrict`) that will be dropped. */
  skippedMetaCommands: number;
  /** `COPY … FROM stdin` blocks, as a default `pg_dump` writes its rows. */
  copyBlocks: number;
}

export interface TabularPreview {
  kind: "tabular";
  columns: PreviewColumn[];
  rows: (string | null)[][];
  sampledRows: number;
  delimiter: string;
  hasHeader: boolean;
}

export type ImportPreview = SqlPreview | TabularPreview;

export interface ImportFailure {
  index: number;
  line: number | null;
  excerpt: string;
  message: string;
}

export interface ImportReport {
  success: boolean;
  cancelled: boolean;
  dryRun: boolean;
  rowsImported: number;
  statementsRun: number;
  tablesTouched: string[];
  elapsedMs: number;
  failures: ImportFailure[];
  failuresTruncated: boolean;
  skippedVersionComments: number;
  skippedMetaCommands: number;
  /** Rows that came out of a `pg_dump` COPY block. */
  copyRows: number;
}

/** What Rust pushes over the progress channel. */
interface ImportTick {
  phase: string;
  bytesRead: number;
  totalBytes: number;
  percentage: number;
  rowsImported: number;
  statementsRun: number;
  errors: number;
  currentTable: string;
}

export interface ImportProgress extends ImportTick {
  status: "idle" | "running" | "completed" | "error" | "cancelled";
  fileName: string;
  elapsedSeconds: number;
  error?: string;
}

const IDLE: ImportProgress = {
  status: "idle",
  phase: "",
  bytesRead: 0,
  totalBytes: 0,
  percentage: 0,
  rowsImported: 0,
  statementsRun: 0,
  errors: 0,
  currentTable: "",
  fileName: "",
  elapsedSeconds: 0
};

export interface ImportConfig {
  profileId: string;
  database: string;
  fileName: string;
  request: ImportRequest;
}

type ProgressListener = (progress: ImportProgress) => void;

/**
 * Owns the one running import, the way `dumpManager` owns the one running
 * export, so progress survives closing the wizard or switching views.
 *
 * Unlike the export side the loop itself lives in Rust: `start` opens a Tauri
 * progress stream, forwards every tick to the subscribers, and awaits a single
 * `run_import` call. There is no pause/resume because the backend has no way
 * to hold a transaction open indefinitely.
 */
class ImportManager {
  private currentProgress: ImportProgress = { ...IDLE };
  private lastReport: ImportReport | null = null;
  private listeners: Set<ProgressListener> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const snapshot = this.getProgress();
    this.listeners.forEach((fn) => fn(snapshot));
  }

  public getProgress(): ImportProgress {
    return { ...this.currentProgress };
  }

  public getReport(): ImportReport | null {
    return this.lastReport;
  }

  public isRunning(): boolean {
    return this.currentProgress.status === "running";
  }

  public reset() {
    if (this.isRunning()) return;
    this.stopTimer();
    this.currentProgress = { ...IDLE };
    this.lastReport = null;
    this.notify();
  }

  public async cancel() {
    if (!this.isRunning()) return;
    try {
      await apiClient.cancelImport();
    } catch (err) {
      console.warn("Cancel import failed:", err);
    }
  }

  private stopTimer() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sendDesktopNotification(title: string, body: string) {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body, icon: "/icon.png" });
    } catch (err) {
      console.warn("Desktop notification error:", err);
    }
  }

  private static async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const res = await Notification.requestPermission();
      return res === "granted";
    }
    return false;
  }

  public async start(config: ImportConfig): Promise<ImportReport> {
    if (this.isRunning()) {
      throw new Error("An import is already running.");
    }
    ImportManager.requestNotificationPermission().catch(() => {});

    const startTime = Date.now();
    this.lastReport = null;
    this.currentProgress = {
      ...IDLE,
      status: "running",
      phase: "preparing",
      fileName: config.fileName,
      currentTable: config.request.targetTable ?? ""
    };
    this.notify();

    this.stopTimer();
    this.timer = setInterval(() => {
      if (this.currentProgress.status !== "running") return;
      this.currentProgress.elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      this.notify();
    }, 1000);

    const channel = new ProgressChannel<ImportTick>();
    channel.onmessage = (tick) => {
      // A late tick must not resurrect a finished job.
      if (this.currentProgress.status !== "running") return;
      this.currentProgress = { ...this.currentProgress, ...tick };
      this.notify();
    };

    try {
      const report = await apiClient.runImport(
        config.profileId,
        config.database,
        config.request,
        channel
      );
      this.stopTimer();
      this.lastReport = report;
      this.currentProgress = {
        ...this.currentProgress,
        status: report.cancelled ? "cancelled" : report.success ? "completed" : "error",
        phase: "done",
        percentage: report.cancelled ? this.currentProgress.percentage : 100,
        rowsImported: report.rowsImported,
        statementsRun: report.statementsRun,
        errors: report.failures.length,
        elapsedSeconds: Math.round(report.elapsedMs / 1000),
        error: report.failures[0]?.message
      };
      this.notify();

      if (report.success && !report.dryRun) {
        this.sendDesktopNotification(
          "Import complete",
          `${config.fileName} — ${report.rowsImported.toLocaleString()} rows, ${report.statementsRun.toLocaleString()} statements`
        );
      }
      return report;
    } catch (err: unknown) {
      this.stopTimer();
      const message = typeof err === "string" ? err : (err as Error)?.message || String(err);
      this.currentProgress = { ...this.currentProgress, status: "error", phase: "done", error: message };
      this.notify();
      throw new Error(message);
    }
  }
}

export const importManager = new ImportManager();

// ==========================================
// Defaults & small helpers used by the wizard
// ==========================================

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  quote: '"',
  hasHeader: true,
  nullLiteral: null,
  encoding: "utf8"
};

export function defaultRequest(filePath: string, format: ImportFormat): ImportRequest {
  return {
    filePath,
    format,
    targetTable: null,
    createTable: false,
    truncateFirst: false,
    columns: [],
    csv: { ...DEFAULT_CSV_OPTIONS },
    batchSize: 500,
    conflict: "error",
    onError: "abort",
    txMode: "atomicBatch",
    dryRun: false,
    maxErrors: 200
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** The label shown for an inferred type in the mapping table. */
export const TYPE_LABELS: Record<InferredType, string> = {
  integer: "integer",
  bigint: "bigint",
  double: "number",
  boolean: "boolean",
  date: "date",
  timestamp: "timestamp",
  json: "json",
  text: "text"
};

/**
 * Suggests a target column name for a source column.
 *
 * Mirrors `sanitize_ident` in src-tauri/src/import.rs — non-ASCII (Thai
 * included) is kept, ASCII punctuation collapses to `_`.
 */
export function suggestColumnName(raw: string): string {
  let out = "";
  let lastUnderscore = false;
  for (const ch of raw.trim()) {
    const keep = /[A-Za-z0-9_]/.test(ch) || (ch.charCodeAt(0) > 127 && !/\s/.test(ch));
    if (keep) {
      out += ch;
      lastUnderscore = false;
    } else if (!lastUnderscore && out.length > 0) {
      out += "_";
      lastUnderscore = true;
    }
  }
  out = out.replace(/_+$/, "");
  if (!out) return "column";
  return /^[0-9]/.test(out) ? `_${out}` : out;
}
