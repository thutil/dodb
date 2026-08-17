import React, { useState, useEffect } from "react";
import { Server, Plus, Trash2, Zap, CheckCircle2, XCircle, X, Database, HardDrive } from "lucide-react";
import { ConnectionProfile, DBType } from "../types";

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: ConnectionProfile[];
  onSaveProfile: (profile: Partial<ConnectionProfile>) => Promise<void>;
  onDeleteProfile: (id: string) => Promise<void>;
  onConnect: (profile: ConnectionProfile) => void;
  onTestConnection: (profile: Partial<ConnectionProfile>) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  profiles,
  onSaveProfile,
  onDeleteProfile,
  onConnect,
  onTestConnection,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<ConnectionProfile>>({
    name: "Local Postgres",
    type: "postgres",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "postgres",
  });
  const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (selectedId) {
      const p = profiles.find((item) => item.id === selectedId);
      if (p) {
        setForm(p);
      }
    }
  }, [selectedId, profiles]);

  if (!isOpen) return null;

  const handleTypeChange = (type: DBType) => {
    setForm((prev) => ({
      ...prev,
      type,
      port: type === "postgres" ? 5432 : 3306,
      user: type === "postgres" ? "postgres" : "root",
      database: type === "postgres" ? "postgres" : "mysql",
    }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(form);
      if (res.success) {
        setTestResult({ success: true, text: "Connection successful" });
      } else {
        setTestResult({ success: false, text: `Connection failed: ${res.error || "Unknown error"}` });
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
      await onSaveProfile(form);
      setTestResult({ success: true, text: "Profile saved successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedId(null);
    setForm({
      name: "New Connection",
      type: "postgres",
      host: "localhost",
      port: 5432,
      user: "postgres",
      password: "",
      database: "postgres",
    });
    setTestResult(null);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-top">
          <div className="modal-title">
            <Server size={16} className="modal-title-icon" />
            <span>Database Connection Profiles</span>
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
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`profile-card-item ${selectedId === p.id ? "active" : ""}`}
                  onClick={() => setSelectedId(p.id)}
                >
                  <HardDrive size={14} className="profile-type-icon" />
                  <div className="profile-meta">
                    <span className="p-title">{p.name}</span>
                    <span className="p-sub">
                      {p.type.toUpperCase()} • {p.host}:{p.port}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="profile-editor-panel">
            <div className="field-group">
              <label className="field-label">Profile Name</label>
              <input
                className="input"
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
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
              </div>
            </div>

            <div className="field-row">
              <div className="field-group flex-2">
                <label className="field-label">Host</label>
                <input
                  className="input font-mono"
                  value={form.host || ""}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
              </div>
              <div className="field-group flex-1">
                <label className="field-label">Port</label>
                <input
                  type="number"
                  className="input font-mono"
                  value={form.port || 5432}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label">User</label>
                <input
                  className="input"
                  value={form.user || ""}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                />
              </div>
              <div className="field-group">
                <label className="field-label">Password</label>
                <input
                  type="password"
                  className="input"
                  value={form.password || ""}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Database Name</label>
              <input
                className="input font-mono"
                value={form.database || ""}
                onChange={(e) => setForm({ ...form, database: e.target.value })}
              />
            </div>

            {testResult && (
              <div className={`status-banner ${testResult.success ? "success" : "error"}`}>
                {testResult.success ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span>{testResult.text}</span>
              </div>
            )}

            <div className="action-row">
              <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
                <Zap size={13} />
                <span>{testing ? "Testing..." : "Test Connection"}</span>
              </button>
              <button className="btn btn-secondary" onClick={handleSave} disabled={saving}>
                <span>Save</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (form.host && form.type) {
                    onConnect(form as ConnectionProfile);
                    onClose();
                  }
                }}
              >
                <span>Connect</span>
              </button>
              {selectedId && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await onDeleteProfile(selectedId);
                    handleCreateNew();
                  }}
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
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .modal-card {
          width: 680px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .modal-top {
          padding: 12px 16px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 13px;
        }
        .modal-title-icon { color: var(--accent-blue); }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }

        .modal-main {
          display: flex;
          height: 420px;
        }

        .profile-list-panel {
          width: 220px;
          border-right: 1px solid var(--border-light);
          background: var(--bg-sidebar);
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .new-btn { width: 100%; }

        .profile-items-wrapper {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .profile-card-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          border: 1px solid transparent;
          transition: all 0.12s ease;
        }
        .profile-card-item:hover {
          background: var(--bg-hover);
        }
        .profile-card-item.active {
          background: var(--bg-active);
          border-color: rgba(59, 130, 246, 0.3);
        }

        .profile-type-icon { color: var(--accent-blue); }

        .profile-meta {
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .p-title {
          font-weight: 600;
          font-size: 12px;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .p-sub {
          font-size: 10px;
          color: var(--text-muted);
        }

        .profile-editor-panel {
          flex: 1;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
        }

        .field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .field-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-sub);
        }

        .engine-options {
          display: flex;
          gap: 8px;
        }
        .engine-card {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px;
          border-radius: var(--radius-xs);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .engine-card.active {
          background: var(--accent-blue);
          color: white;
          border-color: var(--accent-blue);
        }

        .field-row {
          display: flex;
          gap: 10px;
        }
        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }

        .status-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          padding: 7px 10px;
          border-radius: var(--radius-xs);
        }
        .status-banner.success {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .status-banner.error {
          background: rgba(239, 68, 68, 0.12);
          color: var(--accent-red);
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .action-row {
          display: flex;
          gap: 8px;
          margin-top: auto;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
};
