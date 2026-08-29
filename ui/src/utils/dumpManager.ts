import { saveTextFileAsync } from "./saveFile";
import { apiClient } from "./apiClient";
import { ColumnInfo, DBType } from "../types";
import { TableConstraints, draftFromSchema } from "../components/tableDesign/draft";
import {
  DIALECT_LABEL,
  ForeignKeyDraft,
  buildAddForeignKey,
  buildCreateTable,
  buildDropTable,
  quoteIdent,
  quoteTableIdent,
  sqlLiteral,
  toDialect,
} from "./ddlBuilder";

export interface DumpConfig {
  profileId: string;
  database: string;
  dbType?: string;
  tables: string[];
  mode: "full" | "schema_only" | "data_only";
  format: "sql" | "json";
  batchSize: number;
}

export interface DumpProgress {
  status: "idle" | "running" | "paused" | "completed" | "error" | "cancelled";
  currentTable: string;
  currentTableIndex: number;
  totalTables: number;
  rowsExported: number;
  percentage: number;
  startTime: number;
  elapsedSeconds: number;
  fileName?: string;
  fileSizeBytes?: number;
  error?: string;
}

type ProgressListener = (progress: DumpProgress) => void;

/**
 * Statements that make the restore order-independent, before any table is
 * touched.
 *
 * Postgres gets nothing on purpose: `SET session_replication_role` needs
 * superuser and would fail on managed instances, which is the very failure this
 * dump is trying to avoid. Its foreign keys are deferred to the end of the file
 * instead, which needs no privileges at all.
 */
function dumpPreamble(d: DBType): string[] {
  if (d === "mariadb") {
    return ["SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;"];
  }
  if (d === "sqlite") {
    return ["PRAGMA foreign_keys = OFF;"];
  }
  return [];
}

/** The matching re-enable, emitted once every table and constraint is in. */
function dumpPostamble(d: DBType): string[] {
  if (d === "mariadb") return ["SET FOREIGN_KEY_CHECKS = 1;"];
  if (d === "sqlite") return ["PRAGMA foreign_keys = ON;"];
  return [];
}

/**
 * Move a Postgres identity/serial sequence past the rows the dump just
 * inserted, so the next application insert does not collide with them.
 *
 * `pg_get_serial_sequence` returns NULL for a column with no sequence and
 * `setval` is strict, so a column that only looked auto-incrementing is a
 * no-op rather than an error.
 */
function resetSequenceStmt(table: string, column: string): string {
  const qTable = quoteTableIdent(table, "postgres");
  const qCol = quoteIdent(column, "postgres");
  return (
    `SELECT setval(pg_get_serial_sequence(${sqlLiteral(qTable, "postgres")}, ${sqlLiteral(column, "postgres")}), ` +
    `COALESCE((SELECT MAX(${qCol}) FROM ${qTable}), 0) + 1, false);`
  );
}

class DumpManager {
  private isCancelled = false;
  /** The finished dump, held until the user picks a destination. */
  private currentDumpText = "";
  private isPaused = false;
  private currentProgress: DumpProgress = {
    status: "idle",
    currentTable: "",
    currentTableIndex: 0,
    totalTables: 0,
    rowsExported: 0,
    percentage: 0,
    startTime: 0,
    elapsedSeconds: 0,
  };
  private listeners: Set<ProgressListener> = new Set();

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.currentProgress);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((fn) => fn({ ...this.currentProgress }));
  }

  public getProgress(): DumpProgress {
    return { ...this.currentProgress };
  }

  public cancel() {
    if (
      this.currentProgress.status === "running" ||
      this.currentProgress.status === "paused"
    ) {
      this.isCancelled = true;
      this.currentProgress.status = "cancelled";
      this.notify();
    }
  }

  public pause() {
    if (this.currentProgress.status === "running") {
      this.isPaused = true;
      this.currentProgress.status = "paused";
      this.notify();
    }
  }

  public resume() {
    if (this.currentProgress.status === "paused") {
      this.isPaused = false;
      this.currentProgress.status = "running";
      this.notify();
    }
  }

  // Request browser desktop notification permission
  public static async requestNotificationPermission(): Promise<boolean> {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return false;
    }
    if (Notification.permission === "granted") {
      return true;
    }
    if (Notification.permission !== "denied") {
      const res = await Notification.requestPermission();
      return res === "granted";
    }
    return false;
  }

  private sendDesktopNotification(title: string, body: string) {
    if (
      typeof window !== "undefined" &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(title, {
          body,
          icon: "/icon.png",
        });
      } catch (err) {
        console.warn("Desktop notification error:", err);
      }
    }
  }

  public async startDump(config: DumpConfig): Promise<void> {
    if (this.currentProgress.status === "running") {
      throw new Error("A dump job is already in progress.");
    }

    // Try requesting desktop notification permission silently
    DumpManager.requestNotificationPermission().catch(() => {});

    this.isCancelled = false;
    this.isPaused = false;

    const startTime = Date.now();
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const fileName = `${config.database}_dump_${timestamp}.${config.format}`;

    this.currentProgress = {
      status: "running",
      currentTable: config.tables[0] || "",
      currentTableIndex: 0,
      totalTables: config.tables.length,
      rowsExported: 0,
      percentage: 0,
      startTime,
      elapsedSeconds: 0,
      fileName,
    };
    this.notify();

    // Timer to update elapsed seconds
    const timerInterval = setInterval(() => {
      if (this.currentProgress.status === "running") {
        this.currentProgress.elapsedSeconds = Math.floor(
          (Date.now() - startTime) / 1000,
        );
        this.notify();
      }
    }, 1000);

    const chunks: string[] = [];

    // The dialect the dump is written in. Everything below -- quoting, DDL,
    // literals, session flags -- is derived from this one value.
    const dialect: DBType = toDialect(config.dbType);
    const isSql = config.format === "sql";
    const includeSchema = config.mode !== "data_only";
    const includeData = config.mode !== "schema_only";

    // SQLite cannot ALTER TABLE ... ADD CONSTRAINT, so its foreign keys stay
    // inline in CREATE TABLE and the pragma covers the restore order. The other
    // two defer them to the end of the file.
    const deferForeignKeys = dialect !== "sqlite";
    const pendingFks: { table: string; fk: ForeignKeyDraft }[] = [];
    const pendingSequences: { table: string; column: string }[] = [];

    try {
      if (isSql) {
        chunks.push(
          `-- =========================================================\n`,
        );
        chunks.push(`-- DODB Database Backup / Dump\n`);
        chunks.push(`-- Database: ${config.database}\n`);
        // Read back by the import wizard to warn about a dialect mismatch.
        chunks.push(`-- DODB-Dialect: ${dialect}\n`);
        chunks.push(`-- Flavour: ${DIALECT_LABEL[dialect]}\n`);
        chunks.push(`-- Generated: ${new Date().toISOString()}\n`);
        chunks.push(`-- Total Tables: ${config.tables.length}\n`);
        chunks.push(
          `-- =========================================================\n\n`,
        );
        const preamble = dumpPreamble(dialect);
        if (preamble.length > 0) {
          chunks.push(preamble.join("\n") + "\n\n");
        } else if (deferForeignKeys && includeSchema) {
          chunks.push(
            `-- Foreign keys are added at the end of this file, so the order\n` +
              `-- the tables are restored in does not matter.\n\n`,
          );
        }
      } else {
        chunks.push(
          `{\n  "database": "${config.database}",\n  "exportedAt": "${new Date().toISOString()}",\n  "tables": {\n`,
        );
      }

      let totalRowsExported = 0;

      for (let i = 0; i < config.tables.length; i++) {
        if (this.isCancelled) break;

        // Wait if paused
        while (this.isPaused && !this.isCancelled) {
          await new Promise((r) => setTimeout(r, 200));
        }
        if (this.isCancelled) break;

        const table = config.tables[i];
        this.currentProgress.currentTable = table;
        this.currentProgress.currentTableIndex = i + 1;
        this.currentProgress.percentage = Math.round(
          (i / config.tables.length) * 100,
        );
        this.notify();

        // 1. Fetch table columns
        let cols: ColumnInfo[] = [];
        try {
          const colData: any = await apiClient.getColumns(
            config.profileId,
            config.database,
            table,
          );
          cols = Array.isArray(colData) ? colData : colData?.columns || [];
        } catch {
          cols = [];
        }

        // 2. Output Schema / DDL if mode is full or schema_only
        if (isSql) {
          if (includeSchema) {
            chunks.push(
              `-- ---------------------------------------------------------\n`,
            );
            chunks.push(`-- Table structure for: ${table}\n`);
            chunks.push(
              `-- ---------------------------------------------------------\n`,
            );
          }

          if (includeSchema && cols.length > 0) {
            // Indexes and foreign keys, so the dump reproduces the real table
            // and not just its columns. Best-effort: a database that will not
            // report them still gets a usable CREATE TABLE.
            let constraints: TableConstraints | null = null;
            try {
              constraints = (await apiClient.getTableConstraints(
                config.profileId,
                config.database,
                table,
              )) as TableConstraints;
            } catch (cErr) {
              console.warn(`Could not fetch constraints for ${table}:`, cErr);
            }

            const draft = draftFromSchema(table, cols, constraints);
            if (deferForeignKeys) {
              for (const fk of draft.foreignKeys) {
                pendingFks.push({ table, fk });
              }
            }

            chunks.push(buildDropTable(table, dialect, dialect === "postgres", true) + "\n");
            chunks.push(
              buildCreateTable(
                { ...draft, foreignKeys: deferForeignKeys ? [] : draft.foreignKeys },
                dialect,
              ).join("\n") + "\n\n",
            );
          }
        } else {
          // JSON header for table
          chunks.push(`    "${table}": [\n`);
        }

        // 3. Output Data in chunked batches if mode is full or data_only
        if (includeData) {
          if (dialect === "postgres") {
            for (const col of cols) {
              if (col.autoIncrement) {
                pendingSequences.push({ table, column: col.name });
              }
            }
          }

          let offset = 0;
          let hasMore = true;

          if (isSql) {
            chunks.push(`-- Data for table: ${table}\n`);
          }

          while (hasMore && !this.isCancelled) {
            while (this.isPaused && !this.isCancelled) {
              await new Promise((r) => setTimeout(r, 200));
            }
            if (this.isCancelled) break;

            const res: any = await apiClient.getRows(
              config.profileId,
              config.database,
              table,
              config.batchSize,
              offset,
            );

            const rows: Record<string, any>[] = res?.rows || [];
            if (rows.length === 0) {
              hasMore = false;
              break;
            }

            totalRowsExported += rows.length;
            this.currentProgress.rowsExported = totalRowsExported;
            this.notify();

            if (isSql) {
              // Generate SQL INSERT statements
              const colNames =
                cols.length > 0
                  ? cols.map((c) => quoteIdent(c.name, dialect)).join(", ")
                  : Object.keys(rows[0])
                      .map((k) => quoteIdent(k, dialect))
                      .join(", ");
              const valueLines: string[] = [];

              for (const row of rows) {
                const values = (
                  cols.length > 0
                    ? cols.map((c) => row[c.name])
                    : Object.values(row)
                ).map((val) => sqlLiteral(val, dialect));
                valueLines.push(`  (${values.join(", ")})`);
              }

              chunks.push(
                `INSERT INTO ${quoteTableIdent(table, dialect)} (${colNames}) VALUES\n${valueLines.join(",\n")};\n`,
              );
            } else {
              // Format as JSON stream
              const jsonLines = rows.map((r) => `      ${JSON.stringify(r)}`);
              chunks.push((offset > 0 ? ",\n" : "") + jsonLines.join(",\n"));
            }

            offset += config.batchSize;
            if (rows.length < config.batchSize) {
              hasMore = false;
            }

            // Non-blocking yield to browser event loop
            await new Promise((resolve) => setTimeout(resolve, 5));
          }

          if (isSql) {
            chunks.push(`\n`);
          } else {
            chunks.push(`\n    ]${i < config.tables.length - 1 ? "," : ""}\n`);
          }
        } else if (!isSql) {
          chunks.push(`    ]${i < config.tables.length - 1 ? "," : ""}\n`);
        }
      }

      if (this.isCancelled) {
        clearInterval(timerInterval);
        this.currentProgress.status = "cancelled";
        this.notify();
        return;
      }

      if (isSql) {
        if (pendingFks.length > 0) {
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );
          chunks.push(`-- Foreign keys\n`);
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );
          chunks.push(
            pendingFks
              .map(({ table, fk }) => buildAddForeignKey(table, fk, dialect))
              .join("\n") + "\n\n",
          );
        }

        if (pendingSequences.length > 0) {
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );
          chunks.push(`-- Sequences, moved past the rows restored above\n`);
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );
          chunks.push(
            pendingSequences
              .map(({ table, column }) => resetSequenceStmt(table, column))
              .join("\n") + "\n\n",
          );
        }

        const postamble = dumpPostamble(dialect);
        if (postamble.length > 0) {
          chunks.push(postamble.join("\n") + "\n");
        }
        chunks.push(
          `-- Dump complete: ${totalRowsExported} rows exported across ${config.tables.length} tables.\n`,
        );
      } else {
        chunks.push(`  }\n}\n`);
      }

      clearInterval(timerInterval);

      // Create downloadable blob
      const mimeType = isSql ? "application/sql" : "application/json";
      const blob = new Blob(chunks, { type: mimeType });
      // The dump text is kept, not a blob URL: the file is written by the
      // backend through a native save dialog, so there is nothing for the
      // webview to download. See utils/saveFile.ts.
      this.currentDumpText = chunks.join("");

      this.currentProgress = {
        ...this.currentProgress,
        status: "completed",
        percentage: 100,
        rowsExported: totalRowsExported,
        fileSizeBytes: blob.size,
        elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
      };
      this.notify();

      // Trigger Completion Notification
      this.sendDesktopNotification(
        "Database Dump Complete",
        `${fileName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB, ${totalRowsExported.toLocaleString()} rows)`,
      );
    } catch (err: any) {
      clearInterval(timerInterval);
      console.error("Dump error:", err);
      this.currentProgress = {
        ...this.currentProgress,
        status: "error",
        error: err?.message || String(err),
      };
      this.notify();
    }
  }

  /** Writes the finished dump through the host's native save dialog. */
  public downloadCurrentBlob() {
    if (!this.currentDumpText || !this.currentProgress.fileName) return;
    saveTextFileAsync(this.currentProgress.fileName, this.currentDumpText);
  }
}

export const dumpManager = new DumpManager();
