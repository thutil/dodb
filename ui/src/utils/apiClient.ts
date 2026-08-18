import { invoke } from "@tauri-apps/api/core";

export const apiClient = {
  getProfiles: async () => {
    return await invoke("get_profiles");
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveProfile: async (profile: any) => {
    return await invoke("save_profile", { profile });
  },
  deleteProfile: async (id: string) => {
    return await invoke("delete_profile", { id });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testConnection: async (profile: any) => {
    return await invoke("test_connection", { profile });
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
    filters?: any[]
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
      filters
    });
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitChanges: async (id: string, database: string, table: string, changes: any) => {
    return await invoke("commit_changes", { id, database, table, changes });
  },
  executeCommand: async (id: string, database: string, command: string) => {
    return await invoke("execute_command", { id, database, command });
  }
};
