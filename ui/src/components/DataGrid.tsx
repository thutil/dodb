import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import {
  Table2,
  RefreshCw,
  Key,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  FileText,
  Plus,
  Trash2,
  Check,
  RotateCcw,
  AlertCircle,
  Edit2,
  Edit3,
  Download,
  FileCode,
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Copy,
  Code2,
  FileJson,
  WrapText,
  X,
  Server,
  Database,
  Zap,
} from "lucide-react";
import { ColumnInfo, TableRowData, ConnectionProfile, ColumnFilter, FilterOperator } from "../types";


export interface PendingChanges {
  inserts: TableRowData[];
  // Rows are addressed by the original values of their key columns (composite
  // keys included), so the WHERE clause can never be a guess.
  updates: Array<{ keys: TableRowData; data: TableRowData }>;
  deletes: Array<{ keys: TableRowData }>;
}

export interface CommitResult {
  success: boolean;
  error?: string;
  queries?: string[];
  totalAffected?: number;
}

// Values typed into the grid arrive as strings. Convert the ones whose column is
// clearly numeric or boolean so the generated SQL carries a properly typed literal
// instead of relying on the server's implicit cast. Anything wider than a safe
// integer stays a string so no precision is lost.
const coerceCellValue = (col: ColumnInfo | undefined, raw: unknown): unknown => {
  if (!col || typeof raw !== "string" || raw === "" || raw === "__AUTO__") return raw;
  const type = col.type.toLowerCase();
  const trimmed = raw.trim();
  if (/(int|serial)/.test(type) && /^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isSafeInteger(n) ? n : trimmed;
  }
  if (/(double|real|float)/.test(type)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : raw;
  }
  if (/bool/.test(type)) {
    const v = trimmed.toLowerCase();
    if (["true", "t", "1", "yes"].includes(v)) return true;
    if (["false", "f", "0", "no"].includes(v)) return false;
  }
  return raw;
};

interface DataGridProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  tableName: string | null;
  columns: ColumnInfo[];
  rows: TableRowData[];
  totalRows: number;
  loading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (newPage: number) => void;
  onRefresh: () => void;
  onCommitChanges: (changes: PendingChanges) => Promise<CommitResult>;
  sortColumn?: string | null;
  sortOrder?: "ASC" | "DESC";
  onSortChange?: (column: string | null, order: "ASC" | "DESC") => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  filters?: ColumnFilter[];
  onFiltersChange?: (filters: ColumnFilter[]) => void;
  theme?: "dark" | "light";
  errorMessage?: string | null;
  onCreateTable?: () => void;
}

export const DataGrid: React.FC<DataGridProps> = ({
  activeProfile,
  activeDatabase,
  tableName,
  columns,
  rows,
  totalRows,
  loading,
  page,
  pageSize,
  onPageChange,
  onRefresh,
  onCommitChanges,
  sortColumn,
  sortOrder = "ASC",
  onSortChange,
  searchQuery = "",
  onSearchChange,
  filters = [],
  onFiltersChange,
  theme = "dark",
  errorMessage = null,
  onCreateTable,
}) => {
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  // View Mode: Table vs JSON
  const [viewMode, setViewMode] = useState<"table" | "json">("table");
  const [jsonFormat, setJsonFormat] = useState<"pretty" | "compact">("pretty");
  const [jsonWrap, setJsonWrap] = useState<boolean>(true);
  const [copied, setCopied] = useState(false);
  const [cellCopied, setCellCopied] = useState(false);

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string; val: unknown } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<"sql" | "csv" | "json">("sql");
  const [exportContent, setExportContent] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  
  // Pending Transaction Edits keyed by Primary Key Value (or row key)
  const [editedCells, setEditedCells] = useState<{ [pkKey: string]: TableRowData }>({});
  const [newRows, setNewRows] = useState<TableRowData[]>([]);
  const [deletedRowKeys, setDeletedRowKeys] = useState<Set<string>>(new Set());
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{ pkKey: string; rowIdx: number; rowData: TableRowData } | null>(null);
  
  // Close export dropdown on outside click
  useEffect(() => {
    if (!isExportMenuOpen) return;
    const handleOutside = () => setIsExportMenuOpen(false);
    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, [isExportMenuOpen]);

  // Active Inline Editing Cell
  const [editingCell, setEditingCell] = useState<{ pkKey: string; isNew: boolean; nIdx?: number; colName: string; originalVal: unknown } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const isDateTimeColumn = (colType: string = ""): boolean => {
    const t = colType.toLowerCase();
    return t.includes("date") || t.includes("time") || t.includes("timestamp");
  };

  // Full Row Insert/Edit Modal State
  const [rowEditModal, setRowEditModal] = useState<{
    pkKey: string;
    rowIdx: number;
    isNew: boolean;
    data: TableRowData;
  } | null>(null);

  // Status message for transactions
  const [commitMsg, setCommitMsg] = useState<{ success: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset local transaction draft on table, database, or page/sort change
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    setNewRows([]);
    setEditedCells({});
    setDeletedRowKeys(new Set());
    setEditingCell(null);
    setRowEditModal(null);
    setConfirmDeleteRow(null);
    setCommitMsg(null);
  }, [tableName, activeDatabase, page, sortColumn, sortOrder, searchQuery, filtersKey]);

  // Handle ESC key to dismiss sub-modals (Inspector, Row Modal, Delete Confirm, Inline Edit)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDeleteRow) setConfirmDeleteRow(null);
        else if (rowEditModal) setRowEditModal(null);
        else if (selectedCell) setSelectedCell(null);
        else if (editingCell) setEditingCell(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeleteRow, rowEditModal, selectedCell, editingCell]);

  if (!activeProfile) {
    return (
      <div className="empty-state-panel">
        <div className="empty-state-card">
          <div className="empty-icon-wrap">
            <Server size={32} className="empty-icon" />
          </div>
          <h3 className="empty-title">No Database Connected</h3>
          <p className="empty-sub">
            Connect to a database server using the top bar to inspect schemas, run queries, and manage records.
          </p>
        </div>
        <style jsx>{`
          .empty-state-panel {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            width: 100%;
            background: var(--bg-content);
            padding: 32px;
            box-sizing: border-box;
          }
          .empty-state-card {
            max-width: 440px;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            background: var(--bg-card);
            border: 1px solid var(--border-light);
            border-radius: var(--radius-lg);
            padding: 40px 32px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
            gap: 12px;
          }
          .empty-icon-wrap {
            width: 68px;
            height: 68px;
            border-radius: var(--radius-md);
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent-blue);
            margin-bottom: 6px;
          }
          .empty-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-main);
            margin: 0;
          }
          .empty-sub {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.5;
            margin: 0;
          }
        `}</style>
      </div>
    );
  }

  if (!tableName) {
    return (
      <div className="empty-state-panel">
        <div className="empty-state-card">
          <div className="empty-icon-wrap">
            <Database size={32} className="empty-icon" />
          </div>
          <h3 className="empty-title">Select a Table to View Records</h3>
          <p className="empty-sub">
            Choose an existing table from the sidebar on the left to inspect records, or create a brand new table schema.
          </p>
          <div className="empty-actions">
            {onCreateTable && (
              <button
                className="btn btn-primary create-tbl-btn"
                onClick={onCreateTable}
                title="Create a new table in this database"
              >
                <Plus size={13} />
                <span>Create New Table</span>
              </button>
            )}
            <button
              className="btn btn-secondary refresh-btn"
              onClick={onRefresh}
              title="Refresh database tables"
            >
              <RefreshCw size={13} />
              <span>Refresh Explorer</span>
            </button>
          </div>
        </div>
        <style jsx>{`
          .empty-state-panel {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            width: 100%;
            background: var(--bg-content);
            padding: 32px;
            box-sizing: border-box;
          }
          .empty-state-card {
            max-width: 460px;
            width: 100%;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            background: var(--bg-card);
            border: 1px solid var(--border-light);
            border-radius: var(--radius-lg);
            padding: 40px 32px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08);
            gap: 14px;
          }
          .empty-icon-wrap {
            width: 68px;
            height: 68px;
            border-radius: var(--radius-md);
            background: rgba(59, 130, 246, 0.1);
            border: 1px solid rgba(59, 130, 246, 0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent-blue);
            margin-bottom: 6px;
          }
          .empty-title {
            font-size: 16px;
            font-weight: 700;
            color: var(--text-main);
            margin: 0;
          }
          .empty-sub {
            font-size: 13px;
            color: var(--text-muted);
            line-height: 1.5;
            margin: 0;
          }
          .empty-actions {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            margin-top: 8px;
            flex-wrap: wrap;
          }
          .create-tbl-btn {
            gap: 6px;
            padding: 0 16px;
            height: 32px;
            font-size: 12px;
            font-weight: 600;
          }
          .refresh-btn {
            gap: 6px;
            padding: 0 14px;
            height: 32px;
            font-size: 12px;
          }
        `}</style>
      </div>
    );
  }

  // Columns that identify a row: the real primary key when the table has one
  // (composite included), otherwise every column - the backend then refuses any
  // statement that would match zero or more than one row.
  const pkColumnNames = columns.filter((c) => c.primaryKey).map((c) => c.name);
  // Types that cannot be compared with a plain `=` literal are left out of the
  // no-primary-key fallback; the one-row guard still keeps the match honest.
  const isComparableType = (type: string) =>
    !/(json|bytea|blob|xml|geometry|geography|point|\[\])/.test((type || "").toLowerCase());
  const keyColumnNames =
    pkColumnNames.length > 0 ? pkColumnNames : columns.filter((c) => isComparableType(c.type)).map((c) => c.name);
  const pkColName = pkColumnNames[0] || (columns[0] ? columns[0].name : "id");

  // Original database values of the key columns - what the WHERE clause is built from.
  const getRowKeys = (row: TableRowData): TableRowData => {
    const keys: TableRowData = {};
    keyColumnNames.forEach((name) => {
      keys[name] = row[name] === undefined ? null : row[name];
    });
    return keys;
  };

  // Client-side identity for pending edits only; never sent to the database.
  const getRowKey = (row: TableRowData, fallbackIdx: number): string => {
    if (keyColumnNames.length === 0) return `row_${fallbackIdx}`;
    return JSON.stringify(keyColumnNames.map((name) => (row[name] === undefined ? null : row[name])));
  };

  // Calculate pending changes count
  const numUpdates = Object.keys(editedCells).length;
  const numInserts = newRows.length;
  const numDeletes = deletedRowKeys.size;
  const totalPending = numUpdates + numInserts + numDeletes;

  // Handle Cell Double Click to start inline editing
  const startEditing = (pkKey: string, isNew: boolean, nIdx: number | undefined, colName: string, currentVal: unknown) => {
    setEditingCell({ pkKey, isNew, nIdx, colName, originalVal: currentVal });
    setEditValue(currentVal === null || currentVal === undefined || currentVal === "__AUTO__" ? "" : String(currentVal));
  };

  // Save inline cell edit
  const saveCellEdit = () => {
    if (!editingCell) return;
    const { pkKey, isNew, nIdx, colName, originalVal } = editingCell;

    // A NULL cell is shown as an empty box; leaving it empty must keep it NULL
    // rather than writing an empty string over it.
    const wasNullAndStillEmpty = originalVal === null && editValue === "";
    const value = wasNullAndStillEmpty ? null : coerceCellValue(columns.find((c) => c.name === colName), editValue);

    if (!isNew && value === originalVal) {
      // Nothing actually changed - don't queue a pending update for it.
      setEditingCell(null);
      return;
    }

    if (isNew && nIdx !== undefined) {
      setNewRows((prev) => {
        const updated = [...prev];
        updated[nIdx] = { ...updated[nIdx], [colName]: value };
        return updated;
      });
    } else {
      setEditedCells((prev) => ({
        ...prev,
        [pkKey]: {
          ...(prev[pkKey] || {}),
          [colName]: value,
        },
      }));
    }
    setEditingCell(null);
  };

  // Open Full Row Edit Modal
  const openRowModal = (rowIdx: number, row: TableRowData, isNew?: boolean) => {
    const pkKey = isNew ? `new_${rowIdx}` : getRowKey(row, rowIdx);
    const currentEdits = isNew ? {} : (editedCells[pkKey] || {});
    const merged = { ...row, ...currentEdits };
    setRowEditModal({ pkKey, rowIdx, isNew: !!isNew, data: merged });
  };

  // Save Full Row Modal Edits
  const saveRowModal = () => {
    if (!rowEditModal) return;
    const { pkKey, rowIdx, isNew, data } = rowEditModal;

    if (isNew) {
      setNewRows((prev) => {
        const updated = [...prev];
        updated[rowIdx] = { ...data };
        return updated;
      });
    } else {
      const originalRow = rows[rowIdx] || {};
      const changesObj: TableRowData = {};
      columns.forEach((col) => {
        const newVal = coerceCellValue(col, data[col.name]);
        const oldVal = originalRow[col.name];
        if (newVal !== oldVal) {
          changesObj[col.name] = newVal;
        }
      });

      if (Object.keys(changesObj).length > 0) {
        setEditedCells((prev) => ({
          ...prev,
          [pkKey]: {
            ...(prev[pkKey] || {}),
            ...changesObj,
          },
        }));
      }
    }
    setRowEditModal(null);
  };

  // Add new pending row
  const handleAddRow = () => {
    const blank: TableRowData = {};
    columns.forEach((c) => {
      if (c.autoIncrement || (c.primaryKey && c.type.toLowerCase().includes("int"))) {
        blank[c.name] = "__AUTO__";
      } else {
        blank[c.name] = "";
      }
    });
    setNewRows((prev) => [...prev, blank]);
  };

  // Request mark row for deletion (triggers confirmation modal)
  const handleRequestDeleteRow = (pkKey: string, rowIdx: number, rowData: TableRowData) => {
    if (deletedRowKeys.has(pkKey)) {
      // If already marked, unmark directly (restore)
      setDeletedRowKeys((prev) => {
        const next = new Set(prev);
        next.delete(pkKey);
        return next;
      });
    } else {
      // Show confirmation dialog before marking row red
      setConfirmDeleteRow({ pkKey, rowIdx, rowData });
    }
  };

  // Confirm marking row for deletion
  const handleConfirmMarkDelete = () => {
    if (!confirmDeleteRow) return;
    const { pkKey } = confirmDeleteRow;
    setDeletedRowKeys((prev) => {
      const next = new Set(prev);
      next.add(pkKey);
      return next;
    });
    setConfirmDeleteRow(null);
  };

  // Direct toggle mark row for deletion
  const toggleDeleteRow = (pkKey: string) => {
    setDeletedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pkKey)) {
        next.delete(pkKey);
      } else {
        next.add(pkKey);
      }
      return next;
    });
  };

  // Rollback all pending changes
  const handleRollback = () => {
    setEditedCells({});
    setNewRows([]);
    setDeletedRowKeys(new Set());
    setConfirmDeleteRow(null);
    setEditingCell(null);
    setRowEditModal(null);
    setCommitMsg({ success: true, text: "All uncommitted changes rolled back" });
  };

  // Commit all pending changes to Database
  const handleCommit = async () => {
    if (totalPending === 0) return;
    setSubmitting(true);
    setCommitMsg(null);

    // Prepare inserts: omit __AUTO__ or undefined columns so DB creates auto-increment ID
    const insertsToSubmit = newRows.map((r) => {
      const cleanRow: TableRowData = {};
      columns.forEach((c) => {
        const val = r[c.name];
        if (val === "__AUTO__" || val === undefined) {
          // Omit column so DB generates auto-increment value
        } else if (val === null) {
          cleanRow[c.name] = null;
        } else if (val !== "") {
          cleanRow[c.name] = val;
        }
      });
      return cleanRow;
    }).filter((r) => Object.keys(r).length > 0 || columns.some((c) => c.autoIncrement || c.primaryKey));

    // Key values of every row currently loaded. Updates and deletes are addressed
    // by these original values - never by a row index or a stringified key.
    const keysByRowKey = new Map<string, TableRowData>();
    rows.forEach((row, idx) => keysByRowKey.set(getRowKey(row, idx), getRowKeys(row)));

    const updatesToSubmit: Array<{ keys: TableRowData; data: TableRowData }> = [];
    const deletesToSubmit: Array<{ keys: TableRowData }> = [];
    let stalePending = 0;

    Object.keys(editedCells).forEach((rowKey) => {
      const keys = keysByRowKey.get(rowKey);
      if (!keys) {
        stalePending += 1;
        return;
      }
      updatesToSubmit.push({ keys, data: editedCells[rowKey] });
    });

    deletedRowKeys.forEach((rowKey) => {
      const keys = keysByRowKey.get(rowKey);
      if (!keys) {
        stalePending += 1;
        return;
      }
      deletesToSubmit.push({ keys });
    });

    if (stalePending > 0) {
      setCommitMsg({
        success: false,
        text: `${stalePending} pending change(s) no longer match any loaded row. Refresh the table and edit again - nothing was committed.`,
      });
      setSubmitting(false);
      return;
    }

    try {
      const res = await onCommitChanges({
        inserts: insertsToSubmit,
        updates: updatesToSubmit,
        deletes: deletesToSubmit,
      });

      if (res.success) {
        const parts: string[] = [];
        if (insertsToSubmit.length > 0) parts.push(`${insertsToSubmit.length} inserted`);
        if (updatesToSubmit.length > 0) parts.push(`${updatesToSubmit.length} updated`);
        if (deletesToSubmit.length > 0) parts.push(`${deletesToSubmit.length} deleted`);
        const affected = typeof res.totalAffected === "number" ? res.totalAffected : null;
        setCommitMsg({
          success: true,
          text: `Committed: ${parts.join(", ")}${affected === null ? "" : ` (${affected} row${affected === 1 ? "" : "s"} affected in database)`}`,
        });

        setEditedCells({});
        setNewRows([]);
        setDeletedRowKeys(new Set());

        // Always re-read from the database. Patching rows locally used to hide a
        // commit that matched nothing until the user hit refresh themselves.
        onRefresh();
      } else {
        setCommitMsg({ success: false, text: res.error || "Commit failed, transaction rolled back" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCommitMsg({ success: false, text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // Active merged data for JSON view
  const activeMergedRows = rows
    .map((r, idx) => {
      const pkKey = getRowKey(r, idx);
      if (deletedRowKeys.has(pkKey)) return null;
      return { ...r, ...(editedCells[pkKey] || {}) };
    })
    .filter((r): r is TableRowData => r !== null);
  
  const allJsonRows = [...activeMergedRows, ...newRows];
  const formattedJson = jsonFormat === "pretty"
    ? JSON.stringify(allJsonRows, null, 2)
    : JSON.stringify(allJsonRows);

  const handleCopyJson = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyCell = (text: string) => {
    navigator.clipboard.writeText(text);
    setCellCopied(true);
    setTimeout(() => setCellCopied(false), 2000);
  };

  const handleDownloadJson = (filename?: string, content?: string) => {
    const dataToDownload = content || formattedJson;
    const name = filename || `${tableName || "data"}_page_${page + 1}.json`;
    const blob = new Blob([dataToDownload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFetchExport = async (type: "sql" | "csv" | "json") => {
    if (!activeProfile || !activeDatabase || !tableName) return;
    setExporting(true);
    setExportType(type);
    setExportModalOpen(true);
    if (type === "json") {
      setExportContent(JSON.stringify(allJsonRows, null, 2));
      setExporting(false);
      return;
    }
    try {
      const endpoint = type === "sql" ? "export-sql" : "export-csv";
      const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:5820/api";
      const res = await fetch(`${apiBase}/list/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          database: activeDatabase,
          table: tableName,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setExportContent(type === "sql" ? data.sql : data.csv);
      } else {
        setExportContent(`Failed to export ${type.toUpperCase()}`);
      }
    } catch {
      setExportContent("Export error");
    } finally {
      setExporting(false);
    }
  };

  const downloadExportFile = () => {
    const element = document.createElement("a");
    const mimeType = exportType === "json" ? "application/json" : "text/plain";
    const file = new Blob([exportContent], { type: mimeType });
    element.href = URL.createObjectURL(file);
    element.download = `${tableName}_export.${exportType}`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  // Filter Management Functions
  const addFilter = () => {
    if (!columns || columns.length === 0 || !onFiltersChange) return;
    const newFilter: ColumnFilter = {
      id: String(Date.now()),
      column: columns[0].name,
      operator: "equals",
      value: "",
    };
    onFiltersChange([...filters, newFilter]);
    onPageChange(0);
  };

  const updateFilter = (id: string, updated: Partial<ColumnFilter>) => {
    if (!onFiltersChange) return;
    const next = filters.map((f) => (f.id === id ? { ...f, ...updated } : f));
    onFiltersChange(next);
    onPageChange(0);
  };

  const removeFilter = (id: string) => {
    if (!onFiltersChange) return;
    const next = filters.filter((f) => f.id !== id);
    onFiltersChange(next);
    onPageChange(0);
  };

  const clearAllFilters = () => {
    if (onFiltersChange) onFiltersChange([]);
    if (onSearchChange) onSearchChange("");
    onPageChange(0);
  };

  const handleHeaderClick = (colName: string) => {
    if (!onSortChange) return;
    if (sortColumn !== colName) {
      onSortChange(colName, "ASC");
    } else if (sortOrder === "ASC") {
      onSortChange(colName, "DESC");
    } else {
      onSortChange(null, "ASC");
    }
    onPageChange(0);
  };

  const totalPages = Math.ceil(totalRows / pageSize) || 1;

  return (
    <div className="grid-pane">
      <div className="grid-bar">
        <div className="meta-group">
          <Table2 size={15} className="table-icon" />
          <h2 className="table-name-text">{tableName}</h2>
          <span className="count-pill">{totalRows.toLocaleString()} rows</span>

          {/* View Mode Segmented Control (Table vs JSON) */}
          <div className="view-mode-toggle">
            <button
              className={`view-toggle-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title="Table Grid View"
            >
              <Table2 size={12} />
              <span>Table</span>
            </button>
            <button
              className={`view-toggle-btn ${viewMode === "json" ? "active" : ""}`}
              onClick={() => setViewMode("json")}
              title="JSON View"
            >
              <Code2 size={12} />
              <span>JSON</span>
            </button>
          </div>
        </div>

        <div className="bar-actions">
          {viewMode === "json" ? (
            <div className="json-toolbar-group">
              <div className="json-format-toggle">
                <button
                  className={`btn btn-secondary btn-sm ${jsonFormat === "pretty" ? "active-format" : ""}`}
                  onClick={() => setJsonFormat("pretty")}
                  title="Pretty Format (Indented)"
                >
                  Pretty
                </button>
                <button
                  className={`btn btn-secondary btn-sm ${jsonFormat === "compact" ? "active-format" : ""}`}
                  onClick={() => setJsonFormat("compact")}
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

              <button
                className="btn btn-secondary"
                onClick={() => handleCopyJson(formattedJson)}
                title="Copy formatted JSON to clipboard"
              >
                {copied ? <Check size={12} className="copy-check-icon" /> : <Copy size={12} />}
                <span>{copied ? "Copied!" : "Copy JSON"}</span>
              </button>

              <button
                className="btn btn-secondary"
                onClick={() => handleDownloadJson()}
                title="Download JSON file"
              >
                <Download size={12} />
                <span>Download .json</span>
              </button>
            </div>
          ) : (
            <>
              <button
                className={`btn btn-secondary filter-toggle-btn ${filters.length > 0 ? "filter-active-btn" : ""}`}
                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
                title={isFilterPanelOpen ? "Close Filter Drawer" : "Open Filter Drawer (Add column filter rules)"}
              >
                <Filter size={13} />
                <span>Filter {filters.length > 0 ? `(${filters.length})` : ""}</span>
              </button>

              <button
                className="btn btn-secondary add-row-btn"
                onClick={handleAddRow}
                title="Add a new row draft to this table"
              >
                <Plus size={13} />
                <span>Add Row</span>
              </button>

              {/* Compact Export Dropdown */}
              <div className="export-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`btn btn-secondary ${isExportMenuOpen ? "export-btn-active" : ""}`}
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  title="Export table data (JSON, SQL, CSV)"
                >
                  <Download size={13} />
                  <span>Export</span>
                  <ChevronDown size={11} className={`export-chevron ${isExportMenuOpen ? "open" : ""}`} />
                </button>
                {isExportMenuOpen && (
                  <div className="export-dropdown-menu">
                    <button
                      className="export-menu-item"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleFetchExport("json");
                      }}
                      title="Export query results as JSON file"
                    >
                      <FileJson size={13} className="menu-icon json-icon" />
                      <span>Export JSON</span>
                    </button>
                    <button
                      className="export-menu-item"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleFetchExport("sql");
                      }}
                      title="Export query results as SQL INSERT statements"
                    >
                      <Download size={13} className="menu-icon sql-icon" />
                      <span>Export SQL</span>
                    </button>
                    <button
                      className="export-menu-item"
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleFetchExport("csv");
                      }}
                      title="Export query results as CSV spreadsheet"
                    >
                      <FileCode size={13} className="menu-icon csv-icon" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="search-wrap" title="Quick text search across visible data">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              className="input search-input"
              placeholder="Search table..."
              value={searchQuery}
              title="Search table across loaded records"
              onChange={(e) => {
                if (onSearchChange) onSearchChange(e.target.value);
                onPageChange(0);
              }}
            />
          </div>
          <button
            className="btn btn-secondary refresh-table-btn"
            onClick={onRefresh}
            disabled={loading}
            title="Reload table records from database"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Drawer Panel */}
      {isFilterPanelOpen && (
        <div className="filter-drawer">
          <div className="filter-drawer-header">
            <div className="filter-drawer-title">
              <Filter size={14} className="filter-icon" />
              <span>Filter Rules</span>
              {filters.length > 0 && <span className="filter-count-badge">{filters.length} active</span>}
            </div>
            <div className="filter-drawer-actions">
              <button
                className="btn btn-secondary filter-action-btn"
                onClick={addFilter}
                title="Add a new filter condition"
              >
                <Plus size={13} />
                <span>Add Filter Rule</span>
              </button>
              {filters.length > 0 && (
                <button
                  className="btn btn-secondary filter-clear-btn"
                  onClick={clearAllFilters}
                  title="Remove all filter conditions"
                >
                  <Trash2 size={12} />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          {filters.length === 0 ? (
            <div className="empty-filters-msg">
              <span>No active filter rules. Click <strong>&quot;Add Filter Rule&quot;</strong> to filter rows by column values.</span>
            </div>
          ) : (
            <div className="filter-list">
              {filters.map((f, idx) => (
                <div key={f.id} className="filter-row">
                  <span className="filter-row-num" title={`Filter rule #${idx + 1}`}>{idx + 1}</span>
                  <select
                    className="select select-column font-mono"
                    value={f.column}
                    onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                    title="Select column to filter"
                  >
                    {columns.map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name} ({c.type})
                      </option>
                    ))}
                  </select>

                  <select
                    className="select select-operator"
                    value={f.operator}
                    onChange={(e) => updateFilter(f.id, { operator: e.target.value as FilterOperator })}
                    title="Select comparison operator"
                  >
                    <option value="equals">= Equals</option>
                    <option value="contains">Contains (LIKE %val%)</option>
                    <option value="startsWith">Starts with (LIKE val%)</option>
                    <option value="endsWith">Ends with (LIKE %val)</option>
                    <option value="gt">&gt; Greater than</option>
                    <option value="gte">&gt;= Greater or equal</option>
                    <option value="lt">&lt; Less than</option>
                    <option value="lte">&lt; Less or equal</option>
                    <option value="neq">!= Not equal</option>
                    <option value="isNull">IS NULL</option>
                    <option value="isNotNull">IS NOT NULL</option>
                  </select>

                  {f.operator === "isNull" || f.operator === "isNotNull" ? (
                    <div className="filter-null-placeholder" title="No value needed for NULL checks">
                      <span>(No value required)</span>
                    </div>
                  ) : (
                    <input
                      className="input filter-val-input font-mono"
                      placeholder="Filter value..."
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      title="Enter value to compare against"
                    />
                  )}

                  <button
                    className="btn btn-icon delete-filter-btn"
                    onClick={() => removeFilter(f.id)}
                    title="Remove this filter rule"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
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
              Uncommitted Changes ({totalPending}): {numInserts > 0 && `${numInserts} new, `}
              {numUpdates > 0 && `${numUpdates} edited, `}
              {numDeletes > 0 && (
                <strong className="tx-delete-highlight">
                  <Trash2 size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
                  {numDeletes} marked for deletion (Click Commit Changes to delete from database)
                </strong>
              )}
            </span>
          </div>

          <div className="tx-actions">
            <button className="btn btn-secondary" onClick={handleRollback} disabled={submitting}>
              <RotateCcw size={12} />
              <span>Rollback</span>
            </button>
            <button className="btn btn-primary btn-commit-action" onClick={handleCommit} disabled={submitting}>
              <Check size={12} />
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

      <div className="grid-table-area">
        {loading ? (
          <div className="grid-state-msg">Loading records...</div>
        ) : viewMode === "json" ? (
          <div className="json-view-wrapper">
            <Editor
              height="100%"
              language="json"
              theme={theme === "dark" ? "vs-dark" : "light"}
              value={formattedJson}
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
                padding: { top: 10, bottom: 10 },
                renderLineHighlight: "all",
                smoothScrolling: true,
              }}
            />
          </div>
        ) : (
          <table className="pro-table">
            <thead>
              <tr>
                <th className="num-col">#</th>
                <th className="action-col">Act</th>
                {columns.map((col) => {
                  const isSorted = sortColumn === col.name;
                  return (
                    <th
                      key={col.name}
                      className={`col-hdr ${isSorted ? "sorted-hdr" : ""}`}
                      onClick={() => handleHeaderClick(col.name)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      title="Click to toggle order by"
                    >
                      <div className="hdr-flex">
                        {col.primaryKey && (
                          <span title="Primary Key">
                            <Key size={11} className="pk-icon" />
                          </span>
                        )}
                        <span className="col-title">{col.name}</span>
                        <span className="col-type-tag">{col.type}</span>
                        <span className="sort-icon-badge">
                          {isSorted ? (
                            sortOrder === "ASC" ? (
                              <ArrowUp size={11} className="active-sort-icon" />
                            ) : (
                              <ArrowDown size={11} className="active-sort-icon" />
                            )
                          ) : (
                            <ArrowUpDown size={10} className="inactive-sort-icon" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* New Uncommitted Rows */}
              {newRows.map((nRow, nIdx) => (
                <tr key={`new-${nIdx}`} className="new-row-tr">
                  <td className="row-index new-idx">+</td>
                  <td className="action-cell">
                    <div className="act-group">
                      <button
                        className="icon-edit-btn"
                        onClick={() => openRowModal(nIdx, nRow, true)}
                        title="Edit Full New Record"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        className="icon-del-btn"
                        onClick={() => setNewRows((prev) => prev.filter((_, i) => i !== nIdx))}
                        title="Remove new row draft"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                  {columns.map((col) => {
                    const isEditing = editingCell?.isNew && editingCell.nIdx === nIdx && editingCell.colName === col.name;
                    const val = nRow[col.name];
                    const isAuto = val === "__AUTO__";

                    return (
                      <td
                        key={col.name}
                        className={`cell-data cell-new ${isAuto ? "cell-auto" : ""}`}
                        onDoubleClick={() => startEditing(`new_${nIdx}`, true, nIdx, col.name, val)}
                        title={isAuto ? "Auto Increment: Double-click to type custom value" : "Double-click to edit cell"}
                      >
                        {isEditing ? (
                          <input
                            autoFocus
                            className="input cell-edit-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveCellEdit}
                            onKeyDown={(e) => e.key === "Enter" && saveCellEdit()}
                          />
                        ) : isAuto ? (
                          <span className="auto-inc-pill-tag">
                            <Zap size={10} /> AUTO
                          </span>
                        ) : val !== undefined && val !== null && val !== "" ? (
                          String(val)
                        ) : (
                          <span className="placeholder-text">Click to edit</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Existing Database Rows */}
              {rows.length === 0 && newRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length + 2, 3)} className="empty-cell">
                    {errorMessage ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: "var(--accent-red, #ef4444)" }}>
                        <AlertCircle size={22} />
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>Database Query Error</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "480px" }}>{errorMessage}</span>
                        <button className="btn btn-secondary btn-sm" onClick={onRefresh} style={{ marginTop: "4px" }}>
                          <RefreshCw size={11} />
                          <span>Retry</span>
                        </button>
                      </div>
                    ) : (
                      "No matching records found"
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const pkKey = getRowKey(row, idx);
                  const isDeleted = deletedRowKeys.has(pkKey);
                  const rowEdits = editedCells[pkKey] || {};
                  const isRowEdited = Object.keys(rowEdits).length > 0;

                  return (
                    <tr key={pkKey} className={`${isDeleted ? "row-deleted" : ""} ${isRowEdited ? "row-edited" : ""}`}>
                      <td className="row-index">{page * pageSize + idx + 1}</td>
                      <td className="action-cell">
                        <div className="act-group">
                          <button
                            className="icon-edit-btn"
                            onClick={() => openRowModal(idx, row, false)}
                            title="Edit Entire Row Modal"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            className="icon-edit-btn"
                            onClick={() => setSelectedCell({ row: idx, col: pkColName, val: row })}
                            title="Inspect Full Row Data"
                          >
                            <FileText size={11} />
                          </button>
                          <button
                            className={`icon-del-btn ${isDeleted ? "active is-deleted" : ""}`}
                            onClick={() => handleRequestDeleteRow(pkKey, idx, row)}
                            title={isDeleted ? "Restore Row" : "Mark Row for Delete"}
                          >
                            <Trash2 size={11} />
                          </button>
                          {isDeleted && (
                            <button
                              className="icon-restore-btn"
                              onClick={() => toggleDeleteRow(pkKey)}
                              title="Restore Row"
                            >
                              <RotateCcw size={10} />
                            </button>
                          )}
                        </div>
                      </td>
                      {columns.map((col) => {
                        const isEdited = rowEdits.hasOwnProperty(col.name);
                        const val = isEdited ? rowEdits[col.name] : row[col.name];
                        const isNull = val === null || val === undefined;
                        const isEditing = !editingCell?.isNew && editingCell?.pkKey === pkKey && editingCell.colName === col.name;
                        const isDateCol = isDateTimeColumn(col.type);

                        return (
                          <td
                            key={col.name}
                            className={`cell-data ${isNull ? "cell-null" : ""} ${isEdited ? "cell-modified" : ""}`}
                            onDoubleClick={() => startEditing(pkKey, false, undefined, col.name, val)}
                            title="Double-click to edit cell"
                          >
                            {isEditing ? (
                              <div className="input-with-picker inline-edit-wrap">
                                <input
                                  autoFocus
                                  type={isDateCol ? (col.type.toLowerCase().includes("timestamp") || col.type.toLowerCase().includes("datetime") ? "datetime-local" : "date") : "text"}
                                  className="input cell-edit-input"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => saveCellEdit()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCellEdit();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                />
                              </div>
                            ) : isNull ? (
                              <span className="null-tag">NULL</span>
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
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid-footer">
        <span className="pagination-info font-mono">
          Page {page + 1} / {totalPages} ({rows.length} records shown)
        </span>

        <div className="page-nav-btns">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(Math.max(0, page - 1))}
            disabled={page === 0}
            title={page === 0 ? "Already on first page" : `Go to page ${page}`}
          >
            <ChevronLeft size={12} />
            <span>Prev</span>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={(page + 1) * pageSize >= totalRows}
            title={(page + 1) * pageSize >= totalRows ? "Already on last page" : `Go to page ${page + 2}`}
          >
            <span>Next</span>
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Row Edit / Insert Record Modal */}
      {rowEditModal && (
        <div className="row-dialog-overlay" onClick={() => setRowEditModal(null)}>
          <div className="row-dialog-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Titlebar */}
            <div className="row-dialog-header">
              <div className="dialog-header-left">
                <div className="dialog-icon-badge">
                  <Edit3 size={15} />
                </div>
                <div className="dialog-title-group">
                  <span className="dialog-title-text">
                    {rowEditModal.isNew ? "Insert New Record" : `Edit Record #${page * pageSize + rowEditModal.rowIdx + 1}`}
                  </span>
                  <span className="dialog-sub-text">
                    Table: <code className="table-code-tag">{tableName}</code>
                  </span>
                </div>
              </div>
              <button className="dialog-close-btn" onClick={() => setRowEditModal(null)} title="Close (Esc)">
                <X size={15} />
              </button>
            </div>

            {/* Modal Body - Scrollable Fields Grid */}
            <div className="row-dialog-body">
              {columns.map((col) => {
                const val = rowEditModal.data[col.name];
                const isAuto = val === "__AUTO__" || (rowEditModal.isNew && (col.autoIncrement || (col.primaryKey && col.type.toLowerCase().includes("int"))) && val === "__AUTO__");
                const isNull = val === null;
                const isDateCol = isDateTimeColumn(col.type);
                const isBoolCol = col.type.toLowerCase().includes("bool") || col.type.toLowerCase() === "tinyint(1)";
                const isLongText = col.type.toLowerCase().includes("text") || col.type.toLowerCase().includes("json");

                return (
                  <div key={col.name} className={`field-record-card ${col.primaryKey ? "is-pk-record" : ""}`}>
                    <div className="field-card-top">
                      <div className="field-meta-left">
                        <span className="field-name-title font-mono">{col.name}</span>
                        <span className="field-type-badge font-mono">{col.type}</span>
                        {col.primaryKey && (
                          <span className="field-pk-badge">
                            <Key size={10} /> PK
                          </span>
                        )}
                        {col.autoIncrement && (
                          <span className="field-auto-badge">
                            <Zap size={10} /> Auto-Increment
                          </span>
                        )}
                      </div>

                      <div className="field-toggles-right">
                        {(col.autoIncrement || (rowEditModal.isNew && col.primaryKey)) && (
                          <button
                            type="button"
                            className={`toggle-chip-btn auto-chip ${isAuto ? "active" : ""}`}
                            onClick={() => {
                              setRowEditModal({
                                ...rowEditModal,
                                data: {
                                  ...rowEditModal.data,
                                  [col.name]: isAuto ? "" : "__AUTO__",
                                },
                              });
                            }}
                            title="Toggle Auto-Generated / Auto-Increment"
                          >
                            <Zap size={10} />
                            <span>AUTO</span>
                          </button>
                        )}

                        {col.nullable && (
                          <button
                            type="button"
                            className={`toggle-chip-btn null-chip ${isNull ? "active" : ""}`}
                            onClick={() => {
                              setRowEditModal({
                                ...rowEditModal,
                                data: {
                                  ...rowEditModal.data,
                                  [col.name]: isNull ? "" : null,
                                },
                              });
                            }}
                            title="Toggle NULL value"
                          >
                            <span>NULL</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="field-card-control">
                      {isAuto ? (
                        <div
                          className="auto-state-box"
                          onClick={() => {
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: "" },
                            });
                          }}
                          title="Click to switch to custom value"
                        >
                          <Zap size={13} className="auto-state-icon" />
                          <span className="auto-state-text">AUTO (Generated by Database on save)</span>
                          <span className="auto-switch-hint">Click to edit manually</span>
                        </div>
                      ) : isNull ? (
                        <div
                          className="null-state-box"
                          onClick={() => {
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: "" },
                            });
                          }}
                          title="Click to enter custom value"
                        >
                          <span className="null-state-badge">NULL</span>
                          <span className="null-state-text">Value is NULL</span>
                          <span className="null-switch-hint">Click to type value</span>
                        </div>
                      ) : isDateCol ? (
                        <input
                          type={col.type.toLowerCase().includes("timestamp") || col.type.toLowerCase().includes("datetime") ? "datetime-local" : "date"}
                          className="input form-input font-mono"
                          value={val === null || val === undefined ? "" : String(val)}
                          onChange={(e) =>
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: e.target.value },
                            })
                          }
                        />
                      ) : isBoolCol ? (
                        <select
                          className="select form-select font-mono"
                          value={String(val)}
                          onChange={(e) =>
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: e.target.value === "true" || e.target.value === "1" },
                            })
                          }
                        >
                          <option value="true">true (1)</option>
                          <option value="false">false (0)</option>
                        </select>
                      ) : isLongText ? (
                        <textarea
                          rows={3}
                          className="input form-textarea font-mono"
                          value={val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val, null, 2) : String(val)}
                          onChange={(e) =>
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: e.target.value },
                            })
                          }
                        />
                      ) : (
                        <input
                          className="input form-input font-mono"
                          value={val === null || val === undefined ? "" : String(val)}
                          onChange={(e) =>
                            setRowEditModal({
                              ...rowEditModal,
                              data: { ...rowEditModal.data, [col.name]: e.target.value },
                            })
                          }
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="row-dialog-footer">
              <button className="btn btn-secondary" onClick={() => setRowEditModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary apply-dialog-btn" onClick={saveRowModal}>
                <Check size={13} />
                <span>{rowEditModal.isNew ? "Add Row to Batch" : "Apply to Row"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single Cell Inspect Modal */}
      {selectedCell && (
        <div className="cell-overlay" onClick={() => setSelectedCell(null)}>
          <div className="cell-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-hdr">
              <div className="hdr-left">
                <FileText size={14} className="edit-icon" />
                <span>Inspect Value: {selectedCell.col}</span>
              </div>
              <button className="icon-close-btn" onClick={() => setSelectedCell(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="row-modal-body">
              <textarea
                readOnly
                className="textarea cell-mono-text font-mono"
                value={
                  selectedCell.val === null
                    ? "NULL"
                    : typeof selectedCell.val === "object"
                    ? JSON.stringify(selectedCell.val, null, 2)
                    : String(selectedCell.val)
                }
              />
            </div>

            <div className="cell-card-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedCell(null)}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const text =
                    selectedCell.val === null
                      ? "NULL"
                      : typeof selectedCell.val === "object"
                      ? JSON.stringify(selectedCell.val, null, 2)
                      : String(selectedCell.val);
                  handleCopyCell(text);
                }}
              >
                {cellCopied ? <Check size={12} /> : <Copy size={12} />}
                <span>{cellCopied ? "Copied!" : "Copy Value"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Table Modal */}
      {exportModalOpen && (
        <div className="cell-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="cell-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-hdr">
              <div className="hdr-left">
                <Download size={14} className="edit-icon" />
                <span>Export Table: {tableName} ({exportType.toUpperCase()})</span>
              </div>
              <button className="icon-close-btn" onClick={() => setExportModalOpen(false)}>
                <X size={14} />
              </button>
            </div>

            <div className="row-modal-body">
              {exporting ? (
                <div className="grid-state-msg">Generating export content...</div>
              ) : (
                <textarea
                  readOnly
                  className="textarea cell-mono-text font-mono"
                  style={{ height: "300px" }}
                  value={exportContent}
                />
              )}
            </div>

            <div className="cell-card-footer">
              <button className="btn btn-secondary" onClick={() => setExportModalOpen(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={downloadExportFile} disabled={exporting || !exportContent}>
                <Download size={12} />
                <span>Download File (.{exportType})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Mark Row Delete Modal Dialog */}
      {confirmDeleteRow && (
        <div className="cell-overlay" onClick={() => setConfirmDeleteRow(null)}>
          <div className="cell-card delete-confirm-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-hdr danger-hdr">
              <div className="hdr-left">
                <AlertCircle size={15} className="danger-icon" />
                <span>Confirm Deletion</span>
              </div>
              <button className="icon-close-btn" onClick={() => setConfirmDeleteRow(null)}>
                <X size={14} />
              </button>
            </div>
            <div className="delete-modal-content">
              <p className="delete-modal-notice">
                Mark row <strong>#{page * pageSize + confirmDeleteRow.rowIdx + 1}</strong> for deletion?
              </p>
            </div>
            <div className="cell-actions delete-modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteRow(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmMarkDelete}>
                <Trash2 size={12} />
                <span>Confirm</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .grid-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
        }

        .grid-bar {
          padding: 10px 16px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .meta-group {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .table-icon { color: var(--text-muted); }
        .table-name-text {
          font-size: 13px;
          font-weight: 600;
          letter-spacing: -0.2px;
        }
        .count-pill {
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1.5px 6px;
          border-radius: 4px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          border: 1px solid var(--border-light);
        }

        /* View Mode Segmented Switch */
        .view-mode-toggle {
          display: inline-flex;
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: 5px;
          border: 1px solid var(--border-light);
          gap: 2px;
          margin-left: 2px;
        }
        .view-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-muted);
          padding: 2px 7px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .view-toggle-btn:hover {
          color: var(--text-main);
        }
        .view-toggle-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          border-color: var(--border-light);
          box-shadow: var(--shadow-sm);
        }

        .bar-actions {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: nowrap;
        }

        /* Export Dropdown */
        .export-dropdown-wrap {
          position: relative;
        }
        .export-btn-active {
          border-color: var(--border-medium) !important;
          background: var(--bg-hover) !important;
        }
        .export-chevron {
          transition: transform 0.15s ease;
          color: var(--text-muted);
        }
        .export-chevron.open {
          transform: rotate(180deg);
        }
        .export-dropdown-menu {
          position: absolute;
          right: 0;
          top: calc(100% + 5px);
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-sm);
          padding: 4px;
          box-shadow: var(--shadow-popup);
          z-index: 120;
          min-width: 150px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .export-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border: none;
          background: transparent;
          color: var(--text-main);
          font-size: 11px;
          font-weight: 500;
          border-radius: 4px;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.12s ease;
        }
        .export-menu-item:hover {
          background: var(--bg-hover);
        }
        .menu-icon { flex-shrink: 0; color: var(--text-muted); }
        
        .json-toolbar-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .json-format-toggle {
          display: inline-flex;
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: 5px;
          border: 1px solid var(--border-light);
          gap: 2px;
        }
        .active-format {
          background: var(--bg-card) !important;
          color: var(--text-main) !important;
          border-color: var(--border-light) !important;
          font-weight: 600;
        }
        .copy-check-icon {
          color: var(--accent-green);
        }

        .search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }
        .search-icon {
          position: absolute;
          left: 8px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .search-input {
          padding-left: 26px;
          width: 160px;
          height: 26px;
          font-size: 11px;
          border-radius: var(--radius-sm);
        }

        .transaction-bar {
          padding: 6px 14px;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11.5px;
        }
        .tx-info {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--text-main);
          font-weight: 500;
        }
        .tx-actions { display: flex; gap: 6px; }

        .status-bar-msg {
          padding: 6px 14px;
          font-size: 11.5px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .status-bar-msg.success { background: var(--bg-tertiary); color: var(--accent-green); border-bottom: 1px solid var(--border-light); }
        .status-bar-msg.error { background: rgba(239, 68, 68, 0.08); color: #f87171; border-bottom: 1px solid rgba(239, 68, 68, 0.2); }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .grid-table-area {
          flex: 1;
          overflow: auto;
          position: relative;
        }

        .json-view-wrapper {
          width: 100%;
          height: 100%;
          background: var(--bg-content);
          position: relative;
        }

        .pro-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .pro-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          color: var(--text-sub);
          text-align: left;
          padding: 7px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          z-index: 10;
          font-weight: 600;
        }

        .hdr-flex {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 18px;
        }
        .pk-icon { color: var(--text-muted); flex-shrink: 0; }
        .col-title {
          font-weight: 500;
          color: var(--text-main);
          font-size: 11.5px;
        }
        .col-type-tag {
          font-size: 9px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          background: var(--bg-card);
          padding: 1px 4px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          white-space: nowrap;
        }

        .num-col { width: 44px; min-width: 44px; text-align: center; }
        .action-col { width: 80px; min-width: 80px; text-align: center; }

        .row-index {
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          border-bottom: 1px solid var(--border-light);
          font-size: 10.5px;
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          padding: 6px 4px;
        }
        .new-idx { color: var(--accent-green); font-weight: 600; }

        .action-cell {
          text-align: center;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          padding: 4px 6px;
        }
        .act-group {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }

        .icon-edit-btn, .icon-del-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
          transition: all 0.12s ease;
        }
        .icon-edit-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .icon-del-btn:hover, .icon-del-btn.active {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.1);
        }
        .icon-del-btn.is-deleted {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.15);
        }

        .icon-restore-btn {
          background: var(--bg-tertiary);
          color: var(--text-main);
          border: 1px solid var(--border-light);
          border-radius: 3px;
          padding: 2px 5px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .icon-restore-btn:hover {
          background: var(--bg-hover);
          border-color: var(--border-medium);
        }

        .transaction-bar.has-deletions {
          border-left: 3px solid rgba(239, 68, 68, 0.6);
        }
        .tx-delete-highlight {
          color: #f87171;
          font-weight: 600;
        }

        .pro-table td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          white-space: nowrap;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11.5px;
          line-height: 1.4;
        }

        .pro-table tr:hover td {
          background: var(--bg-hover);
        }

        .null-tag {
          display: inline-block;
          font-size: 9.5px;
          font-style: italic;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 0.5px 4px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          opacity: 0.8;
        }

        .row-deleted td {
          background: rgba(239, 68, 68, 0.08) !important;
          color: #fca5a5 !important;
          text-decoration: line-through;
          border-bottom: 1px solid rgba(239, 68, 68, 0.2) !important;
        }
        .row-deleted:hover td {
          background: rgba(239, 68, 68, 0.14) !important;
        }

        .delete-confirm-card {
          width: 440px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: var(--shadow-popup);
        }
        .danger-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--text-main);
          font-weight: 600;
          font-size: 13px;
        }
        .danger-hdr .hdr-left {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .danger-icon { color: var(--accent-red); }
        .delete-modal-content {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .delete-modal-notice {
          font-size: 12px;
          color: var(--text-main);
          line-height: 1.4;
        }
        .delete-preview-box {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          max-height: 120px;
          overflow-y: auto;
          font-size: 11px;
        }
        .preview-item {
          display: flex;
          gap: 6px;
          align-items: center;
        }
        .preview-col {
          color: var(--text-muted);
          font-weight: 600;
        }
        .preview-val {
          color: var(--text-main);
        }
        .delete-step-hint {
          font-size: 11px;
          color: var(--text-sub);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 6px 10px;
          display: flex;
          gap: 6px;
          line-height: 1.4;
        }
        .step-badge {
          color: var(--text-main);
          font-weight: 600;
          flex-shrink: 0;
        }
        .delete-modal-actions {
          margin-top: 4px;
        }

        .cell-data { cursor: pointer; }
        .cell-null { color: var(--text-muted); font-style: italic; }
        .cell-modified {
          background: rgba(245, 158, 11, 0.08) !important;
          outline: 1px dashed rgba(245, 158, 11, 0.4);
        }
        .cell-new {
          background: rgba(16, 185, 129, 0.08) !important;
        }
        .cell-auto {
          background: rgba(255, 255, 255, 0.02) !important;
        }

        .auto-inc-pill-tag {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          font-size: 9px;
          font-family: var(--font-mono);
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 3px;
          letter-spacing: 0.2px;
        }

        .placeholder-text { color: var(--text-muted); font-style: italic; }
        .cell-edit-input {
          width: 100%;
          padding: 2px 4px;
          font-size: 11px;
        }

        .grid-state-msg, .empty-cell {
          padding: 32px;
          text-align: center;
          color: var(--text-muted);
        }

        .grid-footer {
          padding: 6px 14px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
        }

        .pagination-info { color: var(--text-muted); }
        .page-nav-btns { display: flex; gap: 4px; }

        /* Cell Inspect Modal */
        .cell-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }
        .cell-card {
          width: 480px;
          background: var(--bg-card);
          padding: 16px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-medium);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .cell-card-hdr {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cell-card-hdr .hdr-left {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          font-size: 13px;
          color: var(--text-main);
        }
        .cell-mono-text {
          width: 100%;
          height: 180px;
          font-size: 11.5px;
          border-radius: 6px;
          padding: 8px 10px;
          background: var(--bg-app);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          resize: vertical;
        }
        .cell-card-footer {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }

        /* Full Row Edit / Insert Record Dialog */
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
          animation: modalAppear 0.14s cubic-bezier(0.16, 1, 0.3, 1);
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
        .table-code-tag {
          font-family: var(--font-mono);
          font-weight: 500;
          color: var(--text-sub);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 1px 4px;
          border-radius: 3px;
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
          transition: border-color 0.12s ease;
        }
        .field-record-card:hover {
          border-color: var(--border-medium);
        }
        .field-record-card.is-pk-record {
          border-left: 2px solid var(--border-focus);
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
        .field-auto-badge {
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
          font-weight: 500;
          padding: 1px 6px;
          border-radius: 3px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          transition: all 0.12s ease;
        }
        .toggle-chip-btn:hover {
          color: var(--text-main);
          border-color: var(--border-medium);
        }
        .toggle-chip-btn.auto-chip.active {
          background: var(--bg-card);
          border-color: var(--border-focus);
          color: var(--text-main);
          font-weight: 600;
        }
        .toggle-chip-btn.null-chip.active {
          background: var(--bg-card);
          border-color: var(--border-focus);
          color: var(--text-muted);
          font-weight: 600;
        }

        .field-card-control {
          display: flex;
          width: 100%;
        }
        .form-input, .form-select {
          width: 100%;
          height: 30px;
          font-size: 11.5px;
          border-radius: var(--radius-sm);
        }
        .form-textarea {
          width: 100%;
          font-size: 11.5px;
          border-radius: var(--radius-sm);
          padding: 6px 8px;
          resize: vertical;
        }

        .auto-state-box, .null-state-box {
          width: 100%;
          height: 30px;
          border-radius: var(--radius-sm);
          padding: 0 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          cursor: pointer;
          user-select: none;
          background: var(--bg-tertiary);
          border: 1px dashed var(--border-medium);
          transition: all 0.12s ease;
        }
        .auto-state-box:hover, .null-state-box:hover {
          background: var(--bg-hover);
        }
        .auto-state-icon { flex-shrink: 0; margin-right: 6px; color: var(--text-muted); }
        .auto-state-text {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-sub);
          flex: 1;
        }
        .auto-switch-hint, .null-switch-hint {
          font-size: 10px;
          color: var(--text-muted);
        }

        .null-state-badge {
          font-size: 9px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 0.5px 4px;
          border-radius: 3px;
          margin-right: 6px;
        }
        .null-state-text {
          font-size: 11px;
          color: var(--text-muted);
          flex: 1;
        }

        .row-dialog-footer {
          padding: 10px 18px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        .apply-dialog-btn {
          gap: 5px;
          padding: 0 14px;
          height: 28px;
          font-size: 11.5px;
          font-weight: 600;
        }

        .filter-active-btn {
          background: var(--bg-card) !important;
          color: var(--text-main) !important;
          border-color: var(--border-medium) !important;
        }

        .filter-drawer {
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 12px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          animation: filterSlide 0.15s ease;
        }
        @keyframes filterSlide {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .filter-drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .filter-drawer-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-main);
        }
        .filter-count-badge {
          font-size: 10px;
          padding: 1px 7px;
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: var(--radius-full);
          font-weight: 600;
        }
        .filter-icon { color: var(--accent-blue); }
        .filter-drawer-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .filter-action-btn {
          padding: 5px 12px;
          font-size: 11.5px;
          font-weight: 600;
          gap: 5px;
          background: var(--bg-card);
          border-color: var(--border-medium);
        }
        .filter-clear-btn {
          padding: 5px 12px;
          font-size: 11.5px;
          gap: 5px;
          color: var(--accent-rose);
        }
        .filter-clear-btn:hover {
          background: rgba(244, 63, 94, 0.1) !important;
          border-color: rgba(244, 63, 94, 0.3) !important;
        }

        .empty-filters-msg {
          font-size: 11.5px;
          color: var(--text-muted);
          padding: 6px 0;
        }

        .filter-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .filter-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .filter-row-num {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          width: 20px;
          text-align: center;
          flex-shrink: 0;
        }
        .select-column {
          width: 200px;
          height: 32px;
          font-size: 11.5px;
          flex-shrink: 0;
        }
        .select-operator {
          width: 180px;
          height: 32px;
          font-size: 11.5px;
          flex-shrink: 0;
        }
        .filter-val-input {
          flex: 1;
          max-width: 340px;
          height: 32px;
          font-size: 11.5px;
        }
        .filter-null-placeholder {
          flex: 1;
          max-width: 340px;
          height: 32px;
          display: flex;
          align-items: center;
          padding: 0 10px;
          background: var(--bg-card);
          border: 1px dashed var(--border-medium);
          border-radius: var(--radius-xs);
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
        }
        .delete-filter-btn {
          width: 32px;
          height: 32px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-xs);
          color: var(--text-muted);
          border: 1px solid var(--border-light);
          background: var(--bg-card);
          flex-shrink: 0;
        }
        .delete-filter-btn:hover {
          color: var(--accent-rose);
          border-color: rgba(244, 63, 94, 0.4);
          background: rgba(244, 63, 94, 0.12);
        }

        .sorted-hdr {
          background: var(--bg-hover) !important;
        }
        .sort-icon-badge {
          display: inline-flex;
          align-items: center;
          margin-left: 4px;
        }
        .active-sort-icon {
          color: var(--accent-blue);
        }
        .input-with-picker {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }
        .input-with-picker input {
          flex: 1;
          padding-right: 32px;
        }
        .btn-picker-trigger {
          position: absolute;
          right: 6px;
          background: transparent;
          border: none;
          color: var(--accent-blue);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .btn-picker-trigger:hover {
          background: rgba(59, 130, 246, 0.15);
        }

        /* Small Screen Responsive Layout */
        @media (max-width: 1050px) {
          .grid-bar {
            flex-wrap: wrap;
            padding: 6px 10px;
            gap: 8px;
          }
          .meta-group {
            flex-wrap: wrap;
            gap: 6px;
          }
          .bar-actions {
            flex-wrap: wrap;
            gap: 5px;
          }
          .search-input {
            width: 120px;
          }
        }

        @media (max-width: 780px) {
          .search-wrap {
            display: none;
          }
          .export-group {
            display: none;
          }
        }
      `}</style>
    </div>
  );
};

