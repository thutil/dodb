import React, { useState, useEffect, useCallback } from "react";
import { X, Search, RefreshCw, Trash2, Download, CheckCircle2, XCircle, FileText } from "lucide-react";
import { AuditLogEntry, ConnectionProfile } from "../types";
import { auditLogger } from "../utils/auditLogger";

interface AuditLogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profiles: ConnectionProfile[];
  apiBase?: string;
}

export const AuditLogDrawer: React.FC<AuditLogDrawerProps> = ({
  isOpen,
  onClose,
  profiles,
}) => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [actionType, setActionType] = useState("");
  const [status, setStatus] = useState("");
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const fetchLogs = useCallback(() => {
    setLoading(true);
    try {
      let all = auditLogger.getLogs();
      if (search) {
        const q = search.toLowerCase();
        all = all.filter(l => 
          (l.sql && l.sql.toLowerCase().includes(q)) ||
          (l.database && l.database.toLowerCase().includes(q)) ||
          (l.profileName && l.profileName.toLowerCase().includes(q)) ||
          (l.actionType && l.actionType.toLowerCase().includes(q))
        );
      }
      if (selectedProfileId) {
        all = all.filter(l => l.profileId === selectedProfileId);
      }
      if (actionType) {
        all = all.filter(l => l.actionType === actionType);
      }
      if (status) {
        all = all.filter(l => l.status === status);
      }
      setLogs(all);
      setTotal(all.length);
    } catch (err) {
      console.error("Error fetching audit logs:", err);
    } finally {
      setLoading(false);
    }
  }, [search, selectedProfileId, actionType, status]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedLog) {
          setSelectedLog(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedLog, onClose]);

  if (!isOpen) return null;

  const handleClearLogs = () => {
    if (!confirm("Are you sure you want to clear all audit logs?")) return;
    auditLogger.clearLogs();
    fetchLogs();
  };

  const handleExport = (format: "json" | "csv") => {
    let content = "";
    let mimeType = "application/json";
    let filename = `audit_logs_${new Date().toISOString().slice(0, 10)}`;

    if (format === "json") {
      content = JSON.stringify(logs, null, 2);
      filename += ".json";
    } else {
      mimeType = "text/csv";
      filename += ".csv";
      const headers = ["ID", "Timestamp", "Action", "Status", "Profile", "DB Type", "Database", "SQL", "Duration (ms)", "Affected Rows", "Error"];
      content = headers.join(",") + "\n";
      logs.forEach((l) => {
        const row = [
          `"${l.id}"`,
          `"${l.timestamp}"`,
          `"${l.actionType}"`,
          `"${l.status}"`,
          `"${l.profileName || ""}"`,
          `"${l.dbType || ""}"`,
          `"${l.database || ""}"`,
          `"${(l.sql || "").replace(/"/g, '""')}"`,
          l.executionTimeMs ?? "",
          l.affectedRows ?? "",
          `"${(l.errorMessage || "").replace(/"/g, '""')}"`,
        ];
        content += row.join(",") + "\n";
      });
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString("th-TH", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return ts;
    }
  };

  const getActionBadgeClass = (action: string) => {
    switch (action) {
      case "INSERT": return "badge-green";
      case "UPDATE": return "badge-blue";
      case "DELETE": return "badge-red";
      case "DDL": return "badge-purple";
      case "IMPORT": return "badge-green";
      case "CONNECT":
      case "TEST": return "badge-orange";
      default: return "badge-gray";
    }
  };

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer-card" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <FileText size={16} className="title-icon" />
            <span>Audit Log & Execution History</span>
            <span className="log-count-tag">{total} Entries</span>
          </div>
          <div className="drawer-actions">
            <button className="btn btn-secondary btn-sm" onClick={fetchLogs} title="Refresh Logs">
              <RefreshCw size={13} className={loading ? "spin" : ""} />
              <span>Refresh</span>
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport("csv")} title="Export CSV">
              <Download size={13} />
              <span>Export CSV</span>
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleExport("json")} title="Export JSON">
              <Download size={13} />
              <span>Export JSON</span>
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleClearLogs} title="Clear All Logs">
              <Trash2 size={13} />
              <span>Clear History</span>
            </button>
            <button className="icon-close-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <div className="search-input-wrapper">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              className="input search-field"
              placeholder="Filter by SQL query, error, or database..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select filter-select"
            value={selectedProfileId}
            onChange={(e) => setSelectedProfileId(e.target.value)}
          >
            <option value="">All Profiles</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>

          <select
            className="select filter-select"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
          >
            <option value="">All Actions</option>
            <option value="QUERY">QUERY</option>
            <option value="INSERT">INSERT</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="DDL">DDL (Schema)</option>
            <option value="IMPORT">IMPORT (Data load)</option>
            <option value="TEST">TEST Connection</option>
          </select>

          <select
            className="select filter-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>

        <div className="drawer-table-wrapper">
          {loading && logs.length === 0 ? (
            <div className="empty-message">Loading audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="empty-message">No audit log entries found matching criteria.</div>
          ) : (
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Profile / DB</th>
                  <th>SQL Command</th>
                  <th>Duration</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} onClick={() => setSelectedLog(log)} className="log-row">
                    <td className="ts-cell">{formatTimestamp(log.timestamp)}</td>
                    <td>
                      <span className={`badge ${getActionBadgeClass(log.actionType)}`}>
                        {log.actionType}
                      </span>
                    </td>
                    <td>
                      {log.status === "SUCCESS" ? (
                        <span className="status-indicator success">
                          <CheckCircle2 size={12} />
                          <span>OK</span>
                        </span>
                      ) : (
                        <span className="status-indicator error">
                          <XCircle size={12} />
                          <span>ERR</span>
                        </span>
                      )}
                    </td>
                    <td className="profile-cell">
                      <span className="p-name">{log.profileName || "Direct"}</span>
                      {log.dbType && <span className="p-type">({log.dbType})</span>}
                    </td>
                    <td className="sql-cell">
                      <code>{log.sql ? (log.sql.length > 90 ? log.sql.substring(0, 90) + "..." : log.sql) : "-"}</code>
                    </td>
                    <td className="dur-cell">{log.executionTimeMs !== undefined ? `${log.executionTimeMs}ms` : "-"}</td>
                    <td className="rows-cell">{log.affectedRows !== undefined ? log.affectedRows : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selectedLog && (
          <div className="modal-overlay log-detail-modal" onClick={() => setSelectedLog(null)}>
            <div className="detail-card" onClick={(e) => e.stopPropagation()}>
              <div className="detail-header">
                <h3>Audit Log Details</h3>
                <button className="icon-close-btn" onClick={() => setSelectedLog(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="detail-body">
                <div className="meta-grid">
                  <div><strong>ID:</strong> <code>{selectedLog.id}</code></div>
                  <div><strong>Timestamp:</strong> {selectedLog.timestamp}</div>
                  <div><strong>Action Type:</strong> {selectedLog.actionType}</div>
                  <div><strong>Status:</strong> {selectedLog.status}</div>
                  <div><strong>Profile:</strong> {selectedLog.profileName || "-"} ({selectedLog.dbType || "-"})</div>
                  <div><strong>Database:</strong> {selectedLog.database || "-"}</div>
                  <div><strong>Execution Duration:</strong> {selectedLog.executionTimeMs} ms</div>
                  <div><strong>Affected Rows:</strong> {selectedLog.affectedRows ?? "-"}</div>
                </div>

                <div className="code-block-section">
                  <label className="section-label">Executed SQL Query:</label>
                  <pre className="sql-code-block">{selectedLog.sql || "N/A"}</pre>
                </div>

                {selectedLog.errorMessage && (
                  <div className="code-block-section error-section">
                    <label className="section-label text-red">Error Traceback:</label>
                    <pre className="error-code-block">{selectedLog.errorMessage}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .drawer-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1500;
        }

        .drawer-card {
          width: 90%;
          max-width: 1200px;
          height: 82vh;
          max-height: 820px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .drawer-header {
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .drawer-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          font-size: 13px;
          color: var(--text-main);
        }
        .title-icon { color: var(--accent-blue); }

        .log-count-tag {
          font-size: 10px;
          background: var(--bg-active);
          color: var(--accent-blue);
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: 600;
        }

        .drawer-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-sm {
          padding: 4px 10px;
          font-size: 11px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
        }
        .icon-close-btn:hover { color: var(--text-main); }

        .filter-bar {
          padding: 10px 16px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .search-input-wrapper {
          position: relative;
          flex: 1;
          display: flex;
          align-items: center;
        }

        .search-icon {
          position: absolute;
          left: 10px;
          color: var(--text-muted);
        }

        .search-field {
          padding-left: 30px;
          width: 100%;
          font-size: 11px;
        }

        .filter-select {
          width: 160px;
          font-size: 11px;
        }

        .drawer-table-wrapper {
          flex: 1;
          overflow: auto;
        }

        .audit-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          text-align: left;
        }

        .audit-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 8px 12px;
          color: var(--text-muted);
          font-weight: 600;
          text-transform: uppercase;
          font-size: 10px;
          z-index: 10;
        }

        .log-row {
          border-bottom: 1px solid var(--border-light);
          cursor: pointer;
          transition: background 0.1s ease;
        }
        .log-row:hover {
          background: var(--bg-hover);
        }

        .audit-table td {
          padding: 8px 12px;
          vertical-align: middle;
        }

        .ts-cell {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .badge-green { background: rgba(16, 185, 129, 0.15); color: #10b981; }
        .badge-blue { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
        .badge-red { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
        .badge-purple { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
        .badge-orange { background: rgba(249, 115, 22, 0.15); color: #f97316; }
        .badge-gray { background: rgba(156, 163, 175, 0.15); color: #9ca3af; }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          font-weight: 700;
        }
        .status-indicator.success { color: #10b981; }
        .status-indicator.error { color: #ef4444; }

        .profile-cell { display: flex; gap: 4px; align-items: center; }
        .p-name { font-weight: 600; color: var(--text-main); }
        .p-type { color: var(--text-muted); font-size: 10px; }

        .sql-cell code {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-sub);
        }

        .dur-cell, .rows-cell {
          font-family: var(--font-mono);
          font-size: 10px;
          color: var(--text-muted);
        }

        .empty-message {
          padding: 40px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }

        .log-detail-modal {
          z-index: 2000;
        }
        .detail-card {
          width: 600px;
          max-height: 80vh;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .detail-header {
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .detail-header h3 {
          margin: 0;
          font-size: 13px;
          color: var(--text-main);
        }
        .detail-body {
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          font-size: 11px;
          background: var(--bg-secondary);
          padding: 10px;
          border-radius: var(--radius-sm);
        }
        .code-block-section {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .section-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
        }
        .sql-code-block, .error-code-block {
          background: var(--bg-tertiary);
          padding: 10px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 11px;
          white-space: pre-wrap;
          word-break: break-all;
          max-height: 200px;
          overflow-y: auto;
        }
        .error-code-block {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};
