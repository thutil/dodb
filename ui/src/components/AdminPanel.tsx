/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from "react";
import {
  Database,
  Users,
  Plus,
  Trash2,
  Shield,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Activity,
  Layers,
  Server,
  AlertTriangle,
  X,
  Copy,
  Check,
  Download,
  Play,
  Pause,
  Square,
  Bell,
  Sliders,
  FileCode,
  CheckSquare,
  Clock,
  Sparkles,
  Archive,
  Search,
} from "lucide-react";
import { ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";
import { dumpManager, DumpProgress } from "../utils/dumpManager";

interface AdminPanelProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase?: string;
  databases: string[];
  tables?: string[];
  onRefreshDatabases: () => void;
  apiBase?: string;
}

interface DbUser {
  username: string;
  host?: string;
  isSuperuser?: boolean;
  canCreateDb?: boolean;
}

interface DbProcess {
  pid: number | string;
  user: string;
  db: string;
  state: string;
  query: string;
  time: number | string;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  activeProfile,
  activeDatabase,
  databases,
  tables = [],
  onRefreshDatabases,
}) => {
  const [subTab, setSubTab] = useState<"databases" | "users" | "processes" | "dump">("databases");

  // Database creation state
  const [newDbName, setNewDbName] = useState("");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbMsg, setDbMsg] = useState<{ success: boolean; text: string } | null>(null);

  // Dump & Export State
  const [dumpProgress, setDumpProgress] = useState<DumpProgress>(dumpManager.getProgress());
  const [dumpMode, setDumpMode] = useState<"full" | "schema_only" | "data_only">("full");
  const [dumpFormat, setDumpFormat] = useState<"sql" | "json">("sql");
  const [dumpBatchSize, setDumpBatchSize] = useState<number>(500);
  const [dumpSelectedTables, setDumpSelectedTables] = useState<string[]>([]);
  const [dumpTableFilter, setDumpTableFilter] = useState<string>("");
  const [dumpLoadingTables, setDumpLoadingTables] = useState(false);
  const [fetchedTables, setFetchedTables] = useState<string[]>([]);

  // Drop Database Modal State
  const [dbToDrop, setDbToDrop] = useState<string | null>(null);
  const [confirmDropInput, setConfirmDropInput] = useState("");
  const [dropDbLoading, setDropDbLoading] = useState(false);
  const [dropDbError, setDropDbError] = useState<string | null>(null);

  // Drop User Modal State
  const [userToDrop, setUserToDrop] = useState<DbUser | null>(null);
  const [dropUserLoading, setDropUserLoading] = useState(false);

  // Kill Process Modal State
  const [processToKill, setProcessToKill] = useState<DbProcess | null>(null);
  const [killProcLoading, setKillProcLoading] = useState(false);

  // Copy error feedback state
  const [copiedError, setCopiedError] = useState<string | null>(null);
  const handleCopyError = (text: string, id: string = "default") => {
    navigator.clipboard.writeText(text);
    setCopiedError(id);
    setTimeout(() => setCopiedError(null), 2000);
  };

  // Users state
  const [users, setUsers] = useState<DbUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPass, setNewUserPass] = useState("");
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [userMsg, setUserMsg] = useState<{ success: boolean; text: string } | null>(null);

  // Processes state
  const [processes, setProcesses] = useState<DbProcess[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [processMsg, setProcessMsg] = useState<{ success: boolean; text: string } | null>(null);
  const [processSearchTerm, setProcessSearchTerm] = useState("");
  const [processAutoRefreshSecs, setProcessAutoRefreshSecs] = useState<number>(0);
  const [copiedQueryPid, setCopiedQueryPid] = useState<string | null>(null);

  const currentDb = activeDatabase || activeProfile?.database || "postgres";

  // Fetch Users
  const fetchUsers = useCallback(async () => {
    if (!activeProfile) return;
    setUsersLoading(true);
    try {
      const data: any = await apiClient.adminGetUsers(activeProfile.id, currentDb);
      setUsers(data || []);
    } catch (err: any) {
      console.error("Fetch users error", err);
    } finally {
      setUsersLoading(false);
    }
  }, [activeProfile, currentDb]);

  // Fetch Processes
  const fetchProcesses = useCallback(async (silent = false) => {
    if (!activeProfile) return;
    if (!silent) setProcessesLoading(true);
    try {
      const data: any = await apiClient.adminGetProcesses(activeProfile.id, currentDb);
      setProcesses(Array.isArray(data) ? data : []);
      setProcessMsg(null);
    } catch (err: any) {
      console.error("Fetch processes error", err);
      const msg = err?.message || String(err);
      setProcessMsg({ success: false, text: msg });
      setProcesses([]);
    } finally {
      if (!silent) setProcessesLoading(false);
    }
  }, [activeProfile, currentDb]);

  // Auto-refresh interval for processes
  useEffect(() => {
    if (subTab !== "processes" || processAutoRefreshSecs <= 0 || !activeProfile) return;
    const interval = setInterval(() => {
      fetchProcesses(true);
    }, processAutoRefreshSecs * 1000);
    return () => clearInterval(interval);
  }, [subTab, processAutoRefreshSecs, activeProfile, fetchProcesses]);

  // Subscribe to Dump Manager progress
  useEffect(() => {
    return dumpManager.subscribe((p) => {
      setDumpProgress(p);
    });
  }, []);

  // Fetch available tables for Dump if not provided
  const availableTables = tables.length > 0 ? tables : fetchedTables;

  const fetchTablesForDump = useCallback(async () => {
    if (!activeProfile) return;
    setDumpLoadingTables(true);
    try {
      const data: any = await apiClient.getTables(activeProfile.id, currentDb);
      const list = Array.isArray(data) ? data : [];
      setFetchedTables(list);
      setDumpSelectedTables(list);
    } catch (err) {
      console.error("Fetch tables for dump error", err);
    } finally {
      setDumpLoadingTables(false);
    }
  }, [activeProfile, currentDb]);

  useEffect(() => {
    if (tables.length > 0) {
      setDumpSelectedTables(tables);
    } else if (activeProfile) {
      fetchTablesForDump();
    }
  }, [tables, activeProfile, fetchTablesForDump]);

  useEffect(() => {
    if (activeProfile) {
      if (subTab === "users") fetchUsers();
      if (subTab === "processes") fetchProcesses();
      if (subTab === "dump" && availableTables.length === 0) fetchTablesForDump();
    }
  }, [activeProfile, subTab, fetchUsers, fetchProcesses, availableTables.length, fetchTablesForDump]);

  // Dump Handlers
  const handleToggleTable = (table: string) => {
    setDumpSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    );
  };

  const handleSelectAllTables = () => {
    setDumpSelectedTables(availableTables);
  };

  const handleDeselectAllTables = () => {
    setDumpSelectedTables([]);
  };

  const handleStartDump = async () => {
    if (!activeProfile || dumpSelectedTables.length === 0) return;
    try {
      await dumpManager.startDump({
        profileId: activeProfile.id,
        database: currentDb,
        dbType: activeProfile.type,
        tables: dumpSelectedTables,
        mode: dumpMode,
        format: dumpFormat,
        batchSize: dumpBatchSize,
      });
    } catch (err: any) {
      console.error("Failed to start dump", err);
    }
  };

  // Create Database Handler
  const handleCreateDatabase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDbName.trim() || !activeProfile) return;
    setDbLoading(true);
    setDbMsg(null);
    try {
      await apiClient.adminCreateDatabase(activeProfile.id, currentDb, newDbName.trim());
      setDbMsg({ success: true, text: `Database '${newDbName.trim()}' created successfully` });
      setNewDbName("");
      onRefreshDatabases();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setDbMsg({ success: false, text: msg });
    } finally {
      setDbLoading(false);
    }
  };

  // Drop Database Handlers
  const handleOpenDropDbModal = (name: string) => {
    setDbToDrop(name);
    setConfirmDropInput("");
    setDropDbError(null);
  };

  const handleConfirmDropDatabase = async () => {
    if (!activeProfile || !dbToDrop) return;
    if (confirmDropInput.trim() !== dbToDrop) return;
    setDropDbLoading(true);
    setDropDbError(null);
    try {
      await apiClient.adminDropDatabase(activeProfile.id, currentDb, dbToDrop);
      setDbMsg({ success: true, text: `Database '${dbToDrop}' dropped successfully` });
      setDbToDrop(null);
      onRefreshDatabases();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setDropDbError(msg);
    } finally {
      setDropDbLoading(false);
    }
  };

  // Create User Handler
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newUserPass.trim() || !activeProfile) return;
    setUserMsg(null);
    try {
      await apiClient.adminCreateUser(
        activeProfile.id,
        currentDb,
        newUsername.trim(),
        newUserPass.trim(),
        isSuperuser
      );
      setUserMsg({ success: true, text: `User '${newUsername.trim()}' created successfully` });
      setNewUsername("");
      setNewUserPass("");
      setIsSuperuser(false);
      fetchUsers();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setUserMsg({ success: false, text: msg });
    }
  };

  // Drop User Handler
  const handleConfirmDropUser = async () => {
    if (!activeProfile || !userToDrop) return;
    setDropUserLoading(true);
    try {
      await apiClient.adminDropUser(activeProfile.id, currentDb, userToDrop.username, userToDrop.host);
      setUserMsg({ success: true, text: `User '${userToDrop.username}' dropped successfully` });
      setUserToDrop(null);
      fetchUsers();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setUserMsg({ success: false, text: msg });
    } finally {
      setDropUserLoading(false);
    }
  };

  // Kill Process Handler
  const handleConfirmKillProcess = async () => {
    if (!activeProfile || !processToKill) return;
    setKillProcLoading(true);
    setProcessMsg(null);
    try {
      await apiClient.adminKillProcess(activeProfile.id, currentDb, String(processToKill.pid));
      setProcessMsg({ success: true, text: `Process ${processToKill.pid} killed successfully` });
      setProcessToKill(null);
      fetchProcesses();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setProcessMsg({ success: false, text: msg });
    } finally {
      setKillProcLoading(false);
    }
  };

  if (!activeProfile) {
    return (
      <div className="admin-empty">
        <Shield size={40} className="empty-icon" />
        <h3>Database Administration</h3>
        <p>Connect to a database server to manage databases, users, and server processes</p>
        <style jsx>{`
          .admin-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: var(--text-muted);
            height: 100%;
          }
          .empty-icon { color: var(--accent-blue); }
          .admin-empty h3 { color: var(--text-main); font-size: 16px; }
        `}</style>
      </div>
    );
  }

  return (
    <div className="admin-container">
      {/* Header bar with tabs & stats */}
      <div className="admin-nav-bar">
        <div className="tab-group">
          <button
            className={`nav-btn ${subTab === "databases" ? "active" : ""}`}
            onClick={() => setSubTab("databases")}
          >
            <Database size={13} />
            <span>Databases</span>
            <span className="count-badge">{databases.length}</span>
          </button>
          <button
            className={`nav-btn ${subTab === "users" ? "active" : ""}`}
            onClick={() => setSubTab("users")}
          >
            <Users size={13} />
            <span>Users & Privileges</span>
            <span className="count-badge">{users.length}</span>
          </button>
          <button
            className={`nav-btn ${subTab === "processes" ? "active" : ""}`}
            onClick={() => setSubTab("processes")}
          >
            <Activity size={13} />
            <span>Process Manager</span>
            <span className="count-badge">{processes.length}</span>
          </button>
          <button
            className={`nav-btn ${subTab === "dump" ? "active" : ""}`}
            onClick={() => setSubTab("dump")}
          >
            <Download size={13} />
            <span>Dump & Export</span>
            {dumpProgress.status === "running" && <span className="running-dot" />}
          </button>
        </div>

        <div className="header-meta-group">
          <div className="meta-item">
            <Server size={12} className="meta-icon" />
            <span className="meta-val font-mono">{activeProfile.name}</span>
          </div>
          <div className="meta-item">
            <Layers size={12} className="meta-icon" />
            <span className="meta-label">Active DB:</span>
            <span className="meta-val font-mono">{currentDb}</span>
          </div>
        </div>
      </div>

      <div className="admin-content-body">
        {subTab === "databases" ? (
          <div className="tab-pane-grid">
            {/* Quick Action / Create Section */}
            <div className="pane-section create-card">
              <div className="section-header">
                <h4 className="section-heading">Create New Database</h4>
                <span className="section-sub">Add a new database instance on this server</span>
              </div>

              <form onSubmit={handleCreateDatabase} className="create-form">
                <input
                  type="text"
                  className="input form-control font-mono db-name-input"
                  placeholder="e.g. staging_ecommerce"
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                />
                <button className="btn btn-primary create-btn" type="submit" disabled={dbLoading || !newDbName.trim()}>
                  <Plus size={13} />
                  <span>Create Database</span>
                </button>
              </form>

              {dbMsg && (
                <div className={`status-banner ${dbMsg.success ? "success" : "error"}`}>
                  <div className="status-banner-left">
                    {dbMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    <span className="status-banner-text">{dbMsg.text}</span>
                  </div>
                  {!dbMsg.success && (
                    <button
                      type="button"
                      className="btn-copy-banner-err"
                      onClick={() => handleCopyError(dbMsg.text, "dbMsg")}
                      title="Copy error message"
                    >
                      {copiedError === "dbMsg" ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedError === "dbMsg" ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Existing Databases Table (Full Width) */}
            <div className="pane-section full-table-card">
              <div className="section-top-row">
                <div className="section-header">
                  <h4 className="section-heading">Existing Databases ({databases.length})</h4>
                  <span className="section-sub">List of all databases hosted on {activeProfile.host || "server"}</span>
                </div>
                <button className="btn btn-secondary" onClick={onRefreshDatabases}>
                  <RefreshCw size={12} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px" }}>#</th>
                      <th>Database Name</th>
                      <th>Engine</th>
                      <th>Status</th>
                      <th style={{ width: "80px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {databases.map((db, idx) => (
                      <tr key={db} className={db === currentDb ? "active-db-row" : ""}>
                        <td className="row-num font-mono">{idx + 1}</td>
                        <td className="font-mono db-name-col">
                          <div className="db-name-wrap">
                            <Database size={13} className="tbl-db-icon" />
                            <span>{db}</span>
                            {db === currentDb && <span className="active-tag">Active</span>}
                          </div>
                        </td>
                        <td>
                          <span className="type-pill">{activeProfile.type.toUpperCase()}</span>
                        </td>
                        <td>
                          <span className="status-pill ready">Ready</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            className="btn btn-danger icon-only-btn"
                            onClick={() => handleOpenDropDbModal(db)}
                            title={`Drop database '${db}'`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : subTab === "users" ? (
          <div className="tab-pane-grid">
            {/* Create User Card */}
            <div className="pane-section create-card">
              <div className="section-header">
                <h4 className="section-heading">Create New User / Role</h4>
                <span className="section-sub">Add credentials and grant server privileges</span>
              </div>

              <form onSubmit={handleCreateUser} className="create-user-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Username</label>
                    <input
                      type="text"
                      className="input form-control font-mono"
                      placeholder="e.g. app_service_user"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Password</label>
                    <input
                      type="password"
                      className="input form-control font-mono"
                      placeholder="••••••••••••"
                      value={newUserPass}
                      onChange={(e) => setNewUserPass(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-options">
                  <label className="checkbox-label" title="Grant superuser administrative rights">
                    <input
                      type="checkbox"
                      checked={isSuperuser}
                      onChange={(e) => setIsSuperuser(e.target.checked)}
                    />
                    <span>Grant Superuser / Admin Privileges</span>
                  </label>

                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={!newUsername.trim() || !newUserPass.trim()}
                  >
                    <Plus size={13} />
                    <span>Create User</span>
                  </button>
                </div>
              </form>

              {userMsg && (
                <div className={`status-banner ${userMsg.success ? "success" : "error"}`}>
                  <div className="status-banner-left">
                    {userMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    <span className="status-banner-text">{userMsg.text}</span>
                  </div>
                  {!userMsg.success && (
                    <button
                      type="button"
                      className="btn-copy-banner-err"
                      onClick={() => handleCopyError(userMsg.text, "userMsg")}
                      title="Copy error message"
                    >
                      {copiedError === "userMsg" ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedError === "userMsg" ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Users Table */}
            <div className="pane-section full-table-card">
              <div className="section-top-row">
                <div className="section-header">
                  <h4 className="section-heading">Database Users ({users.length})</h4>
                  <span className="section-sub">Accounts registered on this database server</span>
                </div>
                <button className="btn btn-secondary" onClick={fetchUsers} disabled={usersLoading}>
                  <RefreshCw size={12} className={usersLoading ? "spin" : ""} />
                  <span>Refresh Users</span>
                </button>
              </div>

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px" }}>#</th>
                      <th>Username</th>
                      <th>Host Mask</th>
                      <th>Privilege Level</th>
                      <th style={{ width: "80px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-td">
                          {usersLoading ? "Loading users..." : "No users found or insufficient permissions"}
                        </td>
                      </tr>
                    ) : (
                      users.map((u, idx) => (
                        <tr key={`${u.username}-${u.host || ""}`}>
                          <td className="row-num font-mono">{idx + 1}</td>
                          <td className="font-mono user-name-col">
                            <div className="user-name-wrap">
                              <Users size={13} className="tbl-user-icon" />
                              <span>{u.username}</span>
                            </div>
                          </td>
                          <td className="font-mono host-cell">{u.host || "%"}</td>
                          <td>
                            {u.isSuperuser ? (
                              <span className="role-pill superuser">SUPERUSER</span>
                            ) : (
                              <span className="role-pill standard">STANDARD</span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="btn btn-danger icon-only-btn"
                              onClick={() => setUserToDrop(u)}
                              title={`Drop user '${u.username}'`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : subTab === "processes" ? (
          /* Process Manager Tab */
          <div className="tab-pane-grid">
            <div className="pane-section full-table-card">
              <div className="section-top-row">
                <div className="section-header">
                  <h4 className="section-heading">
                    Server Running Processes ({processes.length})
                  </h4>
                  <span className="section-sub">
                    {activeProfile.type === "sqlite"
                      ? "SQLite operates as an embedded in-process database engine"
                      : "Active queries, background tasks, and client connections"}
                  </span>
                </div>

                <div className="proc-controls-group">
                  {/* Search input */}
                  <div className="proc-search-wrap">
                    <span className="proc-search-icon-wrap">
                      <Search size={12} />
                    </span>
                    <input
                      type="text"
                      className="input form-control proc-search-input font-mono"
                      placeholder="Filter pid, user, query..."
                      value={processSearchTerm}
                      onChange={(e) => setProcessSearchTerm(e.target.value)}
                    />
                    {processSearchTerm && (
                      <button
                        className="proc-search-clear"
                        onClick={() => setProcessSearchTerm("")}
                        title="Clear filter"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {/* Auto-refresh dropdown */}
                  <div className="auto-refresh-wrap">
                    <Clock size={12} className="meta-icon" />
                    <select
                      className="select auto-refresh-select"
                      value={processAutoRefreshSecs}
                      onChange={(e) => setProcessAutoRefreshSecs(Number(e.target.value))}
                      title="Auto-refresh interval"
                    >
                      <option value={0}>Auto: Off</option>
                      <option value={3}>Auto: 3s</option>
                      <option value={5}>Auto: 5s</option>
                      <option value={10}>Auto: 10s</option>
                    </select>
                  </div>

                  <button
                    className="btn btn-secondary"
                    onClick={() => fetchProcesses(false)}
                    disabled={processesLoading}
                  >
                    <RefreshCw size={12} className={processesLoading ? "spin" : ""} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {processMsg && (
                <div className={`status-banner ${processMsg.success ? "success" : "error"}`}>
                  <div className="status-banner-left">
                    {processMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                    <span className="status-banner-text">{processMsg.text}</span>
                  </div>
                  {!processMsg.success && (
                    <button
                      type="button"
                      className="btn-copy-banner-err"
                      onClick={() => handleCopyError(processMsg.text, "processMsg")}
                      title="Copy error message"
                    >
                      {copiedError === "processMsg" ? <Check size={11} /> : <Copy size={11} />}
                      <span>{copiedError === "processMsg" ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Status summary pills */}
              {processes.length > 0 && (
                <div className="proc-summary-pills">
                  <span className="proc-summary-item">
                    Total: <strong>{processes.length}</strong>
                  </span>
                  <span className="proc-summary-item active-cnt">
                    Active: <strong>{processes.filter((p) => (p.state || "").toLowerCase() !== "idle" && (p.state || "").toLowerCase() !== "sleep").length}</strong>
                  </span>
                  <span className="proc-summary-item idle-cnt">
                    Idle/Sleep: <strong>{processes.filter((p) => (p.state || "").toLowerCase() === "idle" || (p.state || "").toLowerCase() === "sleep").length}</strong>
                  </span>
                </div>
              )}

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: "90px" }}>PID</th>
                      <th style={{ width: "120px" }}>User</th>
                      <th style={{ width: "130px" }}>Database</th>
                      <th style={{ width: "110px" }}>State</th>
                      <th>Current Query</th>
                      <th style={{ width: "90px" }}>Duration (s)</th>
                      <th style={{ width: "80px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const filtered = processes.filter((p) => {
                        if (!processSearchTerm.trim()) return true;
                        const term = processSearchTerm.toLowerCase();
                        return (
                          String(p.pid).toLowerCase().includes(term) ||
                          (p.user || "").toLowerCase().includes(term) ||
                          (p.db || "").toLowerCase().includes(term) ||
                          (p.state || "").toLowerCase().includes(term) ||
                          (p.query || "").toLowerCase().includes(term)
                        );
                      });

                      if (filtered.length === 0) {
                        return (
                          <tr>
                            <td colSpan={7} className="empty-td">
                              {processesLoading
                                ? "Loading active processes..."
                                : processSearchTerm
                                  ? `No processes match "${processSearchTerm}"`
                                  : activeProfile.type === "sqlite"
                                    ? "SQLite is an embedded database (single local process)"
                                    : "No active query processes running"}
                            </td>
                          </tr>
                        );
                      }

                      return filtered.map((p) => {
                        const isQueryCopied = copiedQueryPid === String(p.pid);
                        return (
                          <tr key={String(p.pid)}>
                            <td className="font-mono row-num">{p.pid}</td>
                            <td className="font-mono">{p.user || "-"}</td>
                            <td className="font-mono">{p.db || "-"}</td>
                            <td>
                              <span
                                className={`process-state-pill ${(p.state || "active").toLowerCase()}`}
                              >
                                {p.state || "active"}
                              </span>
                            </td>
                            <td className="font-mono query-cell" title={p.query}>
                              <div className="proc-query-row">
                                <code>{p.query || "<idle>"}</code>
                                {p.query && p.query !== "<idle>" && (
                                  <button
                                    type="button"
                                    className="proc-copy-btn"
                                    onClick={() => {
                                      navigator.clipboard.writeText(p.query);
                                      setCopiedQueryPid(String(p.pid));
                                      setTimeout(() => setCopiedQueryPid(null), 1500);
                                    }}
                                    title="Copy query SQL"
                                  >
                                    {isQueryCopied ? <Check size={10} /> : <Copy size={10} />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="font-mono">{String(p.time || "0")}</td>
                            <td style={{ textAlign: "right" }}>
                              {activeProfile.type !== "sqlite" && (
                                <button
                                  className="btn btn-danger icon-only-btn"
                                  onClick={() => setProcessToKill(p)}
                                  title={`Kill process ${p.pid}`}
                                >
                                  <XCircle size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* Dump & Export Tab */
          <div className="tab-pane-grid dump-grid">
            {/* Left: Configuration & Table Selection */}
            <div className="pane-section dump-config-card">
              <div className="section-header">
                <h4 className="section-heading">
                  <Archive size={15} style={{ display: "inline-block", marginRight: "6px", verticalAlign: "middle" }} />
                  Dump & Backup Configuration
                </h4>
                <span className="section-sub">Configure streaming batch export for {currentDb}</span>
              </div>

              <div className="dump-form-body">
                {/* Dump Mode */}
                <div className="dump-field-group">
                  <label className="dump-field-label">Export Mode</label>
                  <div className="dump-pill-selector">
                    <button
                      type="button"
                      className={`dump-pill ${dumpMode === "full" ? "active" : ""}`}
                      onClick={() => setDumpMode("full")}
                    >
                      <Layers size={12} />
                      <span>Full Backup (Schema + Data)</span>
                    </button>
                    <button
                      type="button"
                      className={`dump-pill ${dumpMode === "schema_only" ? "active" : ""}`}
                      onClick={() => setDumpMode("schema_only")}
                    >
                      <FileCode size={12} />
                      <span>Schema Only (DDL)</span>
                    </button>
                    <button
                      type="button"
                      className={`dump-pill ${dumpMode === "data_only" ? "active" : ""}`}
                      onClick={() => setDumpMode("data_only")}
                    >
                      <Database size={12} />
                      <span>Data Only (INSERTs)</span>
                    </button>
                  </div>
                </div>

                {/* Format & Batch Size */}
                <div className="dump-dual-row">
                  <div className="dump-field-group">
                    <label className="dump-field-label">File Format</label>
                    <div className="dump-format-toggle">
                      <button
                        type="button"
                        className={`format-btn ${dumpFormat === "sql" ? "active" : ""}`}
                        onClick={() => setDumpFormat("sql")}
                      >
                        .SQL Script
                      </button>
                      <button
                        type="button"
                        className={`format-btn ${dumpFormat === "json" ? "active" : ""}`}
                        onClick={() => setDumpFormat("json")}
                      >
                        .JSON Archive
                      </button>
                    </div>
                  </div>

                  <div className="dump-field-group">
                    <label className="dump-field-label">Chunk Batch Size</label>
                    <select
                      className="input select font-mono dump-select"
                      value={dumpBatchSize}
                      onChange={(e) => setDumpBatchSize(Number(e.target.value))}
                    >
                      <option value={250}>250 rows / chunk (Fastest response)</option>
                      <option value={500}>500 rows / chunk (Recommended)</option>
                      <option value={1000}>1,000 rows / chunk</option>
                      <option value={2000}>2,000 rows / chunk (High throughput)</option>
                    </select>
                  </div>
                </div>

                {/* Tables Multi-select */}
                <div className="dump-field-group table-selection-group">
                  <div className="table-selection-header">
                    <label className="dump-field-label">
                      Select Tables to Export ({dumpSelectedTables.length} / {availableTables.length})
                    </label>
                    <div className="table-select-actions">
                      <button type="button" className="btn-link" onClick={handleSelectAllTables}>
                        Select All
                      </button>
                      <span className="dot-sep">•</span>
                      <button type="button" className="btn-link" onClick={handleDeselectAllTables}>
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="table-filter-wrap">
                    <span className="table-filter-icon-wrap">
                      <Search size={12} />
                    </span>
                    <input
                      type="text"
                      className="input table-filter-input"
                      placeholder="Filter tables..."
                      value={dumpTableFilter}
                      onChange={(e) => setDumpTableFilter(e.target.value)}
                    />
                  </div>

                  <div className="dump-tables-list">
                    {dumpLoadingTables ? (
                      <div className="dump-tables-empty">Loading database tables...</div>
                    ) : availableTables.length === 0 ? (
                      <div className="dump-tables-empty">No tables found in this database.</div>
                    ) : (
                      availableTables
                        .filter((t) => t.toLowerCase().includes(dumpTableFilter.toLowerCase()))
                        .map((tbl) => {
                          const checked = dumpSelectedTables.includes(tbl);
                          return (
                            <label key={tbl} className={`dump-table-row ${checked ? "checked" : ""}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleTable(tbl)}
                              />
                              <span className="font-mono tbl-name">{tbl}</span>
                            </label>
                          );
                        })
                    )}
                  </div>
                </div>

                {/* Action Trigger */}
                <div className="dump-submit-row">
                  <button
                    type="button"
                    className="btn btn-primary dump-start-btn"
                    disabled={dumpProgress.status === "running" || dumpSelectedTables.length === 0}
                    onClick={handleStartDump}
                  >
                    <Play size={13} />
                    <span>Start Background Export ({dumpSelectedTables.length} Tables)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Live Background Progress & File Download Card */}
            <div className="pane-section dump-monitor-card">
              <div className="section-header">
                <h4 className="section-heading">Live Background Job Monitor</h4>
                <span className="section-sub">Export runs asynchronously in chunks without blocking the UI</span>
              </div>

              <div className="dump-monitor-body">
                {/* Status Hero Card */}
                <div className={`monitor-status-box ${dumpProgress.status}`}>
                  <div className="status-top">
                    <div className="status-badge-wrap">
                      <span className={`monitor-status-pill ${dumpProgress.status}`}>
                        {dumpProgress.status === "running"
                          ? "Exporting in Background..."
                          : dumpProgress.status === "paused"
                            ? "Paused"
                            : dumpProgress.status === "completed"
                              ? "Completed"
                              : dumpProgress.status === "error"
                                ? "Error"
                                : dumpProgress.status === "cancelled"
                                  ? "Cancelled"
                                  : "Ready to Dump"}
                      </span>
                    </div>
                    {dumpProgress.status === "running" && (
                      <span className="elapsed-counter font-mono">
                        <Clock size={11} />
                        {dumpProgress.elapsedSeconds}s elapsed
                      </span>
                    )}
                  </div>

                  {/* Progress Bar */}
                  <div className="progress-bar-track">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${dumpProgress.percentage}%` }}
                    />
                  </div>

                  {/* Metrics Row */}
                  <div className="monitor-metrics-grid">
                    <div className="metric-col">
                      <span className="m-label">Current Table</span>
                      <span className="m-val font-mono">
                        {dumpProgress.currentTable || "-"}
                      </span>
                    </div>
                    <div className="metric-col">
                      <span className="m-label">Table Progress</span>
                      <span className="m-val font-mono">
                        {dumpProgress.currentTableIndex} / {dumpProgress.totalTables}
                      </span>
                    </div>
                    <div className="metric-col">
                      <span className="m-label">Rows Exported</span>
                      <span className="m-val font-mono highlight">
                        {dumpProgress.rowsExported.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="monitor-controls-row">
                    {dumpProgress.status === "running" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => dumpManager.pause()}
                        >
                          <Pause size={11} />
                          <span>Pause</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => dumpManager.cancel()}
                        >
                          <Square size={11} />
                          <span>Cancel Job</span>
                        </button>
                      </>
                    )}

                    {dumpProgress.status === "paused" && (
                      <>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => dumpManager.resume()}
                        >
                          <Play size={11} />
                          <span>Resume</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => dumpManager.cancel()}
                        >
                          <Square size={11} />
                          <span>Cancel Job</span>
                        </button>
                      </>
                    )}

                    {dumpProgress.status === "completed" && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm download-btn-highlight"
                        onClick={() => dumpManager.downloadCurrentBlob()}
                      >
                        <Download size={12} />
                        <span>Download {dumpProgress.fileName} ({((dumpProgress.fileSizeBytes || 0) / (1024 * 1024)).toFixed(2)} MB)</span>
                      </button>
                    )}
                  </div>

                  {dumpProgress.error && (
                    <div className="dump-error-banner">
                      <AlertTriangle size={13} />
                      <span>{dumpProgress.error}</span>
                    </div>
                  )}
                </div>

                {/* Feature Info Callout */}
                <div className="dump-info-card">
                  <div className="info-title-wrap">
                    <Bell size={13} className="info-icon" />
                    <span className="info-title">Asynchronous Background System</span>
                  </div>
                  <ul className="info-bullets">
                    <li>
                      <strong>Non-blocking UI:</strong> You can switch to Data Explorer, edit rows, or run custom SQL scripts while this dump runs.
                    </li>
                    <li>
                      <strong>Automatic Notification:</strong> You will receive a desktop alert and in-app banner immediately when the dump finishes.
                    </li>
                    <li>
                      <strong>Memory safe:</strong> Data is paginated and streamed in batches to handle millions of rows smoothly.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal: Drop Database */}
      {dbToDrop && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-card danger-card">
            <div className="admin-modal-header danger-header">
              <div className="modal-title-wrap">
                <AlertTriangle size={16} className="danger-icon" />
                <span className="modal-title">Drop Database</span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !dropDbLoading && setDbToDrop(null)}
                disabled={dropDbLoading}
              >
                <X size={14} />
              </button>
            </div>

            <div className="admin-modal-body">
              <div className="danger-callout">
                <span className="callout-bold">Permanent Deletion Warning:</span>
                <span>
                  You are about to permanently drop the database <strong>&quot;{dbToDrop}&quot;</strong>.
                  All tables, rows, views, and schemas inside this database will be destroyed immediately.
                </span>
              </div>

              <div className="confirm-input-section">
                <label className="confirm-label">
                  To confirm, type <code>{dbToDrop}</code> below:
                </label>
                <input
                  type="text"
                  className="input confirm-input font-mono"
                  placeholder={dbToDrop}
                  value={confirmDropInput}
                  autoFocus
                  disabled={dropDbLoading}
                  onChange={(e) => setConfirmDropInput(e.target.value)}
                />
              </div>

              {dropDbError && (
                <div className="modal-error-box">
                  <div className="modal-error-left">
                    <XCircle size={13} className="error-icon" />
                    <span className="modal-error-text font-mono">{dropDbError}</span>
                  </div>
                  <button
                    type="button"
                    className="btn-copy-banner-err"
                    onClick={() => handleCopyError(dropDbError, "dropDb")}
                    title="Copy error details"
                  >
                    {copiedError === "dropDb" ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedError === "dropDb" ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDbToDrop(null)}
                disabled={dropDbLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger confirm-danger-btn"
                disabled={confirmDropInput.trim() !== dbToDrop || dropDbLoading}
                onClick={handleConfirmDropDatabase}
              >
                <Trash2 size={13} />
                <span>{dropDbLoading ? "Dropping Database..." : "Drop Database"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Drop User */}
      {userToDrop && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-card danger-card">
            <div className="admin-modal-header danger-header">
              <div className="modal-title-wrap">
                <AlertTriangle size={16} className="danger-icon" />
                <span className="modal-title">Drop User</span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !dropUserLoading && setUserToDrop(null)}
                disabled={dropUserLoading}
              >
                <X size={14} />
              </button>
            </div>

            <div className="admin-modal-body">
              <p className="modal-confirm-text">
                Are you sure you want to drop user <strong>&quot;{userToDrop.username}&quot;</strong>
                {userToDrop.host ? ` (Host: ${userToDrop.host})` : ""}? All granted server permissions for this account will be revoked.
              </p>
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setUserToDrop(null)}
                disabled={dropUserLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger confirm-danger-btn"
                disabled={dropUserLoading}
                onClick={handleConfirmDropUser}
              >
                <Trash2 size={13} />
                <span>{dropUserLoading ? "Dropping User..." : "Drop User"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Kill Process */}
      {processToKill && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-card danger-card">
            <div className="admin-modal-header danger-header">
              <div className="modal-title-wrap">
                <AlertTriangle size={16} className="danger-icon" />
                <span className="modal-title">Terminate Query Process</span>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => !killProcLoading && setProcessToKill(null)}
                disabled={killProcLoading}
              >
                <X size={14} />
              </button>
            </div>

            <div className="admin-modal-body">
              <p className="modal-confirm-text">
                Are you sure you want to kill process PID <strong>#{processToKill.pid}</strong>
                {processToKill.user ? ` running by user "${processToKill.user}"` : ""}?
              </p>
              {processToKill.query && (
                <div className="process-query-preview font-mono">
                  <code>{processToKill.query}</code>
                </div>
              )}
            </div>

            <div className="admin-modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setProcessToKill(null)}
                disabled={killProcLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger confirm-danger-btn"
                disabled={killProcLoading}
                onClick={handleConfirmKillProcess}
              >
                <XCircle size={13} />
                <span>{killProcLoading ? "Terminating..." : "Kill Process"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .admin-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
          width: 100%;
          height: 100%;
        }

        .admin-nav-bar {
          padding: 8px 18px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
          gap: 16px;
        }

        .tab-group {
          display: flex;
          gap: 6px;
        }

        .nav-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.12s ease;
          height: 30px;
        }
        .nav-btn:hover { color: var(--text-main); background: var(--bg-hover); }
        .nav-btn.active {
          background: var(--bg-tertiary);
          color: var(--text-main);
          border-color: var(--border-light);
          font-weight: 600;
        }

        .count-badge {
          font-size: 9px;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 5px;
          border-radius: 10px;
          color: var(--text-muted);
        }

        .header-meta-group {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .meta-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .meta-icon { color: var(--accent-blue); }
        .meta-label { color: var(--text-muted); }
        .meta-val { color: var(--text-main); font-weight: 600; }

        .admin-content-body {
          flex: 1;
          overflow: auto;
          padding: 18px 20px;
          width: 100%;
          box-sizing: border-box;
        }

        .tab-pane-grid {
          display: flex;
          flex-direction: column;
          gap: 18px;
          width: 100%;
        }

        .pane-section {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          width: 100%;
          box-sizing: border-box;
        }

        .create-card {
          background: var(--bg-card);
        }

        .full-table-card {
          flex: 1;
        }

        .section-top-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .section-header {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .section-heading {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
        }

        .section-sub {
          font-size: 11px;
          color: var(--text-muted);
        }

        .create-form {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .db-name-input {
          max-width: 360px;
          flex: 1;
          height: 34px;
        }

        .create-btn {
          height: 34px;
          padding: 0 14px;
          white-space: nowrap;
        }

        .create-user-form {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }

        .user-form-inputs {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          flex-wrap: wrap;
        }

        .user-form-inputs .input {
          width: 220px;
          height: 34px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          color: var(--text-sub);
          cursor: pointer;
          user-select: none;
        }

        .status-banner {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
        }
        .status-banner.success {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .status-banner.error {
          background: rgba(239, 68, 68, 0.12);
          color: var(--accent-red);
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        .table-wrapper {
          overflow-x: auto;
          width: 100%;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11.5px;
          table-layout: auto;
        }
        .admin-table th {
          background: var(--bg-tertiary);
          color: var(--text-sub);
          text-align: left;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-light);
          font-weight: 600;
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .admin-table td {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-light);
          color: var(--text-main);
        }
        .admin-table tr:last-child td {
          border-bottom: none;
        }
        .admin-table tr:hover td {
          background: var(--bg-hover);
        }

        .active-db-row td {
          background: rgba(59, 130, 246, 0.05);
        }

        .row-num { color: var(--text-muted); }
        .db-name-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tbl-db-icon { color: var(--accent-blue); flex-shrink: 0; }
        .db-name-col, .user-name-col { font-weight: 600; color: var(--text-main); }
        .user-name-col { display: flex; align-items: center; gap: 7px; }
        .user-icon { color: var(--accent-blue); flex-shrink: 0; }
        .host-cell { color: var(--text-sub); }

        .active-tag {
          font-size: 9px;
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          padding: 1px 6px;
          border-radius: 4px;
          font-weight: 600;
        }

        .proc-controls-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .proc-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .proc-search-icon-wrap {
          position: absolute;
          left: 8px;
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .proc-search-input {
          padding-left: 26px;
          padding-right: 22px;
          width: 190px;
          font-size: 11px;
          height: 28px;
        }
        .proc-search-clear {
          position: absolute;
          right: 6px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
        }
        .proc-search-clear:hover {
          color: var(--text-main);
        }

        .auto-refresh-wrap {
          display: flex;
          align-items: center;
          gap: 5px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 0 6px;
          height: 28px;
        }
        .auto-refresh-select {
          background: transparent;
          border: none;
          color: var(--text-sub);
          font-size: 11px;
          cursor: pointer;
          outline: none;
        }

        .proc-summary-pills {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
          color: var(--text-muted);
          padding: 6px 10px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
        }
        .proc-summary-item strong {
          color: var(--text-main);
        }
        .proc-summary-item.active-cnt strong {
          color: #60a5fa;
        }
        .proc-summary-item.idle-cnt strong {
          color: var(--text-sub);
        }

        .proc-query-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          max-width: 100%;
        }
        .proc-query-row code {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }
        .proc-copy-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          flex-shrink: 0;
          opacity: 0.6;
          transition: opacity 0.15s ease, color 0.15s ease;
        }
        .proc-copy-btn:hover {
          opacity: 1;
          color: var(--text-main);
          background: rgba(255, 255, 255, 0.08);
        }

        .query-cell {
          max-width: 480px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-main);
        }
        .query-cell code {
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
        }

        .type-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
          background: var(--bg-tertiary);
          color: var(--text-sub);
        }

        .status-pill {
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .status-pill.ready {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
        }

        .process-state-pill {
          font-size: 9px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .process-state-pill.active {
          background: rgba(59, 130, 246, 0.15);
          color: #60a5fa;
        }
        .process-state-pill.idle,
        .process-state-pill.sleep {
          background: var(--bg-tertiary);
          color: var(--text-muted);
        }

        .role-pill {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .role-pill.superuser {
          background: rgba(245, 158, 11, 0.15);
          color: #f59e0b;
        }
        .role-pill.standard {
          background: var(--bg-tertiary);
          color: var(--text-sub);
        }

        .icon-only-btn {
          padding: 5px 8px;
          height: 26px;
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .empty-td { padding: 32px; text-align: center; color: var(--text-muted); }

        /* Admin Confirmation Modals - Clean & Minimalist */
        .admin-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 16px;
          animation: adminFadeIn 0.14s ease;
        }
        @keyframes adminFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .admin-modal-card {
          width: 100%;
          max-width: 480px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: adminScaleIn 0.14s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes adminScaleIn {
          from { opacity: 0; transform: scale(0.98); }
          to { opacity: 1; transform: scale(1); }
        }

        .admin-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-header);
        }
        .danger-header {
          background: var(--bg-header);
          border-bottom-color: var(--border-light);
        }
        .modal-title-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .modal-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
        }
        .danger-icon {
          color: var(--accent-rose);
        }
        .modal-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .modal-close-btn:hover:not(:disabled) {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .admin-modal-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .danger-callout {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-left: 3px solid var(--accent-rose);
          border-radius: var(--radius-xs);
          padding: 10px 12px;
          font-size: 12px;
          color: var(--text-main);
          line-height: 1.5;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .callout-bold {
          font-weight: 600;
          color: var(--accent-rose);
        }
        .confirm-input-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .confirm-label {
          font-size: 11.5px;
          color: var(--text-muted);
        }
        .confirm-label code {
          color: var(--text-main);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 1px 5px;
          border-radius: var(--radius-xs);
          font-weight: 600;
        }
        .confirm-input {
          font-size: 12px;
          height: 32px;
          padding: 0 10px;
        }
        .modal-confirm-text {
          font-size: 12.5px;
          color: var(--text-main);
          line-height: 1.5;
          margin: 0;
        }
        .process-query-preview {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 10px 12px;
          font-size: 11px;
          color: var(--text-sub);
          max-height: 120px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-all;
          user-select: text;
        }
        .modal-error-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: var(--bg-tertiary);
          border: 1px solid rgba(244, 63, 94, 0.35);
          border-radius: var(--radius-xs);
          padding: 8px 12px;
          font-size: 11.5px;
          color: var(--accent-rose);
        }
        .modal-error-left {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .modal-error-text {
          word-break: break-word;
          user-select: text;
        }

        .status-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-radius: var(--radius-xs);
          font-size: 12px;
          gap: 8px;
        }
        .status-banner.success {
          background: rgba(16, 185, 129, 0.1);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .status-banner.error {
          background: rgba(244, 63, 94, 0.08);
          color: var(--accent-rose);
          border: 1px solid rgba(244, 63, 94, 0.25);
        }
        .status-banner-left {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          min-width: 0;
        }
        .status-banner-text {
          word-break: break-word;
          user-select: text;
        }

        .btn-copy-banner-err {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-xs);
          font-size: 10.5px;
          color: var(--text-main);
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.12s ease;
        }
        .btn-copy-banner-err:hover {
          background: var(--bg-hover);
          border-color: var(--text-muted);
        }

        .admin-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 10px 16px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
        }
        .confirm-danger-btn {
          gap: 6px;
          padding: 0 14px;
          height: 30px;
          font-size: 11.5px;
          font-weight: 600;
        }

        /* Dump & Export CSS */
        .running-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 6px var(--accent-green);
          margin-left: 4px;
          animation: pulse 1.5s infinite;
        }

        .dump-grid {
          display: grid;
          grid-template-columns: 1.15fr 0.85fr;
          gap: 16px;
          align-items: start;
        }
        @media (max-width: 1080px) {
          .dump-grid {
            grid-template-columns: 1fr;
          }
        }

        .dump-config-card, .dump-monitor-card {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 16px;
        }

        .dump-form-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-top: 14px;
        }

        .dump-field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .dump-field-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }

        .dump-pill-selector {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .dump-pill {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .dump-pill:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .dump-pill.active {
          background: var(--bg-card);
          border-color: var(--accent-blue);
          color: var(--text-main);
          box-shadow: 0 0 0 1px var(--accent-blue);
        }

        .dump-dual-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .dump-format-toggle {
          display: flex;
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .format-btn {
          flex: 1;
          background: transparent;
          border: none;
          padding: 5px 8px;
          border-radius: 4px;
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .format-btn:hover {
          color: var(--text-main);
        }
        .format-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          box-shadow: var(--shadow-sm);
        }

        .dump-select {
          height: 32px;
          font-size: 11.5px;
        }

        .table-selection-group {
          margin-top: 4px;
        }
        .table-selection-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .table-select-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .btn-link {
          background: transparent;
          border: none;
          color: var(--accent-blue);
          font-size: 10.5px;
          font-weight: 500;
          cursor: pointer;
          padding: 0;
        }
        .btn-link:hover {
          text-decoration: underline;
        }
        .dot-sep {
          color: var(--text-muted);
          font-size: 10px;
        }

        .table-filter-wrap {
          position: relative;
          display: flex;
          align-items: center;
          margin-top: 4px;
        }
        .table-filter-icon-wrap {
          position: absolute;
          left: 8px;
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .table-filter-input {
          padding-left: 26px;
          width: 100%;
          height: 28px;
          font-size: 11px;
        }

        .dump-tables-list {
          max-height: 180px;
          overflow-y: auto;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          background: var(--bg-tertiary);
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 6px;
        }
        .dump-table-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border-radius: 4px;
          font-size: 11.5px;
          color: var(--text-sub);
          cursor: pointer;
          transition: background 0.1s ease;
          user-select: none;
        }
        .dump-table-row:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .dump-table-row.checked {
          color: var(--text-main);
          font-weight: 500;
        }
        .tbl-name {
          flex: 1;
        }
        .dump-tables-empty {
          padding: 16px;
          text-align: center;
          font-size: 11px;
          color: var(--text-muted);
        }

        .dump-submit-row {
          margin-top: 6px;
        }
        .dump-start-btn {
          width: 100%;
          height: 36px;
          font-size: 12.5px;
          gap: 8px;
          font-weight: 600;
        }

        .dump-monitor-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-top: 14px;
        }

        .monitor-status-box {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .status-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .monitor-status-pill {
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .monitor-status-pill.idle {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-muted);
        }
        .monitor-status-pill.running {
          background: rgba(20, 184, 166, 0.15);
          color: var(--accent-blue);
          animation: pulse 1.5s infinite;
        }
        .monitor-status-pill.paused {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-amber);
        }
        .monitor-status-pill.completed {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
        }
        .monitor-status-pill.error {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-red);
        }
        .monitor-status-pill.cancelled {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-muted);
        }

        .elapsed-counter {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          color: var(--text-muted);
        }

        .progress-bar-track {
          width: 100%;
          height: 8px;
          background: var(--bg-card);
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid var(--border-light);
        }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent-blue), #10b981);
          border-radius: 4px;
          transition: width 0.2s ease;
        }

        .monitor-metrics-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          background: var(--bg-card);
          padding: 10px;
          border-radius: var(--radius-xs);
          border: 1px solid var(--border-light);
        }
        .metric-col {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .m-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .m-val {
          font-size: 12px;
          color: var(--text-main);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .m-val.highlight {
          color: var(--accent-green);
          font-weight: 600;
        }

        .monitor-controls-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .download-btn-highlight {
          width: 100%;
          height: 34px;
          font-size: 12px;
          background: #10b981 !important;
          color: #ffffff !important;
          font-weight: 600;
          box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
        }

        .dump-error-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 10px;
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 4px;
          color: #fca5a5;
          font-size: 11px;
        }

        .dump-info-card {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .info-title-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }
        .info-icon {
          color: var(--accent-blue);
        }
        .info-bullets {
          margin: 0;
          padding-left: 16px;
          font-size: 11px;
          color: var(--text-sub);
          display: flex;
          flex-direction: column;
          gap: 6px;
          line-height: 1.4;
        }
        .info-bullets strong {
          color: var(--text-main);
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};
