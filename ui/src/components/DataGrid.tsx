import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";
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
  FileSpreadsheet,
  Filter,
  Play,
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
  Globe,
  MapPin,
  Layers,
  Compass,
  Eye,
  Crosshair,
} from "lucide-react";
import { ColumnInfo, TableRowData, ConnectionProfile, ColumnFilter, FilterOperator, DBType } from "../types";
import { quoteIdent, quoteTableIdent } from "../utils/ddlBuilder";
import {
  isGeometryColumn,
  isCoordinateColumn,
  isGisData,
  formatGisSummary,
  parseGisToGeoJson,
  geoJsonToWkt,
  GeoJsonGeometry,
  detectCoordinatePairs,
  extractPointFromRow,
  getAllSpatialFeaturesFromRows,
  isValidCoordinate,
} from "../utils/gisUtils";
import { GisMapViewer, GisFeatureRecord } from "./GisMapViewer";
import { Language, t } from "../utils/i18n";
import { saveTextFileAsync } from "../utils/saveFile";


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
  onRefresh: (isSilent?: boolean) => void;
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
  language?: Language;
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
  language = "en",
}) => {
  const dialect: DBType =
    activeProfile?.type === "mariadb"
      ? "mariadb"
      : activeProfile?.type === "sqlite"
        ? "sqlite"
        : "postgres";

  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);

  // Draft filter state so editing rules does not immediately trigger heavy DB queries
  const [draftFilters, setDraftFilters] = useState<ColumnFilter[]>(filters);
  const filtersKey = JSON.stringify(filters);

  // Sync draft filters whenever external filters change (e.g. table switch or external reset)
  useEffect(() => {
    setDraftFilters(filters);
  }, [filtersKey]);

  const hasUnappliedFilters = useMemo(() => {
    return JSON.stringify(draftFilters) !== JSON.stringify(filters);
  }, [draftFilters, filters]);

  // View Mode: Table vs JSON vs GIS Map
  const [viewMode, setViewMode] = useState<"table" | "json" | "gis">("table");
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

  // Row Right-Click Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowIdx: number;
    row: TableRowData;
    pkKey: string;
  } | null>(null);

  // Detailed Searchable Row Inspector State
  const [inspectRowModal, setInspectRowModal] = useState<{
    rowIdx: number;
    row: TableRowData;
    pkKey: string;
  } | null>(null);
  const [inspectSearchTerm, setInspectSearchTerm] = useState<string>("");

  // GIS Map Viewer Modal State
  const [gisModalData, setGisModalData] = useState<{
    title: string;
    subtitle?: string;
    value: unknown;
    pickerMode?: boolean;
    onPick?: (coords: { lng: number; lat: number; wkt: string }) => void;
  } | null>(null);

  // Pending Transaction Edits keyed by Primary Key Value (or row key)
  const [editedCells, setEditedCells] = useState<{ [pkKey: string]: TableRowData }>({});
  const [newRows, setNewRows] = useState<TableRowData[]>([]);
  const [deletedRowKeys, setDeletedRowKeys] = useState<Set<string>>(new Set());
  // Full Row Insert/Edit Modal State
  const [rowEditModal, setRowEditModal] = useState<{
    pkKey: string;
    rowIdx: number;
    isNew: boolean;
    data: TableRowData;
  } | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{ pkKey: string; rowIdx: number; rowData: TableRowData } | null>(null);

  // Multi-Row Selection State
  const [selectedRowIndices, setSelectedRowIndices] = useState<Set<number>>(new Set());
  const [lastSelectedRowIdx, setLastSelectedRowIdx] = useState<number | null>(null);
  const [batchCopied, setBatchCopied] = useState<string | null>(null);

  // Scroll Container Ref & Horizontal Scroll Retention
  const tableAreaRef = useRef<HTMLDivElement>(null);
  const lastScrollLeftRef = useRef<number>(0);

  const handleTableAreaScroll = (e: React.UIEvent<HTMLDivElement>) => {
    lastScrollLeftRef.current = e.currentTarget.scrollLeft;
  };

  // Reset scroll to top-left when table or database changes
  useEffect(() => {
    lastScrollLeftRef.current = 0;
    if (tableAreaRef.current) {
      tableAreaRef.current.scrollLeft = 0;
      tableAreaRef.current.scrollTop = 0;
    }
  }, [tableName, activeDatabase]);

  // Reset vertical scroll to top on sort change while preserving horizontal scroll
  useEffect(() => {
    if (tableAreaRef.current) {
      tableAreaRef.current.scrollTop = 0;
      tableAreaRef.current.scrollLeft = lastScrollLeftRef.current;
    }
  }, [sortColumn, sortOrder]);

  // Ensure horizontal scroll is restored after rows or columns update
  useLayoutEffect(() => {
    if (tableAreaRef.current && lastScrollLeftRef.current > 0) {
      tableAreaRef.current.scrollLeft = lastScrollLeftRef.current;
    }
  }, [rows, columns]);

  // Close export dropdown and context menu on outside click
  useEffect(() => {
    if (!isExportMenuOpen && !contextMenu) return;
    const handleOutside = () => {
      setIsExportMenuOpen(false);
      setContextMenu(null);
    };
    window.addEventListener("click", handleOutside);
    return () => window.removeEventListener("click", handleOutside);
  }, [isExportMenuOpen, contextMenu]);

  // Active Inline Editing Cell
  const [editingCell, setEditingCell] = useState<{ pkKey: string; isNew: boolean; nIdx?: number; colName: string; originalVal: unknown } | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const isDateTimeColumn = (colType: string = ""): boolean => {
    const t = colType.toLowerCase();
    return t.includes("date") || t.includes("time") || t.includes("timestamp");
  };

  // Detect coordinate column pairs (e.g. lat + lng, latitude + longitude, pickup_lat + pickup_lng)
  const coordinatePairs = React.useMemo(() => {
    return detectCoordinatePairs(columns);
  }, [columns]);

  // Check if table contains spatial/geometry columns or coordinate pairs
  const hasGisColumns = React.useMemo(() => {
    return columns.some((c) => isGeometryColumn(c.type, c.name)) || coordinatePairs.length > 0;
  }, [columns, coordinatePairs]);

  // Build GIS feature records for current page rows
  const gisFeatures: GisFeatureRecord[] = React.useMemo(() => {
    return getAllSpatialFeaturesFromRows(rows, columns);
  }, [columns, rows]);

  const handleRowClick = (e: React.MouseEvent, idx: number) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedRowIndices((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
      setLastSelectedRowIdx(idx);
    } else if (e.shiftKey && lastSelectedRowIdx !== null) {
      const [low, high] = lastSelectedRowIdx < idx ? [lastSelectedRowIdx, idx] : [idx, lastSelectedRowIdx];
      const next = new Set(selectedRowIndices);
      for (let i = low; i <= high; i++) next.add(i);
      setSelectedRowIndices(next);
    }
  };

  const handleIndexCellClick = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    if (e.metaKey || e.ctrlKey) {
      setSelectedRowIndices((prev) => {
        const next = new Set(prev);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return next;
      });
      setLastSelectedRowIdx(idx);
    } else if (e.shiftKey && lastSelectedRowIdx !== null) {
      const [low, high] = lastSelectedRowIdx < idx ? [lastSelectedRowIdx, idx] : [idx, lastSelectedRowIdx];
      const next = new Set<number>();
      for (let i = low; i <= high; i++) next.add(i);
      setSelectedRowIndices(next);
    } else {
      setSelectedRowIndices((prev) => (prev.size === 1 && prev.has(idx) ? new Set() : new Set([idx])));
      setLastSelectedRowIdx(idx);
    }
  };

  const handleCopySelectedRows = (format: "json" | "csv" | "sql") => {
    const selRows = Array.from(selectedRowIndices)
      .sort((a, b) => a - b)
      .map((i) => rows[i])
      .filter(Boolean);
    if (selRows.length === 0) return;

    if (format === "json") {
      navigator.clipboard.writeText(JSON.stringify(selRows, null, 2));
      setBatchCopied("Copied JSON");
    } else if (format === "csv") {
      const colNames = columns.map((c) => c.name);
      const header = colNames.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
      const body = selRows
        .map((r) =>
          colNames
            .map((c) => {
              const val = r[c];
              if (val === null || val === undefined) return "";
              const str = typeof val === "object" ? JSON.stringify(val) : String(val);
              return `"${str.replace(/"/g, '""')}"`;
            })
            .join(",")
        )
        .join("\n");
      navigator.clipboard.writeText(`${header}\n${body}`);
      setBatchCopied("Copied CSV");
    } else if (format === "sql") {
      const colList = columns.map((c) => quoteIdent(c.name, dialect)).join(", ");
      const qTable = tableName ? quoteTableIdent(tableName, dialect) : "table_name";
      const lines = selRows
        .map((r) => {
          const valList = columns
            .map((c) => {
              const v = r[c.name];
              if (v === null || v === undefined) return "NULL";
              if (typeof v === "number" || typeof v === "boolean") return String(v);
              return `'${String(v).replace(/'/g, "''")}'`;
            })
            .join(", ");
          return `INSERT INTO ${qTable} (${colList}) VALUES (${valList});`;
        })
        .join("\n");
      navigator.clipboard.writeText(lines);
      setBatchCopied("Copied SQL");
    }

    setTimeout(() => setBatchCopied(null), 2000);
  };

  const handleBatchDeleteSelected = () => {
    setDeletedRowKeys((prev) => {
      const next = new Set(prev);
      Array.from(selectedRowIndices).forEach((i) => {
        const r = rows[i];
        if (r) {
          next.add(getRowKey(r, i));
        }
      });
      return next;
    });
  };

  const handleClearRowSelection = () => {
    setSelectedRowIndices(new Set());
    setLastSelectedRowIdx(null);
  };

  // Status message for transactions
  const [commitMsg, setCommitMsg] = useState<{ success: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-dismiss commit/status toast after 3.5 seconds
  useEffect(() => {
    if (!commitMsg) return;
    const timer = setTimeout(() => {
      setCommitMsg(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [commitMsg]);

  // Reset local transaction draft on table, database, or page/sort change
  useEffect(() => {
    setNewRows([]);
    setEditedCells({});
    setDeletedRowKeys(new Set());
    setEditingCell(null);
    setRowEditModal(null);
    setConfirmDeleteRow(null);
    setCommitMsg(null);
    setContextMenu(null);
    setInspectRowModal(null);
    setSelectedRowIndices(new Set());
    setLastSelectedRowIdx(null);
  }, [tableName, activeDatabase, page, sortColumn, sortOrder, searchQuery, filtersKey]);

  // Handle ESC key to dismiss sub-modals or clear selection; Cmd+A to select all rows
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a" && !isInput && rows.length > 0) {
        e.preventDefault();
        setSelectedRowIndices(new Set(rows.map((_, i) => i)));
        return;
      }

      if (e.key === "Escape") {
        if (contextMenu) setContextMenu(null);
        else if (gisModalData) setGisModalData(null);
        else if (inspectRowModal) setInspectRowModal(null);
        else if (confirmDeleteRow) setConfirmDeleteRow(null);
        else if (rowEditModal) setRowEditModal(null);
        else if (selectedCell) setSelectedCell(null);
        else if (editingCell) setEditingCell(null);
        else if (selectedRowIndices.size > 0) setSelectedRowIndices(new Set());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [contextMenu, gisModalData, inspectRowModal, confirmDeleteRow, rowEditModal, selectedCell, editingCell, rows, selectedRowIndices]);

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
              onClick={() => onRefresh()}
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

        // Perform silent background refresh so the entire table does NOT flicker or reset
        onRefresh(true);
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
    saveTextFileAsync(name, dataToDownload);
  };

  const handleFetchExport = async (type: "sql" | "csv" | "json") => {
    if (!tableName) return;
    setExporting(true);
    setExportType(type);
    setExportModalOpen(true);
    try {
      if (type === "json") {
        setExportContent(JSON.stringify(allJsonRows, null, 2));
        return;
      }

      if (type === "csv") {
        const colNames = columns.map((c) => c.name);
        const csvHeader = colNames.map((col) => `"${col.replace(/"/g, '""')}"`).join(",");
        const csvRows = allJsonRows.map((row) =>
          colNames
            .map((col) => {
              const val = row[col];
              if (val === null || val === undefined) return "";
              if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
              return `"${String(val).replace(/"/g, '""')}"`;
            })
            .join(",")
        );
        setExportContent([csvHeader, ...csvRows].join("\n"));
        return;
      }

      if (type === "sql") {
        const colNames = columns.map((c) => c.name);
        const quotedCols = colNames.map((c) => quoteIdent(c, dialect)).join(", ");
        const qTable = tableName ? quoteTableIdent(tableName, dialect) : "table_name";
        const sqlStatements = allJsonRows.map((row) => {
          const vals = colNames.map((c) => {
            const val = row[c];
            if (val === null || val === undefined) return "NULL";
            if (typeof val === "number" || typeof val === "boolean") return String(val);
            if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
            return `'${String(val).replace(/'/g, "''")}'`;
          }).join(", ");
          return `INSERT INTO ${qTable} (${quotedCols}) VALUES (${vals});`;
        });
        const sqlText = `-- Table: ${tableName || "table_name"}\n-- Exported: ${new Date().toISOString()}\n-- Rows: ${allJsonRows.length}\n\n${sqlStatements.join("\n")}`;
        setExportContent(sqlText);
        return;
      }
    } catch {
      setExportContent("Export error");
    } finally {
      setExporting(false);
    }
  };

  const downloadExportFile = () => {
    saveTextFileAsync(`${tableName}_export.${exportType}`, exportContent);
  };

  // Filter Management Functions
  const addFilter = () => {
    if (!columns || columns.length === 0) return;
    const newFilter: ColumnFilter = {
      id: String(Date.now()),
      column: columns[0].name,
      operator: "equals",
      value: "",
    };
    setDraftFilters((prev) => [...prev, newFilter]);
  };

  const updateFilter = (id: string, updated: Partial<ColumnFilter>) => {
    setDraftFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...updated } : f))
    );
  };

  const removeFilter = (id: string) => {
    setDraftFilters((prev) => prev.filter((f) => f.id !== id));
  };

  const applyFilters = () => {
    if (onFiltersChange) {
      onFiltersChange(draftFilters);
      onPageChange(0);
    }
  };

  const clearAllFilters = () => {
    setDraftFilters([]);
    if (onFiltersChange) {
      onFiltersChange([]);
      onPageChange(0);
    }
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

          {/* View Mode Segmented Control (Table vs JSON vs Map) */}
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
            {hasGisColumns && (
              <button
                className={`view-toggle-btn ${viewMode === "gis" ? "active" : ""}`}
                onClick={() => setViewMode("gis")}
                title="GIS Spatial Map View (MapLibre GL)"
              >
                <Globe size={12} />
                <span>Map ({gisFeatures.length})</span>
              </button>
            )}
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
                <span>{t("gridFilter", language)} {filters.length > 0 ? `(${filters.length})` : ""}</span>
              </button>

              <button
                className="btn btn-secondary add-row-btn"
                onClick={handleAddRow}
                title="Add a new row draft to this table"
              >
                <Plus size={13} />
                <span>{t("gridAddRow", language)}</span>
              </button>

              {/* Compact Export Dropdown */}
              <div className="export-dropdown-wrap" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`btn btn-secondary ${isExportMenuOpen ? "export-btn-active" : ""}`}
                  onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
                  title="Export table data (JSON, SQL, CSV)"
                >
                  <Download size={13} />
                  <span>{t("gridExport", language)}</span>
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
                      <span>{t("gridExportJson", language)}</span>
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
                      <span>{t("gridExportSql", language)}</span>
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
                      <span>{t("gridExportCsv", language)}</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="search-wrap" title="Quick text search across visible data">
            <span className="search-icon-wrap">
              <Search size={13} />
            </span>
            <input
              type="text"
              className="input search-input"
              placeholder={t("gridSearchPlaceholder", language)}
              value={searchQuery}
              title="Search table across loaded records"
              onChange={(e) => {
                if (onSearchChange) onSearchChange(e.target.value);
                onPageChange(0);
              }}
            />
            {searchQuery && (
              <button
                className="search-clear-btn"
                onClick={() => {
                  if (onSearchChange) onSearchChange("");
                  onPageChange(0);
                }}
                title={t("close", language)}
              >
                <X size={11} />
              </button>
            )}
          </div>
          <button
            className="btn btn-secondary refresh-table-btn"
            onClick={() => onRefresh()}
            disabled={loading}
            title="Reload table records from database"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} />
            <span>{t("refresh", language)}</span>
          </button>
        </div>
      </div>

      {/* Filter Drawer Panel */}
      {isFilterPanelOpen && (
        <div className="filter-drawer">
          <div className="filter-drawer-header">
            <div className="filter-drawer-title">
              <Filter size={14} className="filter-icon" />
              <span>{t("gridFilterRules", language)}</span>
              {filters.length > 0 && (
                <span className="filter-count-badge" title={`${filters.length} active filter rule(s) applied`}>
                  {filters.length} active
                </span>
              )}
              {hasUnappliedFilters && (
                <span className="filter-unapplied-badge" title="You have unapplied filter changes. Click Query to apply.">
                  {t("gridFilterUnapplied", language)}
                </span>
              )}
            </div>
            <div className="filter-drawer-actions">
              <button
                className="btn btn-secondary filter-action-btn"
                onClick={addFilter}
                title="Add a new filter condition"
              >
                <Plus size={13} />
                <span>{t("gridAddFilterRule", language)}</span>
              </button>
              {(filters.length > 0 || draftFilters.length > 0) && (
                <button
                  className="btn btn-secondary filter-clear-btn"
                  onClick={clearAllFilters}
                  title="Remove all filter conditions and show unfiltered data"
                >
                  <Trash2 size={12} />
                  <span>{t("gridClearFilters", language)}</span>
                </button>
              )}
              <button
                className={`btn filter-query-btn ${hasUnappliedFilters ? "btn-primary filter-query-btn-highlight" : "btn-secondary"}`}
                onClick={applyFilters}
                disabled={loading}
                title="Apply filter conditions and execute query on database (Press Enter)"
              >
                <Play size={12} fill="currentColor" />
                <span>{t("gridApplyFilter", language)}</span>
              </button>
            </div>
          </div>

          {draftFilters.length === 0 ? (
            <div className="empty-filters-msg">
              <span>
                {language === "th" ? (
                  <>ยังไม่มีเงื่อนไขตัวกรอง คลิก <strong>&quot;เพิ่มเงื่อนไข&quot;</strong> เพื่อกำหนดตัวกรอง แล้วคลิก <strong>&quot;ประมวลผล (Query)&quot;</strong> เพื่อดึงข้อมูล</>
                ) : (
                  <>No filter rules configured. Click <strong>&quot;Add Filter Rule&quot;</strong> to configure conditions, then click <strong>&quot;Query&quot;</strong> to execute.</>
                )}
              </span>
            </div>
          ) : (
            <div className="filter-list">
              {draftFilters.map((f, idx) => (
                <div key={f.id} className="filter-row">
                  <span className="filter-row-num" title={`Filter rule #${idx + 1}`}>{idx + 1}</span>
                  <select
                    className="select select-column font-mono"
                    value={f.column}
                    onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyFilters();
                      }
                    }}
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
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        applyFilters();
                      }
                    }}
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
                      placeholder={language === "th" ? "ค่าที่ต้องการกรอง... (กด Enter เพื่อ Query)" : "Filter value... (Press Enter to Query)"}
                      value={f.value}
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyFilters();
                        }
                      }}
                      title="Enter value to compare against and press Enter to Query"
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
              <span>{t("gridRollback", language)}</span>
            </button>
            <button className="btn btn-primary btn-commit-action" onClick={handleCommit} disabled={submitting}>
              <Check size={12} />
              <span>{submitting ? t("loading", language) : t("gridCommit", language)}</span>
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

      <div className="grid-table-area" ref={tableAreaRef} onScroll={handleTableAreaScroll}>
        {loading && columns.length > 0 && (
          <div className="grid-loading-bar" aria-label="Loading...">
            <div className="grid-loading-bar-inner" />
          </div>
        )}
        {loading && columns.length === 0 ? (
          <div className="grid-state-msg">{t("loading", language)}</div>
        ) : viewMode === "gis" ? (
          <div className="gis-view-wrapper" style={{ height: "100%", width: "100%", position: "relative" }}>
            <GisMapViewer
              isInline
              records={gisFeatures}
              title={`${tableName} — GIS Spatial View`}
              subtitle={`${gisFeatures.length} spatial features on page ${page + 1}`}
            />
          </div>
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
          <table className={`pro-table ${loading ? "is-reloading" : ""}`}>
            <thead>
              <tr>
                <th className="th-index">#</th>
                <th className="th-actions">Actions</th>
                {columns.map((c) => {
                  const isPk = c.primaryKey;
                  const isSorted = sortColumn === c.name;

                  return (
                    <th
                      key={c.name}
                      onClick={() => handleHeaderClick(c.name)}
                      className={`th-column ${isSorted ? "sorted" : ""}`}
                      title={`Click to sort by ${c.name} (Shift-click to clear)`}
                    >
                      <div className="th-content">
                        <div className="th-col-main">
                          {isPk && (
                            <span title="Primary Key" className="pk-badge">
                              <Key size={11} className="pk-icon" />
                            </span>
                          )}
                          <span className="col-name">{c.name}</span>
                          <span className="col-type">{c.type}</span>
                        </div>
                        <span className="sort-icon-wrap">
                          {isSorted ? (
                            sortOrder === "ASC" ? (
                              <ArrowUp size={11} className="sort-active" />
                            ) : (
                              <ArrowDown size={11} className="sort-active" />
                            )
                          ) : (
                            <ArrowUpDown size={10} className="sort-idle" />
                          )}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {/* Client-side Newly Drafted Rows */}
              {newRows.map((nr, nIdx) => (
                <tr key={`new-${nIdx}`} className="row-new-draft">
                  <td className="row-index new-badge">NEW</td>
                  <td className="action-cell">
                    <button
                      className="icon-del-btn is-deleted"
                      onClick={() => setNewRows((prev) => prev.filter((_, i) => i !== nIdx))}
                      title="Discard drafted row"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                  {columns.map((c) => {
                    const val = nr[c.name];
                    const isAuto =
                      val === "__AUTO__" ||
                      (c.autoIncrement && (val === undefined || val === "__AUTO__"));

                    return (
                      <td
                        key={c.name}
                        className="cell-draft cell-editable"
                        onClick={() => openRowModal(nIdx, nr, true)}
                        title="Click to edit drafted values"
                      >
                        {isAuto ? (
                          <span className="auto-pill">
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
                    {loading ? (
                      t("loading", language)
                    ) : errorMessage ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", color: "var(--accent-red, #ef4444)" }}>
                        <AlertCircle size={22} />
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>{t("gridQueryError", language)}</span>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)", maxWidth: "480px" }}>{errorMessage}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => onRefresh()} style={{ marginTop: "4px" }}>
                          <RefreshCw size={11} />
                          <span>{t("gridRetry", language)}</span>
                        </button>
                      </div>
                    ) : (
                      t("gridNoData", language)
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => {
                  const pkKey = getRowKey(row, idx);
                  const isDeleted = deletedRowKeys.has(pkKey);
                  const rowEdits = editedCells[pkKey] || {};
                  const isRowEdited = Object.keys(rowEdits).length > 0;
                  const isSelected = selectedRowIndices.has(idx);

                  return (
                    <tr
                      key={pkKey}
                      className={`${isDeleted ? "row-deleted" : ""} ${isRowEdited ? "row-edited" : ""} ${isSelected ? "row-selected" : ""}`}
                      onClick={(e) => handleRowClick(e, idx)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        if (selectedRowIndices.has(idx) && selectedRowIndices.size > 1) {
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            rowIdx: idx,
                            row,
                            pkKey,
                          });
                        } else {
                          setSelectedRowIndices(new Set([idx]));
                          setLastSelectedRowIdx(idx);
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            rowIdx: idx,
                            row,
                            pkKey,
                          });
                        }
                      }}
                    >
                      <td
                        className="row-index"
                        onClick={(e) => handleIndexCellClick(e, idx)}
                        title="Click to select row (⌘-click to multi-select, Shift-click for range)"
                      >
                        {page * pageSize + idx + 1}
                      </td>
                      <td className="action-cell">
                        <div className="act-group">
                          <button
                            className="icon-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRowModal(idx, row, false);
                            }}
                            title="Edit Entire Row Modal"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            className="icon-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCell({ row: idx, col: pkColName, val: row });
                            }}
                            title="Inspect Full Row Data"
                          >
                            <FileText size={11} />
                          </button>
                          <button
                            className={`icon-del-btn ${isDeleted ? "active is-deleted" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRequestDeleteRow(pkKey, idx, row);
                            }}
                            title={isDeleted ? "Restore Row" : "Mark Row for Delete"}
                          >
                            <Trash2 size={11} />
                          </button>
                          {isDeleted && (
                            <button
                              className="icon-restore-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleDeleteRow(pkKey);
                              }}
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
                        const isGeomCol = isGeometryColumn(col.type, col.name) || (!isNull && isGisData(val));
                        const gisSummary = isGeomCol && !isNull ? formatGisSummary(val) : null;

                        // Check if this column is part of a coordinate pair
                        const matchingPair = coordinatePairs.find((p) => p.latColumn === col.name || p.lngColumn === col.name);
                        let pairCoords: { lat: number; lng: number } | null = null;
                        if (matchingPair && !isNull) {
                          const rawLat = row[matchingPair.latColumn];
                          const rawLng = row[matchingPair.lngColumn];
                          if (rawLat != null && rawLng != null) {
                            const latNum = typeof rawLat === "number" ? rawLat : parseFloat(String(rawLat));
                            const lngNum = typeof rawLng === "number" ? rawLng : parseFloat(String(rawLng));
                            if (isValidCoordinate(latNum, lngNum)) {
                              pairCoords = { lat: latNum, lng: lngNum };
                            }
                          }
                        }

                        return (
                          <td
                            key={col.name}
                            className={`cell-data ${isNull ? "cell-null" : ""} ${isEdited ? "cell-modified" : ""} ${isEditing ? "cell-editing" : ""}`}
                            onDoubleClick={() => startEditing(pkKey, false, undefined, col.name, val)}
                            title={gisSummary ? "Click badge to view on GIS map; double-click to edit" : pairCoords ? `Coordinate: ${pairCoords.lat}, ${pairCoords.lng} (Click pin to view on map)` : "Double-click to edit cell"}
                          >
                            {isEditing && (
                              <div className="inline-edit-wrap">
                                <input
                                  autoFocus
                                  type={isDateCol ? (col.type.toLowerCase().includes("timestamp") || col.type.toLowerCase().includes("datetime") ? "datetime-local" : "date") : "text"}
                                  className="cell-edit-input"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => saveCellEdit()}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") saveCellEdit();
                                    if (e.key === "Escape") setEditingCell(null);
                                  }}
                                />
                              </div>
                            )}
                            <div className={`cell-text-flow ${isEditing ? "cell-hidden-flow" : ""}`}>
                              {isNull ? (
                                <span className="null-tag">NULL</span>
                              ) : gisSummary ? (
                                <span
                                  className="gis-badge-pill"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setGisModalData({
                                      title: `${tableName} — ${col.name}`,
                                      subtitle: `Record #${page * pageSize + idx + 1}`,
                                      value: val,
                                    });
                                  }}
                                  title="Click to view spatial shape on interactive map"
                                >
                                  <Globe size={10} />
                                  <span>{gisSummary.label}</span>
                                </span>
                              ) : pairCoords ? (
                                <div className="coord-cell-content">
                                  <span>{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
                                  <button
                                    type="button"
                                    className="coord-pin-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setGisModalData({
                                        title: `${tableName} — ${matchingPair!.label}`,
                                        subtitle: `Record #${page * pageSize + idx + 1} (${pairCoords!.lat}, ${pairCoords!.lng})`,
                                        value: { type: "Point", coordinates: [pairCoords!.lng, pairCoords!.lat] },
                                      });
                                    }}
                                    title={language === "th" ? `ดูพิกัด (${pairCoords.lat}, ${pairCoords.lng}) บนแผนที่ GIS` : `View coordinates (${pairCoords.lat}, ${pairCoords.lng}) on GIS map`}
                                  >
                                    <MapPin size={10} />
                                  </button>
                                </div>
                              ) : typeof val === "object" ? (
                                JSON.stringify(val)
                              ) : (
                                String(val)
                              )}
                            </div>
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

      {/* Floating Multi-Row Selection Toolbar */}
      {selectedRowIndices.size > 0 && viewMode === "table" && (
        <div className="grid-floating-bar">
          <div className="bar-info">
            <span className="bar-count">{selectedRowIndices.size}</span>
            <span>{t("gridRowsSelected", language)}</span>
          </div>

          <div className="bar-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleCopySelectedRows("json")}
              title="Copy selected rows as JSON array"
            >
              <Copy size={12} />
              <span>{t("gridCopyJson", language)}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleCopySelectedRows("csv")}
              title="Copy selected rows as CSV"
            >
              <FileSpreadsheet size={12} />
              <span>{t("gridCopyCsv", language)}</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleCopySelectedRows("sql")}
              title="Copy selected rows as SQL INSERT statements"
            >
              <FileCode size={12} />
              <span>{t("gridCopySql", language)}</span>
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={handleBatchDeleteSelected}
              title="Mark selected rows for deletion"
            >
              <Trash2 size={12} />
              <span>{t("gridDeleteSelected", language, { count: selectedRowIndices.size })}</span>
            </button>
            <button
              type="button"
              className="btn-icon-clear"
              onClick={handleClearRowSelection}
              title="Clear selection (Esc)"
            >
              <X size={13} />
            </button>
          </div>

          {batchCopied && (
            <div className="bar-toast">
              <Check size={11} />
              <span>{batchCopied}!</span>
            </div>
          )}
        </div>
      )}

      <div className="grid-footer">
        <span className="pagination-info font-mono">
          {t("gridPageOf", language, { page: page + 1, totalPages, count: rows.length })}
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
                      ) : isGeometryColumn(col.type, col.name) ? (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <input
                            className="input form-input font-mono"
                            placeholder="POINT (100.5018 13.7563) or GeoJSON"
                            value={val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val)}
                            onChange={(e) =>
                              setRowEditModal({
                                ...rowEditModal,
                                data: { ...rowEditModal.data, [col.name]: e.target.value },
                              })
                            }
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setGisModalData({
                                title: `Pick Coordinates on Map: ${col.name}`,
                                subtitle: "Click on map to select Point coordinates",
                                value: val,
                                pickerMode: true,
                                onPick: (coords) => {
                                  setRowEditModal((prev) => {
                                    if (!prev) return null;
                                    return {
                                      ...prev,
                                      data: { ...prev.data, [col.name]: coords.wkt },
                                    };
                                  });
                                },
                              });
                            }}
                            title="Open interactive Map to pick coordinates"
                          >
                            <Globe size={12} />
                            <span>Pick on Map</span>
                          </button>
                        </div>
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
          {selectedRowIndices.size > 1 && selectedRowIndices.has(contextMenu.rowIdx) ? (
            <>
              <div className="context-menu-header">
                {selectedRowIndices.size} {t("gridRowsSelected", language)}
              </div>
              <button
                className="context-menu-item"
                onClick={() => {
                  handleCopySelectedRows("json");
                  setContextMenu(null);
                }}
              >
                <Copy size={13} />
                <span>{t("gridCopyJson", language)}</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  handleCopySelectedRows("csv");
                  setContextMenu(null);
                }}
              >
                <FileSpreadsheet size={13} />
                <span>{t("gridCopyCsv", language)}</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  handleCopySelectedRows("sql");
                  setContextMenu(null);
                }}
              >
                <FileCode size={13} />
                <span>{t("gridCopySql", language)}</span>
              </button>
              <div className="context-menu-separator" />
              <button
                className="context-menu-item danger"
                onClick={() => {
                  handleBatchDeleteSelected();
                  setContextMenu(null);
                }}
              >
                <Trash2 size={13} />
                <span>{t("gridDeleteSelected", language, { count: selectedRowIndices.size })}</span>
              </button>
              <div className="context-menu-separator" />
              <button
                className="context-menu-item"
                onClick={() => {
                  handleClearRowSelection();
                  setContextMenu(null);
                }}
              >
                <X size={13} />
                <span>{t("gridClearSelection", language)}</span>
              </button>
            </>
          ) : (
            <>
              <div className="context-menu-header">
                Row #{page * pageSize + contextMenu.rowIdx + 1}
              </div>
              <button
                className="context-menu-item"
                onClick={() => {
                  setInspectRowModal({ rowIdx: contextMenu.rowIdx, row: contextMenu.row, pkKey: contextMenu.pkKey });
                  setInspectSearchTerm("");
                  setContextMenu(null);
                }}
              >
                <Eye size={13} />
                <span>{t("gridInspectDetails", language)}</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  openRowModal(contextMenu.rowIdx, contextMenu.row, false);
                  setContextMenu(null);
                }}
              >
                <Edit3 size={13} />
                <span>{t("gridEditRecord", language)}</span>
              </button>
              {(() => {
                const rowPoints = extractPointFromRow(contextMenu.row, columns, coordinatePairs);
                const gCol = columns.find((c) => isGeometryColumn(c.type, c.name) && isGisData(contextMenu.row[c.name]));
                if (!gCol && rowPoints.length === 0) return null;

                return (
                  <button
                    className="context-menu-item"
                    onClick={() => {
                      if (gCol) {
                        setGisModalData({
                          title: `${tableName} — ${gCol.name}`,
                          subtitle: `Record #${page * pageSize + contextMenu.rowIdx + 1}`,
                          value: contextMenu.row[gCol.name],
                        });
                      } else if (rowPoints.length > 0) {
                        const pt = rowPoints[0];
                        setGisModalData({
                          title: `${tableName} — ${pt.label}`,
                          subtitle: `Record #${page * pageSize + contextMenu.rowIdx + 1} (${pt.coordinates[1]}, ${pt.coordinates[0]})`,
                          value: { type: "Point", coordinates: pt.coordinates },
                        });
                      }
                      setContextMenu(null);
                    }}
                  >
                    <Globe size={13} style={{ color: "var(--accent-blue)" }} />
                    <span>{t("gridViewOnMap", language)}</span>
                  </button>
                );
              })()}
              <button
                className="context-menu-item"
                onClick={() => {
                  const clone = { ...contextMenu.row };
                  columns.forEach((c) => {
                    if (c.autoIncrement || (c.primaryKey && c.type.toLowerCase().includes("int"))) {
                      clone[c.name] = "__AUTO__";
                    }
                  });
                  setNewRows([...newRows, clone]);
                  setContextMenu(null);
                }}
              >
                <Plus size={13} />
                <span>{t("gridDuplicateRow", language)}</span>
              </button>
              <div className="context-menu-separator" />
              <button
                className="context-menu-item"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(contextMenu.row, null, 2));
                  setContextMenu(null);
                }}
              >
                <Copy size={13} />
                <span>{t("gridCopyAsJson", language)}</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => {
                  const cols = Object.keys(contextMenu.row).filter((k) => contextMenu.row[k] !== undefined);
                  const colList = cols.map((c) => quoteIdent(c, dialect)).join(", ");
                  const qTable = tableName ? quoteTableIdent(tableName, dialect) : "table_name";
                  const valList = cols.map((c) => {
                    const v = contextMenu.row[c];
                    if (v === null) return "NULL";
                    if (typeof v === "number" || typeof v === "boolean") return String(v);
                    return `'${String(v).replace(/'/g, "''")}'`;
                  }).join(", ");
                  const sql = `INSERT INTO ${qTable} (${colList}) VALUES (${valList});`;
                  navigator.clipboard.writeText(sql);
                  setContextMenu(null);
                }}
              >
                <FileCode size={13} />
                <span>{t("gridCopyAsSql", language)}</span>
              </button>
              <div className="context-menu-separator" />
              <button
                className={`context-menu-item ${deletedRowKeys.has(contextMenu.pkKey) ? "" : "danger"}`}
                onClick={() => {
                  toggleDeleteRow(contextMenu.pkKey);
                  setContextMenu(null);
                }}
              >
                {deletedRowKeys.has(contextMenu.pkKey) ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                <span>{deletedRowKeys.has(contextMenu.pkKey) ? t("gridRestoreRecord", language) : t("gridDeleteRecord", language)}</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Detailed Searchable Row Inspector Modal */}
      {inspectRowModal && (
        <div className="row-detail-overlay" onClick={() => setInspectRowModal(null)}>
          <div className="row-detail-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="row-detail-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="gis-icon-tag">
                  <Eye size={15} />
                </div>
                <div>
                  <div className="gis-title">Record Details #{page * pageSize + inspectRowModal.rowIdx + 1}</div>
                  <div className="gis-subtitle">
                    Table: {tableName} &bull; {columns.length} columns
                  </div>
                </div>
              </div>

              {/* Live Search inside Row Fields */}
              <div className="row-detail-search-box">
                <Search size={13} style={{ color: "var(--text-muted)" }} />
                <input
                  className="row-detail-search-input font-mono"
                  placeholder="Search fields or values..."
                  value={inspectSearchTerm}
                  onChange={(e) => setInspectSearchTerm(e.target.value)}
                  autoFocus
                />
                {inspectSearchTerm && (
                  <button
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0 }}
                    onClick={() => setInspectSearchTerm("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <button className="gis-close-btn" onClick={() => setInspectRowModal(null)} title="Close (Esc)">
                <X size={15} />
              </button>
            </div>

            {/* Modal Body - Field Cards */}
            <div className="row-detail-body">
              {columns
                .filter((col) => {
                  if (!inspectSearchTerm.trim()) return true;
                  const term = inspectSearchTerm.toLowerCase();
                  const val = inspectRowModal.row[col.name];
                  const valStr = val === null || val === undefined ? "null" : typeof val === "object" ? JSON.stringify(val) : String(val);
                  return col.name.toLowerCase().includes(term) || col.type.toLowerCase().includes(term) || valStr.toLowerCase().includes(term);
                })
                .map((col) => {
                  const val = inspectRowModal.row[col.name];
                  const isNull = val === null || val === undefined;
                  const isGeom = isGeometryColumn(col.type, col.name) || (!isNull && isGisData(val));
                  const gisSum = isGeom && !isNull ? formatGisSummary(val) : null;
                  const valStr = isNull ? "NULL" : typeof val === "object" ? JSON.stringify(val, null, 2) : String(val);
                  const isMatch = inspectSearchTerm.trim().length > 0;

                  return (
                    <div key={col.name} className={`row-detail-field-card ${isMatch ? "highlighted" : ""}`}>
                      <div className="row-detail-field-header">
                        <div className="row-detail-field-meta">
                          {col.primaryKey && (
                            <span className="field-pk-badge font-mono" title="Primary Key">
                              <Key size={10} /> PK
                            </span>
                          )}
                          {col.autoIncrement && (
                            <span className="field-auto-badge font-mono" title="Auto Increment">
                              <Zap size={10} /> AUTO
                            </span>
                          )}
                          <span className="row-detail-field-name">{col.name}</span>
                          <span className="row-detail-field-type font-mono">{col.type}</span>
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
                                  title: `${tableName} — ${col.name}`,
                                  subtitle: `Record #${page * pageSize + inspectRowModal.rowIdx + 1}`,
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
                            onClick={() => {
                              navigator.clipboard.writeText(valStr);
                            }}
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

            {/* Modal Footer Actions */}
            <div className="row-detail-footer">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(inspectRowModal.row, null, 2));
                  }}
                  title="Copy full row as JSON"
                >
                  <Copy size={12} />
                  <span>Copy JSON</span>
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const cols = Object.keys(inspectRowModal.row).filter((k) => inspectRowModal.row[k] !== undefined);
                    const colList = cols.map((c) => quoteIdent(c, dialect)).join(", ");
                    const qTable = tableName ? quoteTableIdent(tableName, dialect) : "table_name";
                    const valList = cols.map((c) => {
                      const v = inspectRowModal.row[c];
                      if (v === null) return "NULL";
                      if (typeof v === "number" || typeof v === "boolean") return String(v);
                      return `'${String(v).replace(/'/g, "''")}'`;
                    }).join(", ");
                    const sql = `INSERT INTO ${qTable} (${colList}) VALUES (${valList});`;
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
                  className={`btn btn-sm ${deletedRowKeys.has(inspectRowModal.pkKey) ? "btn-secondary" : "btn-danger"}`}
                  onClick={() => {
                    toggleDeleteRow(inspectRowModal.pkKey);
                  }}
                >
                  {deletedRowKeys.has(inspectRowModal.pkKey) ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                  <span>{deletedRowKeys.has(inspectRowModal.pkKey) ? "Restore Record" : "Delete Record"}</span>
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const rIdx = inspectRowModal.rowIdx;
                    const rData = inspectRowModal.row;
                    setInspectRowModal(null);
                    openRowModal(rIdx, rData, false);
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
        .grid-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
          position: relative;
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
          display: inline-flex;
          align-items: center;
        }
        .search-icon-wrap {
          position: absolute;
          left: 8px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .search-input {
          padding-left: 26px;
          width: 160px;
          height: 26px;
          font-size: 11px;
          border-radius: var(--radius-sm);
          box-sizing: border-box;
        }

        /* Transaction Commit / Rollback Floating Dock */
        .transaction-bar {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 16px;
          background: var(--bg-card);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid var(--border-light);
          border-radius: 9999px;
          box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.45);
          font-size: 11.5px;
          color: var(--text-main);
          gap: 16px;
          animation: floatDockIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          white-space: nowrap;
          pointer-events: auto;
          max-width: calc(100vw - 32px);
        }
        .tx-info {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 500;
        }
        .tx-icon {
          flex-shrink: 0;
          color: #f59e0b;
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

        .status-bar-msg {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 1000;
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
          border: 1px solid var(--border-light);
          box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.45);
          animation: floatDockIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          white-space: nowrap;
          pointer-events: auto;
          max-width: calc(100vw - 32px);
        }
        .status-bar-msg.success {
          color: #34d399;
        }
        .status-bar-msg.error {
          color: #f87171;
        }

        @keyframes floatDockIn {
          from {
            opacity: 0;
            transform: translate(-50%, 14px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .grid-table-area {
          flex: 1;
          overflow: auto;
          position: relative;
        }

        .grid-loading-bar {
          position: sticky;
          top: 0;
          left: 0;
          right: 0;
          width: 100%;
          height: 2.5px;
          z-index: 25;
          overflow: hidden;
          background: rgba(59, 130, 246, 0.12);
        }

        .grid-loading-bar-inner {
          position: absolute;
          top: 0;
          left: 0;
          bottom: 0;
          width: 35%;
          background: var(--accent-blue, #3b82f6);
          animation: grid-indeterminate 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          border-radius: 2px;
          box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
        }

        @keyframes grid-indeterminate {
          0% {
            left: -35%;
            width: 35%;
          }
          50% {
            left: 30%;
            width: 50%;
          }
          100% {
            left: 100%;
            width: 35%;
          }
        }

        .pro-table.is-reloading {
          opacity: 0.65;
          transition: opacity 0.15s ease;
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
          font-weight: 600;
          user-select: none;
        }

        .th-index {
          width: 48px;
          min-width: 48px;
          max-width: 48px;
          text-align: center;
        }

        .th-actions {
          width: 76px;
          min-width: 76px;
          max-width: 76px;
          text-align: center;
        }

        .th-column {
          min-width: 140px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .th-column:hover {
          background: var(--bg-hover);
        }

        .th-column.sorted {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        .th-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-height: 18px;
        }

        .th-col-main {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          overflow: hidden;
        }

        .pk-badge {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
        }

        .pk-icon {
          color: #eab308;
          flex-shrink: 0;
        }

        .col-name {
          font-weight: 600;
          color: var(--text-main);
          font-size: 11.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .col-type {
          font-size: 9px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          background: var(--bg-card);
          padding: 1.5px 5px;
          border-radius: 3px;
          border: 1px solid var(--border-light);
          white-space: nowrap;
          flex-shrink: 0;
          text-transform: lowercase;
          font-weight: 500;
          line-height: 1.2;
        }

        .sort-icon-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          margin-left: 2px;
        }

        .sort-idle {
          color: var(--text-muted);
          opacity: 0.35;
          transition: opacity 0.15s ease, color 0.15s ease;
        }

        .th-column:hover .sort-idle {
          opacity: 0.85;
          color: var(--text-main);
        }

        .sort-active {
          color: var(--accent-primary, #3b82f6);
          opacity: 1;
        }

        .num-col { width: 48px; min-width: 48px; text-align: center; }
        .action-col { width: 76px; min-width: 76px; text-align: center; }

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
          border-color: rgba(239, 68, 68, 0.55);
          box-shadow: 0 12px 32px -4px rgba(0, 0, 0, 0.55), 0 4px 12px -2px rgba(239, 68, 68, 0.2);
          color: #f87171;
        }
        .tx-delete-highlight {
          color: #f87171;
          margin-left: 6px;
        }

        .pro-table td {
          position: relative;
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

        .cell-text-flow {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: inherit;
        }
        .cell-hidden-flow {
          visibility: hidden !important;
          pointer-events: none !important;
          user-select: none !important;
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

        .row-selected td {
          background: rgba(59, 130, 246, 0.16) !important;
          border-bottom-color: rgba(59, 130, 246, 0.3) !important;
        }
        .row-selected:hover td {
          background: rgba(59, 130, 246, 0.22) !important;
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

        .grid-floating-bar {
          position: fixed;
          bottom: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          box-shadow: var(--shadow-popup);
          border-radius: var(--radius-md);
          padding: 6px 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 999;
          animation: slideUpFloat 0.16s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUpFloat {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .bar-info {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-main);
        }
        .bar-count {
          background: var(--accent-blue);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          padding: 1.5px 6px;
          border-radius: 10px;
        }
        .bar-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .btn-icon-clear {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .btn-icon-clear:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .bar-toast {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: #10b981;
          font-weight: 600;
          animation: fadeIn 0.12s ease;
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

        .inline-edit-wrap {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          z-index: 5;
        }
        .cell-edit-input {
          width: 100%;
          height: 100%;
          padding: 4px 8px;
          font-size: 11.5px;
          font-family: inherit;
          background: var(--bg-card);
          border: 1.5px solid var(--accent-blue, #3b82f6);
          border-radius: var(--radius-xs, 3px);
          color: var(--text-main);
          outline: none;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
          box-sizing: border-box;
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
        .filter-unapplied-badge {
          font-size: 10px;
          padding: 1px 7px;
          background: rgba(234, 179, 8, 0.15);
          color: var(--accent-amber, #eab308);
          border: 1px solid rgba(234, 179, 8, 0.3);
          border-radius: var(--radius-full);
          font-weight: 600;
          animation: filterPulse 2s infinite ease-in-out;
        }
        @keyframes filterPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.65; }
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
        .filter-query-btn {
          padding: 5px 14px;
          font-size: 11.5px;
          font-weight: 600;
          gap: 6px;
          transition: all 0.15s ease;
        }
        .filter-query-btn-highlight {
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.35);
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

