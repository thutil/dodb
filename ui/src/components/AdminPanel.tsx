import React, { useState, useEffect, useCallback } from "react";
import { Database, Users, Plus, Trash2, Shield, ShieldCheck, CheckCircle2, XCircle, RefreshCw, Activity } from "lucide-react";
import { ConnectionProfile } from "../types";

interface AdminPanelProps {
  activeProfile: ConnectionProfile | null;
  databases: string[];
  onRefreshDatabases: () => void;
  apiBase: string;
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
  databases,
  onRefreshDatabases,
  apiBase,
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

  // Fetch Users
  const fetchUsers = useCallback(async () => {
    if (!activeProfile) return;
    setUsersLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeProfile),
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      // ignore
    } finally {
      setUsersLoading(false);
    }
  }, [activeProfile, apiBase]);

  // Fetch Processes
  const fetchProcesses = useCallback(async () => {
    if (!activeProfile) return;
    setProcessesLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/processes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(activeProfile),
      });
      if (res.ok) {
        const data = await res.json();
        setProcesses(data);
      }
    } catch {
      // ignore
    } finally {
      setProcessesLoading(false);
    }
  }, [activeProfile, apiBase]);

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
      const res = await fetch(`${apiBase}/admin/create-database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activeProfile, name: newDbName.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setDbMsg({ success: true, text: `Database '${newDbName}' created successfully` });
        setNewDbName("");
        onRefreshDatabases();
      } else {
        setDbMsg({ success: false, text: data.error || "Create database failed" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDbMsg({ success: false, text: msg });
    } finally {
      setDbLoading(false);
    }
  };

  // Drop Database Handler
  const handleDropDatabase = async (name: string) => {
    if (!activeProfile || !window.confirm(`Are you sure you want to drop database '${name}'?`)) return;
    setDbLoading(true);
    try {
      const res = await fetch(`${apiBase}/admin/drop-database`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...activeProfile, name }),
      });
      const data = await res.json();
      if (res.ok) {
        setDbMsg({ success: true, text: `Database '${name}' dropped` });
        onRefreshDatabases();
      } else {
        setDbMsg({ success: false, text: data.error || "Drop database failed" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
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
      const res = await fetch(`${apiBase}/admin/create-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          username: newUsername.trim(),
          password: newUserPass.trim(),
          isSuperuser,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMsg({ success: true, text: `User '${newUsername}' created successfully` });
        setNewUsername("");
        setNewUserPass("");
        setIsSuperuser(false);
        fetchUsers();
      } else {
        setUserMsg({ success: false, text: data.error || "Create user failed" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUserMsg({ success: false, text: msg });
    }
  };

  // Drop User Handler
  const handleDropUser = async (u: DbUser) => {
    if (!activeProfile || !window.confirm(`Drop user '${u.username}'?`)) return;
    try {
      const res = await fetch(`${apiBase}/admin/drop-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          username: u.username,
          host: u.host || "%",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMsg({ success: true, text: `User '${u.username}' dropped` });
        fetchUsers();
      } else {
        setUserMsg({ success: false, text: data.error || "Drop user failed" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setUserMsg({ success: false, text: msg });
    }
  };

  // Kill Process Handler
  const handleKillProcess = async (pid: number | string) => {
    if (!activeProfile || !window.confirm(`Kill database query process PID ${pid}?`)) return;
    setProcessMsg(null);
    try {
      const res = await fetch(`${apiBase}/admin/kill-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          pid,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setProcessMsg({ success: true, text: `Process ${pid} killed` });
        fetchProcesses();
      } else {
        setProcessMsg({ success: false, text: data.error || "Kill process failed" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setProcessMsg({ success: false, text: msg });
    }
  };

  if (!activeProfile) {
    return (
      <div className="admin-empty">
        <Shield size={36} className="empty-icon" />
        <h3>Database Administration</h3>
        <p>Connect to a database server to manage databases, users, and processes</p>
        <style jsx>{`
          .admin-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: var(--text-muted);
          }
          .empty-icon { color: var(--accent-blue); }
          .admin-empty h3 { color: var(--text-main); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-nav-bar">
        <button
          className={`nav-btn ${subTab === "databases" ? "active" : ""}`}
          onClick={() => setSubTab("databases")}
        >
          <Database size={13} />
          <span>Databases ({databases.length})</span>
        </button>
        <button
          className={`nav-btn ${subTab === "users" ? "active" : ""}`}
          onClick={() => setSubTab("users")}
        >
          <Users size={13} />
          <span>Users & Privileges</span>
        </button>
        <button
          className={`nav-btn ${subTab === "processes" ? "active" : ""}`}
          onClick={() => setSubTab("processes")}
        >
          <Activity size={13} />
          <span>Process Manager</span>
        </button>
      </div>

      <div className="admin-content-body">
        {subTab === "databases" ? (
          <div className="tab-pane">
            <div className="pane-section">
              <h4 className="section-heading">Create New Database</h4>
              <form onSubmit={handleCreateDatabase} className="create-form">
                <input
                  type="text"
                  className="input db-input font-mono"
                  placeholder="Enter database name..."
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={dbLoading}>
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

            <div className="pane-section list-section">
              <div className="section-top">
                <h4 className="section-heading">Existing Databases</h4>
                <button className="btn btn-secondary" onClick={onRefreshDatabases}>
                  <RefreshCw size={12} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Database Name</th>
                      <th>Type</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {databases.map((db, idx) => (
                      <tr key={db}>
                        <td className="row-num font-mono">{idx + 1}</td>
                        <td className="font-mono db-name-col">{db}</td>
                        <td>
                          <span className="type-pill">{activeProfile.type.toUpperCase()}</span>
                        </td>
                        <td>
                          <button
                            className="btn btn-danger icon-only-btn"
                            onClick={() => handleDropDatabase(db)}
                            title="Drop Database"
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
          <div className="tab-pane">
            <div className="pane-section">
              <h4 className="section-heading">Create New User / Role</h4>
              <form onSubmit={handleCreateUser} className="create-form user-form">
                <input
                  type="text"
                  className="input font-mono"
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <input
                  type="password"
                  className="input font-mono"
                  placeholder="Password"
                  value={newUserPass}
                  onChange={(e) => setNewUserPass(e.target.value)}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isSuperuser}
                    onChange={(e) => setIsSuperuser(e.target.checked)}
                  />
                  <span>Superuser (ALL Privileges)</span>
                </label>
                <button className="btn btn-primary" type="submit">
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

            <div className="pane-section list-section">
              <div className="section-top">
                <h4 className="section-heading">Database Users & Privileges</h4>
                <button className="btn btn-secondary" onClick={fetchUsers} disabled={usersLoading}>
                  <RefreshCw size={12} className={usersLoading ? "spin" : ""} />
                  <span>Refresh</span>
                </button>
              </div>

              <div className="table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Username</th>
                      <th>Host</th>
                      <th>Privilege Level</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="empty-td">
                          {usersLoading ? "Loading users..." : "No users listed"}
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
                          <td className="font-mono">{u.host || "%"}</td>
                          <td>
                            {u.isSuperuser ? (
                              <span className="role-pill superuser">SUPERUSER</span>
                            ) : (
                              <span className="role-pill standard">STANDARD</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-danger icon-only-btn"
                              onClick={() => handleDropUser(u)}
                              title="Drop User"
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
          <div className="tab-pane">
            <div className="pane-section list-section">
              <div className="section-top">
                <h4 className="section-heading">Server Running Processes</h4>
                <button className="btn btn-secondary" onClick={fetchProcesses} disabled={processesLoading}>
                  <RefreshCw size={12} className={processesLoading ? "spin" : ""} />
                  <span>Refresh</span>
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
                      <th>PID</th>
                      <th>User</th>
                      <th>Database</th>
                      <th>State</th>
                      <th>Active Query</th>
                      <th>Duration</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="empty-td">
                          {processesLoading ? "Loading active query processes..." : "No active query processes running"}
                        </td>
                      </tr>
                    ) : (
                      processes.map((p) => (
                        <tr key={String(p.pid)}>
                          <td className="font-mono row-num">{p.pid}</td>
                          <td className="font-mono">{p.user}</td>
                          <td className="font-mono">{p.db || "-"}</td>
                          <td>
                            <span className="type-pill">{p.state || "active"}</span>
                          </td>
                          <td className="font-mono query-cell" title={p.query}>
                            {p.query || "<idle>"}
                          </td>
                          <td className="font-mono">{String(p.time || "0")}</td>
                          <td>
                            <button
                              className="btn btn-danger icon-only-btn"
                              onClick={() => handleKillProcess(p.pid)}
                              title="Kill Process"
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
        }

        .admin-nav-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          gap: 6px;
        }

        .nav-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .nav-btn:hover { color: var(--text-main); }
        .nav-btn.active {
          background: var(--bg-tertiary);
          color: var(--text-main);
          border-color: var(--border-light);
          font-weight: 600;
        }

        .admin-content-body {
          flex: 1;
          overflow: auto;
          padding: 16px;
        }

        .tab-pane {
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-width: 960px;
        }

        .pane-section {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .section-heading {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
        }

        .section-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .create-form {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .db-input { width: 280px; }

        .user-form {
          flex-wrap: wrap;
        }
        .user-form .input { width: 200px; }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-sub);
          cursor: pointer;
        }

        .status-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          padding: 6px 10px;
          border-radius: var(--radius-xs);
        }
        .status-banner.success {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
        }
        .status-banner.error {
          background: rgba(239, 68, 68, 0.12);
          color: var(--accent-red);
        }

        .table-wrapper {
          overflow-x: auto;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .admin-table th {
          background: var(--bg-tertiary);
          color: var(--text-sub);
          text-align: left;
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
          font-weight: 600;
        }
        .admin-table td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
        }

        .row-num { width: 40px; color: var(--text-muted); }
        .db-name-col, .user-name-col { font-weight: 600; color: var(--text-main); }
        .user-name-col { display: flex; align-items: center; gap: 6px; }
        .user-icon { color: var(--accent-blue); }

        .query-cell {
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-main);
        }

        .type-pill {
          font-size: 9px;
          font-weight: bold;
          padding: 1px 5px;
          border-radius: 3px;
          background: var(--bg-tertiary);
          color: var(--text-sub);
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

        .icon-only-btn { padding: 4px 8px; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .empty-td { padding: 24px; text-align: center; color: var(--text-muted); }
      `}</style>
    </div>
  );
};
