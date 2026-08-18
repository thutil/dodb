import React, { useState, useEffect } from "react";
import {
  Table2,
  RefreshCw,
  Key,
  ChevronLeft,
  ChevronRight,
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
  Calendar as CalendarIcon,
} from "lucide-react";
import { ColumnInfo, TableRowData, ConnectionProfile, ColumnFilter, FilterOperator } from "../types";
import { DateTimePickerPopover } from "./DateTimePickerPopover";

export interface PendingChanges {
  inserts: TableRowData[];
  updates: Array<{ pkColumn: string; pkValue: unknown; data: TableRowData }>;
  deletes: Array<{ pkColumn: string; pkValue: unknown }>;
}

interface DataGridProps {
  activeProfile?: ConnectionProfile | null;
  activeDatabase?: string;
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
  sortColumn?: string | null;
  sortOrder?: "ASC" | "DESC";
  onSortChange?: (col: string | null, order: "ASC" | "DESC") => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  filters?: ColumnFilter[];
  onFiltersChange?: (filters: ColumnFilter[]) => void;
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
}) => {
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  const [selectedCell, setSelectedCell] = useState<{ row: number; col: string; val: unknown } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportType, setExportType] = useState<"sql" | "csv">("sql");
  const [exportContent, setExportContent] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  
  // Pending Transaction Edits keyed by Primary Key Value (or row key)
  const [editedCells, setEditedCells] = useState<{ [pkKey: string]: TableRowData }>({});
  const [newRows, setNewRows] = useState<TableRowData[]>([]);
  const [deletedRowKeys, setDeletedRowKeys] = useState<Set<string>>(new Set());
  
  // Active Inline Editing Cell
  const [editingCell, setEditingCell] = useState<{ pkKey: string; isNew: boolean; nIdx?: number; colName: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  // DateTime Picker Popover state
  const [activePicker, setActivePicker] = useState<{
    colName: string;
    colType: string;
    value: string;
    onApply: (val: string) => void;
  } | null>(null);

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
    setEditingCell(null);
    setRowEditModal(null);
    setCommitMsg(null);
  }, [tableName, page]);

  if (!tableName) {
    return (
      <div className="grid-placeholder">
        <div className="placeholder-card">
          <img src="/mascot.jpg" alt="dodb mascot" className="mascot-placeholder-img" />
          <h3>dodb Database Manager</h3>
          <p>Select a table from the sidebar to inspect records or open SQL Console</p>
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
          .mascot-placeholder-img {
            width: 80px;
            height: 80px;
            border-radius: 18px;
            box-shadow: var(--shadow-popup);
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

  // Toggle mark row for deletion
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
        setEditedCells({});
        setNewRows([]);
        setDeletedRowKeys(new Set());
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

  const handleFetchExport = async (type: "sql" | "csv") => {
    if (!activeProfile || !activeDatabase || !tableName) return;
    setExporting(true);
    setExportType(type);
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
      }
    } catch {
      setExportContent("Export error");
    } finally {
      setExporting(false);
    }
  };

  const downloadExportFile = () => {
    const element = document.createElement("a");
    const file = new Blob([exportContent], { type: "text/plain" });
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
        </div>

        <div className="bar-actions">
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

          <button className="btn btn-secondary" onClick={() => handleFetchExport("sql")}>
            <Download size={12} />
            <span>Export SQL</span>
          </button>
          <button className="btn btn-secondary" onClick={() => handleFetchExport("csv")}>
            <FileCode size={12} />
            <span>Export CSV</span>
          </button>
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
              <span>Column Filters</span>
            </div>
            <div className="filter-drawer-actions">
              <button className="btn btn-secondary btn-sm" onClick={addFilter}>
                <Plus size={11} />
                <span>Add Condition</span>
              </button>
              {(filters.length > 0 || searchQuery) && (
                <button className="btn btn-secondary btn-sm" onClick={clearAllFilters}>
                  <RotateCcw size={11} />
                  <span>Clear Filters</span>
                </button>
              )}
            </div>
          </div>

          {filters.length === 0 ? (
            <div className="empty-filters-msg">No active column filters. Click &quot;+ Add Condition&quot; to filter table rows.</div>
          ) : (
            <div className="filter-list">
              {filters.map((f) => (
                <div key={f.id} className="filter-row">
                  <select
                    className="input font-mono select-column"
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
                    className="input select-operator"
                    value={f.operator}
                    onChange={(e) => updateFilter(f.id, { operator: e.target.value as FilterOperator })}
                  >
                    <option value="equals">= Equals</option>
                    <option value="contains">🔍 Contains</option>
                    <option value="startsWith">Starts with</option>
                    <option value="endsWith">Ends with</option>
                    <option value="gt">&gt; Greater than</option>
                    <option value="gte">&gt;= Greater or equal</option>
                    <option value="lt">&lt; Less than</option>
                    <option value="lte">&lt;= Less or equal</option>
                    <option value="neq">!= Not equal</option>
                    <option value="isNull">IS NULL</option>
                    <option value="isNotNull">IS NOT NULL</option>
                  </select>

                  {f.operator !== "isNull" && f.operator !== "isNotNull" && (
                    <input
                      type="text"
                      className="input font-mono filter-val-input"
                      placeholder="Value..."
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    />
                  )}

                  <button className="icon-del-btn" onClick={() => removeFilter(f.id)} title="Remove filter">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transaction Commit / Rollback Bar */}
      {totalPending > 0 && (
        <div className="transaction-bar">
          <div className="tx-info">
            <Edit2 size={13} className="tx-icon" />
            <span>
              Uncommitted Changes ({totalPending}): {numInserts > 0 && `${numInserts} new, `}
              {numUpdates > 0 && `${numUpdates} edited, `}
              {numDeletes > 0 && `${numDeletes} deleted`}
            </span>
          </div>

          <div className="tx-actions">
            <button className="btn btn-secondary" onClick={handleRollback} disabled={submitting}>
              <RotateCcw size={12} />
              <span>Rollback (Discard)</span>
            </button>
            <button className="btn btn-primary" onClick={handleCommit} disabled={submitting}>
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
                            className={`icon-del-btn ${isDeleted ? "active" : ""}`}
                            onClick={() => toggleDeleteRow(pkKey)}
                            title={isDeleted ? "Restore Row" : "Mark for Delete"}
                          >
                            <Trash2 size={11} />
                          </button>
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
                                  className="input cell-edit-input"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={(e) => {
                                    // Prevent blur when clicking calendar picker trigger
                                    if (!e.relatedTarget || !(e.relatedTarget as HTMLElement).classList.contains("btn-picker-trigger")) {
                                      saveCellEdit();
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCellEdit();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                />
                                {isDateCol && (
                                  <button
                                    type="button"
                                    className="btn-picker-trigger"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setActivePicker({
                                        colName: col.name,
                                        colType: col.type,
                                        value: editValue,
                                        onApply: (selectedVal) => {
                                          setEditValue(selectedVal);
                                          setEditedCells((prev) => ({
                                            ...prev,
                                            [pkKey]: {
                                              ...(prev[pkKey] || {}),
                                              [col.name]: selectedVal,
                                            },
                                          }));
                                          setEditingCell(null);
                                        },
                                      });
                                    }}
                                    title="Pick Date & Time"
                                  >
                                    <CalendarIcon size={12} />
                                  </button>
                                )}
                              </div>
                            ) : isNull ? (
                              "NULL"
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
            className="btn btn-secondary"
            disabled={page === 0 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={13} />
            <span>Prev</span>
          </button>
          <button
            className="btn btn-secondary"
            disabled={page >= totalPages - 1 || loading}
            onClick={() => onPageChange(page + 1)}
          >
            <span>Next</span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Full Row Edit Modal */}
      {rowEditModal && (
        <div className="cell-overlay" onClick={() => setRowEditModal(null)}>
          <div className="row-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-header">
              <div className="cell-card-title">
                <Edit3 size={14} className="edit-icon" />
                <span>Edit Row #{rowEditModal.rowIdx + 1} ({rowEditModal.pkKey})</span>
              </div>
              <button className="icon-close-btn" onClick={() => setRowEditModal(null)}>
                ×
              </button>
            </div>

            <div className="row-modal-body">
              {columns.map((col) => {
                const isDate = isDateTimeColumn(col.type);
                const curVal = rowEditModal.data[col.name] === null || rowEditModal.data[col.name] === undefined
                  ? ""
                  : String(rowEditModal.data[col.name]);

                return (
                  <div key={col.name} className="row-field-group">
                    <label className="row-field-label">
                      <span>{col.name}</span>
                      <span className="col-type-tag">{col.type}</span>
                    </label>
                    <div className="input-with-picker">
                      <input
                        type="text"
                        className="input font-mono"
                        value={curVal}
                        onChange={(e) => {
                          const val = e.target.value;
                          setRowEditModal((prev) =>
                            prev ? { ...prev, data: { ...prev.data, [col.name]: val } } : null
                          );
                        }}
                      />
                      {isDate && (
                        <button
                          type="button"
                          className="btn-picker-trigger"
                          onClick={() => {
                            setActivePicker({
                              colName: col.name,
                              colType: col.type,
                              value: curVal,
                              onApply: (selectedVal) => {
                                setRowEditModal((prev) =>
                                  prev ? { ...prev, data: { ...prev.data, [col.name]: selectedVal } } : null
                                );
                              },
                            });
                          }}
                          title="Pick Date & Time"
                        >
                          <CalendarIcon size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="cell-card-footer">
              <button className="btn btn-secondary" onClick={() => setRowEditModal(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveRowModal}>
                Save Row Edits
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inspect Cell Overlay */}
      {selectedCell && (
        <div className="cell-overlay" onClick={() => setSelectedCell(null)}>
          <div className="cell-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-header">
              <div className="cell-card-title">
                <FileText size={14} />
                <span>Column: {selectedCell.col}</span>
              </div>
              <button className="icon-close-btn" onClick={() => setSelectedCell(null)}>
                ×
              </button>
            </div>
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
            <div className="cell-card-footer">
              <button className="btn btn-primary" onClick={() => setSelectedCell(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Data Modal */}
      {exportModalOpen && (
        <div className="cell-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="row-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="cell-card-header">
              <div className="cell-card-title">
                <Download size={14} className="edit-icon" />
                <span>Export Table: {tableName} ({exportType.toUpperCase()})</span>
              </div>
              <button className="icon-close-btn" onClick={() => setExportModalOpen(false)}>
                ×
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

      <style jsx>{`
        .grid-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
        }

        .grid-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .meta-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .table-icon { color: var(--accent-blue); }
        .table-name-text { font-size: 14px; font-weight: 700; }
        .count-pill {
          font-size: 10px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
        }

        .bar-actions { display: flex; gap: 8px; align-items: center; }
        .search-wrap { position: relative; display: flex; align-items: center; }
        .search-icon { position: absolute; left: 8px; color: var(--text-muted); }
        .search-input { padding-left: 26px; width: 160px; font-size: 11px; }

        .transaction-bar {
          padding: 6px 14px;
          background: rgba(245, 158, 11, 0.12);
          border-bottom: 1px solid rgba(245, 158, 11, 0.3);
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 11px;
        }
        .tx-info { display: flex; align-items: center; gap: 6px; color: #f59e0b; font-weight: 600; }
        .tx-actions { display: flex; gap: 8px; }

        .status-bar-msg {
          padding: 6px 14px;
          font-size: 11px;
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

        .pro-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        .pro-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          color: var(--text-sub);
          text-align: left;
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          z-index: 10;
        }

        .hdr-flex {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .pk-icon { color: #f59e0b; }
        .col-title { font-weight: 600; color: var(--text-main); }
        .col-type-tag { font-size: 9px; color: var(--text-muted); font-family: var(--font-mono); }

        .num-col { width: 36px; text-align: center; }
        .action-col { width: 56px; text-align: center; }

        .row-index {
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          border-bottom: 1px solid var(--border-light);
          font-size: 10px;
          font-family: var(--font-mono);
        }
        .new-idx { color: var(--accent-green); font-weight: bold; }

        .action-cell {
          text-align: center;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
        }
        .act-group {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
        }

        .icon-edit-btn, .icon-del-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .icon-edit-btn:hover {
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.15);
        }
        .icon-del-btn:hover, .icon-del-btn.active {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.15);
        }

        .pro-table td {
          padding: 5px 10px;
          border-bottom: 1px solid var(--border-light);
          border-right: 1px solid var(--border-light);
          white-space: nowrap;
          max-width: 280px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .pro-table tr:hover td {
          background: var(--bg-hover);
        }

        .row-deleted td {
          text-decoration: line-through;
          opacity: 0.4;
          background: rgba(239, 68, 68, 0.05);
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
      `}</style>

      {activePicker && (
        <DateTimePickerPopover
          value={activePicker.value}
          type={activePicker.colType}
          onChange={(val) => {
            activePicker.onApply(val);
            setActivePicker(null);
          }}
          onClose={() => setActivePicker(null)}
        />
      )}
    </div>
  );
};

