import React, { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import { Header } from "../components/Header";
import { SidebarExplorer } from "../components/SidebarExplorer";
import { ConnectionModal } from "../components/ConnectionModal";
import { DataGrid, PendingChanges } from "../components/DataGrid";
import { SqlConsole } from "../components/SqlConsole";
import { AdminPanel } from "../components/AdminPanel";
import { SchemaDiagram } from "../components/SchemaDiagram";
import { ConnectionProfile, ColumnInfo, TableRowData, QueryExecutionResult } from "../types";

const API_BASE = "http://localhost:3000/api";

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [activeView, setActiveView] = useState<"explorer" | "sql" | "admin" | "diagram">("explorer");

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ConnectionProfile | null>(null);
  const [isConnModalOpen, setIsConnModalOpen] = useState(false);

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

  // Fetch connection profiles
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/profile`);
      if (res.ok) {
        const data: ConnectionProfile[] = await res.json();
        setProfiles(data);
        if (data.length > 0 && !activeProfile) {
          setActiveProfile(data[0]);
        }
      }
    } catch {
      // Backend service offline or initial launch
    }
  }, [activeProfile]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Fetch Databases when activeProfile changes
  const fetchDatabases = useCallback(async () => {
    if (!activeProfile) return;
    try {
      const res = await fetch(`${API_BASE}/list/databases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeProfile),
      });
      if (res.ok) {
        const dbList: string[] = await res.json();
        setDatabases(dbList);
        if (dbList.length > 0) {
          const defaultDb = dbList.includes(activeProfile.database)
            ? activeProfile.database
            : dbList[0];
          setActiveDatabase(defaultDb);
        }
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

  // Fetch Tables when activeDatabase changes
  const fetchTables = useCallback(async () => {
    if (!activeProfile || !activeDatabase) return;
    setLoadingTables(true);
    try {
      const res = await fetch(`${API_BASE}/list/tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activeProfile, database: activeDatabase }),
      });
      if (res.ok) {
        const data = await res.json();
        setTables(data.tables || []);
        if (data.tables && data.tables.length > 0) {
          setActiveTable(data.tables[0]);
        } else {
          setActiveTable(null);
        }
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

  // Fetch Table Data & Columns when activeTable or page changes
  const fetchTableData = useCallback(async () => {
    if (!activeProfile || !activeDatabase || !activeTable) return;
    setLoadingData(true);
    try {
      // 1. Fetch columns metadata
      const colRes = await fetch(`${API_BASE}/list/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activeProfile, database: activeDatabase, table: activeTable }),
      });
      if (colRes.ok) {
        const colData = await colRes.json();
        setColumns(colData.columns || []);
      }

      // 2. Fetch paginated rows
      const rowRes = await fetch(`${API_BASE}/list/rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          database: activeDatabase,
          table: activeTable,
          limit: pageSize,
          offset: page * pageSize,
        }),
      });
      if (rowRes.ok) {
        const rowData = await rowRes.json();
        setRows(rowData.rows || []);
        setTotalRows(rowData.total || 0);
      }
    } catch (err) {
      console.error("Fetch table data error", err);
    } finally {
      setLoadingData(false);
    }
  }, [activeProfile, activeDatabase, activeTable, page]);

  useEffect(() => {
    if (activeTable) {
      fetchTableData();
    }
  }, [activeTable, page, fetchTableData]);

  // Handle Save Profile
  const handleSaveProfile = async (profileData: Partial<ConnectionProfile>) => {
    const isEdit = !!profileData.id;
    const url = isEdit ? `${API_BASE}/profile/${profileData.id}` : `${API_BASE}/profile`;
    const method = isEdit ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileData),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Save profile failed");
    }

    const saved: ConnectionProfile = await res.json();
    await fetchProfiles();
    setActiveProfile(saved);
  };

  // Handle Delete Profile
  const handleDeleteProfile = async (id: string) => {
    await fetch(`${API_BASE}/profile/${id}`, { method: "DELETE" });
    if (activeProfile?.id === id) {
      setActiveProfile(null);
    }
    await fetchProfiles();
  };

  // Handle Test Connection
  const handleTestConnection = async (profileData: Partial<ConnectionProfile>) => {
    const res = await fetch(`${API_BASE}/profile/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileData),
    });
    return await res.json();
  };

  // Handle Execute SQL
  const handleExecuteSql = async (sql: string): Promise<QueryExecutionResult> => {
    if (!activeProfile) {
      throw new Error("โปรดเลือกการเชื่อมต่อฐานข้อมูลก่อนรันคำสั่ง");
    }
    const res = await fetch(`${API_BASE}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...activeProfile,
        database: activeDatabase || activeProfile.database,
        sql,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Execution failed");
    }

    if (Array.isArray(data)) {
      return { rows: data };
    }
    return { rows: data.rows || [], affectedRows: data.affectedRows || data.rowCount };
  };

  // Handle Commit Changes (Atomic Database Transaction)
  const handleCommitChanges = async (changes: PendingChanges) => {
    if (!activeProfile || !activeTable) {
      throw new Error("Missing active database connection or table");
    }
    const res = await fetch(`${API_BASE}/database/commit-changes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...activeProfile,
        database: activeDatabase || activeProfile.database,
        table: activeTable,
        changes,
      }),
    });
    return await res.json();
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
            setActiveDatabase(db);
            setPage(0);
          }}
          activeView={activeView}
          onChangeView={setActiveView}
          onOpenConnections={() => setIsConnModalOpen(true)}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="app-main-body">
          {activeView !== "admin" && activeView !== "diagram" && (
            <SidebarExplorer
              databases={databases}
              activeDatabase={activeDatabase}
              onSelectDatabase={(db) => {
                setActiveDatabase(db);
                setPage(0);
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
      `}</style>
    </>
  );
}
