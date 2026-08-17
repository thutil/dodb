import React, { useState } from "react";
import { Play, Clock, Database, CheckCircle2, AlertCircle, FileCode } from "lucide-react";
import { QueryExecutionResult } from "../types";

interface SqlConsoleProps {
  activeDatabase: string;
  activeTable: string | null;
  onExecuteSql: (sql: string) => Promise<QueryExecutionResult>;
}

export const SqlConsole: React.FC<SqlConsoleProps> = ({
  activeDatabase,
  activeTable,
  onExecuteSql,
}) => {
  const [sql, setSql] = useState<string>(
    activeTable ? `SELECT * FROM ${activeTable} LIMIT 50;` : "SELECT 1;"
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);

  const handleRun = async () => {
    if (!sql.trim()) return;
    setLoading(true);
    setResult(null);
    const start = performance.now();
    try {
      const res = await onExecuteSql(sql);
      const duration = Math.round(performance.now() - start);
      setResult({ ...res, executionTimeMs: duration });
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ error: msg || "Query execution failed", executionTimeMs: duration });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };

  const applyTemplate = (template: string) => {
    setSql(template);
  };

  return (
    <div className="sql-console">
      <div className="sql-bar">
        <div className="bar-left">
          {activeDatabase && (
            <div className="active-db-tag">
              <Database size={12} />
              <span>{activeDatabase}</span>
            </div>
          )}
          <div className="template-chips">
            <span className="chips-label">Templates:</span>
            <button
              className="btn btn-secondary chip-btn"
              onClick={() => applyTemplate(activeTable ? `SELECT * FROM ${activeTable} LIMIT 50;` : "SELECT 1;")}
            >
              SELECT
            </button>
            {activeTable && (
              <>
                <button
                  className="btn btn-secondary chip-btn"
                  onClick={() => applyTemplate(`SELECT COUNT(*) FROM ${activeTable};`)}
                >
                  COUNT
                </button>
                <button
                  className="btn btn-secondary chip-btn"
                  onClick={() => applyTemplate(`SHOW COLUMNS FROM ${activeTable};`)}
                >
                  SCHEMA
                </button>
              </>
            )}
          </div>
        </div>

        <button className="btn btn-primary run-query-btn" onClick={handleRun} disabled={loading}>
          <Play size={13} />
          <span>{loading ? "Executing..." : "Run (Cmd + Enter)"}</span>
        </button>
      </div>

      <div className="editor-pane">
        <div className="editor-gutter">
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
        <textarea
          className="sql-input font-mono"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type SQL query here..."
        />
      </div>

      <div className="results-pane">
        {result && (
          <div className="results-bar">
            {result.error ? (
              <span className="res-badge error">
                <AlertCircle size={12} />
                <span>Error</span>
              </span>
            ) : (
              <span className="res-badge success">
                <CheckCircle2 size={12} />
                <span>Success</span>
              </span>
            )}
            <span className="stat-item font-mono">
              <Clock size={11} />
              <span>{result.executionTimeMs} ms</span>
            </span>
            {result.rows && (
              <span className="stat-item font-mono">
                <FileCode size={11} />
                <span>{result.rows.length} rows</span>
              </span>
            )}
          </div>
        )}

        {result?.error && <div className="error-display font-mono">{result.error}</div>}

        {result?.rows && (
          <div className="results-table-scroll">
            {result.rows.length === 0 ? (
              <div className="no-data-text">Query executed successfully. 0 rows returned.</div>
            ) : (
              (() => {
                const cols = Object.keys(result.rows![0] || {});
                return (
                  <table className="sql-table font-mono">
                    <thead>
                      <tr>
                        {cols.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows!.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {cols.map((col) => {
                            const val = row[col];
                            return (
                              <td key={col}>
                                {val === null
                                  ? "NULL"
                                  : typeof val === "object"
                                  ? JSON.stringify(val)
                                  : String(val)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .sql-console {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
        }

        .sql-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .bar-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .active-db-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.12);
          padding: 3px 8px;
          border-radius: var(--radius-xs);
        }

        .template-chips {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .chips-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .chip-btn {
          font-size: 10px;
          padding: 2px 7px;
        }

        .run-query-btn {
          padding: 5px 12px;
        }

        .editor-pane {
          height: 180px;
          background: var(--bg-sidebar);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          position: relative;
        }

        .editor-gutter {
          width: 32px;
          background: rgba(0, 0, 0, 0.15);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding-top: 10px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          gap: 4px;
        }

        .sql-input {
          flex: 1;
          height: 100%;
          padding: 10px 14px;
          font-size: 12px;
          line-height: 1.6;
          background: transparent;
          color: var(--text-main);
          border: none;
          outline: none;
          resize: none;
        }

        .results-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .results-bar {
          padding: 6px 14px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
        }

        .res-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-weight: 700;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .res-badge.success { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
        .res-badge.error { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-sub);
          font-size: 11px;
        }

        .error-display {
          padding: 14px;
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.08);
          font-size: 11px;
          overflow: auto;
        }

        .results-table-scroll {
          flex: 1;
          overflow: auto;
        }

        .sql-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        .sql-table th {
          position: sticky;
          top: 0;
          background: var(--bg-header);
          color: var(--text-sub);
          text-align: left;
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          font-weight: 600;
        }

        .sql-table td {
          padding: 5px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          white-space: nowrap;
        }

        .sql-table tr:hover td {
          background: var(--bg-hover);
        }

        .no-data-text {
          padding: 24px;
          text-align: center;
          color: var(--text-muted);
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};
