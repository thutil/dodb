/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from "react";
import { Database, Users, Plus, Trash2, Shield, ShieldCheck, CheckCircle2, XCircle, RefreshCw, Activity, Layers, Server } from "lucide-react";
import { ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";

interface AdminPanelProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase?: string;
  databases: string[];
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
  onRefreshDatabases,
}) => {
  const [subTab, setSubTab] = useState<"databases" | "users" | "processes">("databases");
  
  // Database creation state
  const [newDbName, setNewDbName] = useState("");
  const [dbLoading, setDbLoading] = useState(false);
  const [dbMsg, setDbMsg] = useState<{ success: boolean; text: string } | null>(null);

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
  const fetchProcesses = useCallback(async () => {
    if (!activeProfile) return;
    setProcessesLoading(true);
    try {
      const data: any = await apiClient.adminGetProcesses(activeProfile.id, currentDb);
      setProcesses(data || []);
    } catch (err: any) {
      console.error("Fetch processes error", err);
    } finally {
      setProcessesLoading(false);
    }
  }, [activeProfile, currentDb]);

  useEffect(() => {
    if (activeProfile) {
      if (subTab === "users") fetchUsers();
      if (subTab === "processes") fetchProcesses();
    }
  }, [activeProfile, subTab, fetchUsers, fetchProcesses]);

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

  // Drop Database Handler
  const handleDropDatabase = async (name: string) => {
    if (!activeProfile || !window.confirm(`Are you sure you want to drop database '${name}'? This action cannot be undone.`)) return;
    setDbLoading(true);
    try {
      await apiClient.adminDropDatabase(activeProfile.id, currentDb, name);
      setDbMsg({ success: true, text: `Database '${name}' dropped` });
      onRefreshDatabases();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setDbMsg({ success: false, text: msg });
    } finally {
      setDbLoading(false);
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
  const handleDropUser = async (u: DbUser) => {
    if (!activeProfile || !window.confirm(`Drop user '${u.username}'?`)) return;
    try {
      await apiClient.adminDropUser(activeProfile.id, currentDb, u.username, u.host);
      setUserMsg({ success: true, text: `User '${u.username}' dropped` });
      fetchUsers();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setUserMsg({ success: false, text: msg });
    }
  };

  // Kill Process Handler
  const handleKillProcess = async (pid: number | string) => {
    if (!activeProfile || !window.confirm(`Kill database query process PID ${pid}?`)) return;
    setProcessMsg(null);
    try {
      await apiClient.adminKillProcess(activeProfile.id, currentDb, String(pid));
      setProcessMsg({ success: true, text: `Process ${pid} killed successfully` });
      fetchProcesses();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setProcessMsg({ success: false, text: msg });
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
                  {dbMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  <span>{dbMsg.text}</span>
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
                            onClick={() => handleDropDatabase(db)}
                            title={`Drop database '${db}'`}
                          >
                            <Trash2 size={12} />
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
                <div className="user-form-inputs">
                  <input
                    type="text"
                    className="input form-control font-mono"
                    placeholder="Username (e.g. app_user)"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                  <input
                    type="password"
                    className="input form-control font-mono"
                    placeholder="Secure password"
                    value={newUserPass}
                    onChange={(e) => setNewUserPass(e.target.value)}
                  />
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={isSuperuser}
                      onChange={(e) => setIsSuperuser(e.target.checked)}
                    />
                    <span>Grant Superuser / Admin Privileges</span>
                  </label>
                </div>
                <button className="btn btn-primary create-btn" type="submit" disabled={!newUsername.trim() || !newUserPass.trim()}>
                  <Plus size={13} />
                  <span>Create User</span>
                </button>
              </form>

              {userMsg && (
                <div className={`status-banner ${userMsg.success ? "success" : "error"}`}>
                  {userMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  <span>{userMsg.text}</span>
                </div>
              )}
            </div>

            {/* Users Table */}
            <div className="pane-section full-table-card">
              <div className="section-top-row">
                <div className="section-header">
                  <h4 className="section-heading">Users & Role Privileges ({users.length})</h4>
                  <span className="section-sub">Manage database accounts and permissions</span>
                </div>
                <button className="btn btn-secondary" onClick={fetchUsers} disabled={usersLoading}>
                  <RefreshCw size={12} className={usersLoading ? "spin" : ""} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th style={{ width: "60px" }}>#</th>
                      <th>Username</th>
                      <th>Host Filter</th>
                      <th>Privilege Role</th>
                      <th style={{ width: "80px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-td">
                          {usersLoading ? "Loading database users..." : "No users found or insufficient permissions"}
                        </td>
                      </tr>
                    ) : (
                      users.map((u, idx) => (
                        <tr key={u.username + (u.host || "")}>
                          <td className="row-num font-mono">{idx + 1}</td>
                          <td className="font-mono user-name-col">
                            <ShieldCheck size={13} className="user-icon" />
                            <span>{u.username}</span>
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
                              onClick={() => handleDropUser(u)}
                              title={`Drop user '${u.username}'`}
                            >
                              <Trash2 size={12} />
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
        ) : (
          /* Process Manager Tab */
          <div className="tab-pane-grid">
            <div className="pane-section full-table-card">
              <div className="section-top-row">
                <div className="section-header">
                  <h4 className="section-heading">Server Running Processes ({processes.length})</h4>
                  <span className="section-sub">Active queries, background tasks, and connections</span>
                </div>
                <button className="btn btn-secondary" onClick={fetchProcesses} disabled={processesLoading}>
                  <RefreshCw size={12} className={processesLoading ? "spin" : ""} />
                  <span>Refresh Processes</span>
                </button>
              </div>

              {processMsg && (
                <div className={`status-banner ${processMsg.success ? "success" : "error"}`}>
                  {processMsg.success ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  <span>{processMsg.text}</span>
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
                    {processes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-td">
                          {processesLoading ? "Loading active processes..." : "No active query processes running"}
                        </td>
                      </tr>
                    ) : (
                      processes.map((p) => (
                        <tr key={String(p.pid)}>
                          <td className="font-mono row-num">{p.pid}</td>
                          <td className="font-mono">{p.user || "-"}</td>
                          <td className="font-mono">{p.db || "-"}</td>
                          <td>
                            <span className={`process-state-pill ${(p.state || "").toLowerCase()}`}>
                              {p.state || "active"}
                            </span>
                          </td>
                          <td className="font-mono query-cell" title={p.query}>
                            <code>{p.query || "<idle>"}</code>
                          </td>
                          <td className="font-mono">{String(p.time || "0")}</td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              className="btn btn-danger icon-only-btn"
                              onClick={() => handleKillProcess(p.pid)}
                              title={`Kill process ${p.pid}`}
                            >
                              <XCircle size={12} />
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
        )}
      </div>

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
        .process-state-pill.idle {
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
      `}</style>
    </div>
  );
};
