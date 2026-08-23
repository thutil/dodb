import { Channel, invoke } from "@tauri-apps/api/core";
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

export const apiClient = {
  getProfiles: async () => {
    return await invoke("get_profiles");
  },
  saveProfile: async (profile: any) => {
    return await invoke("save_profile", { profile });
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
  // `onProgress` is a Tauri Channel: the Rust side pushes a tick per batch
  // rather than the frontend polling for one.
  runImport: async (
    id: string,
    database: string,
    request: ImportRequest,
    onProgress: Channel<ImportProgress>,
  ): Promise<ImportReport> => {
    return await invoke("run_import", { id, database, request, onProgress });
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
