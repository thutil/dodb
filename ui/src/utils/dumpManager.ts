import { saveTextFileAsync } from "./saveFile";
import { apiClient } from "./apiClient";
import { ColumnInfo } from "../types";

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

    try {
      if (config.format === "sql") {
        chunks.push(
          `-- =========================================================\n`,
        );
        chunks.push(`-- DODB Database Backup / Dump\n`);
        chunks.push(`-- Database: ${config.database}\n`);
        chunks.push(`-- Generated: ${new Date().toISOString()}\n`);
        chunks.push(`-- Total Tables: ${config.tables.length}\n`);
        chunks.push(
          `-- =========================================================\n\n`,
        );
        chunks.push(`SET FOREIGN_KEY_CHECKS = 0;\n\n`);
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
          cols = Array.isArray(colData) ? colData : [];
        } catch {
          cols = [];
        }

        // 2. Output Schema / DDL if mode is full or schema_only
        if (config.format === "sql") {
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );
          chunks.push(`-- Table structure for: ${table}\n`);
          chunks.push(
            `-- ---------------------------------------------------------\n`,
          );

          if (config.mode !== "data_only" && cols.length > 0) {
            chunks.push(`DROP TABLE IF EXISTS "${table}";\n`);
            chunks.push(`CREATE TABLE "${table}" (\n`);
            const colDefs = cols.map((col) => {
              const nullable = col.nullable ? "" : " NOT NULL";
              const pk = col.primaryKey ? " PRIMARY KEY" : "";
              const defVal = col.default ? ` DEFAULT ${col.default}` : "";
              return `  "${col.name}" ${col.type || "VARCHAR(255)"}${nullable}${pk}${defVal}`;
            });
            chunks.push(colDefs.join(",\n"));
            chunks.push(`\n);\n\n`);
          }
        } else {
          // JSON header for table
          chunks.push(`    "${table}": [\n`);
        }

        // 3. Output Data in chunked batches if mode is full or data_only
        if (config.mode !== "schema_only") {
          let offset = 0;
          let hasMore = true;
          let tableRowCount = 0;

          if (config.format === "sql") {
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

            tableRowCount += rows.length;
            totalRowsExported += rows.length;
            this.currentProgress.rowsExported = totalRowsExported;
            this.notify();

            if (config.format === "sql") {
              // Generate SQL INSERT statements
              const colNames =
                cols.length > 0
                  ? cols.map((c) => `"${c.name}"`).join(", ")
                  : Object.keys(rows[0])
                      .map((k) => `"${k}"`)
                      .join(", ");
              const valueLines: string[] = [];

              for (const row of rows) {
                const values = (
                  cols.length > 0
                    ? cols.map((c) => row[c.name])
                    : Object.values(row)
                ).map((val) => {
                  if (val === null || val === undefined) return "NULL";
                  if (typeof val === "number" || typeof val === "boolean")
                    return String(val);
                  if (typeof val === "object")
                    return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
                  return `'${String(val).replace(/'/g, "''")}'`;
                });
                valueLines.push(`  (${values.join(", ")})`);
              }

              chunks.push(
                `INSERT INTO "${table}" (${colNames}) VALUES\n${valueLines.join(",\n")};\n`,
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

          if (config.format === "sql") {
            chunks.push(`\n`);
          } else {
            chunks.push(`\n    ]${i < config.tables.length - 1 ? "," : ""}\n`);
          }
        } else if (config.format === "json") {
          chunks.push(`    ]${i < config.tables.length - 1 ? "," : ""}\n`);
        }
      }

      if (this.isCancelled) {
        clearInterval(timerInterval);
        this.currentProgress.status = "cancelled";
        this.notify();
        return;
      }

      if (config.format === "sql") {
        chunks.push(`SET FOREIGN_KEY_CHECKS = 1;\n`);
        chunks.push(
          `-- Dump complete: ${totalRowsExported} rows exported across ${config.tables.length} tables.\n`,
        );
      } else {
        chunks.push(`  }\n}\n`);
      }

      clearInterval(timerInterval);

      // Create downloadable blob
      const mimeType =
        config.format === "sql" ? "application/sql" : "application/json";
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
