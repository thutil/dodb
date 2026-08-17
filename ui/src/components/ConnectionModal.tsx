import React, { useState, useEffect } from "react";
import { Server, Plus, Trash2, Zap, CheckCircle2, XCircle, X, Database, HardDrive, RefreshCw } from "lucide-react";
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
  const [connecting, setConnecting] = useState(false);

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
      await onSaveProfile(form);
      setTestResult({ success: true, text: "Profile saved successfully" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, text: `Save failed: ${msg}` });
    } finally {
      setSaving(false);
    }
  };

  const handleConnect = async () => {
    if (!form.host || !form.type) return;
    setConnecting(true);
    setTestResult(null);
    try {
      const res = await onTestConnection(form);
      if (res.success) {
        setTestResult({ success: true, text: "Connected successfully!" });
        onConnect(form as ConnectionProfile);
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
              <button className="btn btn-secondary" onClick={handleTest} disabled={testing || connecting}>
                {testing ? <RefreshCw size={13} className="spin" /> : <Zap size={13} />}
                <span>{testing ? "Testing..." : "Test Connection"}</span>
              </button>
              <button className="btn btn-secondary" onClick={handleSave} disabled={saving || connecting}>
                {saving ? <RefreshCw size={13} className="spin" /> : null}
                <span>{saving ? "Saving..." : "Save"}</span>
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={connecting || testing || saving}
              >
                {connecting ? <RefreshCw size={13} className="spin" /> : null}
                <span>{connecting ? "Connecting..." : "Connect"}</span>
              </button>
              {selectedId && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    await onDeleteProfile(selectedId);
                    handleCreateNew();
                  }}
                  disabled={connecting}
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
          width: 720px;
          height: 520px;
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
          width: 220px;
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
          gap: 4px;
        }

        .profile-card-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
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

        .profile-type-icon { color: var(--accent-blue); }
        .profile-meta { display: flex; flex-direction: column; }
        .p-title { font-size: 11px; font-weight: 600; color: var(--text-main); }
        .p-sub { font-size: 9px; color: var(--text-muted); }

        .profile-editor-panel {
          flex: 1;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
        }

        .field-group { display: flex; flex-direction: column; gap: 4px; }
        .field-label { font-size: 10px; font-weight: 600; color: var(--text-sub); text-transform: uppercase; }

        .field-row { display: flex; gap: 10px; }
        .flex-1 { flex: 1; }
        .flex-2 { flex: 2; }

        .engine-options { display: flex; gap: 10px; }
        .engine-card {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px;
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

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
