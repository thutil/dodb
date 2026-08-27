import { ConnectionProfile } from "../types";
import type {
  ImportFileInfo,
  ImportPreview,
  ImportProgress,
  ImportReport,
  ImportRequest,
  CsvOptions,
  ImportFormat,
} from "./importManager";

/**
 * Transport for the Go backend.
 *
 * Every call goes to POST /invoke/<command_name>, served by the Wails asset
 * server in the packaged app and by cmd/dodb-devserver in the browser.
 *
 * A failed command returns a non-2xx with {"error": "..."} and is re-thrown as
 * an Error.
 */
/**
 * Base URL for the backend.
 *
 * Empty in the packaged app, where the Wails asset server handles /invoke on the
 * page's own origin. During development `next dev` serves the UI on its own port
 * and cannot proxy (Next.js rewrites do not work under `output: "export"`), so
 * NEXT_PUBLIC_DODB_API points at cmd/dodb-devserver instead.
 */
const API_BASE = process.env.NEXT_PUBLIC_DODB_API ?? "";

/** Full URL for a command. */
export function invokeUrl(command: string): string {
  return `${API_BASE}/invoke/${command}`;
}

async function invoke<T = unknown>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(invokeUrl(command), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args ?? {}),
  });

  if (!response.ok) {
    let message = `${command} failed (${response.status})`;
    try {
      const body = await response.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      // A body that is not JSON leaves the status-code message in place.
    }
    throw new Error(message);
  }

  // A command returning nothing sends `null`; callers expecting void ignore it.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** Progress channel for a streaming command. */
export class ProgressChannel<T> {
  onmessage: (value: T) => void = () => {};
  /** Set by runImport so cancellation can close the stream. */
  close: () => void = () => {};
}

export const apiClient = {
  getProfiles: async () => {
    return await invoke("get_profiles");
  },
  saveProfile: async (profile: any) => {
    return await invoke<ConnectionProfile>("save_profile", { profile });
  },
  saveAllProfiles: async (profiles: any[]) => {
    return await invoke("save_all_profiles", { profiles });
  },
  deleteProfile: async (id: string) => {
    return await invoke("delete_profile", { id });
  },
  registerSessionProfile: async (profile: unknown) => {
    return await invoke<ConnectionProfile>("register_session_profile", {
      profile,
    });
  },
  unregisterSessionProfile: async (id: string) => {
    return await invoke("unregister_session_profile", { id });
  },
  setRuntimePassword: async (id: string, password: string) => {
    return await invoke("set_runtime_password", { id, password });
  },
  clearRuntimePassword: async (id?: string) => {
    return await invoke("clear_runtime_password", { id });
  },

  testConnection: async (profile: any) => {
    return await invoke("test_connection", { profile });
  },
  disconnectDatabase: async (id?: string) => {
    return await invoke("disconnect_database", { id });
  },
  pingDatabase: async (id: string, database?: string): Promise<number> => {
    return await invoke("ping_database", { id, database });
  },
  // DB Operations
  getDatabases: async (id: string) => {
    return await invoke("get_databases", { id });
  },
  getTables: async (id: string, database: string) => {
    return await invoke("get_tables", { id, database });
  },
  getColumns: async (id: string, database: string, table: string) => {
    return await invoke("get_columns", { id, database, table });
  },
  getRows: async (
    id: string,
    database: string,
    table: string,
    limit: number,
    offset: number,
    sortColumn?: string | null,
    sortOrder?: string,
    searchQuery?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filters?: any[],
  ) => {
    return await invoke("get_rows", {
      id,
      database,
      table,
      limit,
      offset,
      sortColumn,
      sortOrder,
      searchQuery,
      filters,
    });
  },
  commitChanges: async (
    id: string,
    database: string,
    table: string,
    changes: unknown,
  ) => {
    return await invoke<{
      success: boolean;
      queries: string[];
      affected: number[];
      totalAffected: number;
    }>("commit_changes", { id, database, table, changes });
  },
  executeCommand: async (id: string, database: string, command: string) => {
    return await invoke("execute_command", { id, database, command });
  },
  getTableConstraints: async (id: string, database: string, table: string) => {
    return await invoke("get_table_constraints", { id, database, table });
  },
  executeDdl: async (id: string, database: string, statements: string[]) => {
    return await invoke("execute_ddl", { id, database, statements });
  },
  getSchemaDiagram: async (id: string, database: string) => {
    return await invoke("get_schema_diagram", { id, database });
  },
  selectFile: async (): Promise<string | null> => {
    return await invoke("select_file");
  },
  /** App version string. */
  appVersion: async (): Promise<string> => {
    return await invoke("app_version");
  },
  /**
   * Writes an export through a native save dialog.
   *
   * Replaces the `<a download>` + blob-URL pattern the UI used: under Wails'
   * webview that click dispatches without error and produces no file, which the
   * Phase 0 spike confirmed. Returns the chosen path, or null if cancelled.
   */
  saveTextFile: async (
    suggestedName: string,
    contents: string,
  ): Promise<string | null> => {
    return await invoke("save_text_file", { suggestedName, contents });
  },
  // Data Import
  pickImportFile: async (): Promise<ImportFileInfo | null> => {
    return await invoke("pick_import_file");
  },
  describeImportFile: async (path: string): Promise<ImportFileInfo> => {
    return await invoke("describe_import_file", { path });
  },
  previewImportFile: async (
    path: string,
    format: ImportFormat,
    csv: CsvOptions,
  ): Promise<ImportPreview> => {
    return await invoke("preview_import_file", { path, format, csv });
  },
  /**
   * Streams progress over Server-Sent Events.
   *
   * The Go side pushes one `progress` event per batch and a final `report`
   * event, so the loop still lives in the backend and the frontend never polls.
   * importManager re-broadcasts each tick through its own observer, so nothing
   * downstream of it notices the change.
   */
  runImport: async (
    id: string,
    database: string,
    request: ImportRequest,
    onProgress: ProgressChannel<ImportProgress>,
  ): Promise<ImportReport> => {
    const response = await fetch(invokeUrl("run_import"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, database, request }),
    });
    if (!response.ok || !response.body) {
      let message = `run_import failed (${response.status})`;
      try {
        const body = await response.json();
        if (body && typeof body.error === "string") message = body.error;
      } catch {
        /* keep the status message */
      }
      throw new Error(message);
    }

    const reader = response.body.getReader();
    onProgress.close = () => void reader.cancel();

    const decoder = new TextDecoder();
    let buffer = "";
    let report: ImportReport | null = null;
    let failure: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line.
      let split: number;
      while ((split = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        const payload = JSON.parse(dataLines.join("\n"));

        if (event === "progress") onProgress.onmessage(payload as ImportProgress);
        else if (event === "report") report = payload as ImportReport;
        else if (event === "error") failure = String(payload?.error ?? "import failed");
      }
    }

    if (failure) throw new Error(failure);
    if (!report) throw new Error("the import ended without reporting a result");
    return report;
  },
  cancelImport: async (): Promise<void> => {
    return await invoke("cancel_import");
  },
  // Admin Operations
  adminGetUsers: async (id: string, database: string) => {
    return await invoke("admin_get_users", { id, database });
  },
  adminGetProcesses: async (id: string, database: string) => {
    return await invoke("admin_get_processes", { id, database });
  },
  adminCreateDatabase: async (id: string, database: string, name: string) => {
    return await invoke("admin_create_database", { id, database, name });
  },
  adminDropDatabase: async (id: string, database: string, name: string) => {
    return await invoke("admin_drop_database", { id, database, name });
  },
  adminCreateUser: async (
    id: string,
    database: string,
    username: string,
    password: string,
    isSuperuser: boolean,
  ) => {
    return await invoke("admin_create_user", {
      id,
      database,
      username,
      password,
      isSuperuser,
    });
  },
  adminDropUser: async (
    id: string,
    database: string,
    username: string,
    host?: string,
  ) => {
    return await invoke("admin_drop_user", { id, database, username, host });
  },
  adminKillProcess: async (id: string, database: string, pid: string) => {
    return await invoke("admin_kill_process", { id, database, pid });
  },
};
