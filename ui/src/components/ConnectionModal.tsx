import React, { useState, useEffect } from "react";
import {
  Server,
  Plus,
  Trash2,
  Zap,
  CheckCircle2,
  XCircle,
  X,
  Database,
  HardDrive,
  RefreshCw,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { ConnectionProfile, DBType } from "../types";
import { apiClient } from "../utils/apiClient";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: ConnectionProfile[];
  activeProfile?: ConnectionProfile | null;
  onSaveProfile: (profile: Partial<ConnectionProfile>) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onConnect: (profile: ConnectionProfile) => void;
  onDisconnect?: () => Promise<void> | void;
  onTestConnection: (profile: Partial<ConnectionProfile>) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  profiles,
  activeProfile,
  onSaveProfile,
  onDeleteProfile,
  onConnect,
  onDisconnect,
  onTestConnection,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(activeProfile?.id || (profiles[0]?.id ?? null));
  const [form, setForm] = useState<Partial<ConnectionProfile>>({
    name: "Local Postgres",
    type: "postgres",
    group: "Default",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
    filePath: "",
  });
  const [portText, setPortText] = useState<string>("5432");
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isCustomGroup, setIsCustomGroup] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const availableGroups = Array.from(
    new Set([
      "Default",
      "Production",
      "Staging",
      "Development",
      "Local",
      ...profiles.map((p) => p.group || "Default").filter(Boolean),
    ])
  );

  useEffect(() => {
    if (isOpen) {
      if (activeProfile) {
        setSelectedId(activeProfile.id);
      } else if (!selectedId && profiles.length > 0) {
        setSelectedId(profiles[0].id);
      }
    }
  }, [isOpen, activeProfile, profiles, selectedId]);

  useEffect(() => {
    if (selectedId) {
      const p = profiles.find((item) => item.id === selectedId);
      if (p) {
        setForm(p);
        setPortText(p.port ? String(p.port) : (p.type === "postgres" ? "5432" : "3306"));
        const defaults = ["Default", "Production", "Staging", "Development", "Local"];
        const existing = profiles.map((pr) => pr.group).filter(Boolean);
        const allGroups = new Set([...defaults, ...existing]);
        if (p.group && !allGroups.has(p.group)) {
          setIsCustomGroup(true);
        } else {
          setIsCustomGroup(false);
        }
      }
    }
  }, [selectedId, profiles]);

  if (!isOpen) return null;

  const handleTypeChange = (type: DBType) => {
    if (type === "sqlite") {
      setForm((prev) => ({
        ...prev,
        type,
        name: prev.name && prev.name !== "Local Postgres" && prev.name !== "Local MariaDB" ? prev.name : "Local SQLite",
        filePath: prev.filePath || "./data/database.sqlite",
        database: prev.filePath || "./data/database.sqlite",
      }));
    } else {
      const defaultPort = type === "postgres" ? 5432 : 3306;
      setPortText(String(defaultPort));
      setForm((prev) => ({
        ...prev,
        type,
        port: defaultPort,
        user: type === "postgres" ? "postgres" : "root",
        database: type === "postgres" ? "postgres" : "mysql",
      }));
    }
  };

  const getCleanForm = (): Partial<ConnectionProfile> => {
    const finalPort = portText ? parseInt(portText, 10) : (form.type === "postgres" ? 5432 : 3306);
    return {
      ...form,
      port: isNaN(finalPort) ? (form.type === "postgres" ? 5432 : 3306) : finalPort,
      group: form.group ? form.group.trim() : "Default",
    };
  };

  const handleBrowseSqliteFile = async () => {
    try {
      const selectedPath = await apiClient.selectFile();
      if (selectedPath) {
        setForm((prev) => ({
          ...prev,
          filePath: selectedPath,
          database: selectedPath,
        }));
      }
    } catch (err) {
      console.error("Browse file error", err);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const cleanData = getCleanForm();
      const res = await onTestConnection(cleanData);
      if (res.success) {
        setTestResult({ success: true, text: "Connection test successful" });
      } else {
        setTestResult({ success: false, text: `Connection test failed: ${res.error || "Unknown error"}` });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Error: ${msg}` });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const cleanData = getCleanForm();
      await onSaveProfile(cleanData);
      setTestResult({ success: true, text: "Profile saved successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    const cleanData = getCleanForm();
    if (cleanData.type !== "sqlite" && !cleanData.host) return;
    if (cleanData.type === "sqlite" && !cleanData.filePath && !cleanData.database) return;

    setConnecting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(cleanData);
      if (res.success) {
        setTestResult({ success: true, text: "Connected successfully!" });
        onConnect(cleanData as ConnectionProfile);
        setTimeout(() => {
          setConnecting(false);
          onClose();
        }, 300);
      } else {
        setTestResult({ success: false, text: `Connection failed: ${res.error || "Could not reach database"}` });
        setConnecting(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Connection error: ${msg}` });
      setConnecting(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedId(null);
    setPortText("5432");
    setForm({
      name: "New Connection",
      type: "postgres",
      group: "Default",
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "postgres",
      filePath: "",
    });
    setTestResult(null);
  };

  // Group profiles
  const groupedProfiles: Record<string, ConnectionProfile[]> = {};
  profiles.forEach((p) => {
    const gName = p.group && p.group.trim() !== "" ? p.group : "Default";
    if (!groupedProfiles[gName]) {
      groupedProfiles[gName] = [];
    }
    groupedProfiles[gName].push(p);
  });

  const toggleGroupCollapse = (gName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [gName]: !prev[gName] }));
  };

  const isCurrentActive = Boolean(activeProfile && selectedId === activeProfile.id);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <div className="modal-title">
            <Server size={16} className="modal-title-icon" />
            <span>Database Connection Profiles</span>
            {activeProfile && (
              <span className="active-indicator-tag">
                <span className="mini-pulse-dot" />
                Active: {activeProfile.name}
              </span>
            )}
          </div>
          <button className="icon-close-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-main">
          <div className="profile-list-panel">
            <button className="btn btn-primary new-btn" onClick={handleCreateNew}>
              <Plus size={13} />
              <span>New Profile</span>
            </button>
            <div className="profile-items-wrapper">
              {Object.keys(groupedProfiles).length === 0 ? (
                <div className="empty-profiles-notice">No profiles saved yet</div>
              ) : (
                Object.entries(groupedProfiles).map(([groupName, groupItems]) => {
                  const isCollapsed = collapsedGroups[groupName];
                  return (
                    <div key={groupName} className="group-folder-container">
                      <div
                        className="group-folder-header"
                        onClick={() => toggleGroupCollapse(groupName)}
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <Folder size={13} className="folder-icon" />
                        <span className="folder-title">{groupName}</span>
                        <span className="folder-count">({groupItems.length})</span>
                      </div>

                      {!isCollapsed && (
                        <div className="group-folder-items">
                          {groupItems.map((p) => {
                            const isConnected = activeProfile?.id === p.id;
                            return (
                              <div
                                key={p.id}
                                className={`profile-card-item ${selectedId === p.id ? "active" : ""} ${isConnected ? "is-connected" : ""}`}
                                onClick={() => setSelectedId(p.id)}
                              >
                                <div className="profile-icon-wrap">
                                  <HardDrive size={13} className="profile-type-icon" />
                                  {isConnected && <span className="item-connected-dot" />}
                                </div>
                                <div className="profile-meta">
                                  <div className="p-title-row">
                                    <span className="p-title">{p.name}</span>
                                    {isConnected && <span className="p-connected-badge">Connected</span>}
                                  </div>
                                  <span className="p-sub">
                                    {p.type.toUpperCase()} • {p.type === "sqlite" ? p.filePath || p.database : `${p.host}:${p.port}`}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="profile-editor-panel">
            {isCurrentActive && (
              <div className="active-connected-banner">
                <div className="banner-left">
                  <span className="pulse-dot" />
                  <span className="banner-text">Currently Connected to this profile</span>
                </div>
                {onDisconnect && (
                  <button
                    className="btn-banner-disconnect"
                    onClick={async () => {
                      setDisconnecting(true);
                      try {
                        await onDisconnect();
                      } finally {
                        setDisconnecting(false);
                      }
                    }}
                    disabled={disconnecting}
                    title="Disconnect database connection"
                  >
                    <LogOut size={12} />
                    <span>{disconnecting ? "Disconnecting..." : "Disconnect"}</span>
                  </button>
                )}
              </div>
            )}

            <div className="field-row">
              <div className="field-group flex-2">
                <label className="field-label">Profile Name</label>
                <input
                  className="input form-control"
                  placeholder="e.g. Production Postgres"
                  value={form.name || ""}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="field-group flex-1">
                <label className="field-label">Group / Folder</label>
                {isCustomGroup ? (
                  <div className="group-input-wrap">
                    <input
                      className="input form-control"
                      placeholder="New group..."
                      value={form.group || ""}
                      onChange={(e) => setForm({ ...form, group: e.target.value })}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn-toggle-group"
                      onClick={() => {
                        setIsCustomGroup(false);
                        setForm({ ...form, group: availableGroups[0] || "Default" });
                      }}
                      title="Select existing group"
                    >
                      Choose
                    </button>
                  </div>
                ) : (
                  <div className="select-container">
                    <select
                      className="select form-control custom-select"
                      value={availableGroups.includes(form.group || "Default") ? (form.group || "Default") : "__NEW__"}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "__NEW__") {
                          setIsCustomGroup(true);
                          setForm({ ...form, group: "" });
                        } else {
                          setForm({ ...form, group: val });
                        }
                      }}
                    >
                      {availableGroups.map((g) => (
                        <option key={g} value={g}>
                          📁 {g}
                        </option>
                      ))}
                      <option value="__NEW__">➕ Create New Group...</option>
                    </select>
                    <ChevronDown size={14} className="select-chevron" />
                  </div>
                )}
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Database Engine</label>
              <div className="engine-options">
                <button
                  type="button"
                  className={`engine-card ${form.type === "postgres" ? "active" : ""}`}
                  onClick={() => handleTypeChange("postgres")}
                >
                  <Database size={14} />
                  <span>PostgreSQL</span>
                </button>
                <button
                  type="button"
                  className={`engine-card ${form.type === "mariadb" ? "active" : ""}`}
                  onClick={() => handleTypeChange("mariadb")}
                >
                  <Database size={14} />
                  <span>MySQL / MariaDB</span>
                </button>
                <button
                  type="button"
                  className={`engine-card ${form.type === "sqlite" ? "active" : ""}`}
                  onClick={() => handleTypeChange("sqlite")}
                >
                  <Database size={14} />
                  <span>SQLite</span>
                </button>
              </div>
            </div>

            {form.type === "sqlite" ? (
              <div className="field-group">
                <label className="field-label">SQLite File Path (.db, .sqlite, .sqlite3)</label>
                <div className="file-input-wrapper">
                  <input
                    className="input font-mono form-control file-path-input"
                    placeholder="/Users/name/data/db.sqlite or ./data/db.sqlite"
                    value={form.filePath || form.database || ""}
                    onChange={(e) => setForm({ ...form, filePath: e.target.value, database: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary browse-btn"
                    onClick={handleBrowseSqliteFile}
                    title="Click to browse SQLite file"
                  >
                    <FolderOpen size={14} />
                    <span>Browse...</span>
                  </button>
                </div>
                <div className="sqlite-info-box">
                  <Folder size={13} className="info-icon" />
                  <span>
                    Click <strong>Browse...</strong> to select a <code>.sqlite</code>, <code>.db</code>, or <code>.sqlite3</code> file from your computer.
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="field-row">
                  <div className="field-group flex-2">
                    <label className="field-label">Host</label>
                    <input
                      className="input font-mono form-control"
                      placeholder="localhost"
                      value={form.host || ""}
                      onChange={(e) => setForm({ ...form, host: e.target.value })}
                    />
                  </div>
                  <div className="field-group flex-1">
                    <label className="field-label">Port</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      className="input font-mono form-control"
                      placeholder={form.type === "postgres" ? "5432" : "3306"}
                      value={portText}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || /^\d+$/.test(val)) {
                          setPortText(val);
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-group flex-1">
                    <label className="field-label">User</label>
                    <input
                      className="input form-control"
                      placeholder="postgres"
                      value={form.user || ""}
                      onChange={(e) => setForm({ ...form, user: e.target.value })}
                    />
                  </div>
                  <div className="field-group flex-1">
                    <label className="field-label">Password</label>
                    <input
                      type="password"
                      className="input form-control"
                      placeholder="••••••••"
                      value={form.password || ""}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                    />
                  </div>
                </div>

                <div className="field-group">
                  <label className="field-label">Database Name</label>
                  <input
                    className="input font-mono form-control"
                    placeholder={form.type === "postgres" ? "postgres" : "mysql"}
                    value={form.database || ""}
                    onChange={(e) => setForm({ ...form, database: e.target.value })}
                  />
                </div>
              </>
            )}

            {testResult && (
              <div className={`status-banner ${testResult.success ? "success" : "error"}`}>
                {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{testResult.text}</span>
              </div>
            )}

            <div className="action-row">
              <button className="btn btn-secondary" onClick={handleTest} disabled={testing || connecting || disconnecting}>
                {testing ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                <span>{testing ? "Testing..." : "Test Connection"}</span>
              </button>
              <button className="btn btn-secondary" onClick={handleSave} disabled={saving || connecting || disconnecting}>
                {saving ? <RefreshCw size={13} className="spin" /> : null}
                <span>{saving ? "Saving..." : "Save"}</span>
              </button>
              {isCurrentActive && onDisconnect && (
                <button
                  className="btn btn-disconnect"
                  onClick={async () => {
                    setDisconnecting(true);
                    try {
                      await onDisconnect();
                    } finally {
                      setDisconnecting(false);
                    }
                  }}
                  disabled={disconnecting || connecting}
                  title="Disconnect from database"
                >
                  <LogOut size={13} />
                  <span>{disconnecting ? "Disconnecting..." : "Disconnect"}</span>
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={connecting || testing || saving || disconnecting}
              >
                {connecting ? <RefreshCw size={13} className="spin" /> : null}
                <span>{connecting ? "Connecting..." : (isCurrentActive ? "Reconnect" : "Connect")}</span>
              </button>
              {selectedId && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await onDeleteProfile(selectedId);
                    handleCreateNew();
                  }}
                  disabled={connecting || disconnecting}
                  title="Delete Profile"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-card {
          width: 760px;
          height: 560px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-top {
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .modal-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 13px;
          color: var(--text-main);
        }
        .modal-title-icon { color: var(--accent-blue); }

        .active-indicator-tag {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.3);
          color: var(--accent-green);
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 12px;
          font-weight: 600;
        }

        .mini-pulse-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
          animation: pulse 2s infinite;
        }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
        }
        .icon-close-btn:hover { color: var(--text-main); background: rgba(255, 255, 255, 0.08); }

        .modal-main {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .profile-list-panel {
          width: 240px;
          border-right: 1px solid var(--border-light);
          background: var(--bg-secondary);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .new-btn { width: 100%; justify-content: center; }

        .profile-items-wrapper {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .empty-profiles-notice {
          padding: 16px;
          text-align: center;
          font-size: 11px;
          color: var(--text-muted);
        }

        .group-folder-container {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .group-folder-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border-radius: 4px;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          user-select: none;
        }
        .group-folder-header:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        .folder-icon { color: var(--accent-blue); }
        .folder-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .folder-count { font-size: 10px; opacity: 0.7; }

        .group-folder-items {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-left: 12px;
        }

        .profile-card-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.12s ease;
        }
        .profile-card-item:hover { background: var(--bg-tertiary); }
        .profile-card-item.active {
          background: var(--bg-tertiary);
          border-color: var(--border-light);
        }
        .profile-card-item.is-connected {
          border-left: 3px solid var(--accent-green);
        }

        .profile-icon-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .item-connected-dot {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 5px rgba(16, 185, 129, 0.9);
        }

        .profile-type-icon { color: var(--accent-blue); flex-shrink: 0; }
        .profile-meta { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
        .p-title-row { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
        .p-title { font-size: 11px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .p-connected-badge {
          font-size: 8px;
          font-weight: 700;
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.15);
          padding: 1px 4px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .p-sub { font-size: 9px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .profile-editor-panel {
          flex: 1;
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow-y: auto;
        }

        .active-connected-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.3);
          border-radius: var(--radius-sm);
        }
        .banner-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.8);
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .banner-text {
          font-size: 11px;
          font-weight: 600;
          color: var(--accent-green);
        }
        .btn-banner-disconnect {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 600;
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.25);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .btn-banner-disconnect:hover {
          background: #ef4444;
          color: #fff;
        }

        .field-group { display: flex; flex-direction: column; gap: 5px; }
        .field-label { font-size: 10px; font-weight: 600; color: var(--text-sub); text-transform: uppercase; letter-spacing: 0.3px; }

        .field-row { display: flex; gap: 12px; align-items: flex-start; }
        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }

        .form-control {
          height: 34px !important;
          min-height: 34px !important;
          box-sizing: border-box !important;
          width: 100%;
        }

        .select-container {
          position: relative;
          width: 100%;
          display: flex;
          align-items: center;
        }

        .custom-select {
          appearance: none;
          -webkit-appearance: none;
          padding-right: 28px !important;
          cursor: pointer;
          background-color: var(--bg-card);
        }

        .select-chevron {
          position: absolute;
          right: 8px;
          pointer-events: none;
          color: var(--text-muted);
        }

        .file-input-wrapper {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .file-path-input {
          flex: 1;
        }

        .browse-btn {
          height: 34px;
          padding: 0 12px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .engine-options { display: flex; gap: 10px; }
        .engine-card {
          flex: 1;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 0 10px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .engine-card.active {
          border-color: var(--accent-blue);
          color: var(--text-main);
          background: rgba(59, 130, 246, 0.12);
          font-weight: 600;
        }

        .status-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: var(--radius-sm);
          font-size: 11px;
          margin-top: 4px;
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

        .action-row {
          display: flex;
          gap: 8px;
          margin-top: auto;
          padding-top: 10px;
        }

        .btn-disconnect {
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.3);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 0 12px;
          border-radius: 6px;
          cursor: pointer;
          height: 32px;
          font-size: 12px;
          transition: all 0.12s ease;
        }
        .btn-disconnect:hover {
          background: #ef4444;
          color: #fff;
        }

        .group-input-wrap {
          display: flex;
          gap: 6px;
          height: 34px;
        }

        .btn-toggle-group {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          font-size: 10px;
          padding: 0 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          white-space: nowrap;
          height: 34px;
        }
        .btn-toggle-group:hover {
          color: var(--text-main);
          border-color: var(--accent-blue);
        }

        .sqlite-info-box {
          margin-top: 6px;
          padding: 8px 10px;
          background: rgba(59, 130, 246, 0.08);
          border: 1px solid rgba(59, 130, 246, 0.2);
          border-radius: var(--radius-sm);
          font-size: 11px;
          color: var(--text-sub);
          display: flex;
          align-items: flex-start;
          gap: 8px;
          line-height: 1.4;
        }
        .sqlite-info-box .info-icon {
          color: var(--accent-blue);
          margin-top: 2px;
          flex-shrink: 0;
        }
        .sqlite-info-box code {
          background: var(--bg-tertiary);
          padding: 1px 4px;
          border-radius: 3px;
          color: var(--text-main);
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
