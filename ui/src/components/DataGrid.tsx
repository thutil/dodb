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
} from "lucide-react";
import { ColumnInfo, TableRowData, ConnectionProfile, ColumnFilter, FilterOperator } from "../types";


export interface PendingChanges {
  inserts: TableRowData[];
  updates: Array<{ pkColumn: string; pkValue: unknown; data: TableRowData }>;
  deletes: Array<{ pkColumn: string; pkValue: unknown }>;
}

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
  onCommitChanges: (changes: PendingChanges) => Promise<{ success: boolean; error?: string }>;
  onUpdateRows?: React.Dispatch<React.SetStateAction<TableRowData[]>>;
  onUpdateTotalRows?: React.Dispatch<React.SetStateAction<number>>;
  sortColumn?: string | null;
  sortOrder?: "ASC" | "DESC";
  onSortChange?: (column: string | null, order: "ASC" | "DESC") => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  filters?: ColumnFilter[];
  onFiltersChange?: (filters: ColumnFilter[]) => void;
  theme?: "dark" | "light";
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
  onUpdateRows,
  onUpdateTotalRows,
  sortColumn,
  sortOrder = "ASC",
  onSortChange,
  searchQuery = "",
  onSearchChange,
  filters = [],
  onFiltersChange,
  theme = "dark",
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
  const [editingCell, setEditingCell] = useState<{ pkKey: string; isNew: boolean; nIdx?: number; colName: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const isDateTimeColumn = (colType: string = ""): boolean => {
    const t = colType.toLowerCase();
    return t.includes("date") || t.includes("time") || t.includes("timestamp");
  };

  // Row Edit Modal State
  const [rowEditModal, setRowEditModal] = useState<{ pkKey: string; rowIdx: number; data: TableRowData } | null>(null);
  
  // Commit Status
  const [submitting, setSubmitting] = useState(false);
  const [commitMsg, setCommitMsg] = useState<{ success: boolean; text: string } | null>(null);

  // Reset local pending changes when table or page changes
  useEffect(() => {
    setEditedCells({});
    setNewRows([]);
    setDeletedRowKeys(new Set());
    setConfirmDeleteRow(null);
    setEditingCell(null);
    setRowEditModal(null);
    setCommitMsg(null);
  }, [tableName, page]);

  // Escape key handler for all modals and drawers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDeleteRow) {
          setConfirmDeleteRow(null);
        } else if (rowEditModal) {
          setRowEditModal(null);
        } else if (selectedCell) {
          setSelectedCell(null);
        } else if (exportModalOpen) {
          setExportModalOpen(false);
        } else if (isExportMenuOpen) {
          setIsExportMenuOpen(false);
        } else if (isFilterPanelOpen) {
          setIsFilterPanelOpen(false);
        } else if (editingCell) {
          setEditingCell(null);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeleteRow, rowEditModal, selectedCell, exportModalOpen, isExportMenuOpen, isFilterPanelOpen, editingCell]);

  if (!tableName) {
    return (
      <div className="grid-placeholder">
        <div className="placeholder-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="dodb Mascot" width={72} height={72} className="placeholder-mascot-img" />
          <h3>dodb Database Manager</h3>
          <p>
            {activeProfile
              ? "Select a table from the sidebar to inspect records or open SQL Console"
              : "Open Connections to connect to PostgreSQL, MySQL, MariaDB, or SQLite"}
          </p>
        </div>
        <style jsx>{`
          .grid-placeholder {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-content);
          }
          .placeholder-card {
            text-align: center;
            color: var(--text-muted);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .placeholder-mascot-img {
            width: 72px;
            height: 72px;
            border-radius: 16px;
            box-shadow: var(--shadow-popup);
            object-fit: cover;
          }
          .placeholder-card h3 { color: var(--text-main); font-size: 16px; }
        `}</style>
      </div>
    );
  }

  // Find Primary Key Column
  const pkColObj = columns.find((c) => c.primaryKey) || columns[0];
  const pkColName = pkColObj ? pkColObj.name : "id";

  const getPkKey = (row: TableRowData, fallbackIdx: number): string => {
    const val = row[pkColName];
    if (val !== undefined && val !== null) {
      return String(val);
    }
    return `row_${fallbackIdx}`;
  };

  // Calculate pending changes count
  const numUpdates = Object.keys(editedCells).length;
  const numInserts = newRows.length;
  const numDeletes = deletedRowKeys.size;
  const totalPending = numUpdates + numInserts + numDeletes;

  // Handle Cell Double Click to start inline editing
  const startEditing = (pkKey: string, isNew: boolean, nIdx: number | undefined, colName: string, currentVal: unknown) => {
    setEditingCell({ pkKey, isNew, nIdx, colName });
    setEditValue(currentVal === null || currentVal === undefined ? "" : String(currentVal));
  };

  // Save inline cell edit
  const saveCellEdit = () => {
    if (!editingCell) return;
    const { pkKey, isNew, nIdx, colName } = editingCell;
    
    if (isNew && nIdx !== undefined) {
      setNewRows((prev) => {
        const updated = [...prev];
        updated[nIdx] = { ...updated[nIdx], [colName]: editValue };
        return updated;
      });
    } else {
      setEditedCells((prev) => ({
        ...prev,
        [pkKey]: {
          ...(prev[pkKey] || {}),
          [colName]: editValue,
        },
      }));
    }
    setEditingCell(null);
  };

  // Open Full Row Edit Modal
  const openRowModal = (rowIdx: number, row: TableRowData) => {
    const pkKey = getPkKey(row, rowIdx);
    const currentEdits = editedCells[pkKey] || {};
    const merged = { ...row, ...currentEdits };
    setRowEditModal({ pkKey, rowIdx, data: merged });
  };

  // Save Full Row Modal Edits
  const saveRowModal = () => {
    if (!rowEditModal) return;
    const { pkKey, rowIdx, data } = rowEditModal;
    const originalRow = rows[rowIdx] || {};
    
    const changesObj: TableRowData = {};
    columns.forEach((col) => {
      const newVal = data[col.name];
      const oldVal = originalRow[col.name];
      if (String(newVal) !== String(oldVal)) {
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
    setRowEditModal(null);
  };

  // Add new pending row
  const handleAddRow = () => {
    const blank: TableRowData = {};
    columns.forEach((c) => {
      blank[c.name] = c.primaryKey ? "" : "";
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

    // Prepare inserts
    const insertsToSubmit = newRows.filter((r) => Object.values(r).some((v) => v !== ""));

    // Prepare updates
    const updatesToSubmit: Array<{ pkColumn: string; pkValue: unknown; data: TableRowData }> = [];
    Object.keys(editedCells).forEach((pkKey) => {
      updatesToSubmit.push({
        pkColumn: pkColName,
        pkValue: pkKey.startsWith("row_") ? pkKey.replace("row_", "") : pkKey,
        data: editedCells[pkKey],
      });
    });

    // Prepare deletes
    const deletesToSubmit: Array<{ pkColumn: string; pkValue: unknown }> = [];
    deletedRowKeys.forEach((pkKey) => {
      deletesToSubmit.push({
        pkColumn: pkColName,
        pkValue: pkKey.startsWith("row_") ? pkKey.replace("row_", "") : pkKey,
      });
    });

    try {
      const res = await onCommitChanges({
        inserts: insertsToSubmit,
        updates: updatesToSubmit,
        deletes: deletesToSubmit,
      });

      if (res.success) {
        setCommitMsg({ success: true, text: "Transaction committed to database successfully" });

        // In-place local row update without reloading entire dataset
        if (onUpdateRows) {
          onUpdateRows((prevRows) => {
            let updated = [...prevRows];

            // 1. Apply cell updates in place
            if (Object.keys(editedCells).length > 0) {
              updated = updated.map((row, idx) => {
                const key = getPkKey(row, idx);
                if (editedCells[key]) {
                  return { ...row, ...editedCells[key] };
                }
                return row;
              });
            }

            // 2. Remove deleted rows in place
            if (deletedRowKeys.size > 0) {
              updated = updated.filter((row, idx) => {
                const key = getPkKey(row, idx);
                return !deletedRowKeys.has(key);
              });
            }

            // 3. Prepend new inserted rows
            if (insertsToSubmit.length > 0) {
              updated = [...insertsToSubmit, ...updated];
            }

            return updated;
          });
        } else {
          onRefresh();
        }

        // Update total rows count in place
        if (onUpdateTotalRows) {
          const delta = insertsToSubmit.length - deletesToSubmit.length;
          if (delta !== 0) {
            onUpdateTotalRows((prev) => Math.max(0, prev + delta));
          }
        }

        setEditedCells({});
        setNewRows([]);
        setDeletedRowKeys(new Set());
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
      const pkKey = getPkKey(r, idx);
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
                className={`btn btn-secondary ${filters.length > 0 ? "filter-active-btn" : ""}`}
                onClick={() => setIsFilterPanelOpen(!isFilterPanelOpen)}
              >
                <Filter size={12} />
                <span>Filter {filters.length > 0 ? `(${filters.length})` : ""}</span>
              </button>

              <button className="btn btn-secondary" onClick={handleAddRow}>
                <Plus size={12} />
                <span>Add Row</span>
              </button>

              {/* Compact Export Dropdown */}
              <div className="export-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`btn btn-secondary ${isExportMenuOpen ? "export-btn-active" : ""}`}
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  title="Export table data (JSON, SQL, CSV)"
                >
                  <Download size={12} />
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
                    >
                      <FileCode size={13} className="menu-icon csv-icon" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="search-wrap">
            <Search size={12} className="search-icon" />
            <input
              type="text"
              className="input search-input"
              placeholder="Search table..."
              value={searchQuery}
              onChange={(e) => {
                if (onSearchChange) onSearchChange(e.target.value);
                onPageChange(0);
              }}
            />
          </div>
          <button className="btn btn-secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Drawer Panel */}
      {isFilterPanelOpen && (
        <div className="filter-drawer">
          <div className="filter-drawer-header">
            <div className="filter-drawer-title">
              <Filter size={13} className="filter-icon" />
              <span>Filter Records</span>
              {filters.length > 0 && <span className="filter-count-badge">{filters.length} active</span>}
            </div>
            <div className="filter-drawer-actions">
              <button className="btn btn-secondary btn-sm" onClick={addFilter}>
                <Plus size={11} />
                <span>Add Filter Rule</span>
              </button>
              {filters.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={clearAllFilters}>
                  Clear All
                </button>
              )}
            </div>
          </div>

          {filters.length === 0 ? (
            <div className="empty-filters-msg">No active filters. Click &quot;Add Filter Rule&quot; to filter table columns.</div>
          ) : (
            <div className="filter-list">
              {filters.map((f) => (
                <div key={f.id} className="filter-row">
                  <select
                    className="select select-column"
                    value={f.column}
                    onChange={(e) => updateFilter(f.id, { column: e.target.value })}
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
                  >
                    <option value="equals">= Equals</option>
                    <option value="contains">Contains</option>
                    <option value="startsWith">Starts with</option>
                    <option value="endsWith">Ends with</option>
                    <option value="gt">&gt; Greater than</option>
                    <option value="gte">&gt;= Greater or equal</option>
                    <option value="lt">&lt; Less than</option>
                    <option value="lte">&lt; Less or equal</option>
                    <option value="neq">!= Not equal</option>
                    <option value="isNull">IS NULL</option>
                    <option value="isNotNull">IS NOT NULL</option>
                  </select>

                  {f.operator !== "isNull" && f.operator !== "isNotNull" && (
                    <input
                      className="input filter-val-input"
                      placeholder="Filter value..."
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    />
                  )}

                  <button className="btn btn-icon delete-filter-btn" onClick={() => removeFilter(f.id)}>
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
                    <button
                      className="icon-del-btn"
                      onClick={() => setNewRows((prev) => prev.filter((_, i) => i !== nIdx))}
                      title="Remove new row"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                  {columns.map((col) => {
                    const isEditing = editingCell?.isNew && editingCell.nIdx === nIdx && editingCell.colName === col.name;
                    const val = nRow[col.name];
                    return (
                      <td
                        key={col.name}
                        className="cell-data cell-new"
                        onDoubleClick={() => startEditing(`new_${nIdx}`, true, nIdx, col.name, val)}
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
                        ) : (
                          val !== undefined && val !== null && val !== "" ? String(val) : <span className="placeholder-text">Click to edit</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Existing Database Rows */}
              {rows.length === 0 && newRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 2} className="empty-cell">
                    No matching records found
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const pkKey = getPkKey(row, idx);
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
                            onClick={() => openRowModal(idx, row)}
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
          >
            <ChevronLeft size={12} />
            <span>Prev</span>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={(page + 1) * pageSize >= totalRows}
          >
            <span>Next</span>
            <ChevronRight size={12} />
          </button>
        </div>
      </div>

      {/* Row Edit Modal */}
      {rowEditModal && (
        <div className="cell-overlay" onClick={() => setRowEditModal(null)}>
          <div className="cell-card row-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-hdr">
              <div className="hdr-left">
                <Edit3 size={14} className="edit-icon" />
                <span>Edit Row #{page * pageSize + rowEditModal.rowIdx + 1}</span>
              </div>
              <button className="icon-close-btn" onClick={() => setRowEditModal(null)}>
                <X size={14} />
              </button>
            </div>

            <div className="row-modal-body">
              {columns.map((col) => {
                const val = rowEditModal.data[col.name];
                return (
                  <div key={col.name} className="field-group">
                    <label className="field-label font-mono">{col.name} ({col.type})</label>
                    <input
                      className="input form-control font-mono"
                      value={val === null || val === undefined ? "" : String(val)}
                      onChange={(e) =>
                        setRowEditModal({
                          ...rowEditModal,
                          data: { ...rowEditModal.data, [col.name]: e.target.value },
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>

            <div className="cell-card-footer">
              <button className="btn btn-secondary" onClick={() => setRowEditModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveRowModal}>
                <Check size={12} />
                <span>Apply to Row</span>
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
          gap: 10px;
          flex-shrink: 0;
        }
        .table-icon { color: var(--accent-blue); }
        .table-name-text {
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.2px;
        }
        .count-pill {
          font-size: 10.5px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 2.5px 7px;
          border-radius: 5px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          border: 1px solid var(--border-light);
        }

        /* View Mode Segmented Switch */
        .view-mode-toggle {
          display: inline-flex;
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: 6px;
          border: 1px solid var(--border-light);
          gap: 2px;
          margin-left: 2px;
        }
        .view-toggle-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 11px;
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

        .bar-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: nowrap;
        }

        /* Export Dropdown */
        .export-dropdown-wrap {
          position: relative;
        }
        .export-btn-active {
          border-color: var(--accent-blue) !important;
          color: var(--accent-blue) !important;
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
          min-width: 155px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .export-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border: none;
          background: transparent;
          color: var(--text-main);
          font-size: 11.5px;
          font-weight: 500;
          border-radius: 4px;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.12s ease;
        }
        .export-menu-item:hover {
          background: var(--bg-hover);
          color: var(--accent-blue);
        }
        .menu-icon { flex-shrink: 0; }
        .json-icon { color: #f59e0b; }
        .sql-icon { color: var(--accent-blue); }
        .csv-icon { color: var(--accent-green); }
        
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
          background: rgba(59, 130, 246, 0.2) !important;
          color: var(--accent-blue) !important;
          border-color: rgba(59, 130, 246, 0.4) !important;
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
          left: 9px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .search-input {
          padding-left: 28px;
          width: 180px;
          height: 28px;
          font-size: 11.5px;
          border-radius: 5px;
        }

        .transaction-bar {
          padding: 7px 16px;
          background: rgba(245, 158, 11, 0.12);
          border-bottom: 1px solid rgba(245, 158, 11, 0.3);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11.5px;
        }
        .tx-info { display: flex; align-items: center; gap: 7px; color: #f59e0b; font-weight: 600; }
        .tx-actions { display: flex; gap: 8px; }

        .status-bar-msg {
          padding: 7px 16px;
          font-size: 11.5px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .status-bar-msg.success { background: rgba(16, 185, 129, 0.15); color: var(--accent-green); }
        .status-bar-msg.error { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }

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
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          z-index: 10;
        }

        .hdr-flex {
          display: flex;
          align-items: center;
          gap: 7px;
          min-height: 20px;
        }
        .pk-icon { color: #f59e0b; flex-shrink: 0; }
        .col-title {
          font-weight: 600;
          color: var(--text-main);
          font-size: 12px;
        }
        .col-type-tag {
          font-size: 9.5px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          background: rgba(255, 255, 255, 0.05);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          white-space: nowrap;
        }

        .num-col { width: 44px; min-width: 44px; text-align: center; }
        .action-col { width: 88px; min-width: 88px; text-align: center; }

        .row-index {
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          border-bottom: 1px solid var(--border-light);
          font-size: 11px;
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          padding: 7px 4px;
        }
        .new-idx { color: var(--accent-green); font-weight: bold; }

        .action-cell {
          text-align: center;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          padding: 5px 6px;
        }
        .act-group {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }

        .icon-edit-btn, .icon-del-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px 5px;
          border-radius: 4px;
          transition: all 0.12s ease;
        }
        .icon-edit-btn:hover {
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.15);
        }
        .icon-del-btn:hover, .icon-del-btn.active {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.15);
        }
        .icon-del-btn.is-deleted {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.25);
        }

        .icon-restore-btn {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          border: 1px solid rgba(59, 130, 246, 0.35);
          border-radius: 3px;
          padding: 2px 5px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .icon-restore-btn:hover {
          background: var(--accent-blue);
          color: #fff;
        }

        .transaction-bar.has-deletions {
          border-left: 4px solid var(--accent-red);
          background: rgba(239, 68, 68, 0.12);
        }
        .tx-delete-highlight {
          color: var(--accent-red);
          font-weight: 700;
        }

        .pro-table td {
          padding: 7px 12px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          white-space: nowrap;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 12px;
          line-height: 1.4;
        }

        .pro-table tr:hover td {
          background: var(--bg-hover);
        }

        .null-tag {
          display: inline-block;
          font-size: 10px;
          font-style: italic;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.04);
          padding: 1px 5px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          letter-spacing: 0.2px;
          opacity: 0.7;
        }

        .pro-table tr:hover td {
          background: var(--bg-hover);
        }

        .row-deleted td {
          background: rgba(239, 68, 68, 0.22) !important;
          color: #fca5a5 !important;
          text-decoration: line-through;
          border-bottom: 1px solid rgba(239, 68, 68, 0.35) !important;
          border-right: 1px solid rgba(239, 68, 68, 0.2) !important;
        }
        .row-deleted:hover td {
          background: rgba(239, 68, 68, 0.3) !important;
        }

        .delete-confirm-card {
          width: 450px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.45);
        }
        .danger-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          color: var(--accent-red);
          font-weight: 700;
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
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.25);
          border-radius: var(--radius-sm);
          padding: 6px 10px;
          display: flex;
          gap: 6px;
          line-height: 1.4;
        }
        .step-badge {
          color: #f59e0b;
          font-weight: 700;
          flex-shrink: 0;
        }
        .delete-modal-actions {
          margin-top: 4px;
        }

        .cell-data { cursor: pointer; }
        .cell-null { color: var(--text-muted); font-style: italic; }
        .cell-modified {
          background: rgba(245, 158, 11, 0.15) !important;
          outline: 1px dashed rgba(245, 158, 11, 0.5);
        }
        .cell-new {
          background: rgba(16, 185, 129, 0.1) !important;
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
        .page-nav-btns { display: flex; gap: 6px; }

        .cell-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 500;
        }
        .cell-card {
          width: 480px;
          background: var(--bg-card);
          padding: 14px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .row-modal-card {
          width: 520px;
          max-height: 80vh;
          background: var(--bg-card);
          padding: 16px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-light);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .row-modal-body {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 380px;
          padding-right: 4px;
        }
        .row-field-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .row-field-label {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          font-weight: 600;
          color: var(--text-sub);
        }

        .edit-icon { color: var(--accent-blue); }
        .cell-modal-icon { color: var(--accent-blue); }
        .cell-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .cell-card-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
        }
        .cell-card-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }
        .cell-mono-text {
          height: 180px;
          font-size: 11px;
        }
        .cell-card-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .filter-active-btn {
          background: rgba(59, 130, 246, 0.15) !important;
          color: var(--accent-blue) !important;
          border-color: rgba(59, 130, 246, 0.4) !important;
          font-weight: 600;
        }

        .filter-drawer {
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .filter-drawer-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .filter-drawer-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-main);
        }
        .filter-icon { color: var(--accent-blue); }
        .filter-drawer-actions {
          display: flex;
          gap: 6px;
        }
        .btn-sm {
          padding: 3px 8px;
          font-size: 10px;
        }

        .empty-filters-msg {
          font-size: 11px;
          color: var(--text-muted);
          font-style: italic;
          padding: 4px 0;
        }

        .filter-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .filter-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .select-column {
          width: 160px;
          font-size: 11px;
        }
        .select-operator {
          width: 150px;
          font-size: 11px;
        }
        .filter-val-input {
          flex: 1;
          max-width: 260px;
          font-size: 11px;
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

