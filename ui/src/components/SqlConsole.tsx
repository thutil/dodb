/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef, useEffect, useCallback } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import { Play, Clock, Database, CheckCircle2, AlertCircle, FileCode, Sparkles, Layers, Table2, Code2, Copy, Check, Download, WrapText } from "lucide-react";
import { QueryExecutionResult, ColumnInfo } from "../types";

interface SqlConsoleProps {
  activeDatabase: string;
  activeTable: string | null;
  tables?: string[];
  columns?: ColumnInfo[];
  theme?: "dark" | "light";
  onExecuteSql: (sql: string) => Promise<QueryExecutionResult>;
}


const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "CROSS JOIN",
  "ON", "GROUP BY", "HAVING", "ORDER BY", "ASC", "DESC", "LIMIT", "OFFSET",
  "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "CREATE TABLE", "ALTER TABLE", "DROP TABLE",
  "TRUNCATE", "UNION", "UNION ALL", "DISTINCT", "AS", "IN", "NOT IN", "BETWEEN",
  "LIKE", "ILIKE", "IS NULL", "IS NOT NULL", "AND", "OR", "NOT", "EXISTS",
  "CASE", "WHEN", "THEN", "ELSE", "END", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES",
  "CASCADE", "DEFAULT", "UNIQUE", "CHECK", "INDEX", "VIEW", "WITH", "RECURSIVE", "RETURNING"
];

const SQL_FUNCTIONS = [
  { name: "COUNT", snippet: "COUNT(${1:*})" },
  { name: "SUM", snippet: "SUM(${1:column})" },
  { name: "AVG", snippet: "AVG(${1:column})" },
  { name: "MIN", snippet: "MIN(${1:column})" },
  { name: "MAX", snippet: "MAX(${1:column})" },
  { name: "COALESCE", snippet: "COALESCE(${1:val1}, ${2:val2})" },
  { name: "NULLIF", snippet: "NULLIF(${1:val1}, ${2:val2})" },
  { name: "CONCAT", snippet: "CONCAT(${1:str1}, ${2:str2})" },
  { name: "LOWER", snippet: "LOWER(${1:str})" },
  { name: "UPPER", snippet: "UPPER(${1:str})" },
  { name: "TRIM", snippet: "TRIM(${1:str})" },
  { name: "SUBSTRING", snippet: "SUBSTRING(${1:str} FROM ${2:start} FOR ${3:length})" },
  { name: "DATE", snippet: "DATE(${1:timestamp})" },
  { name: "NOW", snippet: "NOW()" },
  { name: "ROUND", snippet: "ROUND(${1:val}, ${2:2})" },
  { name: "FLOOR", snippet: "FLOOR(${1:val})" },
  { name: "CEIL", snippet: "CEIL(${1:val})" },
  { name: "CAST", snippet: "CAST(${1:expr} AS ${2:TYPE})" }
];

export const SqlConsole: React.FC<SqlConsoleProps> = ({
  activeDatabase,
  activeTable,
  tables = [],
  columns = [],
  theme = "dark",
  onExecuteSql,
}) => {
  const [sql, setSql] = useState<string>(
    activeTable ? `SELECT * FROM ${activeTable} LIMIT 50;` : "SELECT 1;"
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);

  // Result View Mode: Table vs JSON
  const [resultViewMode, setResultViewMode] = useState<"table" | "json">("table");
  const [resultJsonFormat, setResultJsonFormat] = useState<"pretty" | "compact">("pretty");
  const [copiedJson, setCopiedJson] = useState(false);
  const [jsonWrap, setJsonWrap] = useState(true);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<any>(null);

  // Keep references to tables and columns for completion provider
  const tablesRef = useRef(tables);
  const columnsRef = useRef(columns);
  tablesRef.current = tables;
  columnsRef.current = columns;

  const handleCopyResultJson = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadResultJson = (rowsData: any[]) => {
    const jsonStr = resultJsonFormat === "pretty"
      ? JSON.stringify(rowsData, null, 2)
      : JSON.stringify(rowsData);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query_result_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRun = useCallback(async () => {
    const currentCode = editorRef.current ? editorRef.current.getValue() : sql;
    if (!currentCode.trim()) return;
    setLoading(true);
    setResult(null);
    const start = performance.now();
    try {
      const res = await onExecuteSql(currentCode);
      const duration = Math.round(performance.now() - start);
      setResult({ ...res, executionTimeMs: duration });
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - start);
      const msg = err instanceof Error ? err.message : String(err);
      setResult({ error: msg || "Query execution failed", executionTimeMs: duration });
    } finally {
      setLoading(false);
    }
  }, [sql, onExecuteSql]);

  // Register or update Monaco Auto-completion Provider for SQL
  const setupCompletion = useCallback((monaco: Monaco) => {
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
    }

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ",", '"', "'", "`"],
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: any[] = [];

        // 1. Dynamic Tables from Active Database
        tablesRef.current.forEach((tbl) => {
          suggestions.push({
            label: {
              label: tbl,
              detail: " [Table]",
              description: activeDatabase,
            },
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: tbl,
            range,
            sortText: "00_" + tbl,
          });
        });

        // 2. Dynamic Columns from Active Table
        columnsRef.current.forEach((col) => {
          suggestions.push({
            label: {
              label: col.name,
              detail: ` [Column: ${col.type}]`,
              description: col.primaryKey ? "PK" : "",
            },
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: col.name,
            range,
            sortText: "01_" + col.name,
          });
        });

        // 3. SQL Keywords
        SQL_KEYWORDS.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: "02_" + kw,
          });
        });

        // 4. SQL Built-in Functions with Snippets
        SQL_FUNCTIONS.forEach((fn) => {
          suggestions.push({
            label: {
              label: fn.name,
              detail: " (Function)",
            },
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: fn.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: "03_" + fn.name,
          });
        });

        return { suggestions };
      },
    });
  }, [activeDatabase]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register Cmd + Enter / Ctrl + Enter to run query
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRun();
    });

    // Custom dark theme styling matching macOS DoDB
    monaco.editor.defineTheme("dodb-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "60a5fa", fontStyle: "bold" },
        { token: "string.sql", foreground: "34d399" },
        { token: "number", foreground: "f59e0b" },
        { token: "comment", foreground: "64748b", fontStyle: "italic" },
        { token: "operator.sql", foreground: "93c5fd" },
      ],
      colors: {
        "editor.background": "#14171f",
        "editor.foreground": "#e2e8f0",
        "editorLineNumber.foreground": "#475569",
        "editorLineNumber.activeForeground": "#94a3b8",
        "editor.lineHighlightBackground": "#1e243380",
        "editorCursor.foreground": "#60a5fa",
        "editorSuggestWidget.background": "#1e2230",
        "editorSuggestWidget.border": "#334155",
        "editorSuggestWidget.selectedBackground": "#2563eb",
      },
    });

    setupCompletion(monaco);
  };

  useEffect(() => {
    if (monacoRef.current) {
      setupCompletion(monacoRef.current);
    }
  }, [tables, columns, setupCompletion]);

  useEffect(() => {
    return () => {
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
      }
    };
  }, []);

  const applyTemplate = (template: string) => {
    setSql(template);
    if (editorRef.current) {
      editorRef.current.setValue(template);
      editorRef.current.focus();
    }
  };

  return (
    <div className="sql-console">
      {/* Top Toolbar */}
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
                  onClick={() => applyTemplate(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${activeTable}';`)}
                >
                  SCHEMA
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bar-right">
          <div className="hint-pill">
            <Sparkles size={11} className="sparkle-icon" />
            <span>Auto-Suggest Active</span>
          </div>
          <button className="btn btn-primary run-query-btn" onClick={handleRun} disabled={loading}>
            <Play size={13} />
            <span>{loading ? "Executing..." : "Run (Cmd + Enter)"}</span>
          </button>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="editor-container">
        <Editor
          height="100%"
          language="sql"
          theme={theme === "dark" ? "dodb-dark" : "light"}
          value={sql}
          onChange={(val) => setSql(val || "")}
          onMount={handleEditorDidMount}
          options={{
            fontSize: 12.5,
            fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
            lineNumbers: "on",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: true },
            wordBasedSuggestions: "allDocuments",
            padding: { top: 10, bottom: 10 },
            renderLineHighlight: "all",
            smoothScrolling: true,
            cursorBlinking: "smooth",
          }}
        />
      </div>

      {/* Results Section */}
      <div className="results-pane">
        {result && (
          <div className="results-bar">
            <div className="results-bar-left">
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
              {activeTable && (
                <span className="stat-item font-mono">
                  <Layers size={11} />
                  <span>{activeTable}</span>
                </span>
              )}
            </div>

            {result.rows && result.rows.length > 0 && (
              <div className="results-bar-right">
                {/* View Mode Segmented Switch */}
                <div className="view-mode-toggle">
                  <button
                    className={`view-toggle-btn ${resultViewMode === "table" ? "active" : ""}`}
                    onClick={() => setResultViewMode("table")}
                    title="Table View"
                  >
                    <Table2 size={12} />
                    <span>Table</span>
                  </button>
                  <button
                    className={`view-toggle-btn ${resultViewMode === "json" ? "active" : ""}`}
                    onClick={() => setResultViewMode("json")}
                    title="JSON View"
                  >
                    <Code2 size={12} />
                    <span>JSON</span>
                  </button>
                </div>

                {resultViewMode === "json" && (
                  <div className="json-toolbar-group">
                    <div className="json-format-toggle">
                      <button
                        className={`btn btn-secondary btn-sm ${resultJsonFormat === "pretty" ? "active-format" : ""}`}
                        onClick={() => setResultJsonFormat("pretty")}
                        title="Pretty Format (Indented)"
                      >
                        Pretty
                      </button>
                      <button
                        className={`btn btn-secondary btn-sm ${resultJsonFormat === "compact" ? "active-format" : ""}`}
                        onClick={() => setResultJsonFormat("compact")}
                        title="Compact Format (Minified)"
                      >
                        Compact
                      </button>
                    </div>

                    <button
                      className={`btn btn-secondary btn-sm ${jsonWrap ? "active-format" : ""}`}
                      onClick={() => setJsonWrap(!jsonWrap)}
                      title="Toggle Word Wrap"
                    >
                      <WrapText size={12} />
                      <span>Wrap</span>
                    </button>
                  </div>
                )}

                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const text = resultJsonFormat === "pretty"
                      ? JSON.stringify(result.rows, null, 2)
                      : JSON.stringify(result.rows);
                    handleCopyResultJson(text);
                  }}
                  title="Copy results as JSON"
                >
                  {copiedJson ? <Check size={11} className="copy-check-icon" /> : <Copy size={11} />}
                  <span>{copiedJson ? "Copied!" : "Copy JSON"}</span>
                </button>

                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleDownloadResultJson(result.rows || [])}
                  title="Download results as .json file"
                >
                  <Download size={11} />
                  <span>Download .json</span>
                </button>
              </div>
            )}
          </div>
        )}

        {result?.error && <div className="error-display font-mono">{result.error}</div>}

        {result?.rows && (
          <div className="results-table-scroll">
            {result.rows.length === 0 ? (
              <div className="no-data-text">Query executed successfully. 0 rows returned.</div>
            ) : resultViewMode === "json" ? (
              <div className="json-result-wrapper">
                <Editor
                  height="100%"
                  language="json"
                  theme={theme === "dark" ? "dodb-dark" : "light"}
                  value={resultJsonFormat === "pretty" ? JSON.stringify(result.rows, null, 2) : JSON.stringify(result.rows)}
                  options={{
                    readOnly: true,
                    fontSize: 12,
                    fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
                    lineNumbers: "on",
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: jsonWrap ? "on" : "off",
                    folding: true,
                    padding: { top: 8, bottom: 8 },
                    renderLineHighlight: "all",
                  }}
                />
              </div>
            ) : (
              (() => {
                const cols = Object.keys(result.rows![0] || {});
                return (
                  <table className="sql-table font-mono">
                    <thead>
                      <tr>
                        <th style={{ width: "45px", textAlign: "center" }}>#</th>
                        {cols.map((col) => (
                          <th key={col}>{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows!.map((row, rIdx) => (
                        <tr key={rIdx}>
                          <td className="row-idx" style={{ textAlign: "center" }}>{rIdx + 1}</td>
                          {cols.map((col) => {
                            const val = row[col];
                            return (
                              <td key={col}>
                                {val === null ? (
                                  <span className="null-val">NULL</span>
                                ) : typeof val === "object" ? (
                                  JSON.stringify(val)
                                ) : (
                                  String(val)
                                )}
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
          height: 100%;
        }

        .sql-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
          gap: 12px;
        }

        .bar-left, .bar-right {
          display: flex;
          align-items: center;
          gap: 10px;
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

        .hint-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 3px 8px;
          border-radius: 12px;
          border: 1px solid var(--border-light);
        }
        .sparkle-icon { color: #f59e0b; }

        .run-query-btn {
          padding: 5px 12px;
          height: 30px;
        }

        .editor-container {
          height: 200px;
          min-height: 140px;
          background: #14171f;
          border-bottom: 1px solid var(--border-light);
          position: relative;
          flex-shrink: 0;
        }

        .results-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--bg-content);
        }

        .results-bar {
          padding: 6px 14px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 11px;
          flex-shrink: 0;
        }

        .results-bar-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .results-bar-right {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
        }

        /* View Mode Segmented Control */
        .view-mode-toggle {
          display: inline-flex;
          background: var(--bg-card);
          padding: 2px;
          border-radius: 5px;
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .view-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .view-toggle-btn:hover {
          color: var(--text-main);
        }
        .view-toggle-btn.active {
          background: var(--accent-blue);
          color: #ffffff;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .json-toolbar-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .json-format-toggle {
          display: inline-flex;
          background: var(--bg-card);
          padding: 2px;
          border-radius: 4px;
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .active-format {
          background: rgba(59, 130, 246, 0.2) !important;
          color: var(--accent-blue) !important;
          border-color: rgba(59, 130, 246, 0.4) !important;
          font-weight: 600;
        }
        .copy-check-icon {
          color: var(--accent-green);
        }

        .btn-sm {
          padding: 2px 7px;
          font-size: 10px;
        }

        .json-result-wrapper {
          width: 100%;
          height: 100%;
          min-height: 250px;
          background: var(--bg-content);
          position: relative;
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
          z-index: 2;
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

        .row-idx {
          color: var(--text-muted);
          background: var(--bg-tertiary);
        }

        .null-val {
          color: var(--text-muted);
          font-style: italic;
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
