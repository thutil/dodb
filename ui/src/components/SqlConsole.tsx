/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Editor, { Monaco, OnMount } from "@monaco-editor/react";
import {
  Play, Clock, Database, CheckCircle2, AlertCircle, FileCode, Sparkles,
  Layers, Table2, Code2, Copy, Check, Download, WrapText, Globe,
  Edit2, Edit3, Trash2, RotateCcw, Eye, Search, X, Plus, Key, Zap,
  GripHorizontal, ListFilter
} from "lucide-react";
import { QueryExecutionResult, ColumnInfo, ConnectionProfile } from "../types";
import { PendingChanges, CommitResult } from "./DataGrid";
import { isGeometryColumn, isGisData, formatGisSummary, parseGisToGeoJson } from "../utils/gisUtils";
import { GisMapViewer, GisFeatureRecord } from "./GisMapViewer";
import { splitSqlStatements, getStatementAtLine, stripCommentsAndTrim, extractTableFromSql, extractColumnMappingsFromSql } from "../utils/sqlUtils";
import { apiClient } from "../utils/apiClient";
import { getSharedSql, setSharedSql, useSharedSql } from "../utils/queryWorkspaceStore";
import {
  DatabaseSchemaInfo,
  SchemaRelation,
  extractTableAliasesFromSql,
  getAutocompleteContext,
  predictInlineSqlCompletion,
} from "../utils/sqlAutocomplete";
import { saveTextFileAsync } from "../utils/saveFile";

interface SqlConsoleProps {
  activeProfile?: ConnectionProfile | null;
  activeDatabase: string;
  activeTable: string | null;
  tables?: string[];
  columns?: ColumnInfo[];
  theme?: "dark" | "light";
  onExecuteSql: (sql: string) => Promise<QueryExecutionResult>;
  onCommitChanges?: (changes: PendingChanges) => Promise<CommitResult>;
}

export interface StatementResultItem {
  id: number;
  sql: string;
  result: QueryExecutionResult;
  executionTimeMs: number;
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

const schemaCache = new Map<string, DatabaseSchemaInfo>();

export const SqlConsole: React.FC<SqlConsoleProps> = ({
  activeProfile,
  activeDatabase,
  activeTable,
  tables = [],
  columns = [],
  theme = "dark",
  onExecuteSql,
  onCommitChanges,
}) => {
  const sqlPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // SQL text is shared with the visual Query tab. Monaco stays bound to fast local
  // state; the store is written back debounced so a keystroke never notifies subscribers.
  const sharedSql = useSharedSql();
  const [sql, setSql] = useState<string>(
    () => getSharedSql() || (activeTable ? `SELECT * FROM ${activeTable} LIMIT 50;` : "SELECT 1;")
  );
  const sqlRef = useRef(sql);
  useEffect(() => {
    sqlRef.current = sql;
  });

  // Seed the store from the local default so the Query tab starts from the same text.
  useEffect(() => {
    if (!getSharedSql().trim()) setSharedSql(sqlRef.current);
  }, []);

  // Adopt changes that came from the other tab (e.g. a JOIN drawn on the canvas).
  useEffect(() => {
    if (sharedSql && sharedSql !== sqlRef.current) {
      // Drop any pending push, or it would immediately overwrite what we just adopted.
      if (sqlPushTimerRef.current) {
        clearTimeout(sqlPushTimerRef.current);
        sqlPushTimerRef.current = null;
      }
      setSql(sharedSql);
    }
  }, [sharedSql]);

  // Push local edits back to the store, debounced.
  const handleSqlChange = useCallback((val: string) => {
    setSql(val);
    if (sqlPushTimerRef.current) clearTimeout(sqlPushTimerRef.current);
    sqlPushTimerRef.current = setTimeout(() => setSharedSql(val), 400);
  }, []);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryExecutionResult | null>(null);

  // Selection & Cursor Tracking
  const [selectedSql, setSelectedSql] = useState<string>("");
  const [selectionInfo, setSelectionInfo] = useState<{ lines: number; chars: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ line: number; column: number }>({ line: 1, column: 1 });

  // Multi-statement results & tabs
  const [statementResults, setStatementResults] = useState<StatementResultItem[]>([]);
  const [activeResultTab, setActiveResultTab] = useState<number>(0);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // Editor Resizing State
  const [editorHeight, setEditorHeight] = useState<number>(200);
  const [isDraggingResize, setIsDraggingResize] = useState<boolean>(false);

  // Result View Mode: Table vs JSON vs GIS Map
  const [resultViewMode, setResultViewMode] = useState<"table" | "json" | "gis">("table");
  const [resultJsonFormat, setResultJsonFormat] = useState<"pretty" | "compact">("pretty");
  const [copiedJson, setCopiedJson] = useState(false);
  const [jsonWrap, setJsonWrap] = useState(true);

  // Row Editing & Pending Transactions State
  const [editedCells, setEditedCells] = useState<{ [rowIdx: number]: Record<string, unknown> }>({});
  const [deletedRowIndices, setDeletedRowIndices] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colName: string; originalVal: unknown } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    row: Record<string, unknown>;
  } | null>(null);

  // Searchable Row Inspector Modal State
  const [inspectRowModal, setInspectRowModal] = useState<{
    rowIdx: number;
    row: Record<string, unknown>;
  } | null>(null);
  const [inspectSearchTerm, setInspectSearchTerm] = useState<string>("");

  // Full Row Edit Modal State
  const [rowEditModal, setRowEditModal] = useState<{
    rowIdx: number;
    data: Record<string, unknown>;
  } | null>(null);

  // GIS Map Viewer Modal State (single cell / geometry click)
  const [gisModalData, setGisModalData] = useState<{
    title: string;
    subtitle?: string;
    value: unknown;
    pickerMode?: boolean;
    onPick?: (coords: { lng: number; lat: number; wkt: string }) => void;
  } | null>(null);

  // Status message for transactions
  const [commitMsg, setCommitMsg] = useState<{ success: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<any>(null);
  const inlineCompletionProviderRef = useRef<any>(null);

  // Schema state for intelligent autocomplete
  const [schemaInfo, setSchemaInfo] = useState<DatabaseSchemaInfo>(() => {
    const key = `${activeProfile?.id || "default"}:${activeDatabase || "default"}`;
    return (
      schemaCache.get(key) || {
        tables,
        tableColumns: new Map<string, ColumnInfo[]>(),
      }
    );
  });

  const activeDatabaseRef = useRef(activeDatabase);
  const activeTableRef = useRef(activeTable);
  const tablesRef = useRef(tables);
  const columnsRef = useRef(columns);
  const schemaInfoRef = useRef(schemaInfo);
  const activeProfileRef = useRef(activeProfile);
  const onExecuteSqlRef = useRef(onExecuteSql);
  const onCommitChangesRef = useRef(onCommitChanges);

  activeDatabaseRef.current = activeDatabase;
  activeTableRef.current = activeTable;
  tablesRef.current = tables;
  columnsRef.current = columns;
  schemaInfoRef.current = schemaInfo;
  activeProfileRef.current = activeProfile;
  onExecuteSqlRef.current = onExecuteSql;
  onCommitChangesRef.current = onCommitChanges;

  // Background Schema Indexing for active profile + database
  useEffect(() => {
    if (!activeProfile?.id || !activeDatabase) return;
    const cacheKey = `${activeProfile.id}:${activeDatabase}`;
    if (schemaCache.has(cacheKey)) {
      setSchemaInfo(schemaCache.get(cacheKey)!);
      return;
    }

    let alive = true;
    apiClient
      .getSchemaDiagram(activeProfile.id, activeDatabase)
      .then((data: any) => {
        if (!alive) return;
        const tMap = new Map<string, ColumnInfo[]>();
        const tList: string[] = [];
        const rels: SchemaRelation[] = [];

        if (data && Array.isArray(data.tables)) {
          data.tables.forEach((t: any) => {
            tList.push(t.name);
            const cols: ColumnInfo[] = Array.isArray(t.columns)
              ? t.columns.map((c: any) => ({
                  name: c.name,
                  type: c.type || "text",
                  nullable: !!c.nullable,
                  primaryKey: !!c.primaryKey,
                  defaultValue: c.default || null,
                  autoIncrement: !!c.autoIncrement,
                }))
              : [];
            tMap.set(t.name.toLowerCase(), cols);
            if (t.name.includes(".")) {
              const bareName = t.name.split(".").pop();
              if (bareName && !tMap.has(bareName.toLowerCase())) {
                tMap.set(bareName.toLowerCase(), cols);
              }
            }
          });
        }

        if (data && Array.isArray(data.relations)) {
          data.relations.forEach((r: any) => {
            rels.push({
              fromTable: r.fromTable || r.sourceTable,
              fromColumn: r.fromColumn || r.sourceColumn,
              toTable: r.toTable || r.targetTable,
              toColumn: r.toColumn || r.targetColumn,
            });
          });
        }

        const info: DatabaseSchemaInfo = {
          tables: tList.length > 0 ? tList : tables,
          tableColumns: tMap,
          relations: rels,
        };
        schemaCache.set(cacheKey, info);
        setSchemaInfo(info);
      })
      .catch((err) => {
        console.warn("Could not load schema diagram for SQL autocomplete:", err);
      });

    return () => {
      alive = false;
    };
  }, [activeProfile?.id, activeDatabase, tables]);

  // Clean up Monaco completion providers on unmount
  useEffect(() => {
    return () => {
      if (sqlPushTimerRef.current) {
        clearTimeout(sqlPushTimerRef.current);
        setSharedSql(sqlRef.current);
      }
      if (completionProviderRef.current) {
        completionProviderRef.current.dispose();
        completionProviderRef.current = null;
      }
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose();
        inlineCompletionProviderRef.current = null;
      }
    };
  }, []);

  const numUpdates = Object.keys(editedCells).length;
  const numDeletes = deletedRowIndices.size;
  const totalPending = numUpdates + numDeletes;

  // Parsed SQL statements from current editor content
  const parsedStatements = useMemo(() => splitSqlStatements(sql), [sql]);
  const currentStatementAtCursor = useMemo(() => {
    return getStatementAtLine(parsedStatements, cursorPos.line);
  }, [parsedStatements, cursorPos.line]);

  const currentStmtIndex = useMemo(() => {
    if (!currentStatementAtCursor) return -1;
    return parsedStatements.findIndex(
      (s) => s.startIndex === currentStatementAtCursor.startIndex && s.endIndex === currentStatementAtCursor.endIndex
    );
  }, [parsedStatements, currentStatementAtCursor]);

  // Clean summary of a SQL statement for tab display
  const getStatementSummary = (sqlStr: string, maxLen = 28): string => {
    const clean = sqlStr.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return clean.substring(0, maxLen) + "...";
  };

  // Build GIS feature records for query result rows
  const gisFeatures: GisFeatureRecord[] = React.useMemo(() => {
    if (!result?.rows || result.rows.length === 0) return [];
    const feats: GisFeatureRecord[] = [];
    const cols = Object.keys(result.rows[0] || {});

    // Find which columns contain GIS data
    const gisColNames = cols.filter((col) => {
      if (isGeometryColumn("", col)) return true;
      return result.rows!.some((row) => isGisData(row[col]));
    });

    if (gisColNames.length === 0) return [];

    result.rows.forEach((row, idx) => {
      if (deletedRowIndices.has(idx)) return;
      const rowEdits = editedCells[idx] || {};
      const effectiveRow = { ...row, ...rowEdits };

      for (const gc of gisColNames) {
        const val = effectiveRow[gc];
        const geom = parseGisToGeoJson(val);
        if (geom) {
          feats.push({
            id: `${idx}_${gc}`,
            geometry: geom,
            properties: effectiveRow as Record<string, unknown>,
            label: `${gc} (Row #${idx + 1})`,
          });
        }
      }
    });
    return feats;
  }, [result?.rows, deletedRowIndices, editedCells]);

  // If view mode is GIS but current query has no GIS data, fall back to table
  useEffect(() => {
    if (resultViewMode === "gis" && gisFeatures.length === 0) {
      setResultViewMode("table");
    }
  }, [gisFeatures.length, resultViewMode]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleOutside = () => setContextMenu(null);
    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, [contextMenu]);

  // Handle ESC key to dismiss sub-modals (Inspector, Row Modal, GIS, Inline Edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else if (gisModalData) setGisModalData(null);
        else if (inspectRowModal) setInspectRowModal(null);
        else if (rowEditModal) setRowEditModal(null);
        else if (editingCell) setEditingCell(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, gisModalData, inspectRowModal, rowEditModal, editingCell]);

  // Start inline editing
  const startEditing = (rowIdx: number, colName: string, currentVal: unknown) => {
    setEditingCell({ rowIdx, colName, originalVal: currentVal });
    setEditValue(currentVal === null || currentVal === undefined ? "" : String(currentVal));
  };

  // Coerce value based on column definition or raw type
  const coerceVal = (colName: string, rawStr: string, origVal: unknown): unknown => {
    if (rawStr === "" && origVal === null) return null;
    const colDef = columns.find((c) => c.name === colName);
    if (colDef) {
      const type = colDef.type.toLowerCase();
      const trimmed = rawStr.trim();
      if (/(int|serial)/.test(type) && /^-?\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        return Number.isSafeInteger(n) ? n : trimmed;
      }
      if (/(double|real|float|numeric|decimal)/.test(type)) {
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : rawStr;
      }
      if (/bool/.test(type)) {
        const v = trimmed.toLowerCase();
        if (["true", "t", "1", "yes"].includes(v)) return true;
        if (["false", "f", "0", "no"].includes(v)) return false;
      }
    } else {
      if (typeof origVal === "number") {
        const n = Number(rawStr);
        if (!isNaN(n)) return n;
      } else if (typeof origVal === "boolean") {
        if (rawStr === "true") return true;
        if (rawStr === "false") return false;
      }
    }
    return rawStr;
  };

  // Save inline cell edit
  const saveCellEdit = () => {
    if (!editingCell) return;
    const { rowIdx, colName, originalVal } = editingCell;
    const newVal = coerceVal(colName, editValue, originalVal);
    if (newVal === originalVal) {
      setEditingCell(null);
      return;
    }
    setEditedCells((prev) => ({
      ...prev,
      [rowIdx]: {
        ...(prev[rowIdx] || {}),
        [colName]: newVal,
      },
    }));
    setEditingCell(null);
  };

  // Toggle delete mark on a row
  const toggleDeleteRow = (rowIdx: number) => {
    setDeletedRowIndices((prev) => {
      const next = new Set(prev);
      if (next.has(rowIdx)) next.delete(rowIdx);
      else next.add(rowIdx);
      return next;
    });
  };

// Helper to quote table name or schema.table correctly for SQL
const quoteTableIdentifier = (tbl: string): string => {
  if (!tbl) return '"table_name"';
  const parts = tbl.split(".");
  return parts
    .map((p) => {
      const clean = p.replace(/^["`\[]+|["`\]]+$/g, "").trim();
      return `"${clean}"`;
    })
    .join(".");
};

  // Discard / Rollback changes
  const handleRollback = () => {
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setCommitMsg(null);
  };

  // Infer target table name
  const getTargetTable = useCallback((): string | null => {
    // 1. Check SQL that generated the currently viewed result tab
    const currentTabSql = statementResults[activeResultTab]?.sql;
    if (currentTabSql) {
      const extracted = extractTableFromSql(currentTabSql);
      if (extracted) return extracted;
    }

    // 2. Check editor code or current SQL
    const currentCode = editorRef.current ? editorRef.current.getValue() : sql;
    const extracted = extractTableFromSql(currentCode);
    if (extracted) return extracted;

    // 3. Fallback to activeTable
    if (activeTable) return activeTable;

    return null;
  }, [statementResults, activeResultTab, sql, activeTable]);

  // Generate UPDATE and DELETE SQL statements
  const generateChangesSql = useCallback((): string[] => {
    if (!result?.rows) return [];
    const currentTabSql = statementResults[activeResultTab]?.sql;
    const currentCode = editorRef.current ? editorRef.current.getValue() : sql;
    const activeSql = currentTabSql || currentCode || "";
    const colMappings = extractColumnMappingsFromSql(activeSql);

    const rawTbl = getTargetTable() || "table_name";
    const tbl = quoteTableIdentifier(rawTbl);
    const statements: string[] = [];

    const getKeyCols = (orig: Record<string, unknown>): string[] => {
      const rowKeys = Object.keys(orig);
      // 1. Check if column metadata has PKs that actually exist in this row or mapped alias
      const pkCols = columns
        .filter((c) => c.primaryKey && (orig[c.name] !== undefined || Object.values(colMappings).some((m) => m.realColumn === c.name && orig[m.alias] !== undefined)))
        .map((c) => {
          if (orig[c.name] !== undefined) return c.name;
          const mapped = Object.values(colMappings).find((m) => m.realColumn === c.name && orig[m.alias] !== undefined);
          return mapped ? mapped.alias : c.name;
        });
      if (pkCols.length > 0) return pkCols;

      // 2. Check common PK column naming patterns in the row itself (id, pk, uuid, poi_id, etc.)
      const idCol = rowKeys.find((k) => {
        const realName = colMappings[k]?.realColumn || k;
        return (/^(id|pk|uuid|_id)$/i.test(realName) || /(^.*_id$)/i.test(realName)) && !colMappings[k]?.isExpression;
      });
      if (idCol && orig[idCol] !== undefined && orig[idCol] !== null) {
        return [idCol];
      }

      // 3. Fallback to scalar non-geometry, non-blob, non-null, non-expression columns (up to 3)
      const candidateCols = rowKeys.filter((k) => {
        if (colMappings[k]?.isExpression) return false;
        const v = orig[k];
        if (v === null || v === undefined) return false;
        if (typeof v === "object") return false;
        const realName = colMappings[k]?.realColumn || k;
        if (isGeometryColumn("", realName) || isGisData(v)) return false;
        if (typeof v === "string" && v.length > 255) return false;
        return true;
      });
      if (candidateCols.length > 0) {
        return candidateCols.slice(0, Math.min(3, candidateCols.length));
      }

      return rowKeys.filter((k) => !colMappings[k]?.isExpression).slice(0, 1);
    };

    // 1. Deletes
    deletedRowIndices.forEach((rIdx) => {
      const orig = result.rows![rIdx];
      if (!orig) return;
      const whereParts: string[] = [];
      const keyCols = getKeyCols(orig);
      keyCols.forEach((colKey) => {
        const mapping = colMappings[colKey];
        const realCol = mapping?.realColumn || colKey;
        const v = orig[colKey];
        if (v === null || v === undefined) whereParts.push(`"${realCol}" IS NULL`);
        else if (typeof v === "number" || typeof v === "boolean") whereParts.push(`"${realCol}" = ${v}`);
        else whereParts.push(`"${realCol}" = '${String(v).replace(/'/g, "''")}'`);
      });
      if (whereParts.length > 0) {
        statements.push(`DELETE FROM ${tbl} WHERE ${whereParts.join(" AND ")};`);
      }
    });

    // 2. Updates
    Object.keys(editedCells).forEach((rIdxStr) => {
      const rIdx = Number(rIdxStr);
      if (deletedRowIndices.has(rIdx)) return;
      const orig = result.rows![rIdx];
      const edits = editedCells[rIdx];
      if (!orig || !edits) return;

      const setParts: string[] = [];
      Object.keys(edits).forEach((colKey) => {
        const mapping = colMappings[colKey];
        if (mapping?.isExpression) {
          throw new Error(`Cannot update computed/expression column "${colKey}".`);
        }
        const realCol = mapping?.realColumn || colKey;
        const v = edits[colKey];
        if (v === null || v === undefined) setParts.push(`"${realCol}" = NULL`);
        else if (typeof v === "number" || typeof v === "boolean") setParts.push(`"${realCol}" = ${v}`);
        else setParts.push(`"${realCol}" = '${String(v).replace(/'/g, "''")}'`);
      });

      if (setParts.length === 0) return;

      const whereParts: string[] = [];
      const keyCols = getKeyCols(orig);
      keyCols.forEach((colKey) => {
        const mapping = colMappings[colKey];
        const realCol = mapping?.realColumn || colKey;
        const v = orig[colKey];
        if (v === null || v === undefined) whereParts.push(`"${realCol}" IS NULL`);
        else if (typeof v === "number" || typeof v === "boolean") whereParts.push(`"${realCol}" = ${v}`);
        else whereParts.push(`"${realCol}" = '${String(v).replace(/'/g, "''")}'`);
      });

      if (whereParts.length === 0) {
        throw new Error(`Cannot identify matching row for table ${tbl}.`);
      }

      statements.push(`UPDATE ${tbl} SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")};`);
    });

    return statements;
  }, [result?.rows, statementResults, activeResultTab, sql, getTargetTable, deletedRowIndices, columns, editedCells]);

  // Copy SQL changes
  const handleCopyChangesSql = () => {
    const stmts = generateChangesSql();
    if (stmts.length === 0) return;
    navigator.clipboard.writeText(stmts.join("\n"));
    setCommitMsg({ success: true, text: `Copied ${stmts.length} SQL statement(s) to clipboard` });
    setTimeout(() => setCommitMsg(null), 3000);
  };

  // Commit changes to database
  const handleCommitChanges = async () => {
    if (totalPending === 0) return;
    const stmts = generateChangesSql();
    if (stmts.length === 0) return;

    setSubmitting(true);
    setCommitMsg(null);
    try {
      const sqlToRun = stmts.join("\n");
      const res = await onExecuteSqlRef.current(sqlToRun);
      if (res.error) {
        setCommitMsg({ success: false, text: res.error });
      } else {
        // Apply changes to local result rows
        if (result?.rows) {
          const updatedRows = result.rows
            .map((r, idx) => {
              if (deletedRowIndices.has(idx)) return null;
              if (editedCells[idx]) return { ...r, ...editedCells[idx] };
              return r;
            })
            .filter(Boolean) as Record<string, any>[];

          setResult((prev) => (prev ? { ...prev, rows: updatedRows, rowsReturned: updatedRows.length } : null));
        }
        setEditedCells({});
        setDeletedRowIndices(new Set());
        setCommitMsg({
          success: true,
          text: `Successfully committed ${totalPending} change(s)! (${res.affectedRows ?? totalPending} rows affected)`,
        });
        setTimeout(() => setCommitMsg(null), 4000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCommitMsg({ success: false, text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyResultJson = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadResultJson = (rowsData: any[]) => {
    const jsonStr = resultJsonFormat === "pretty"
      ? JSON.stringify(rowsData, null, 2)
      : JSON.stringify(rowsData);
    saveTextFileAsync(`query_result_${Date.now()}.json`, jsonStr);
  };

  // Execution Engine for single or multiple SQL statements
  const executeStatements = useCallback(async (statementsToRun: string[]) => {
    const validStatements = statementsToRun
      .map((s) => stripCommentsAndTrim(s))
      .filter((s) => s.length > 0);

    if (validStatements.length === 0) return;

    setLoading(true);
    setResult(null);
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setContextMenu(null);
    setInspectRowModal(null);
    setRowEditModal(null);
    setCommitMsg(null);

    const resultsList: StatementResultItem[] = [];

    for (let idx = 0; idx < validStatements.length; idx++) {
      const stmtSql = validStatements[idx];
      setBatchProgress({ current: idx + 1, total: validStatements.length });
      const start = performance.now();

      try {
        const res = await onExecuteSqlRef.current(stmtSql);
        const duration = Math.round(performance.now() - start);
        resultsList.push({
          id: idx + 1,
          sql: stmtSql,
          result: { ...res, executionTimeMs: duration },
          executionTimeMs: duration,
        });

        if (res.error) {
          break; // Stop subsequent statements on error
        }
      } catch (err: unknown) {
        const duration = Math.round(performance.now() - start);
        const msg = err instanceof Error ? err.message : String(err);
        resultsList.push({
          id: idx + 1,
          sql: stmtSql,
          result: { error: msg || "Query execution failed", executionTimeMs: duration },
          executionTimeMs: duration,
        });
        break;
      }
    }

    setStatementResults(resultsList);
    setBatchProgress(null);
    setLoading(false);

    if (resultsList.length > 0) {
      // Pick best tab: error tab if any, else first tab with rows, else last tab
      let defaultTab = 0;
      const errorTabIdx = resultsList.findIndex((r) => r.result.error);
      if (errorTabIdx >= 0) {
        defaultTab = errorTabIdx;
      } else {
        const rowTabIdx = resultsList.findIndex((r) => r.result.rows && r.result.rows.length > 0);
        defaultTab = rowTabIdx >= 0 ? rowTabIdx : resultsList.length - 1;
      }
      setActiveResultTab(defaultTab);
      setResult(resultsList[defaultTab].result);
    }
  }, []);

  // Primary Execute Handler: Runs highlighted selection if present, else runs statement at cursor (or single query)
  const handleRunSelectionOrCurrent = useCallback(() => {
    const model = editorRef.current?.getModel();
    const selection = editorRef.current?.getSelection();
    let textToRun = "";

    if (selection && model && !selection.isEmpty()) {
      textToRun = model.getValueInRange(selection).trim();
    } else if (selectedSql.trim()) {
      textToRun = selectedSql.trim();
    }

    if (textToRun) {
      // Split selected text in case multiple statements were highlighted
      const stmts = splitSqlStatements(textToRun);
      if (stmts.length > 0) {
        executeStatements(stmts.map((s) => s.sql));
      } else {
        executeStatements([textToRun]);
      }
      return;
    }

    // No selection: run statement at cursor if multiple exist, else run full editor
    const currentCode = editorRef.current ? editorRef.current.getValue() : sql;
    const currentPos = editorRef.current?.getPosition() || cursorPos;
    const allStmts = splitSqlStatements(currentCode);

    if (allStmts.length > 1) {
      const atCursor = getStatementAtLine(allStmts, currentPos.lineNumber);
      if (atCursor) {
        executeStatements([atCursor.sql]);
        return;
      }
    }

    executeStatements(allStmts.length > 0 ? [allStmts[0].sql] : [currentCode]);
  }, [selectedSql, sql, cursorPos, executeStatements]);

  // Run all statements in the editor sequentially
  const handleRunAll = useCallback(() => {
    const currentCode = editorRef.current ? editorRef.current.getValue() : sql;
    const allStmts = splitSqlStatements(currentCode);
    if (allStmts.length > 0) {
      executeStatements(allStmts.map((s) => s.sql));
    } else if (currentCode.trim()) {
      executeStatements([currentCode]);
    }
  }, [sql, executeStatements]);

  const handleRunSelectionOrCurrentRef = useRef(handleRunSelectionOrCurrent);
  handleRunSelectionOrCurrentRef.current = handleRunSelectionOrCurrent;

  const handleRunAllRef = useRef(handleRunAll);
  handleRunAllRef.current = handleRunAll;

  // Switch between result tabs when multiple queries ran
  const switchResultTab = (idx: number) => {
    if (!statementResults[idx]) return;
    setActiveResultTab(idx);
    setResult(statementResults[idx].result);
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
  };

  // Draggable Resizer Handler for Monaco Editor height
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResize(true);
    const startY = e.clientY;
    const startHeight = editorHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(650, startHeight + delta));
      setEditorHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingResize(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Register or update Monaco Auto-completion Provider for SQL
  const setupCompletion = useCallback((monaco: Monaco) => {
    if (completionProviderRef.current) {
      completionProviderRef.current.dispose();
      completionProviderRef.current = null;
    }

    completionProviderRef.current = monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [" ", ".", "(", ",", '"', "'", "`"],
      provideCompletionItems: (model: any, position: any) => {
        const lineUntilCursor: string = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const fullSql: string = model.getValue();
        const word = model.getWordUntilPosition(position);

        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const currentActiveDb = activeDatabaseRef.current;
        const currentSchema = schemaInfoRef.current;
        const currentTables = currentSchema.tables && currentSchema.tables.length > 0
          ? currentSchema.tables
          : tablesRef.current;
        const tableAliases = extractTableAliasesFromSql(fullSql);
        const context = getAutocompleteContext(lineUntilCursor);

        // CASE 1: Dot Completion (e.g. "p." or "provinces." or "r.id")
        if (context.type === "dot") {
          const prefixLower = context.prefix.toLowerCase();
          // Find which physical table name this prefix maps to
          const matchedAlias = tableAliases.find((a) => a.alias.toLowerCase() === prefixLower);
          const targetTableName = matchedAlias ? matchedAlias.tableName : context.prefix;
          const targetTableLower = targetTableName.toLowerCase();

          let targetCols = currentSchema.tableColumns.get(targetTableLower);
          if (!targetCols && targetTableLower === activeTableRef.current?.toLowerCase()) {
            targetCols = columnsRef.current;
          }
          if (!targetCols) {
            for (const [tName, cols] of currentSchema.tableColumns.entries()) {
              if (tName === targetTableLower || tName.endsWith("." + targetTableLower)) {
                targetCols = cols;
                break;
              }
            }
          }

          const suggestions: any[] = [];
          const colFilter = context.columnPrefix.toLowerCase();
          const colRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: position.column - context.columnPrefix.length,
            endColumn: position.column,
          };

          if (targetCols && targetCols.length > 0) {
            targetCols.forEach((col) => {
              if (!colFilter || col.name.toLowerCase().includes(colFilter)) {
                suggestions.push({
                  label: {
                    label: col.name,
                    detail: ` [${col.type}]`,
                    description: targetTableName,
                  },
                  kind: col.primaryKey
                    ? monaco.languages.CompletionItemKind.Property
                    : monaco.languages.CompletionItemKind.Field,
                  insertText: col.name,
                  range: colRange,
                  sortText: (col.primaryKey ? "00_" : "01_") + col.name,
                });
              }
            });
          }

          // Also suggest wildcard '*' for table (e.g. p.*)
          suggestions.push({
            label: {
              label: "*",
              detail: ` (All columns of ${targetTableName})`,
            },
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: "*",
            range: colRange,
            sortText: "00_*",
          });

          return { suggestions };
        }

        // CASE 2: Table Specification Context (After FROM, JOIN, INTO, UPDATE, TABLE)
        if (context.type === "table") {
          const suggestions: any[] = [];
          currentTables.forEach((tbl) => {
            suggestions.push({
              label: {
                label: tbl,
                detail: " [Table]",
                description: currentActiveDb,
              },
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: tbl,
              range,
              sortText: "00_" + tbl,
            });
          });
          return { suggestions };
        }

        // CASE 3: Join ON Condition Context (After ON)
        if (context.type === "on") {
          const suggestions: any[] = [];

          // Intelligent Foreign Key & Smart Join Suggestions
          if (tableAliases.length >= 2) {
            const lastAlias = tableAliases[tableAliases.length - 1];
            const prevAliases = tableAliases.slice(0, -1);
            const lastTableCols = currentSchema.tableColumns.get(lastAlias.tableName.toLowerCase()) || [];

            for (const prevAlias of prevAliases) {
              const prevTableCols = currentSchema.tableColumns.get(prevAlias.tableName.toLowerCase()) || [];

              // 1. Check known Foreign Key relations from schema diagram
              if (currentSchema.relations) {
                for (const rel of currentSchema.relations) {
                  if (
                    rel.fromTable.toLowerCase() === lastAlias.tableName.toLowerCase() &&
                    rel.toTable.toLowerCase() === prevAlias.tableName.toLowerCase()
                  ) {
                    suggestions.push({
                      label: {
                        label: `${lastAlias.alias}.${rel.fromColumn} = ${prevAlias.alias}.${rel.toColumn}`,
                        detail: " (Foreign Key Join)",
                      },
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: `${lastAlias.alias}.${rel.fromColumn} = ${prevAlias.alias}.${rel.toColumn}`,
                      range,
                      sortText: "00_fk",
                    });
                  } else if (
                    rel.toTable.toLowerCase() === lastAlias.tableName.toLowerCase() &&
                    rel.fromTable.toLowerCase() === prevAlias.tableName.toLowerCase()
                  ) {
                    suggestions.push({
                      label: {
                        label: `${lastAlias.alias}.${rel.toColumn} = ${prevAlias.alias}.${rel.fromColumn}`,
                        detail: " (Foreign Key Join)",
                      },
                      kind: monaco.languages.CompletionItemKind.Snippet,
                      insertText: `${lastAlias.alias}.${rel.toColumn} = ${prevAlias.alias}.${rel.fromColumn}`,
                      range,
                      sortText: "00_fk",
                    });
                  }
                }
              }

              // 2. Intelligent join condition heuristic: <tableSingular>_id == id
              const lastSingular = lastAlias.tableName.replace(/s$/, "").toLowerCase();
              const prevSingular = prevAlias.tableName.replace(/s$/, "").toLowerCase();

              for (const lc of lastTableCols) {
                for (const pc of prevTableCols) {
                  const lName = lc.name.toLowerCase();
                  const pName = pc.name.toLowerCase();
                  if (
                    (lName === `${prevSingular}_id` && pName === "id") ||
                    (pName === `${lastSingular}_id` && lName === "id") ||
                    (lName === pName && lName.includes("_id")) ||
                    (lName === pName && lName === "code")
                  ) {
                    const joinExpr = `${lastAlias.alias}.${lc.name} = ${prevAlias.alias}.${pc.name}`;
                    if (!suggestions.some((s) => s.label.label === joinExpr)) {
                      suggestions.push({
                        label: {
                          label: joinExpr,
                          detail: " (Smart Join Condition)",
                        },
                        kind: monaco.languages.CompletionItemKind.Snippet,
                        insertText: joinExpr,
                        range,
                        sortText: "01_smart",
                      });
                    }
                  }
                }
              }
            }

            // Suggest table aliases
            tableAliases.forEach((a) => {
              suggestions.push({
                label: {
                  label: a.alias,
                  detail: ` [Alias -> ${a.tableName}]`,
                },
                kind: monaco.languages.CompletionItemKind.Variable,
                insertText: a.alias,
                range,
                sortText: "02_" + a.alias,
              });
            });
          }

          if (suggestions.length > 0) {
            return { suggestions };
          }
        }

        // CASE 4: General Context (SELECT, WHERE, GROUP BY, ORDER BY, etc.)
        const suggestions: any[] = [];

        // 1. Table Aliases in current query (r, p)
        tableAliases.forEach((a) => {
          if (a.alias !== a.tableName) {
            suggestions.push({
              label: {
                label: a.alias,
                detail: ` [Alias -> ${a.tableName}]`,
              },
              kind: monaco.languages.CompletionItemKind.Variable,
              insertText: a.alias,
              range,
              sortText: "00_" + a.alias,
            });
          }
        });

        // 2. Columns of tables referenced in query
        tableAliases.forEach((a) => {
          const cols = currentSchema.tableColumns.get(a.tableName.toLowerCase()) || [];
          cols.forEach((col) => {
            suggestions.push({
              label: {
                label: col.name,
                detail: ` [${col.type}]`,
                description: a.alias,
              },
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col.name,
              range,
              sortText: (col.primaryKey ? "01_" : "02_") + col.name,
            });
          });
        });

        // If no table aliases in query yet, suggest columns from active table
        if (tableAliases.length === 0) {
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
              sortText: "02_" + col.name,
            });
          });
        }

        // 3. Tables from active database
        currentTables.forEach((tbl) => {
          suggestions.push({
            label: {
              label: tbl,
              detail: " [Table]",
              description: currentActiveDb,
            },
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: tbl,
            range,
            sortText: "03_" + tbl,
          });
        });

        // 4. SQL Functions
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
            sortText: "04_" + fn.name,
          });
        });

        // 5. SQL Keywords
        SQL_KEYWORDS.forEach((kw) => {
          suggestions.push({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: "05_" + kw,
          });
        });

        return { suggestions };
      },
    });

    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose();
      inlineCompletionProviderRef.current = null;
    }

    // Register Inline Ghost-Text Provider (100% Offline, Instant Heuristic Engine)
    if (monaco.languages.registerInlineCompletionsProvider) {
      inlineCompletionProviderRef.current = monaco.languages.registerInlineCompletionsProvider("sql", {
        provideInlineCompletions: async (model: any, position: any) => {
          const lineUntilCursor: string = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const fullSql: string = model.getValue();

          const predicted = predictInlineSqlCompletion(
            fullSql,
            lineUntilCursor,
            schemaInfoRef.current,
            activeTableRef.current
          );

          if (!predicted) {
            return { items: [] };
          }

          return {
            items: [
              {
                insertText: predicted,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              },
            ],
          };
        },
        freeInlineCompletions: () => {},
      });
    }
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme("dodb-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "60a5fa", fontStyle: "bold" },
        { token: "string.sql", foreground: "34d399" },
        { token: "number", foreground: "f59e0b" },
        { token: "comment", foreground: "6b7280", fontStyle: "italic" },
        { token: "operator.sql", foreground: "f472b6" },
      ],
      colors: {
        "editor.background": "#14171f",
        "editor.foreground": "#e2e8f0",
        "editor.lineHighlightBackground": "#1e2433",
        "editorCursor.foreground": "#60a5fa",
        "editorLineNumber.foreground": "#475569",
        "editorLineNumber.activeForeground": "#94a3b8",
      },
    });

    monaco.editor.setTheme(theme === "dark" ? "dodb-dark" : "light");

    // Enable inline suggestions (ghost text) & smart tab completion
    editor.updateOptions({
      inlineSuggest: {
        enabled: true,
        mode: "subwordSmart",
      },
      tabCompletion: "on",
      suggest: {
        preview: true,
        showInlineDetails: true,
      },
    });

    setupCompletion(monaco);

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (sel && model && !sel.isEmpty()) {
        const text = model.getValueInRange(sel).trim();
        setSelectedSql(text);
        setSelectionInfo({
          lines: Math.abs(sel.endLineNumber - sel.startLineNumber) + 1,
          chars: text.length,
        });
      } else {
        setSelectedSql("");
        setSelectionInfo(null);
      }
    });

    editor.onDidChangeCursorPosition((e) => {
      setCursorPos({ line: e.position.lineNumber, column: e.position.column });
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleRunSelectionOrCurrentRef.current();
    });

    // Keyboard shortcut: Cmd/Ctrl + Shift + Enter to run ALL statements
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      handleRunAllRef.current();
    });

    // Right-Click Context Menu Actions in Editor
    editor.addAction({
      id: "run-selection-or-current",
      label: "▶ Run Selection / Current Query (รันคำสั่งที่เลือก / ปัจจุบัน)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 1,
      run: () => {
        handleRunSelectionOrCurrentRef.current();
      },
    });

    editor.addAction({
      id: "run-all-queries",
      label: "Run All Queries (รันคำสั่งทั้งหมด)",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      contextMenuGroupId: "navigation",
      contextMenuOrder: 2,
      run: () => {
        handleRunAllRef.current();
      },
    });
  };

  // Re-register auto-complete when database, tables, or columns change
  useEffect(() => {
    if (monacoRef.current) {
      setupCompletion(monacoRef.current);
    }
  }, [tables, columns, activeDatabase, setupCompletion]);

  // Update theme dynamically
  useEffect(() => {
    if (monacoRef.current) {
      monacoRef.current.editor.setTheme(theme === "dark" ? "dodb-dark" : "light");
    }
  }, [theme]);

  return (
    <div className="sql-console">
      {/* SQL Toolbar */}
      <div className="sql-bar">
        <div className="bar-left">
          <div className="active-db-tag font-mono">
            <Database size={12} />
            <span>{activeDatabase || "No Database"}</span>
          </div>

          <div className="template-chips">
            <span className="chips-label">Snippets:</span>
            {activeTable && (
              <button
                className="btn btn-secondary btn-sm chip-btn"
                onClick={() => handleSqlChange(`SELECT * FROM ${activeTable} LIMIT 50;`)}
                title="Select 50 rows from active table"
              >
                SELECT *
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm chip-btn"
              onClick={() =>
                handleSqlChange(
                  activeTable
                    ? `SELECT COUNT(*) AS total_count FROM ${activeTable};`
                    : "SELECT COUNT(*) FROM information_schema.tables;"
                )
              }
              title="Count total records"
            >
              COUNT(*)
            </button>
            {tables.length > 0 && (
              <button
                className="btn btn-secondary btn-sm chip-btn"
                onClick={() =>
                  handleSqlChange(
                    activeTable
                      ? `SELECT * FROM ${activeTable} ORDER BY 1 DESC LIMIT 10;`
                      : `SELECT * FROM ${tables[0]} LIMIT 10;`
                  )
                }
                title="Order by recent rows"
              >
                Recent Rows
              </button>
            )}
          </div>
        </div>

        <div className="bar-right">
          {selectionInfo ? (
            <div className="selection-active-badge">
              <Sparkles size={11} className="sparkle-icon" />
              <span>
                Selection: {selectionInfo.lines} line{selectionInfo.lines > 1 ? "s" : ""} ({selectionInfo.chars} chars)
              </span>
              <button
                className="btn-clear-sel"
                onClick={() => {
                  if (editorRef.current) {
                    const pos = editorRef.current.getPosition();
                    if (pos) editorRef.current.setPosition(pos);
                  }
                  setSelectedSql("");
                  setSelectionInfo(null);
                }}
                title="Clear highlight selection"
              >
                <X size={10} />
              </button>
            </div>
          ) : parsedStatements.length > 1 ? (
            <div className="hint-pill">
              <span className="statement-count-pill font-mono">
                Query {currentStmtIndex >= 0 ? currentStmtIndex + 1 : 1} of {parsedStatements.length}
              </span>
              <span>(Highlight or Cmd+Enter to Run)</span>
            </div>
          ) : (
            <div className="hint-pill">
              <Sparkles size={11} className="sparkle-icon" />
              <span>Highlight to run selection | Cmd+Enter to Run</span>
            </div>
          )}

          <div className="run-button-group">
            <button
              className={`btn btn-primary run-query-btn ${selectionInfo ? "has-selection" : ""}`}
              onClick={handleRunSelectionOrCurrent}
              disabled={loading}
              title={
                selectionInfo
                  ? "Run highlighted text (Cmd + Enter)"
                  : parsedStatements.length > 1
                  ? `Run query #${currentStmtIndex >= 0 ? currentStmtIndex + 1 : 1} at cursor (Cmd + Enter)`
                  : "Run SQL (Cmd + Enter)"
              }
            >
              <Play size={13} fill={selectionInfo ? "currentColor" : "none"} />
              <span>
                {loading
                  ? batchProgress
                    ? `Running (${batchProgress.current}/${batchProgress.total})...`
                    : "Executing..."
                  : selectionInfo
                  ? `Run Selection (${selectionInfo.lines}L)`
                  : parsedStatements.length > 1
                  ? `Run Current (#${currentStmtIndex >= 0 ? currentStmtIndex + 1 : 1})`
                  : "Run (Cmd + Enter)"}
              </span>
            </button>

            {(parsedStatements.length > 1 || (selectionInfo && splitSqlStatements(selectedSql).length > 1)) && (
              <button
                className="btn btn-secondary btn-run-all"
                onClick={handleRunAll}
                disabled={loading}
                title="Run all queries in sequence (Cmd + Shift + Enter)"
              >
                <Zap size={12} className="zap-icon" />
                <span>Run All ({parsedStatements.length})</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Monaco Code Editor */}
      <div className="editor-container" style={{ height: editorHeight }}>
        <Editor
          height="100%"
          language="sql"
          theme={theme === "dark" ? "dodb-dark" : "light"}
          value={sql}
          onChange={(val) => handleSqlChange(val || "")}
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

      {/* Draggable Resizer Bar */}
      <div
        className={`editor-resizer ${isDraggingResize ? "is-resizing" : ""}`}
        onMouseDown={handleMouseDownResize}
        onDoubleClick={() => setEditorHeight(200)}
        title="Drag to resize SQL editor (Double-click to reset height)"
      >
        <div className="resizer-handle">
          <GripHorizontal size={12} />
        </div>
      </div>

      {/* Results Section */}
      <div className="results-pane">
        {/* Multi-Statement Result Tabs Bar */}
        {statementResults.length > 1 && (
          <div className="statement-tabs-bar">
            <div className="tabs-list">
              {statementResults.map((item, idx) => {
                const isCurrent = activeResultTab === idx;
                const hasErr = Boolean(item.result.error);
                return (
                  <button
                    key={item.id || idx}
                    className={`stmt-tab-btn ${isCurrent ? "active" : ""} ${hasErr ? "tab-error" : ""}`}
                    onClick={() => switchResultTab(idx)}
                    title={item.sql}
                  >
                    {hasErr ? (
                      <AlertCircle size={11} className="tab-icon-err" />
                    ) : (
                      <CheckCircle2 size={11} className="tab-icon-ok" />
                    )}
                    <span className="stmt-tab-num font-mono">#{idx + 1}</span>
                    <span className="stmt-tab-title font-mono">{getStatementSummary(item.sql, 28)}</span>
                    <span className="stmt-tab-badge">
                      {hasErr
                        ? "Error"
                        : typeof item.result.affectedRows === "number"
                        ? `${item.result.affectedRows} aff`
                        : `${item.result.rowsReturned ?? item.result.rows?.length ?? 0} rows`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="tabs-summary font-mono">
              <span>
                {statementResults.filter((r) => !r.result.error).length}/{statementResults.length} executed
              </span>
              <span>
                {statementResults.reduce((acc, r) => acc + (r.executionTimeMs || 0), 0)} ms
              </span>
            </div>
          </div>
        )}

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
              {typeof result.affectedRows === "number" ? (
                <span className="stat-item font-mono">
                  <FileCode size={11} />
                  <span>
                    {result.affectedRows} row{result.affectedRows === 1 ? "" : "s"} affected
                  </span>
                </span>
              ) : (
                result.rows && (
                  <span className="stat-item font-mono">
                    <FileCode size={11} />
                    <span>
                      {result.rowsReturned ?? result.rows.length} row
                      {(result.rowsReturned ?? result.rows.length) === 1 ? "" : "s"} returned
                    </span>
                  </span>
                )
              )}
              {getTargetTable() && (
                <span className="stat-item font-mono" title={`Table: ${getTargetTable()}`}>
                  <Layers size={11} />
                  <span>{getTargetTable()?.replace(/["`\[\]]/g, "")}</span>
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
                  {gisFeatures.length > 0 && (
                    <button
                      className={`view-toggle-btn ${resultViewMode === "gis" ? "active" : ""}`}
                      onClick={() => setResultViewMode("gis")}
                      title="GIS Spatial Map View (MapLibre GL)"
                    >
                      <Globe size={12} />
                      <span>Map ({gisFeatures.length})</span>
                    </button>
                  )}
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

        {/* Transaction Commit / Rollback Bar */}
        {totalPending > 0 && (
          <div className={`transaction-bar ${numDeletes > 0 ? "has-deletions" : ""}`}>
            <div className="tx-info">
              <Edit2 size={13} className="tx-icon" />
              <span>
                Uncommitted Changes ({totalPending}): {numUpdates > 0 && `${numUpdates} edited, `}
                {numDeletes > 0 && (
                  <strong className="tx-delete-highlight">
                    <Trash2 size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                    {numDeletes} marked for deletion
                  </strong>
                )}
              </span>
            </div>

            <div className="tx-actions">
              <button className="btn btn-secondary btn-sm" onClick={handleRollback} disabled={submitting}>
                <RotateCcw size={11} />
                <span>Rollback</span>
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleCopyChangesSql} disabled={submitting} title="Copy UPDATE/DELETE SQL">
                <FileCode size={11} />
                <span>Copy SQL</span>
              </button>
              <button className="btn btn-primary btn-sm btn-commit-action" onClick={handleCommitChanges} disabled={submitting}>
                <Check size={11} />
                <span>{submitting ? "Committing..." : "Commit Changes"}</span>
              </button>
            </div>
          </div>
        )}

        {commitMsg && (
          <div className={`status-bar-msg ${commitMsg.success ? "success" : "error"}`}>
            {commitMsg.success ? <Check size={13} /> : <AlertCircle size={13} />}
            <span>{commitMsg.text}</span>
          </div>
        )}

        {result?.error && <div className="error-display font-mono">{result.error}</div>}

        {result?.rows && (
          <div className="results-table-scroll">
            {result.rows.length === 0 ? (
              <div className="no-data-text">Query executed successfully. 0 rows returned.</div>
            ) : resultViewMode === "gis" ? (
              <div className="gis-view-wrapper" style={{ height: "100%", width: "100%", position: "relative" }}>
                <GisMapViewer
                  isInline
                  records={gisFeatures}
                  title="Query Results — GIS Spatial View"
                  subtitle={`${gisFeatures.length} spatial feature${gisFeatures.length === 1 ? "" : "s"} found in query`}
                />
              </div>
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
                      {result.rows!.map((row, rIdx) => {
                        const isDeleted = deletedRowIndices.has(rIdx);
                        const rowEdits = editedCells[rIdx] || {};
                        const effectiveRow = { ...row, ...rowEdits };

                        return (
                          <tr
                            key={rIdx}
                            className={isDeleted ? "row-deleted" : ""}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                rowIdx: rIdx,
                                row: effectiveRow,
                              });
                            }}
                          >
                            <td className="row-idx" style={{ textAlign: "center" }}>
                              {isDeleted ? (
                                <span title="Marked for deletion" style={{ color: "#f87171" }}>×</span>
                              ) : (
                                rIdx + 1
                              )}
                            </td>
                            {cols.map((col) => {
                              const val = effectiveRow[col];
                              const isModified = rowEdits[col] !== undefined;
                              const isEditing = editingCell?.rowIdx === rIdx && editingCell?.colName === col;
                              const isNull = val === null || val === undefined;
                              const isGeom = !isNull && (isGeometryColumn("", col) || isGisData(val));
                              const gisSummary = isGeom ? formatGisSummary(val) : null;

                              return (
                                <td
                                  key={col}
                                  className={`cell-data ${isModified ? "cell-modified" : ""} ${isNull ? "cell-null" : ""}`}
                                  onDoubleClick={() => !isDeleted && startEditing(rIdx, col, val)}
                                  title={
                                    isDeleted
                                      ? "Row marked for deletion"
                                      : gisSummary
                                      ? "Click badge to view on GIS map; double-click to edit cell"
                                      : "Double-click to edit cell (ดับเบิลคลิกเพื่อแก้ไข)"
                                  }
                                >
                                  {isEditing ? (
                                    <div className="inline-edit-wrap">
                                      <input
                                        autoFocus
                                        type="text"
                                        className="cell-edit-input"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={saveCellEdit}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") saveCellEdit();
                                          if (e.key === "Escape") setEditingCell(null);
                                        }}
                                      />
                                    </div>
                                  ) : isNull ? (
                                    <span className="null-val">NULL</span>
                                  ) : gisSummary ? (
                                    <span
                                      className="gis-badge-pill"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setGisModalData({
                                          title: `Query Result — ${col}`,
                                          subtitle: `Row #${rIdx + 1}`,
                                          value: val,
                                        });
                                      }}
                                      title="Click to view spatial shape on interactive map"
                                    >
                                      <Globe size={10} />
                                      <span>{gisSummary.label}</span>
                                    </span>
                                  ) : typeof val === "object" ? (
                                    JSON.stringify(val)
                                  ) : (
                                    String(val)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })()
            )}
          </div>
        )}
      </div>

      {/* Row Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="row-context-menu"
          style={{
            top: typeof window !== "undefined" ? Math.min(contextMenu.y, window.innerHeight - 280) : contextMenu.y,
            left: typeof window !== "undefined" ? Math.min(contextMenu.x, window.innerWidth - 220) : contextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">
            Row #{contextMenu.rowIdx + 1}
          </div>
          <button
            className="context-menu-item"
            onClick={() => {
              setInspectRowModal({ rowIdx: contextMenu.rowIdx, row: contextMenu.row });
              setInspectSearchTerm("");
              setContextMenu(null);
            }}
          >
            <Eye size={13} />
            <span>Inspect Details</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setRowEditModal({ rowIdx: contextMenu.rowIdx, data: { ...contextMenu.row } });
              setContextMenu(null);
            }}
          >
            <Edit3 size={13} />
            <span>Edit Record (แก้ไขข้อมูล)</span>
          </button>
          {Object.keys(contextMenu.row).some((k) => isGisData(contextMenu.row[k])) && (
            <button
              className="context-menu-item"
              onClick={() => {
                const gCol = Object.keys(contextMenu.row).find((k) => isGisData(contextMenu.row[k]));
                if (gCol) {
                  setGisModalData({
                    title: `Row #${contextMenu.rowIdx + 1} — ${gCol}`,
                    subtitle: `Spatial Feature Inspector`,
                    value: contextMenu.row[gCol],
                  });
                }
                setContextMenu(null);
              }}
            >
              <Globe size={13} style={{ color: "var(--accent-blue)" }} />
              <span>View on Map</span>
            </button>
          )}
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(contextMenu.row, null, 2));
              setContextMenu(null);
            }}
          >
            <Copy size={13} />
            <span>Copy as JSON</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              const rawTbl = getTargetTable() || "table_name";
              const tbl = quoteTableIdentifier(rawTbl);
              const cols = Object.keys(contextMenu.row).filter((k) => contextMenu.row[k] !== undefined);
              const colList = cols.map((c) => `"${c}"`).join(", ");
              const valList = cols.map((c) => {
                const v = contextMenu.row[c];
                if (v === null) return "NULL";
                if (typeof v === "number" || typeof v === "boolean") return String(v);
                return `'${String(v).replace(/'/g, "''")}'`;
              }).join(", ");
              const sql = `INSERT INTO ${tbl} (${colList}) VALUES (${valList});`;
              navigator.clipboard.writeText(sql);
              setContextMenu(null);
            }}
          >
            <FileCode size={13} />
            <span>Copy as SQL INSERT</span>
          </button>
          <div className="context-menu-separator" />
          <button
            className={`context-menu-item ${deletedRowIndices.has(contextMenu.rowIdx) ? "" : "danger"}`}
            onClick={() => {
              toggleDeleteRow(contextMenu.rowIdx);
              setContextMenu(null);
            }}
          >
            {deletedRowIndices.has(contextMenu.rowIdx) ? <RotateCcw size={13} /> : <Trash2 size={13} />}
            <span>{deletedRowIndices.has(contextMenu.rowIdx) ? "Restore Record" : "Delete Record (ลบแถว)"}</span>
          </button>
        </div>
      )}

      {/* Searchable Row Inspector Modal */}
      {inspectRowModal && (
        <div className="row-detail-overlay" onClick={() => setInspectRowModal(null)}>
          <div className="row-detail-card" onClick={(e) => e.stopPropagation()}>
            <div className="row-detail-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="gis-icon-tag">
                  <Eye size={15} />
                </div>
                <div>
                  <div className="gis-title">Record Details #{inspectRowModal.rowIdx + 1}</div>
                  <div className="gis-subtitle">{Object.keys(inspectRowModal.row).length} attributes</div>
                </div>
              </div>

              <div className="row-detail-search-box">
                <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Search field or value..."
                  className="row-detail-search-input font-mono"
                  value={inspectSearchTerm}
                  onChange={(e) => setInspectSearchTerm(e.target.value)}
                  autoFocus
                />
                {inspectSearchTerm && (
                  <button className="icon-clear-btn" onClick={() => setInspectSearchTerm("")}>
                    <X size={12} />
                  </button>
                )}
              </div>

              <button className="gis-close-btn" onClick={() => setInspectRowModal(null)} title="Close (Esc)">
                <X size={15} />
              </button>
            </div>

            <div className="row-detail-body">
              {Object.keys(inspectRowModal.row)
                .filter((colName) => {
                  if (!inspectSearchTerm.trim()) return true;
                  const term = inspectSearchTerm.toLowerCase();
                  const val = inspectRowModal.row[colName];
                  const valStr = val === null || val === undefined ? "null" : typeof val === "object" ? JSON.stringify(val) : String(val);
                  return colName.toLowerCase().includes(term) || valStr.toLowerCase().includes(term);
                })
                .map((colName) => {
                  const val = inspectRowModal.row[colName];
                  const isNull = val === null || val === undefined;
                  const isGeom = isGisData(val) || isGeometryColumn("", colName);
                  const gisSum = isGeom && !isNull ? formatGisSummary(val) : null;
                  const valStr = isNull ? "NULL" : typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
                  const isMatch = inspectSearchTerm.trim().length > 0;
                  const colDef = columns.find((c) => c.name === colName);

                  return (
                    <div key={colName} className={`row-detail-field-card ${isMatch ? "highlighted" : ""}`}>
                      <div className="row-detail-field-header">
                        <div className="row-detail-field-meta">
                          {colDef?.primaryKey && (
                            <span className="field-pk-badge font-mono" title="Primary Key">
                              <Key size={10} /> PK
                            </span>
                          )}
                          <span className="row-detail-field-name">{colName}</span>
                          {colDef?.type && <span className="row-detail-field-type font-mono">{colDef.type}</span>}
                          {isGeom && (
                            <span className="gis-badge-pill" style={{ pointerEvents: "none" }}>
                              <Globe size={9} /> GIS
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {isGeom && !isNull && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setGisModalData({
                                  title: `Record #${inspectRowModal.rowIdx + 1} — ${colName}`,
                                  subtitle: `Spatial Feature Inspector`,
                                  value: val,
                                });
                              }}
                              title="View on Map"
                            >
                              <Globe size={11} />
                              <span>Map</span>
                            </button>
                          )}
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => navigator.clipboard.writeText(valStr)}
                            title="Copy field value"
                          >
                            <Copy size={11} />
                            <span>Copy</span>
                          </button>
                        </div>
                      </div>

                      <div className={`row-detail-field-val font-mono ${isNull ? "is-null" : ""}`}>
                        {isGeom && gisSum ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span className="gis-badge-pill" style={{ margin: 0 }}>
                              <Globe size={10} /> {gisSum.label}
                            </span>
                            <span style={{ color: "var(--text-sub)", fontSize: "11px" }}>{valStr}</span>
                          </div>
                        ) : (
                          valStr
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>

            <div className="row-detail-footer">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(inspectRowModal.row, null, 2))}
                  title="Copy full row as JSON"
                >
                  <Copy size={12} />
                  <span>Copy JSON</span>
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const rawTbl = getTargetTable() || "table_name";
                    const tbl = quoteTableIdentifier(rawTbl);
                    const cols = Object.keys(inspectRowModal.row).filter((k) => inspectRowModal.row[k] !== undefined);
                    const colList = cols.map((c) => `"${c}"`).join(", ");
                    const valList = cols.map((c) => {
                      const v = inspectRowModal.row[c];
                      if (v === null) return "NULL";
                      if (typeof v === "number" || typeof v === "boolean") return String(v);
                      return `'${String(v).replace(/'/g, "''")}'`;
                    }).join(", ");
                    const sql = `INSERT INTO ${tbl} (${colList}) VALUES (${valList});`;
                    navigator.clipboard.writeText(sql);
                  }}
                  title="Copy full row as SQL INSERT statement"
                >
                  <FileCode size={12} />
                  <span>Copy SQL</span>
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  className={`btn btn-sm ${deletedRowIndices.has(inspectRowModal.rowIdx) ? "btn-secondary" : "btn-danger"}`}
                  onClick={() => toggleDeleteRow(inspectRowModal.rowIdx)}
                >
                  {deletedRowIndices.has(inspectRowModal.rowIdx) ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                  <span>{deletedRowIndices.has(inspectRowModal.rowIdx) ? "Restore Record" : "Delete Record"}</span>
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const rIdx = inspectRowModal.rowIdx;
                    const rData = inspectRowModal.row;
                    setInspectRowModal(null);
                    setRowEditModal({ rowIdx: rIdx, data: { ...rData } });
                  }}
                >
                  <Edit3 size={12} />
                  <span>Edit Record</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Row Edit Modal */}
      {rowEditModal && (
        <div className="row-dialog-overlay" onClick={() => setRowEditModal(null)}>
          <div className="row-dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="row-dialog-header">
              <div className="dialog-header-left">
                <div className="dialog-icon-badge">
                  <Edit3 size={14} />
                </div>
                <div className="dialog-title-group">
                  <span className="dialog-title-text">Edit Record #{rowEditModal.rowIdx + 1}</span>
                  <span className="dialog-sub-text">Modify row attributes and values</span>
                </div>
              </div>
              <button className="dialog-close-btn" onClick={() => setRowEditModal(null)} title="Close (Esc)">
                <X size={14} />
              </button>
            </div>

            <div className="row-dialog-body">
              {Object.keys(rowEditModal.data).map((colName) => {
                const val = rowEditModal.data[colName];
                const colDef = columns.find((c) => c.name === colName);
                const isGeom = isGeometryColumn(colDef?.type, colName) || isGisData(val);

                return (
                  <div key={colName} className="field-record-card">
                    <div className="field-card-top">
                      <div className="field-meta-left">
                        <span className="field-name-title">{colName}</span>
                        {colDef?.type && <span className="field-type-badge">{colDef.type}</span>}
                        {colDef?.primaryKey && <span className="field-pk-badge">PK</span>}
                      </div>

                      <div className="field-toggles-right">
                        <button
                          type="button"
                          className={`toggle-chip-btn ${val === null ? "active-null-chip" : ""}`}
                          onClick={() => {
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [colName]: val === null ? "" : null },
                            });
                          }}
                        >
                          SET NULL
                        </button>
                      </div>
                    </div>

                    {val === null ? (
                      <div className="null-field-display">NULL</div>
                    ) : isGeom ? (
                      <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                        <input
                          type="text"
                          className="input font-mono"
                          style={{ flex: 1 }}
                          value={typeof val === "object" ? JSON.stringify(val) : String(val)}
                          onChange={(e) => {
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [colName]: e.target.value },
                            });
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setGisModalData({
                              title: `Record #${rowEditModal.rowIdx + 1} — ${colName}`,
                              subtitle: `Interactive Map Editor`,
                              value: val,
                              pickerMode: true,
                              onPick: (coords) => {
                                setRowEditModal((prev) => {
                                  if (!prev) return null;
                                  return {
                                    ...prev,
                                    data: { ...prev.data, [colName]: coords.wkt },
                                  };
                                });
                                setGisModalData(null);
                              },
                            });
                          }}
                          title="Pick location or edit coordinates on map"
                        >
                          <Globe size={12} />
                          <span>Map Picker</span>
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        className="input font-mono"
                        value={typeof val === "object" ? JSON.stringify(val) : String(val)}
                        onChange={(e) => {
                          setRowEditModal({
                            ...rowEditModal,
                            data: { ...rowEditModal.data, [colName]: e.target.value },
                          });
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="row-dialog-footer">
              <button className="btn btn-secondary" onClick={() => setRowEditModal(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const rIdx = rowEditModal.rowIdx;
                  const originalRow = result?.rows?.[rIdx] || {};
                  const changesObj: Record<string, unknown> = {};

                  Object.keys(rowEditModal.data).forEach((col) => {
                    const newVal = coerceVal(col, String(rowEditModal.data[col] ?? ""), originalRow[col]);
                    const oldVal = originalRow[col];
                    if (newVal !== oldVal) {
                      changesObj[col] = rowEditModal.data[col] === null ? null : newVal;
                    }
                  });

                  if (Object.keys(changesObj).length > 0) {
                    setEditedCells((prev) => ({
                      ...prev,
                      [rIdx]: {
                        ...(prev[rIdx] || {}),
                        ...changesObj,
                      },
                    }));
                  }
                  setRowEditModal(null);
                }}
              >
                <Check size={12} />
                <span>Apply to Row (บันทึกการแก้ไข)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GIS Spatial Map Viewer Modal */}
      {gisModalData && (
        <GisMapViewer
          value={gisModalData.value}
          title={gisModalData.title}
          subtitle={gisModalData.subtitle}
          pickerMode={gisModalData.pickerMode}
          onPickCoordinates={gisModalData.onPick}
          onClose={() => setGisModalData(null)}
        />
      )}

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

        .selection-active-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 600;
          color: #3b82f6;
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.35);
          padding: 3px 8px;
          border-radius: 12px;
          animation: pulse-selection 2s infinite ease-in-out;
        }
        @keyframes pulse-selection {
          0%, 100% { border-color: rgba(59, 130, 246, 0.35); }
          50% { border-color: rgba(59, 130, 246, 0.75); }
        }
        .btn-clear-sel {
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: #3b82f6;
          cursor: pointer;
          padding: 2px;
          border-radius: 50%;
          transition: all 0.12s ease;
        }
        .btn-clear-sel:hover {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
        }
        .statement-count-pill {
          font-weight: 600;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.1);
          padding: 1px 5px;
          border-radius: 4px;
          margin-right: 4px;
        }

        .run-button-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .run-query-btn {
          padding: 5px 12px;
          height: 30px;
        }
        .run-query-btn.has-selection {
          background: #2563eb !important;
          box-shadow: 0 0 10px rgba(37, 99, 235, 0.35);
        }

        .btn-run-all {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 5px 10px;
          height: 30px;
          font-size: 11px;
        }
        .zap-icon {
          color: #f59e0b;
        }

        .editor-container {
          min-height: 100px;
          max-height: 650px;
          background: #14171f;
          position: relative;
          flex-shrink: 0;
        }

        /* Draggable Resizer Bar */
        .editor-resizer {
          height: 6px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          border-bottom: 1px solid var(--border-light);
          cursor: row-resize;
          display: flex;
          align-items: center;
          justify-content: center;
          user-select: none;
          transition: background 0.15s ease;
          z-index: 10;
          flex-shrink: 0;
        }
        .editor-resizer:hover, .editor-resizer.is-resizing {
          background: var(--accent-blue);
        }
        .editor-resizer:hover .resizer-handle, .editor-resizer.is-resizing .resizer-handle {
          color: #fff;
        }
        .resizer-handle {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          opacity: 0.7;
        }

        /* Multi-Statement Result Tabs */
        .statement-tabs-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 5px 12px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          gap: 10px;
          overflow-x: auto;
          flex-shrink: 0;
        }
        .tabs-list {
          display: flex;
          align-items: center;
          gap: 5px;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .tabs-list::-webkit-scrollbar {
          display: none;
        }
        .stmt-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          color: var(--text-sub);
          font-size: 11px;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.12s ease;
        }
        .stmt-tab-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--border-medium);
        }
        .stmt-tab-btn.active {
          background: var(--bg-tertiary);
          color: var(--text-main);
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 1px var(--accent-blue);
          font-weight: 600;
        }
        .stmt-tab-btn.tab-error {
          border-color: rgba(239, 68, 68, 0.4);
        }
        .stmt-tab-btn.tab-error.active {
          border-color: #ef4444;
          box-shadow: 0 0 0 1px #ef4444;
        }
        .tab-icon-ok {
          color: var(--accent-green);
        }
        .tab-icon-err {
          color: #f87171;
        }
        .stmt-tab-num {
          font-weight: 600;
          color: var(--text-muted);
        }
        .stmt-tab-btn.active .stmt-tab-num {
          color: var(--accent-blue);
        }
        .stmt-tab-title {
          font-size: 10.5px;
          color: var(--text-main);
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .stmt-tab-badge {
          font-size: 9.5px;
          padding: 1px 4px;
          border-radius: 3px;
          background: var(--bg-app);
          color: var(--text-muted);
          font-family: var(--font-mono);
        }
        .stmt-tab-btn.active .stmt-tab-badge {
          background: var(--bg-card);
          color: var(--text-sub);
        }
        .tabs-summary {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
        }

        .results-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--bg-content);
          position: relative;
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

        /* Transaction Commit / Rollback Floating Dock */
        .transaction-bar {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: var(--bg-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(245, 158, 11, 0.45);
          border-radius: 9999px;
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.5), 0 4px 12px -2px rgba(245, 158, 11, 0.15);
          font-size: 11.5px;
          color: #fbbf24;
          gap: 16px;
          animation: floatDockIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          white-space: nowrap;
          pointer-events: auto;
        }
        .transaction-bar.has-deletions {
          border-color: rgba(239, 68, 68, 0.55);
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px -2px rgba(239, 68, 68, 0.2);
          color: #f87171;
        }
        .tx-info {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
        }
        .tx-icon {
          flex-shrink: 0;
        }
        .tx-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .btn-commit-action {
          background: #f59e0b !important;
          border-color: #f59e0b !important;
          color: #18181b !important;
          font-weight: 600;
          border-radius: 9999px;
        }
        .btn-commit-action:hover {
          background: #d97706 !important;
          border-color: #d97706 !important;
        }
        .tx-delete-highlight {
          color: #f87171;
          margin-left: 6px;
        }

        .status-bar-msg {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 50;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 18px;
          font-size: 12px;
          font-weight: 500;
          border-radius: 9999px;
          background: var(--bg-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.5);
          animation: floatDockIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
          white-space: nowrap;
          pointer-events: auto;
        }
        .status-bar-msg.success {
          border: 1px solid rgba(16, 185, 129, 0.45);
          color: #34d399;
        }
        .status-bar-msg.error {
          border: 1px solid rgba(239, 68, 68, 0.45);
          color: #f87171;
        }

        @keyframes floatDockIn {
          from {
            opacity: 0;
            transform: translate(-50%, 14px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0) scale(1);
          }
        }

        /* View Mode Segmented Control */
        .view-mode-toggle {
          display: inline-flex;
          background: var(--bg-card);
          padding: 2px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .view-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-muted);
          padding: 2px 7px;
          border-radius: var(--radius-xs);
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .view-toggle-btn:hover {
          color: var(--text-main);
        }
        .view-toggle-btn.active {
          background: var(--bg-tertiary);
          color: var(--text-main);
          font-weight: 600;
          border-color: var(--border-light);
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
          border-radius: var(--radius-xs);
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .active-format {
          background: var(--bg-tertiary) !important;
          color: var(--text-main) !important;
          border-color: var(--border-light) !important;
          font-weight: 600;
        }
        .copy-check-icon {
          color: var(--accent-green);
        }

        .btn-sm {
          padding: 2px 7px;
          font-size: 10.5px;
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
          font-weight: 600;
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .res-badge.success { background: var(--bg-card); color: var(--accent-green); border: 1px solid var(--border-light); }
        .res-badge.error { background: rgba(239, 68, 68, 0.08); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 5px;
          color: var(--text-sub);
          font-size: 11px;
        }

        .error-display {
          padding: 12px 14px;
          color: #f87171;
          background: rgba(239, 68, 68, 0.06);
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
          cursor: default;
        }

        .sql-table tr:hover td {
          background: var(--bg-hover);
        }

        .row-deleted {
          opacity: 0.45;
          text-decoration: line-through;
          background: rgba(239, 68, 68, 0.08) !important;
        }

        .cell-modified {
          background: rgba(245, 158, 11, 0.18) !important;
          outline: 1px solid rgba(245, 158, 11, 0.45);
        }

        .inline-edit-wrap {
          width: 100%;
          display: flex;
          align-items: center;
        }
        .cell-edit-input {
          width: 100%;
          padding: 2px 6px;
          font-size: 11px;
          font-family: inherit;
          background: var(--bg-card);
          border: 1px solid var(--accent-blue);
          border-radius: var(--radius-xs);
          color: var(--text-main);
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        .row-idx {
          color: var(--text-muted);
          background: var(--bg-tertiary);
          user-select: none;
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

        /* Full Row Edit Dialog */
        .row-dialog-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }
        .row-dialog-card {
          width: 580px;
          max-height: 85vh;
          background: var(--bg-app);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .row-dialog-header {
          padding: 12px 18px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .dialog-header-left {
          display: flex;
          align-items: center;
          gap: 9px;
        }
        .dialog-icon-badge {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: var(--bg-tertiary);
          color: var(--text-main);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border-light);
        }
        .dialog-title-group {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .dialog-title-text {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
        }
        .dialog-sub-text {
          font-size: 11px;
          color: var(--text-muted);
        }
        .dialog-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 5px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .dialog-close-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .row-dialog-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .field-record-card {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .field-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .field-meta-left {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .field-name-title {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }
        .field-type-badge {
          font-size: 9px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1px 4px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          font-family: var(--font-mono);
        }
        .field-pk-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 8.5px;
          font-weight: 600;
          color: var(--text-sub);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 1px 4px;
          border-radius: 3px;
        }
        .field-toggles-right {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .toggle-chip-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          font-size: 9.5px;
          padding: 2px 6px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .toggle-chip-btn:hover {
          color: var(--text-main);
        }
        .active-null-chip {
          background: rgba(239, 68, 68, 0.15) !important;
          color: #f87171 !important;
          border-color: rgba(239, 68, 68, 0.3) !important;
        }
        .null-field-display {
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
          padding: 6px 8px;
          background: var(--bg-tertiary);
          border-radius: var(--radius-xs);
          font-family: var(--font-mono);
        }
        .row-dialog-footer {
          padding: 12px 18px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        /* Searchable Row Inspector Modal */
        .row-detail-field-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .row-detail-field-card.highlighted {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.04);
        }
        .row-detail-field-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .row-detail-field-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .row-detail-field-name {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }
        .row-detail-field-type {
          font-size: 10px;
          color: var(--text-muted);
        }
        .row-detail-field-val {
          font-size: 11.5px;
          color: var(--text-main);
          word-break: break-all;
        }
        .row-detail-field-val.is-null {
          color: var(--text-muted);
          font-style: italic;
        }
        .row-detail-footer {
          padding: 10px 18px;
          border-top: 1px solid var(--border-light);
          background: var(--bg-header);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .icon-clear-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
        }

        /* Small Screen Responsive Layout */
        @media (max-width: 960px) {
          .template-chips {
            display: none;
          }
          .hint-pill {
            display: none;
          }
          .results-bar {
            flex-wrap: wrap;
            padding: 6px 10px;
            gap: 8px;
          }
          .results-bar-left {
            gap: 8px;
          }
          .results-bar-right {
            margin-left: 0;
            width: 100%;
            justify-content: flex-start;
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
};
