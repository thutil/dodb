/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { Header } from "../components/Header";
import { SidebarExplorer } from "../components/SidebarExplorer";
import { ConnectionModal } from "../components/ConnectionModal";
import { AuditLogDrawer } from "../components/AuditLogDrawer";
import { TableStructureModal } from "../components/TableStructureModal";
import { CreateTableModal } from "../components/CreateTableModal";
import { EditTableModal } from "../components/EditTableModal";
import { ConfirmDdlModal, ConfirmDdlRequest } from "../components/ConfirmDdlModal";
import { DataGrid, PendingChanges, CommitResult } from "../components/DataGrid";
import { SqlConsole } from "../components/SqlConsole";
import { AdminPanel } from "../components/AdminPanel";
import { SchemaDiagram } from "../components/SchemaDiagram";
import { VisualQueryBuilder } from "../components/VisualQueryBuilder";
import { CommandPalette } from "../components/CommandPalette";
import { AlertCircle, X, CheckCircle2, Download } from "lucide-react";
import { ConnectionProfile, ColumnInfo, TableRowData, QueryExecutionResult, ColumnFilter, DBType } from "../types";
import { DdlResult } from "../components/tableDesign/draft";
import { quoteTableIdent } from "../utils/ddlBuilder";
import { apiClient } from "../utils/apiClient";
import { auditLogger } from "../utils/auditLogger";
import { dumpManager, DumpProgress } from "../utils/dumpManager";

const DEFAULT_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
const SESSION_ID_PREFIX = "session-";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5820/api";


interface ErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class ViewErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMsg: error?.message || String(error) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("View ErrorBoundary caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", padding: 32, gap: 12, color: "var(--text-main)" }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Something went wrong loading this view</div>
          <div style={{ fontSize: 11, color: "var(--accent-red)", fontFamily: "monospace" }}>{this.state.errorMsg}</div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => this.setState({ hasError: false, errorMsg: "" })}
            style={{ marginTop: 8 }}
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Home() {
  const [appVersion, setAppVersion] = useState<string>(DEFAULT_APP_VERSION);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeView, setActiveView] = useState<"explorer" | "sql" | "admin" | "diagram" | "visual-query">("explorer");
  const [sqlConsoleInitialQuery, setSqlConsoleInitialQuery] = useState<string>("");

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);
  const [isConnModalOpen, setIsConnModalOpen] = useState(true);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [dumpProgress, setDumpProgress] = useState<DumpProgress>(dumpManager.getProgress());
  const [showDumpToast, setShowDumpToast] = useState(false);
  const [structureModalTable, setStructureModalTable] = useState<string | null>(null);
  const [isCreateTableOpen, setIsCreateTableOpen] = useState(false);
  const [editTableModalTable, setEditTableModalTable] = useState<string | null>(null);
  const [confirmDdlRequest, setConfirmDdlRequest] = useState<ConfirmDdlRequest | null>(null);

  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string>("");

  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<TableRowData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingData, setLoadingData] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  // Connection-level failures (database/table listing). Rendered as a banner so
  // a failed connection can never look like an empty database.
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Pagination & Filtering
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("ASC");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ColumnFilter[]>([]);

  // Real-time Database Ping Latency
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Request sequence ref to prevent table data race condition
  const fetchSeqRef = React.useRef(0);

  // Auto-detect OS Theme on mount
  useEffect(() => {
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initialTheme = isDark ? "dark" : "light";
    setTheme(initialTheme);
    document.documentElement.setAttribute("data-theme", initialTheme);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const updatedTheme = e.matches ? "dark" : "light";
      setTheme(updatedTheme);
      document.documentElement.setAttribute("data-theme", updatedTheme);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Dynamically load Tauri version at runtime if running in desktop app
  useEffect(() => {
    const loadVersion = async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const v = await getVersion();
        if (v) setAppVersion(v);
      } catch {
        // Fallback to build-time process.env.NEXT_PUBLIC_APP_VERSION
      }
    };
    loadVersion();
  }, []);

  // Subscribe to background dump progress & notify
  useEffect(() => {
    return dumpManager.subscribe((p) => {
      setDumpProgress(p);
      if (p.status === "completed" || p.status === "error") {
        setShowDumpToast(true);
      }
    });
  }, []);

  // Block F12, DevTools shortcuts, and Right-Click Inspect
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      const isF12 = key === "f12";
      const isInspect = (e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && (key === "i" || key === "j" || key === "c");
      const isViewSource = (e.ctrlKey || e.metaKey) && key === "u";

      if ((e.ctrlKey || e.metaKey) && key === "k") {
        e.preventDefault();
        e.stopPropagation();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (isF12 || isInspect || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.setAttribute("data-theme", nextTheme);
  };

  const fetchProfiles = useCallback(async () => {
    try {
      const data: any = await apiClient.getProfiles();
      setProfiles(data);
    } catch {
      // Backend service offline or initial launch
    }
  }, []);

  const handleDisconnect = async () => {
    try {
      if (activeProfile) {
        await apiClient.disconnectDatabase(activeProfile.id);
        if (activeProfile.id.startsWith(SESSION_ID_PREFIX)) {
          await apiClient.unregisterSessionProfile(activeProfile.id);
        }
      } else {
        await apiClient.disconnectDatabase();
      }
    } catch (err) {
      console.warn("Disconnect backend warning", err);
    }
    setActiveProfile(null);
    setActiveDatabase("");
    setDatabases([]);
    setTables([]);
    setActiveTable(null);
    setColumns([]);
    setRows([]);
    setTotalRows(0);
    setIsConnModalOpen(true);
  };

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Loads the database list for a profile and returns it. Throws on failure so
  // callers can report it instead of showing an empty list.
  const loadDatabasesFor = useCallback(async (profile: ConnectionProfile) => {
    const dbList = (await apiClient.getDatabases(profile.id)) as string[];
    setDatabases(dbList);
    if (dbList.length > 0) {
      const defaultDb = dbList.includes(profile.database) ? profile.database : dbList[0];
      setActiveDatabase(defaultDb);
    }
    setConnectionError(null);
    return dbList;
  }, []);

  const fetchDatabases = useCallback(async () => {
    if (!activeProfile) return;
    try {
      await loadDatabasesFor(activeProfile);
    } catch (err) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || String(err);
      setConnectionError(`Could not list databases: ${msg}`);
    }
  }, [activeProfile, loadDatabasesFor]);

  const fetchTables = useCallback(async () => {
    if (!activeProfile || !activeDatabase) return;
    setLoadingTables(true);
    setTables([]);
    setActiveTable(null);
    setRows([]);
    setColumns([]);
    setTotalRows(0);
    try {
      const data: any = await apiClient.getTables(activeProfile.id, activeDatabase);
      const newTables: string[] = data.tables || [];
      setTables(newTables);
      if (newTables.length > 0) {
        setActiveTable(newTables[0]);
      } else {
        setActiveTable(null);
      }
    } catch (err) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || String(err);
      setConnectionError(`Could not list tables in ${activeDatabase}: ${msg}`);
    } finally {
      setLoadingTables(false);
    }
  }, [activeProfile, activeDatabase]);

  useEffect(() => {
    if (activeDatabase) {
      fetchTables();
    }
  }, [activeDatabase, fetchTables]);

  // Reset pagination, sorting, filters, search, and table error when switching table, database, or connection
  useEffect(() => {
    setPage(0);
    setSortColumn(null);
    setSortOrder("ASC");
    setSearchQuery("");
    setFilters([]);
    setTableError(null);
  }, [activeProfile?.id, activeDatabase, activeTable]);

  const fetchTableData = useCallback(async () => {
    if (!activeProfile || !activeDatabase || !activeTable) return;
    const currentReqSeq = ++fetchSeqRef.current;
    const reqProfileId = activeProfile.id;
    const reqDatabase = activeDatabase;
    const reqTable = activeTable;

    setLoadingData(true);
    setTableError(null);
    try {
      // 1. Fetch columns metadata
      const colData: any = await apiClient.getColumns(reqProfileId, reqDatabase, reqTable);
      if (fetchSeqRef.current !== currentReqSeq) return;

      const fetchedCols = colData.columns || [];
      setColumns(fetchedCols);

      // Validate sortColumn belongs to current table
      const effectiveSortCol = sortColumn && fetchedCols.some((c: any) => c.name === sortColumn) ? sortColumn : null;
      if (sortColumn && !effectiveSortCol) {
        setSortColumn(null);
      }

      // 2. Fetch paginated rows with sorting, search, and filtering
      const rowData: any = await apiClient.getRows(
        reqProfileId,
        reqDatabase,
        reqTable,
        pageSize,
        page * pageSize,
        effectiveSortCol,
        sortOrder,
        searchQuery,
        filters
      );
      if (fetchSeqRef.current !== currentReqSeq) return;

      setRows(rowData.rows || []);
      setTotalRows(rowData.total || 0);
      setTableError(null);
    } catch (err: any) {
      if (fetchSeqRef.current === currentReqSeq) {
        const msg = typeof err === "string" ? err : err?.message || String(err);
        console.error("Fetch table data error", err);
        setTableError(msg);
      }
    } finally {
      if (fetchSeqRef.current === currentReqSeq) {
        setLoadingData(false);
      }
    }
  }, [activeProfile, activeDatabase, activeTable, page, sortColumn, sortOrder, searchQuery, filters, pageSize]);

  useEffect(() => {
    if (activeDatabase && activeTable) {
      fetchTableData();
    }
  }, [activeDatabase, activeTable, page, sortColumn, sortOrder, searchQuery, filters, fetchTableData]);

  // Real-time Database Ping Heartbeat (measures actual round-trip latency)
  useEffect(() => {
    if (!activeProfile) {
      setLatencyMs(null);
      return;
    }

    let isMounted = true;
    const pingServer = async () => {
      try {
        const ms = await apiClient.pingDatabase(activeProfile.id, activeDatabase || undefined);
        if (isMounted) setLatencyMs(ms);
      } catch {
        if (isMounted) setLatencyMs(null);
      }
    };

    pingServer();
    const interval = setInterval(pingServer, 4000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeProfile?.id, activeDatabase]);

  const handleSaveProfile = async (profileData: Partial<ConnectionProfile>) => {
    const previous = activeProfile;
    let saved: ConnectionProfile;
    try {
      saved = (await apiClient.saveProfile(profileData)) as ConnectionProfile;
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || String(err);
      throw new Error(msg || "Save profile failed");
    }

    await fetchProfiles();
    setActiveProfile(saved);

    // Saving an unsaved connection promotes it to a real profile: release the
    // session entry so its pooled connections are not left behind.
    if (previous?.id?.startsWith(SESSION_ID_PREFIX) && previous.id !== saved.id) {
      apiClient
        .unregisterSessionProfile(previous.id)
        .catch((err) => console.warn("Could not release the session connection", err));
    }

    // Switching to a different connection needs its own database list.
    if (previous?.id !== saved.id) {
      try {
        await loadDatabasesFor(saved);
      } catch (err) {
        const msg = typeof err === "string" ? err : (err as Error)?.message || String(err);
        setConnectionError(`Could not list databases: ${msg}`);
      }
    }

    // The connection dialog uses this to track the profile it just saved.
    return saved;
  };

  const handleSaveAllProfiles = async (newProfiles: ConnectionProfile[]) => {
    try {
      await apiClient.saveAllProfiles(newProfiles);
      await fetchProfiles();
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || String(err);
      throw new Error(msg || "Save profiles failed");
    }
  };

  const handleSwitchProfile = async (
    profile: ConnectionProfile,
    opts?: { ephemeral?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    let target = profile;

    if (opts?.ephemeral) {
      // Register the connection in the backend's in-memory table so every
      // command can address it by id - without writing it to profiles.json.
      try {
        target = await apiClient.registerSessionProfile({ ...profile, id: undefined });
      } catch (err) {
        const msg = typeof err === "string" ? err : (err as Error)?.message || String(err);
        return { success: false, error: `Could not start the connection: ${msg}` };
      }
    } else if (!profile.id) {
      return {
        success: false,
        error: "This connection has not been saved yet, so it has no id. Save it first, or connect without saving.",
      };
    }

    // Release a previous unsaved connection; it can never be returned to.
    const previous = activeProfile;
    if (previous?.id && previous.id.startsWith(SESSION_ID_PREFIX) && previous.id !== target.id) {
      try {
        await apiClient.unregisterSessionProfile(previous.id);
      } catch (err) {
        console.warn("Could not release the previous session connection", err);
      }
    }

    fetchSeqRef.current += 1;
    setActiveProfile(target);
    setActiveDatabase("");
    setDatabases([]);
    setTables([]);
    setActiveTable(null);
    setColumns([]);
    setRows([]);
    setTotalRows(0);
    setPage(0);
    setConnectionError(null);
    setTableError(null);

    // Load the database list here so the caller learns whether the connection
    // is actually usable, instead of the modal closing on a green message.
    try {
      await loadDatabasesFor(target);
    } catch (err) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || String(err);
      const text = `Connected, but the database list could not be loaded: ${msg}`;
      setConnectionError(text);
      return { success: false, error: text };
    }

    setIsConnModalOpen(false);
    return { success: true };
  };

  const handleDeleteProfile = async (id: string) => {
    await apiClient.deleteProfile(id);
    if (activeProfile?.id === id) {
      setActiveProfile(null);
    }
    await fetchProfiles();
  };

  const handleTestConnection = async (profileData: Partial<ConnectionProfile>): Promise<{ success: boolean; message?: string; error?: string }> => {
    const start = performance.now();
    try {
      const msg: any = await apiClient.testConnection(profileData);
      const duration = Math.round(performance.now() - start);
      auditLogger.addLog({
        profileId: profileData.id || "temp",
        profileName: profileData.name || "Test Connection",
        dbType: profileData.type || "postgres",
        database: profileData.database || "",
        actionType: "CONNECT",
        sql: "TEST CONNECTION",
        status: "SUCCESS",
        executionTimeMs: duration,
      });
      return { success: true, message: typeof msg === "string" ? msg : "Connection successful" };
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      const msg = typeof err === "string" ? err : err?.message || String(err);
      auditLogger.addLog({
        profileId: profileData.id || "temp",
        profileName: profileData.name || "Test Connection",
        dbType: profileData.type || "postgres",
        database: profileData.database || "",
        actionType: "CONNECT",
        sql: "TEST CONNECTION",
        status: "ERROR",
        executionTimeMs: duration,
        errorMessage: msg,
      });
      return { success: false, error: msg };
    }
  };

  const handleExecuteSql = async (sql: string): Promise<QueryExecutionResult> => {
    if (!activeProfile || !activeDatabase) {
      throw new Error("Please select an active database connection before running SQL queries.");
    }

    const start = performance.now();
    try {
      const data: any = await apiClient.executeCommand(
        activeProfile.id,
        activeDatabase || activeProfile.database,
        sql
      );
      const duration = Math.round(performance.now() - start);
      const rows = Array.isArray(data) ? data : data.rows || [];
      // The backend reports these separately: a query returns rows, a DML
      // statement affects rows. Conflating them made every UPDATE read as
      // "0 rows affected".
      const rowsReturned: number = data.rowsReturned ?? rows.length;
      const affected: number | null =
        typeof data.affectedRows === "number" ? data.affectedRows : null;

      // Determine action type from SQL command
      const trimmed = sql.trim().toUpperCase();
      let actionType = "SELECT";
      if (trimmed.startsWith("INSERT")) actionType = "INSERT";
      else if (trimmed.startsWith("UPDATE")) actionType = "UPDATE";
      else if (trimmed.startsWith("DELETE")) actionType = "DELETE";
      else if (trimmed.startsWith("CREATE") || trimmed.startsWith("ALTER") || trimmed.startsWith("DROP") || trimmed.startsWith("TRUNCATE")) actionType = "DDL";

      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase || activeProfile.database,
        actionType,
        sql,
        status: "SUCCESS",
        executionTimeMs: duration,
        affectedRows: affected ?? rowsReturned,
      });

      return { rows, rowsReturned, affectedRows: affected };
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      const msg = typeof err === "string" ? err : err?.message || String(err);
      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase || activeProfile.database,
        actionType: "QUERY",
        sql,
        status: "ERROR",
        executionTimeMs: duration,
        errorMessage: msg,
      });
      throw new Error(msg);
    }
  };

  // Handle Commit Changes (Atomic Database Transaction)
  const handleCommitChanges = async (changes: PendingChanges): Promise<CommitResult> => {
    if (!activeProfile || !activeTable) {
      return { success: false, error: "Missing active database connection or table" };
    }

    const start = performance.now();
    const numInserts = changes.inserts?.length || 0;
    const numUpdates = changes.updates?.length || 0;
    const numDeletes = changes.deletes?.length || 0;
    const totalChanges = numInserts + numUpdates + numDeletes;

    try {
      // The backend reports the SQL it ran and the rows the database actually
      // touched - both are logged so a no-op commit can never look successful.
      const res = await apiClient.commitChanges(
        activeProfile.id,
        activeDatabase || activeProfile.database,
        activeTable,
        changes
      );
      const duration = Math.round(performance.now() - start);
      const queries = res?.queries ?? [];
      const totalAffected = typeof res?.totalAffected === "number" ? res.totalAffected : undefined;

      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase || activeProfile.database,
        actionType: "COMMIT",
        sql: queries.length > 0
          ? queries.join(";\n")
          : `Table ${activeTable}: +${numInserts} inserts, ~${numUpdates} updates, -${numDeletes} deletes`,
        status: "SUCCESS",
        executionTimeMs: duration,
        affectedRows: totalAffected ?? totalChanges,
      });

      return { success: true, queries, totalAffected };
    } catch (err: any) {
      const duration = Math.round(performance.now() - start);
      const msg = typeof err === "string" ? err : err?.message || String(err);
      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase || activeProfile.database,
        actionType: "COMMIT",
        sql: `Table ${activeTable}: Transaction failed`,
        status: "ERROR",
        executionTimeMs: duration,
        errorMessage: msg,
      });
      return { success: false, error: msg };
    }
  };

  const handleApplyDdl = async (statements: string[]): Promise<DdlResult> => {
    if (!activeProfile || !activeDatabase) {
      return { success: false, executed: 0, error: "No active connection or database" };
    }
    const start = performance.now();
    try {
      const res: any = await apiClient.executeDdl(activeProfile.id, activeDatabase, statements);
      const duration = Math.round(performance.now() - start);
      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase,
        actionType: "DDL",
        sql: statements.join("\n"),
        status: res?.success ? "SUCCESS" : "ERROR",
        errorMessage: res?.error,
        executionTimeMs: duration,
      });
      return res as DdlResult;
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      auditLogger.addLog({
        profileId: activeProfile.id,
        profileName: activeProfile.name,
        dbType: activeProfile.type,
        database: activeDatabase,
        actionType: "DDL",
        sql: statements.join("\n"),
        status: "ERROR",
        errorMessage: msg,
        executionTimeMs: duration,
      });
      return {
        success: false,
        executed: 0,
        error: msg,
      };
    }
  };

  const handleFetchColumnsForTable = async (tbl: string): Promise<string[]> => {
    if (!activeProfile || !activeDatabase || !tbl) return [];
    try {
      const data: any = await apiClient.getColumns(activeProfile.id, activeDatabase, tbl);
      return (data?.columns || []).map((c: any) => c.name);
    } catch (err) {
      console.warn(`Could not fetch columns for ${tbl}:`, err);
      return [];
    }
  };

  const handleTableCreated = async (tableName: string) => {
    await fetchTables();
    setActiveTable(tableName);
    if (activeView !== "explorer") setActiveView("explorer");
  };

  const handleTableSaved = async (oldName: string, newName: string) => {
    await fetchTables();
    if (activeTable === oldName) {
      setActiveTable(newName);
    }
    fetchTableData();
  };

  const handleRequestTruncate = (tbl: string) => {
    const dialect: DBType = activeProfile?.type === "mariadb" ? "mariadb" : activeProfile?.type === "sqlite" ? "sqlite" : "postgres";
    const sql = dialect === "sqlite"
      ? `DELETE FROM ${quoteTableIdent(tbl, "sqlite")};`
      : `TRUNCATE TABLE ${quoteTableIdent(tbl, dialect)};`;
    setConfirmDdlRequest({
      title: `Truncate Table "${tbl}"`,
      description: `Are you sure you want to delete all rows in table "${tbl}"? This action cannot be undone.`,
      statements: [sql],
      confirmLabel: "Truncate Table",
      typeToConfirm: tbl,
    });
  };

  const handleRequestDrop = (tbl: string) => {
    const dialect: DBType = activeProfile?.type === "mariadb" ? "mariadb" : activeProfile?.type === "sqlite" ? "sqlite" : "postgres";
    const sql = `DROP TABLE ${quoteTableIdent(tbl, dialect)};`;
    setConfirmDdlRequest({
      title: `Drop Table "${tbl}"`,
      description: `Are you sure you want to permanently DROP table "${tbl}" and all of its schema, indexes, and data? This action cannot be undone.`,
      statements: [sql],
      confirmLabel: "Drop Table",
      typeToConfirm: tbl,
    });
  };

  const handleDdlDone = async () => {
    const req = confirmDdlRequest;
    setConfirmDdlRequest(null);
    await fetchTables();
    if (req?.typeToConfirm && req.typeToConfirm === activeTable && req.title.startsWith("Drop")) {
      setActiveTable(null);
      setRows([]);
      setColumns([]);
      setTotalRows(0);
    } else {
      fetchTableData();
    }
  };

  return (
    <React.Fragment>
      <Head>
        <title>DODB - Database Manager</title>
        <meta name="description" content="Simple, fast macOS Native Database Manager for Postgres, MySQL, MariaDB & SQLite" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon.png" />
      </Head>

      <div className="app-layout">
        <Header
          activeProfile={activeProfile}
          profiles={profiles}
          onSelectProfile={handleSwitchProfile}
          activeDatabase={activeDatabase}
          databases={databases}
          onSelectDatabase={(db) => {
            if (db !== activeDatabase) {
              fetchSeqRef.current += 1;
              setActiveDatabase(db);
              setActiveTable(null);
              setRows([]);
              setColumns([]);
              setTotalRows(0);
              setPage(0);
            }
          }}
          tables={tables}
          activeTable={activeTable}
          onSelectTable={(tbl) => {
            if (tbl !== activeTable) {
              fetchSeqRef.current += 1;
              setRows([]);
              setColumns([]);
              setTotalRows(0);
              setLoadingData(true);
              setActiveTable(tbl);
              setPage(0);
              if (activeView !== "explorer") {
                setActiveView("explorer");
              }
            }
          }}
          activeView={activeView}
          onChangeView={setActiveView}
          onOpenConnections={() => setIsConnModalOpen(true)}
          onDisconnect={handleDisconnect}
          onOpenAuditLogs={() => setIsAuditLogOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onViewStructure={(tbl) => setStructureModalTable(tbl)}
          onOpenInSql={(sql) => {
            setActiveView("sql");
            handleExecuteSql(sql);
          }}
          onRefreshDatabases={fetchDatabases}
          latencyMs={latencyMs}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="app-main-body">
          {activeView !== "admin" && activeView !== "diagram" && activeView !== "visual-query" && (
            <SidebarExplorer
              databases={databases}
              activeDatabase={activeDatabase}
              onSelectDatabase={(db) => {
                if (db !== activeDatabase) {
                  fetchSeqRef.current += 1;
                  setActiveDatabase(db);
                  setActiveTable(null);
                  setRows([]);
                  setColumns([]);
                  setTotalRows(0);
                  setPage(0);
                }
              }}
              tables={tables}
              activeTable={activeTable}
              onSelectTable={(tbl) => {
                if (tbl !== activeTable) {
                  fetchSeqRef.current += 1;
                  setRows([]);
                  setColumns([]);
                  setTotalRows(0);
                  setLoadingData(true);
                  setActiveTable(tbl);
                  setPage(0);
                  if (activeView !== "explorer") {
                    setActiveView("explorer");
                  }
                }
              }}
              onViewStructure={(tbl) => setStructureModalTable(tbl)}
              onCreateTable={() => setIsCreateTableOpen(true)}
              onEditStructure={(tbl) => setEditTableModalTable(tbl)}
              onTruncateTable={(tbl) => handleRequestTruncate(tbl)}
              onDropTable={(tbl) => handleRequestDrop(tbl)}
              onOpenInSql={(sql) => {
                setActiveView("sql");
                handleExecuteSql(sql);
              }}
              onRefresh={() => {
                fetchDatabases();
                fetchTables();
                fetchTableData();
              }}
              loading={loadingTables}
              dbType={activeProfile?.type}
            />
          )}

          <main className="app-content">
            {connectionError && (
              <div className="connection-error-banner" role="alert">
                <AlertCircle size={14} />
                <span className="connection-error-text">{connectionError}</span>
                <button
                  className="connection-error-dismiss"
                  onClick={() => setConnectionError(null)}
                  title="Dismiss"
                >
                  <X size={13} />
                </button>
              </div>
            )}
            <ViewErrorBoundary key={activeView}>
              {activeView === "explorer" ? (
                <DataGrid
                  activeProfile={activeProfile}
                  activeDatabase={activeDatabase}
                  tableName={activeTable}
                  columns={columns}
                  rows={rows}
                  totalRows={totalRows}
                  loading={loadingData}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onRefresh={fetchTableData}
                  onCommitChanges={handleCommitChanges}
                  sortColumn={sortColumn}
                  sortOrder={sortOrder}
                  onSortChange={(col, order) => {
                    setSortColumn(col);
                    setSortOrder(order);
                  }}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  filters={filters}
                  onFiltersChange={setFilters}
                  theme={theme}
                  errorMessage={tableError}
                  onCreateTable={() => setIsCreateTableOpen(true)}
                />
              ) : activeView === "sql" ? (
                <SqlConsole
                  activeDatabase={activeDatabase}
                  activeTable={activeTable}
                  tables={tables}
                  columns={columns}
                  theme={theme}
                  initialSql={sqlConsoleInitialQuery}
                  onExecuteSql={handleExecuteSql}
                  onCommitChanges={handleCommitChanges}
                />
              ) : activeView === "visual-query" ? (
                <VisualQueryBuilder
                  activeProfile={activeProfile}
                  activeDatabase={activeDatabase}
                  tables={tables}
                  theme={theme}
                  initialSql={sqlConsoleInitialQuery}
                  onExecuteSql={handleExecuteSql}
                  onCommitChanges={handleCommitChanges}
                  onOpenInSqlConsole={(sql) => {
                    setSqlConsoleInitialQuery(sql);
                    setActiveView("sql");
                  }}
                />
              ) : activeView === "diagram" ? (
                <SchemaDiagram
                  activeProfile={activeProfile}
                  activeDatabase={activeDatabase}
                  apiBase={API_BASE}
                  theme={theme}
                />
              ) : (
                <AdminPanel
                  activeProfile={activeProfile}
                  activeDatabase={activeDatabase}
                  databases={databases}
                  tables={tables}
                  onRefreshDatabases={fetchDatabases}
                />
              )}
            </ViewErrorBoundary>
          </main>
        </div>

        <ConnectionModal
          isOpen={isConnModalOpen}
          onClose={() => setIsConnModalOpen(false)}
          profiles={profiles}
          activeProfile={activeProfile}
          onSaveProfile={handleSaveProfile}
          onSaveAllProfiles={handleSaveAllProfiles}
          onDeleteProfile={handleDeleteProfile}
          onConnect={handleSwitchProfile}
          onDisconnect={handleDisconnect}
          onTestConnection={handleTestConnection}
        />

        <AuditLogDrawer
          isOpen={isAuditLogOpen}
          onClose={() => setIsAuditLogOpen(false)}
          profiles={profiles}
        />

        <TableStructureModal
          isOpen={!!structureModalTable}
          onClose={() => setStructureModalTable(null)}
          tableName={structureModalTable || ""}
          activeProfile={activeProfile}
          activeDatabase={activeDatabase}
          onOpenInSql={(sql) => {
            setActiveView("sql");
            handleExecuteSql(sql);
          }}
          onOpenInExplorer={(tbl) => {
            setActiveTable(tbl);
            setActiveView("explorer");
          }}
        />

        <CreateTableModal
          isOpen={isCreateTableOpen}
          onClose={() => setIsCreateTableOpen(false)}
          dbType={activeProfile?.type || "postgres"}
          activeDatabase={activeDatabase}
          availableTables={tables}
          onFetchColumns={handleFetchColumnsForTable}
          onApplyDdl={handleApplyDdl}
          onCreated={handleTableCreated}
        />

        <EditTableModal
          isOpen={!!editTableModalTable}
          onClose={() => setEditTableModalTable(null)}
          tableName={editTableModalTable || ""}
          dbType={activeProfile?.type || "postgres"}
          activeDatabase={activeDatabase}
          activeProfile={activeProfile}
          availableTables={tables}
          onFetchColumns={handleFetchColumnsForTable}
          onApplyDdl={handleApplyDdl}
          onSaved={handleTableSaved}
        />

        <ConfirmDdlModal
          request={confirmDdlRequest}
          onCancel={() => setConfirmDdlRequest(null)}
          onApplyDdl={handleApplyDdl}
          onDone={handleDdlDone}
        />

        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          tables={tables}
          activeTable={activeTable}
          onSelectTable={(tbl) => {
            if (tbl !== activeTable) {
              fetchSeqRef.current += 1;
              setRows([]);
              setColumns([]);
              setTotalRows(0);
              setLoadingData(true);
              setActiveTable(tbl);
              setPage(0);
              if (activeView !== "explorer") {
                setActiveView("explorer");
              }
            }
          }}
          databases={databases}
          activeDatabase={activeDatabase}
          onSelectDatabase={(db) => {
            if (db !== activeDatabase) {
              fetchSeqRef.current += 1;
              setActiveDatabase(db);
              setActiveTable(null);
              setRows([]);
              setColumns([]);
              setTotalRows(0);
              setPage(0);
            }
          }}
          activeView={activeView}
          onChangeView={setActiveView}
          onOpenConnections={() => setIsConnModalOpen(true)}
          onOpenCreateTable={() => setIsCreateTableOpen(true)}
          onOpenAuditLogs={() => setIsAuditLogOpen(true)}
          onToggleTheme={toggleTheme}
          theme={theme}
          activeProfile={activeProfile}
        />

        {/* Global Floating Background Dump Notification Toast */}
        {showDumpToast && dumpProgress.status === "completed" && (
          <div className="global-dump-toast success">
            <div className="toast-left">
              <CheckCircle2 size={16} className="toast-icon success" />
              <div className="toast-body">
                <span className="toast-title">Database Export Complete!</span>
                <span className="toast-sub font-mono">
                  {dumpProgress.fileName} ({((dumpProgress.fileSizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB, {dumpProgress.rowsExported.toLocaleString()} rows)
                </span>
              </div>
            </div>
            <div className="toast-actions">
              <button
                className="btn btn-primary btn-sm toast-dl-btn"
                onClick={() => {
                  dumpManager.downloadCurrentBlob();
                  setShowDumpToast(false);
                }}
              >
                <Download size={11} />
                <span>Save File</span>
              </button>
              <button className="toast-dismiss-btn" onClick={() => setShowDumpToast(false)} title="Dismiss">
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        <footer className="app-footer">
          <div className="footer-left">
            <span className="footer-version">dodb v{appVersion}</span>
            <span className="footer-dot">•</span>
            <span className="footer-status">
              DB Engine: {activeProfile ? activeProfile.type.toUpperCase() : "Offline"}
            </span>
            {activeProfile?.id?.startsWith(SESSION_ID_PREFIX) && (
              <>
                <span className="footer-dot">•</span>
                <span className="footer-unsaved" title="This connection was not saved and disappears when the app closes">
                  Unsaved connection
                </span>
              </>
            )}
            {dumpProgress.status === "running" && (
              <>
                <span className="footer-dot">•</span>
                <span className="footer-dump-running font-mono">
                  📦 Exporting {dumpProgress.currentTable} ({dumpProgress.rowsExported.toLocaleString()} rows)...
                </span>
              </>
            )}
          </div>
          <div className="footer-right">
            {totalRows > 0 && <span className="footer-text font-mono">{totalRows.toLocaleString()} rows in table</span>}
          </div>
        </footer>

      </div>

      <style jsx>{`
        .app-layout {
          display: flex;
          flex-direction: column;
          width: 100vw;
          height: 100vh;
          overflow: hidden;
          background: var(--bg-app);
        }

        .app-main-body {
          display: flex;
          flex: 1;
          overflow: hidden;
          position: relative;
        }

        .app-content {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
          background: var(--bg-content);
        }

        .connection-error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(239, 68, 68, 0.12);
          border-bottom: 1px solid rgba(239, 68, 68, 0.25);
          color: #ef4444;
          font-size: 11.5px;
          font-weight: 500;
        }
        .connection-error-text {
          flex: 1;
        }
        .connection-error-dismiss {
          background: transparent;
          border: none;
          color: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 2px;
        }

        .footer-dump-running {
          color: var(--accent-blue);
          font-weight: 600;
          animation: pulse 1.5s infinite;
        }

        .global-dump-toast {
          position: fixed;
          bottom: 32px;
          right: 20px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(16, 185, 129, 0.3);
          border-radius: var(--radius-md);
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 99999;
          animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .toast-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .toast-icon.success {
          color: var(--accent-green);
          flex-shrink: 0;
        }
        .toast-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .toast-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-main);
        }
        .toast-sub {
          font-size: 10.5px;
          color: var(--text-sub);
        }
        .toast-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .toast-dl-btn {
          background: var(--accent-green) !important;
          color: #ffffff !important;
          font-weight: 600;
        }
        .toast-dismiss-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 3px;
          border-radius: 4px;
        }
        .toast-dismiss-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .app-footer {
          height: 22px;
          background: var(--bg-tertiary);
          border-top: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          font-size: 10px;
          color: var(--text-muted);
          user-select: none;
          z-index: 10;
        }

        .footer-left, .footer-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .footer-version {
          font-weight: 700;
          color: var(--accent-blue);
          font-family: var(--font-mono);
        }

        .footer-dot {
          opacity: 0.5;
        }

        .footer-status, .footer-text {
          font-family: var(--font-mono);
        }

        @keyframes slideUp {
          from {
            transform: translateY(16px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </React.Fragment>
  );
}
