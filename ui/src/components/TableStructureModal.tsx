/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, Table2, Key, Code, Copy, Check, Terminal, Database, RefreshCw, Layers } from "lucide-react";
import { ColumnInfo, ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";

interface TableStructureModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  onOpenInSql?: (sql: string) => void;
  onOpenInExplorer?: (tableName: string) => void;
}

export const TableStructureModal: React.FC<TableStructureModalProps> = ({
  isOpen,
  onClose,
  tableName,
  activeProfile,
  activeDatabase,
  onOpenInSql,
  onOpenInExplorer,
}) => {
  const [mounted, setMounted] = useState(false);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"columns" | "ddl">("columns");
  const [copiedDdl, setCopiedDdl] = useState(false);
  const [copiedCols, setCopiedCols] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchColumns = useCallback(async () => {
    if (!activeProfile || !activeDatabase || !tableName) return;
    setLoading(true);
    setError(null);
    try {
      const data: any = await apiClient.getColumns(activeProfile.id, activeDatabase, tableName);
      setColumns(data?.columns || []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProfile, activeDatabase, tableName]);

  useEffect(() => {
    if (isOpen && tableName) {
      fetchColumns();
    }
  }, [isOpen, tableName, fetchColumns]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const isMySql = activeProfile?.type === "mariadb";
  const quoteChar = isMySql ? "`" : '"';

  // Generate DDL based on columns
  const generateDdl = (): string => {
    if (!columns || columns.length === 0) return `-- No columns found for table ${tableName}`;
    
    const lines = columns.map((col) => {
      let line = `  ${quoteChar}${col.name}${quoteChar} ${col.type.toUpperCase()}`;
      if (!col.nullable) {
        line += " NOT NULL";
      }
      if (col.default !== null && col.default !== undefined && col.default !== "") {
        line += ` DEFAULT ${col.default}`;
      }
      if (col.primaryKey) {
        line += " PRIMARY KEY";
      }
      return line;
    });

    return `CREATE TABLE ${quoteChar}${tableName}${quoteChar} (\n${lines.join(",\n")}\n);`;
  };

  const handleCopyDdl = () => {
    navigator.clipboard.writeText(generateDdl());
    setCopiedDdl(true);
    setTimeout(() => setCopiedDdl(false), 2000);
  };

  const handleCopyColumnsList = () => {
    const colList = columns.map((c) => `${quoteChar}${c.name}${quoteChar}`).join(", ");
    navigator.clipboard.writeText(colList);
    setCopiedCols(true);
    setTimeout(() => setCopiedCols(false), 2000);
  };

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  const pkCount = columns.filter((c) => c.primaryKey).length;

  const modalContent = (
    <div className="structure-modal-portal-root">
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="modal-header">
            <div className="title-group">
              <Table2 size={18} className="table-header-icon" />
              <div>
                <div className="table-title-row">
                  <h3 className="table-name font-mono">{tableName}</h3>
                  <span className="badge-db">{activeDatabase}</span>
                  <span className="badge-type">{activeProfile?.type.toUpperCase()}</span>
                </div>
                <p className="table-subinfo">
                  {columns.length} columns {pkCount > 0 ? `• ${pkCount} Primary Key` : ""}
                </p>
              </div>
            </div>

            <div className="header-actions">
              <button className="icon-btn" onClick={fetchColumns} title="Refresh Schema">
                <RefreshCw size={13} className={loading ? "spin" : ""} />
              </button>
              <button className="icon-btn close-btn" onClick={onClose} title="Close (Esc)">
                <X size={15} />
              </button>
            </div>
          </div>

          {/* Tab Nav */}
          <div className="tabs-bar">
            <div className="tab-group">
              <button
                className={`tab-btn ${activeTab === "columns" ? "active" : ""}`}
                onClick={() => setActiveTab("columns")}
              >
                <Layers size={13} />
                <span>Columns & Structure ({columns.length})</span>
              </button>
              <button
                className={`tab-btn ${activeTab === "ddl" ? "active" : ""}`}
                onClick={() => setActiveTab("ddl")}
              >
                <Code size={13} />
                <span>DDL Statement</span>
              </button>
            </div>

            <div className="tab-actions">
              {activeTab === "columns" && (
                <button className="btn btn-secondary btn-xs" onClick={handleCopyColumnsList} title="Copy comma-separated columns">
                  {copiedCols ? <Check size={11} className="copy-check" /> : <Copy size={11} />}
                  <span>{copiedCols ? "Copied Columns!" : "Copy Column Names"}</span>
                </button>
              )}
              {activeTab === "ddl" && (
                <button className="btn btn-secondary btn-xs" onClick={handleCopyDdl} title="Copy CREATE TABLE SQL">
                  {copiedDdl ? <Check size={11} className="copy-check" /> : <Copy size={11} />}
                  <span>{copiedDdl ? "Copied DDL!" : "Copy DDL"}</span>
                </button>
              )}
            </div>
          </div>

          {/* Modal Body */}
          <div className="modal-body">
            {loading ? (
              <div className="state-message">
                <RefreshCw size={18} className="spin loading-icon" />
                <span>Loading schema structure...</span>
              </div>
            ) : error ? (
              <div className="error-message font-mono">
                <p>Failed to load structure: {error}</p>
              </div>
            ) : activeTab === "columns" ? (
              <div className="table-wrapper">
                <table className="structure-table">
                  <thead>
                    <tr>
                      <th style={{ width: "36px", textAlign: "center" }}>#</th>
                      <th>Column Name</th>
                      <th>Data Type</th>
                      <th style={{ width: "90px", textAlign: "center" }}>Nullable</th>
                      <th>Default Value</th>
                      <th style={{ width: "110px", textAlign: "center" }}>Key</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((col, idx) => (
                      <tr key={col.name} className={col.primaryKey ? "pk-row" : ""}>
                        <td className="row-num font-mono">{idx + 1}</td>
                        <td className="col-name font-mono">
                          <div className="col-name-cell">
                            {col.primaryKey && (
                              <span className="pk-badge" title="Primary Key">
                                <Key size={11} className="pk-key-icon" />
                              </span>
                            )}
                            <span className={col.primaryKey ? "pk-name-text" : ""}>{col.name}</span>
                          </div>
                        </td>
                        <td>
                          <span className="type-badge font-mono">{col.type}</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {col.nullable ? (
                            <span className="badge-nullable yes">YES</span>
                          ) : (
                            <span className="badge-nullable no">NO</span>
                          )}
                        </td>
                        <td className="col-default font-mono">
                          {col.default !== null && col.default !== undefined && col.default !== "" ? (
                            <span className="default-pill">{String(col.default)}</span>
                          ) : (
                            <span className="null-text">-</span>
                          )}
                        </td>
                        <td style={{ textAlign: "center" }}>
                          {col.primaryKey ? (
                            <span className="key-pill pk">PRIMARY KEY</span>
                          ) : (
                            <span className="key-pill none">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="ddl-container">
                <pre className="ddl-code font-mono">{generateDdl()}</pre>
              </div>
            )}
          </div>

          {/* Modal Footer with Quick Actions */}
          <div className="modal-footer">
            <div className="footer-left-actions">
              {onOpenInExplorer && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    onOpenInExplorer(tableName);
                    onClose();
                  }}
                >
                  <Database size={13} />
                  <span>Open in Data Explorer</span>
                </button>
              )}
              {onOpenInSql && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    onOpenInSql(`SELECT * FROM ${quoteChar}${tableName}${quoteChar} LIMIT 100;`);
                    onClose();
                  }}
                >
                  <Terminal size={13} />
                  <span>Query in SQL Console</span>
                </button>
              )}
            </div>

            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .structure-modal-portal-root {
          position: relative;
          z-index: 999999;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999999;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .modal-card {
          width: 780px;
          max-width: 94vw;
          max-height: 85vh;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: 1000000;
        }
        @keyframes slideUp {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }

        .modal-header {
          padding: 12px 16px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .title-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .table-header-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .table-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .table-name {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-main);
        }
        .badge-db {
          font-size: 10px;
          font-weight: 600;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.15);
          padding: 1px 6px;
          border-radius: 4px;
        }
        .badge-type {
          font-size: 9px;
          font-weight: 700;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
        }
        .table-subinfo {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 1px;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .icon-btn {
          background: transparent;
          border: none;
          color: var(--text-sub);
          cursor: pointer;
          padding: 5px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          transition: all 0.12s ease;
        }
        .icon-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .close-btn:hover {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        .tabs-bar {
          padding: 6px 14px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .tab-group {
          display: flex;
          gap: 4px;
        }
        .tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 500;
          border: none;
          background: transparent;
          color: var(--text-sub);
          border-radius: 5px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .tab-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        }

        .btn-xs {
          padding: 3px 8px;
          font-size: 10.5px;
          height: 24px;
        }
        .copy-check {
          color: var(--accent-green);
        }

        .modal-body {
          flex: 1;
          overflow: auto;
          max-height: 52vh;
          min-height: 220px;
          background: var(--bg-content);
        }

        .table-wrapper {
          width: 100%;
          overflow-x: auto;
        }

        .structure-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11.5px;
        }
        .structure-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          color: var(--text-sub);
          text-align: left;
          padding: 7px 12px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          font-weight: 600;
          font-size: 11px;
          z-index: 1;
        }
        .structure-table td {
          padding: 6px 12px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          color: var(--text-main);
        }
        .structure-table tr:hover td {
          background: var(--bg-hover);
        }
        .structure-table tr.pk-row td {
          background: rgba(245, 158, 11, 0.04);
        }

        .row-num {
          text-align: center;
          color: var(--text-muted);
          font-size: 10.5px;
        }
        .col-name-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pk-badge {
          color: #f59e0b;
          display: inline-flex;
        }
        .pk-name-text {
          font-weight: 600;
          color: #f59e0b;
        }

        .type-badge {
          font-size: 11px;
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: 4px;
          border: 1px solid var(--border-light);
          color: #60a5fa;
        }

        .badge-nullable {
          font-size: 9.5px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
        }
        .badge-nullable.yes {
          color: var(--text-muted);
          background: var(--bg-tertiary);
        }
        .badge-nullable.no {
          color: #f87171;
          background: rgba(239, 68, 68, 0.15);
        }

        .default-pill {
          font-size: 10.5px;
          color: var(--text-sub);
          background: var(--bg-tertiary);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .null-text {
          color: var(--text-muted);
        }

        .key-pill {
          font-size: 9.5px;
          font-weight: 700;
          padding: 1.5px 6px;
          border-radius: 4px;
        }
        .key-pill.pk {
          color: #f59e0b;
          background: rgba(245, 158, 11, 0.15);
        }
        .key-pill.none {
          color: var(--text-muted);
        }

        .ddl-container {
          padding: 16px;
          height: 100%;
        }
        .ddl-code {
          background: #10121a;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 14px;
          color: #93c5fd;
          font-size: 12px;
          line-height: 1.6;
          overflow: auto;
          white-space: pre-wrap;
          user-select: text;
        }

        .state-message {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 40px 16px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .loading-icon { color: var(--accent-blue); }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .error-message {
          padding: 16px;
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.08);
          font-size: 11px;
        }

        .modal-footer {
          padding: 10px 16px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .footer-left-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
};
