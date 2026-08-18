/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import pkg from "../../../package.json";
import { Header } from "../components/Header";
import { SidebarExplorer } from "../components/SidebarExplorer";
import { ConnectionModal } from "../components/ConnectionModal";
import { AuditLogDrawer } from "../components/AuditLogDrawer";
import { GuiSizeModal } from "../components/GuiSizeModal";
import { DataGrid, PendingChanges } from "../components/DataGrid";
import { SqlConsole } from "../components/SqlConsole";
import { AdminPanel } from "../components/AdminPanel";
import { SchemaDiagram } from "../components/SchemaDiagram";
import { ConnectionProfile, ColumnInfo, TableRowData, QueryExecutionResult, ColumnFilter } from "../types";
import { apiClient } from "../utils/apiClient";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5820/api";

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeView, setActiveView] = useState<"explorer" | "sql" | "admin" | "diagram">("explorer");

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);
  const [isConnModalOpen, setIsConnModalOpen] = useState(false);
  const [isAuditLogOpen, setIsAuditLogOpen] = useState(false);
  const [isGuiSizeOpen, setIsGuiSizeOpen] = useState(false);

  const [databases, setDatabases] = useState<string[]>([]);
  const [activeDatabase, setActiveDatabase] = useState<string>("");

  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [rows, setRows] = useState<TableRowData[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loadingData, setLoadingData] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Sorting, Search, and Filtering state
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("ASC");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filters, setFilters] = useState<ColumnFilter[]>([]);

  // Reset state when switching table or database
  useEffect(() => {
    setSortColumn(null);
    setSortOrder("ASC");
    setSearchQuery("");
    setFilters([]);
    setPage(0);
  }, [activeTable, activeDatabase]);

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

  // Auto Sync Theme with OS System Preference & Manual Toggle
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const initialTheme = mediaQuery.matches ? "dark" : "light";
    setTheme(initialTheme);
    document.documentElement.setAttribute("data-theme", initialTheme);

    const handleChange = (e: MediaQueryListEvent) => {
      const nextTheme = e.matches ? "dark" : "light";
      setTheme(nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
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
      if (data.length > 0 && !activeProfile) {
        setActiveProfile(data[0]);
      }
    } catch {
      // Backend service offline or initial launch
    }
  }, [activeProfile]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const fetchDatabases = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const dbList: any = await apiClient.getDatabases(activeProfile.id);
      setDatabases(dbList);
      if (dbList.length > 0) {
        const defaultDb = dbList.includes(activeProfile.database)
          ? activeProfile.database
          : dbList[0];
        setActiveDatabase(defaultDb);
      }
    } catch (err) {
      console.error("Fetch databases error", err);
    }
  }, [activeProfile]);

  useEffect(() => {
    if (activeProfile) {
      fetchDatabases();
    }
  }, [activeProfile, fetchDatabases]);

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
      console.error("Fetch tables error", err);
    } finally {
      setLoadingTables(false);
    }
  }, [activeProfile, activeDatabase]);

  useEffect(() => {
    if (activeDatabase) {
      fetchTables();
    }
  }, [activeDatabase, fetchTables]);

  const fetchTableData = useCallback(async () => {
    if (!activeProfile || !activeDatabase || !activeTable) return;
    setLoadingData(true);
    try {
      // 1. Fetch columns metadata
      const colData: any = await apiClient.getColumns(activeProfile.id, activeDatabase, activeTable);
      setColumns(colData.columns || []);

      // 2. Fetch paginated rows with sorting, search, and filtering
      const rowData: any = await apiClient.getRows(
        activeProfile.id,
        activeDatabase,
        activeTable,
        pageSize,
        page * pageSize,
        sortColumn,
        sortOrder,
        searchQuery,
        filters
      );
      
      setRows(rowData.rows || []);
      setTotalRows(rowData.total || 0);
    } catch (err) {
      console.error("Fetch table data error", err);
    } finally {
      setLoadingData(false);
    }
  }, [activeProfile, activeDatabase, activeTable, page, sortColumn, sortOrder, searchQuery, filters]);

  useEffect(() => {
    if (activeDatabase && activeTable) {
      fetchTableData();
    }
  }, [activeDatabase, activeTable, page, sortColumn, sortOrder, searchQuery, filters, fetchTableData]);

  const handleSaveProfile = async (profileData: Partial<ConnectionProfile>) => {
    try {
      const saved: any = await apiClient.saveProfile(profileData);
      await fetchProfiles();
      setActiveProfile(saved);
    } catch (err: any) {
      throw new Error(err.message || "Save profile failed");
    }
  };

  const handleDeleteProfile = async (id: string) => {
    await apiClient.deleteProfile(id);
    if (activeProfile?.id === id) {
      setActiveProfile(null);
    }
    await fetchProfiles();
  };

  const handleTestConnection = async (profileData: Partial<ConnectionProfile>): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const msg: any = await apiClient.testConnection(profileData);
      return { success: true, message: msg };
    } catch (err: any) {
      return { success: false, error: err.message || String(err) };
    }
  };

  const handleExecuteSql = async (sql: string): Promise<QueryExecutionResult> => {
    if (!activeProfile) {
      throw new Error("โปรดเลือกการเชื่อมต่อฐานข้อมูลก่อนรันคำสั่ง");
    }
    
    try {
      const data: any = await apiClient.executeCommand(
        activeProfile.id,
        activeDatabase || activeProfile.database,
        sql
      );
      if (Array.isArray(data)) {
        return { rows: data };
      }
      return { rows: data.rows || [], affectedRows: data.affectedRows || data.rowCount };
    } catch (err: any) {
      throw new Error(err.message || "Execution failed");
    }
  };

  // Handle Commit Changes (Atomic Database Transaction)
  const handleCommitChanges = async (changes: PendingChanges): Promise<{ success: boolean; error?: string }> => {
    if (!activeProfile || !activeTable) {
      return { success: false, error: "Missing active database connection or table" };
    }
    
    try {
      await apiClient.commitChanges(
          activeProfile.id,
          activeDatabase || activeProfile.database,
          activeTable,
          changes
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  return (
    <>
      <Head>
        <title>dodb - macOS Native Database Manager</title>
        <meta name="description" content="Simple, fast macOS Native Database Manager for Postgres and MySQL" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="app-layout">
        <Header
          activeProfile={activeProfile}
          activeDatabase={activeDatabase}
          databases={databases}
          onSelectDatabase={(db) => {
            if (db !== activeDatabase) {
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
          onOpenAuditLogs={() => setIsAuditLogOpen(true)}
          onOpenGuiSize={() => setIsGuiSizeOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="app-main-body">
          {activeView !== "admin" && activeView !== "diagram" && (
            <SidebarExplorer
              databases={databases}
              activeDatabase={activeDatabase}
              onSelectDatabase={(db) => {
                if (db !== activeDatabase) {
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
                setActiveTable(tbl);
                setPage(0);
              }}
              onRefresh={() => {
                fetchDatabases();
                fetchTables();
                fetchTableData();
              }}
              loading={loadingTables}
            />
          )}

          <main className="app-content">
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
              />
            ) : activeView === "sql" ? (
              <SqlConsole
                activeDatabase={activeDatabase}
                activeTable={activeTable}
                onExecuteSql={handleExecuteSql}
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
                databases={databases}
                onRefreshDatabases={fetchDatabases}
                apiBase={API_BASE}
              />
            )}
          </main>
        </div>

        <ConnectionModal
          isOpen={isConnModalOpen || !activeProfile}
          onClose={() => setIsConnModalOpen(false)}
          profiles={profiles}
          onSaveProfile={handleSaveProfile}
          onDeleteProfile={handleDeleteProfile}
          onConnect={(profile) => {
            setActiveProfile(profile);
            setIsConnModalOpen(false);
          }}
          onTestConnection={handleTestConnection}
        />

        <AuditLogDrawer
          isOpen={isAuditLogOpen}
          onClose={() => setIsAuditLogOpen(false)}
          profiles={profiles}
          apiBase={API_BASE}
        />

        <GuiSizeModal
          isOpen={isGuiSizeOpen}
          onClose={() => setIsGuiSizeOpen(false)}
          apiBase={API_BASE}
        />

        <footer className="app-footer">
          <div className="footer-left">
            <span className="footer-version">dodb v{pkg.version}</span>
            <span className="footer-dot">•</span>
            <span className="footer-status">
              DB Engine: {activeProfile ? activeProfile.type.toUpperCase() : "Offline"}
            </span>
          </div>
          <div className="footer-right">
            <span className="footer-text">Local API: http://localhost:5820</span>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .app-layout {
          width: 100vw;
          height: 100vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--bg-primary);
        }

        .app-main-body {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .app-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
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
      `}</style>
    </>
  );
}
