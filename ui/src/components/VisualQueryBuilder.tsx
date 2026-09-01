import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant,
  Edge,
  Node,
  Connection,
  addEdge,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Workflow,
  Table2,
  Key,
  Search,
  RefreshCw,
  Play,
  Copy,
  Check,
  Download,
  Terminal,
  Filter,
  ArrowUpDown,
  Code2,
  Trash2,
  Plus,
  X,
  Layers,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  Globe,
  Zap,
  CheckCircle2,
  RotateCcw,
  Save,
  Edit2,
  GripHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  FileText,
} from "lucide-react";
import {
  ConnectionProfile,
  ColumnInfo,
  QueryExecutionResult,
  JoinType,
  VisualJoinInfo,
  VisualFilterCondition,
  VisualSortCondition,
  VisualFilterOperator,
  VisualGroupByCondition,
  VisualHavingCondition,
  VisualAggregateItem,
  AggregateFunction,
  DBType,
} from "../types";
import { apiClient } from "../utils/apiClient";
import { buildVisualSql, VisualTableSelection, findSmartJoinMatch, parseSqlToVisual } from "../utils/visualSqlBuilder";
import { quoteIdent, quoteTableIdent, sqlLiteral, toDialect } from "../utils/ddlBuilder";
import { isGeometryColumn } from "../utils/gisUtils";
import { extractColumnMappingsFromSql } from "../utils/sqlUtils";
import { setSharedSql, useSharedSql } from "../utils/queryWorkspaceStore";
import { PendingChanges, CommitResult } from "./DataGrid";
import { saveTextFileAsync } from "../utils/saveFile";
import { ContentEditorModal, ContentEditorData } from "./ContentEditorModal";
import { getContentInfo } from "../utils/contentDetection";

interface VisualQueryBuilderProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  tables: string[];
  theme?: "dark" | "light";
  onExecuteSql: (sql: string) => Promise<QueryExecutionResult>;
  onCommitChanges?: (changes: PendingChanges) => Promise<CommitResult>;
  onOpenInSqlConsole: (sql: string) => void;
}

interface TableNodeData {
  tableName: string;
  columns: ColumnInfo[];
  selectedColumns: Set<string>;
  filteredColumns?: Set<string>;
  onToggleColumn: (colName: string) => void;
  onSelectAllColumns: () => void;
  onClearColumns: () => void;
  onRemoveTable: () => void;
  onAddFilterFromColumn: (colName: string) => void;
}

interface FilterNodeData {
  filterId: string;
  table: string;
  column: string;
  operator: VisualFilterOperator;
  value: string;
  logic: "AND" | "OR";
  tablesList: string[];
  tableSchemas: Record<string, ColumnInfo[]>;
  onUpdateFilter: (id: string, updates: Partial<VisualFilterCondition>) => void;
  onRemoveFilter: (id: string) => void;
}

// 1. Custom ReactFlow Table Node (Clean Minimalist Native dodb Style)
const VisualTableNode: React.FC<NodeProps> = React.memo(function VisualTableNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as TableNodeData;
  const {
    tableName,
    columns = [],
    selectedColumns = new Set<string>(),
    filteredColumns = new Set<string>(),
    onToggleColumn,
    onSelectAllColumns,
    onClearColumns,
    onRemoveTable,
    onAddFilterFromColumn,
  } = nodeData;

  const allSelected = columns.length > 0 && selectedColumns.size === columns.length;

  return (
    <div className={`table-node-card ${selected ? "is-selected" : ""}`}>
      {/* Table Node Header */}
      <div className="table-card-header">
        <div className="table-card-title-group">
          <span className="table-icon-badge">
            <Table2 size={13} />
          </span>
          <div className="table-name-wrapper">
            <span className="table-name font-mono" title={tableName}>
              {tableName}
            </span>
            <span className="table-sub-count font-mono">{selectedColumns.size}/{columns.length} cols</span>
          </div>
        </div>
        <div className="table-header-actions nodrag" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="card-action-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              if (allSelected) {
                onClearColumns();
              } else {
                onSelectAllColumns();
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={allSelected ? "Deselect all columns" : "Select all columns"}
          >
            {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
          </button>
          <button
            type="button"
            className="card-action-btn remove-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveTable();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Remove table"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Columns List */}
      <div className="table-columns-list">
        {columns.map((col) => {
          const isChecked = selectedColumns.has(col.name);
          const isFiltered = filteredColumns.has(col.name);
          const isGeom = isGeometryColumn(col.type, col.name);

          return (
            <div
              key={col.name}
              className={`column-row ${isChecked ? "is-checked" : ""} ${isFiltered ? "is-filtered" : ""} ${col.primaryKey ? "is-pk" : ""}`}
              onClick={() => onToggleColumn(col.name)}
              title="Click to toggle column in SELECT, or drag handle to create JOIN or filter"
            >
              {/* Left Handle (Target) */}
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                className="column-snap-handle handle-left"
              />

              <div className="col-checkbox-wrapper nodrag" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleColumn(col.name)}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="col-checkbox nodrag"
                />
              </div>

              <div className="col-info-wrapper">
                <div className="col-name-box">
                  {col.primaryKey ? (
                    <span className="pk-tag font-mono" title="Primary Key">
                      <Key size={10} /> PK
                    </span>
                  ) : isGeom ? (
                    <span title="GIS Geometry Column">
                      <Globe size={11} className="col-geom-icon" />
                    </span>
                  ) : (
                    <span className="col-bullet" />
                  )}
                  <span className="col-name font-mono" title={col.name}>
                    {col.name}
                  </span>
                  {isFiltered && (
                    <span className="col-where-badge font-mono" title="Active WHERE filter connected">
                      <Filter size={8} /> WHERE
                    </span>
                  )}
                </div>
                <span className="col-type font-mono">{col.type}</span>
              </div>

              {/* Quick Filter Button */}
              <button
                type="button"
                className={`quick-col-filter-btn nodrag ${isFiltered ? "is-active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddFilterFromColumn(col.name);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Create or connect a WHERE filter for this column"
              >
                <Filter size={10} />
              </button>

              {/* Right Handle (Source) */}
              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                className="column-snap-handle handle-right"
              />
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .table-node-card {
          min-width: 250px;
          max-width: 320px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
          font-size: 12px;
          user-select: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .table-node-card.is-selected {
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35), var(--shadow-sm);
        }

        .table-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          gap: 8px;
        }

        .table-card-title-group {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .table-icon-badge {
          width: 22px;
          height: 22px;
          border-radius: var(--radius-xs);
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .table-name-wrapper {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .table-name {
          font-weight: 700;
          font-size: 12px;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .table-sub-count {
          font-size: 9.5px;
          color: var(--text-muted);
        }

        .table-header-actions {
          display: flex;
          align-items: center;
          gap: 3px;
        }

        .card-action-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.12s ease, color 0.12s ease;
        }

        .card-action-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        .card-action-btn.remove-btn:hover {
          background: rgba(239, 68, 68, 0.12);
          color: var(--accent-red);
        }

        .table-columns-list {
          max-height: 280px;
          overflow-y: auto;
          padding: 4px 0;
        }

        .column-row {
          position: relative;
          display: flex;
          align-items: center;
          padding: 5px 10px;
          cursor: pointer;
          gap: 8px;
          transition: background 0.12s ease;
        }

        .column-row:hover {
          background: var(--bg-hover);
        }

        .column-row.is-checked {
          background: rgba(59, 130, 246, 0.05);
        }

        .column-row.is-filtered {
          background: rgba(59, 130, 246, 0.12);
        }

        .col-where-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1px 4px;
          border-radius: var(--radius-xs);
          background: rgba(59, 130, 246, 0.2);
          color: var(--accent-blue);
          font-size: 8.5px;
          font-weight: 700;
        }

        .quick-col-filter-btn.is-active {
          color: var(--accent-blue);
          opacity: 1;
        }

        .col-checkbox-wrapper {
          display: flex;
          align-items: center;
        }

        .col-checkbox {
          cursor: pointer;
          accent-color: var(--accent-blue);
          width: 13px;
          height: 13px;
        }

        .col-info-wrapper {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          min-width: 0;
          gap: 8px;
        }

        .col-name-box {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .pk-tag {
          font-size: 8.5px;
          font-weight: 700;
          color: var(--accent-amber);
          background: rgba(245, 158, 11, 0.12);
          padding: 1px 4px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        :global(.col-geom-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .col-bullet {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--text-muted);
          flex-shrink: 0;
        }

        .col-name {
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .column-row.is-checked .col-name {
          color: var(--accent-blue);
          font-weight: 600;
        }

        .col-type {
          font-size: 10px;
          color: var(--text-muted);
          opacity: 0.8;
          flex-shrink: 0;
        }

        .quick-col-filter-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          opacity: 0;
          cursor: pointer;
          padding: 2px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          transition: opacity 0.12s ease, color 0.12s ease;
        }

        .column-row:hover .quick-col-filter-btn {
          opacity: 0.7;
        }

        .quick-col-filter-btn:hover {
          opacity: 1 !important;
          color: var(--accent-blue) !important;
          background: var(--bg-hover);
        }

        :global(.column-snap-handle) {
          width: 8px !important;
          height: 8px !important;
          background: var(--accent-blue) !important;
          border: 2px solid var(--bg-card) !important;
          border-radius: 50% !important;
          transition: transform 0.15s ease, background 0.15s ease;
        }

        :global(.column-snap-handle:hover) {
          transform: scale(1.5);
          background: #60a5fa !important;
        }
      `}</style>
    </div>
  );
});

// 2. Custom Filter Block Node (Clean Minimalist dodb Style)
const FilterBlockNode: React.FC<NodeProps> = React.memo(function FilterBlockNode({ data, selected }: NodeProps) {
  const filterData = data as unknown as FilterNodeData;
  const {
    filterId,
    table,
    column,
    operator,
    value,
    logic,
    tablesList = [],
    tableSchemas = {},
    onUpdateFilter,
    onRemoveFilter,
  } = filterData;

  const cols = tableSchemas[table] || [];

  // Buffer the value locally and commit on blur/Enter: committing per keystroke fans out
  // to setFilters + setNodes + setEdges and rebuilds every node on the canvas.
  const [draftValue, setDraftValue] = useState(value);
  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  return (
    <div className={`filter-block-card ${selected ? "is-selected" : ""}`}>
      {/* Target Snap Handle on Left */}
      <Handle
        type="target"
        position={Position.Left}
        id="filter-input-handle"
        className="filter-snap-handle handle-left"
      />

      {/* Block Header */}
      <div className="filter-card-header">
        <div className="filter-title-group">
          <Filter size={12} className="filter-header-icon" />
          <span className="filter-title font-mono">WHERE</span>
          {table && (
            <span className="filter-header-table-badge font-mono" title={`Filtering ${table}.${column}`}>
              <Table2 size={10} /> {table}.{column}
            </span>
          )}
        </div>
        <div className="filter-header-actions nodrag" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`logic-switch-btn font-mono nodrag ${logic === "OR" ? "is-or" : "is-and"}`}
            onClick={(e) => {
              e.stopPropagation();
              onUpdateFilter(filterId, { logic: logic === "AND" ? "OR" : "AND" });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Click to toggle logic (AND / OR)"
          >
            {logic}
          </button>
          <button
            type="button"
            className="filter-remove-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveFilter(filterId);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Remove Filter Block"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Block Body */}
      <div className="filter-card-body nodrag" onMouseDown={(e) => e.stopPropagation()}>
        <div className="filter-target-row nodrag">
          <select
            value={table}
            onChange={(e) => {
              const newTbl = e.target.value;
              const newCols = tableSchemas[newTbl] || [];
              onUpdateFilter(filterId, {
                table: newTbl,
                column: newCols[0]?.name || "",
              });
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="filter-select table-select font-mono nodrag"
            title="Select Table"
          >
            {tablesList.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <span className="filter-dot font-mono">.</span>

          <select
            value={column}
            onChange={(e) => onUpdateFilter(filterId, { column: e.target.value })}
            onMouseDown={(e) => e.stopPropagation()}
            className="filter-select col-select font-mono nodrag"
            title="Select Column"
          >
            {cols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-condition-row nodrag">
          <select
            value={operator}
            onChange={(e) =>
              onUpdateFilter(filterId, { operator: e.target.value as VisualFilterOperator })
            }
            onMouseDown={(e) => e.stopPropagation()}
            className="filter-select op-select font-mono nodrag"
          >
            <option value="=">= (Equals)</option>
            <option value="!=">!= (Not equals)</option>
            <option value=">">&gt; (Greater than)</option>
            <option value="<">&lt; (Less than)</option>
            <option value=">=">&gt;= (Greater or equal)</option>
            <option value="<=">&lt;= (Less or equal)</option>
            <option value="LIKE">LIKE (Contains)</option>
            <option value="NOT LIKE">NOT LIKE (Not contains)</option>
            <option value="IN">IN (...)</option>
            <option value="IS NULL">IS NULL</option>
            <option value="IS NOT NULL">IS NOT NULL</option>
          </select>

          {!["IS NULL", "IS NOT NULL"].includes(operator) && (
            <input
              type="text"
              placeholder={operator === "IN" ? "val1, val2" : "Value..."}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={() => {
                if (draftValue !== value) onUpdateFilter(filterId, { value: draftValue });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="filter-input value-input font-mono nodrag"
            />
          )}
        </div>
      </div>

      {/* Source Snap Handle on Right */}
      <Handle
        type="source"
        position={Position.Right}
        id="filter-output-handle"
        className="filter-snap-handle handle-right"
      />

      <style jsx>{`
        .filter-block-card {
          width: 260px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-sm);
          overflow: hidden;
          font-size: 11.5px;
          user-select: none;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .filter-block-card.is-selected {
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35), var(--shadow-sm);
        }

        .filter-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
        }

        .filter-title-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        :global(.filter-header-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .filter-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: var(--text-sub);
        }

        .filter-header-table-badge {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 1px 5px;
          border-radius: var(--radius-xs);
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          font-size: 9.5px;
          font-weight: 600;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .filter-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .logic-switch-btn {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .logic-switch-btn.is-and {
          color: var(--accent-blue);
        }

        .logic-switch-btn.is-or {
          color: var(--accent-purple);
        }

        .filter-remove-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
        }

        .filter-remove-btn:hover {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.12);
        }

        .filter-card-body {
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--bg-card);
        }

        .filter-target-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .filter-dot {
          color: var(--text-muted);
          font-weight: 700;
        }

        .filter-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 3px 6px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          outline: none;
          flex: 1;
          min-width: 0;
        }

        .filter-select:focus {
          border-color: var(--border-focus);
        }

        .filter-condition-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .op-select {
          flex: 1;
        }

        .filter-input {
          flex: 1.1;
          min-width: 0;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 3px 6px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          outline: none;
        }

        .filter-input:focus {
          border-color: var(--border-focus);
        }

        :global(.filter-snap-handle) {
          width: 8px !important;
          height: 8px !important;
          background: var(--accent-blue) !important;
          border: 2px solid var(--bg-card) !important;
          border-radius: 50% !important;
          transition: transform 0.15s ease;
        }

        :global(.filter-snap-handle:hover) {
          transform: scale(1.5);
          background: #60a5fa !important;
        }
      `}</style>
    </div>
  );
});

const NODE_TYPES = Object.freeze({
  visualTable: VisualTableNode,
  visualFilter: FilterBlockNode,
});

const EDGE_TYPES = Object.freeze({});

// Module-level so React Flow does not see a new object on every render.
const DEFAULT_EDGE_OPTIONS = Object.freeze({
  animated: true,
  style: { stroke: "var(--accent-blue)", strokeWidth: 2 },
});

export const VisualQueryBuilderInner: React.FC<VisualQueryBuilderProps> = ({
  activeProfile,
  activeDatabase,
  tables,
  theme = "dark",
  onExecuteSql,
  onCommitChanges,
  onOpenInSqlConsole,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [tableSchemas, setTableSchemas] = useState<Record<string, ColumnInfo[]>>({});
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Joins list
  const [joins, setJoins] = useState<VisualJoinInfo[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Filters & Sorting & Limit & Pagination
  const [filters, setFilters] = useState<VisualFilterCondition[]>([]);
  const [sorts, setSorts] = useState<VisualSortCondition[]>([]);
  const [groupBys, setGroupBys] = useState<VisualGroupByCondition[]>([]);
  const [aggregates, setAggregates] = useState<VisualAggregateItem[]>([]);
  const [havings, setHavings] = useState<VisualHavingCondition[]>([]);
  const [limit, setLimit] = useState<number>(50);
  const [page, setPage] = useState<number>(0);

  // Bottom drawer state (starts collapsed by default, expands on Run Query or tab click)
  const [bottomTab, setBottomTab] = useState<"results" | "sql" | "filters" | "sort" | "groupby">("results");
  const [drawerHeight, setDrawerHeight] = useState<number>(360);
  const [isDrawerCollapsed, setIsDrawerCollapsed] = useState(true);
  const [isDraggingResize, setIsDraggingResize] = useState<boolean>(false);

  // Query Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryExecutionResult | null>(null);
  const [lastExecutedSql, setLastExecutedSql] = useState<string>("");
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Results In-line Editing & Transaction State
  const [editedCells, setEditedCells] = useState<{ [rowIdx: number]: Record<string, unknown> }>({});
  const [deletedRowIndices, setDeletedRowIndices] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIdx: number; colName: string; originalVal: unknown } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [isSubmittingChanges, setIsSubmittingChanges] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<{ success: boolean; text: string } | null>(null);
  const [contentEditorModal, setContentEditorModal] = useState<ContentEditorData | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const { fitView } = useReactFlow();

  const numUpdates = Object.keys(editedCells).length;
  const numDeletes = deletedRowIndices.size;
  const totalPending = numUpdates + numDeletes;

  // "Latest value" refs. Callbacks that end up inside node `data` must not depend on
  // `nodes`/`filters`/`tableSchemas` directly, or their identity churns on every canvas
  // change and drags the whole rebuild chain along with it.
  const schemaFetchAttemptedRef = useRef<Set<string>>(new Set());
  const nodesRef = useRef(nodes);
  const tableSchemasRef = useRef(tableSchemas);
  const tablesRef = useRef(tables);
  useEffect(() => {
    nodesRef.current = nodes;
    tableSchemasRef.current = tableSchemas;
    tablesRef.current = tables;
  });

  // Load schemas and reset canvas when activeDatabase or activeProfile changes
  useEffect(() => {
    // Reset canvas elements for the new database
    setNodes([]);
    setEdges([]);
    setJoins([]);
    setFilters([]);
    setSorts([]);
    setGroupBys([]);
    setAggregates([]);
    setHavings([]);
    setPage(0);
    setQueryResult(null);
    setSelectedEdgeId(null);
    setTableSchemas({});
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setCommitMessage(null);
    schemaFetchAttemptedRef.current = new Set();

    if (!activeDatabase || !activeProfile) return;

    let isMounted = true;
    setLoadingSchemas(true);

    const loadAllSchemas = async () => {
      try {
        const schemaMap: Record<string, ColumnInfo[]> = {};

        try {
          const diagData: any = await apiClient.getSchemaDiagram(activeProfile.id, activeDatabase);
          if (diagData?.tables && Array.isArray(diagData.tables)) {
            for (const t of diagData.tables) {
              schemaMap[t.name] = t.columns || [];
            }
          }
        } catch (diagErr) {
          console.warn("getSchemaDiagram failed, falling back to getColumns:", diagErr);
        }

        // Fallback for any missing tables
        for (const tbl of tablesRef.current) {
          if (!schemaMap[tbl]) {
            try {
              const colData: any = await apiClient.getColumns(activeProfile.id, activeDatabase, tbl);
              if (colData?.columns) {
                schemaMap[tbl] = colData.columns;
              }
            } catch (e) {
              console.warn(`Failed to fetch schema for ${tbl}:`, e);
            }
          }
        }

        if (isMounted) {
          setTableSchemas(schemaMap);
        }
      } catch (err) {
        console.error("Error loading table schemas:", err);
      } finally {
        if (isMounted) setLoadingSchemas(false);
      }
    };

    loadAllSchemas();
    return () => {
      isMounted = false;
    };
    // Deliberately keyed on the profile id, not the profile object or the `tables` array:
    // the parent re-creates both, and depending on them silently wiped the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProfile?.id, activeDatabase, setNodes, setEdges]);

  // The reset effect above is deliberately not keyed on `tables`. Tables that show up
  // afterwards (or that getSchemaDiagram missed) get their columns filled in here —
  // without wiping the canvas the way the combined effect used to.
  useEffect(() => {
    if (!activeProfile || !activeDatabase || loadingSchemas) return;
    const missing = tables.filter(
      (t) => !tableSchemas[t] && !schemaFetchAttemptedRef.current.has(t)
    );
    if (missing.length === 0) return;

    let alive = true;
    missing.forEach((t) => schemaFetchAttemptedRef.current.add(t));
    (async () => {
      for (const tbl of missing) {
        try {
          const colData: any = await apiClient.getColumns(activeProfile.id, activeDatabase, tbl);
          if (alive && colData?.columns) {
            setTableSchemas((prev) => (prev[tbl] ? prev : { ...prev, [tbl]: colData.columns }));
          }
        } catch (e) {
          console.warn(`Failed to fetch schema for ${tbl}:`, e);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [tables, activeProfile, activeDatabase, tableSchemas, loadingSchemas]);

  // Selected table names on canvas
  const canvasTableNames = useMemo(() => {
    return nodes
      .filter((n) => n.type === "visualTable")
      .map((n) => (n.data as any).tableName as string);
  }, [nodes]);

  // Stable handler indirection: everything stored in a node's `data` keeps its
  // referential identity forever, so rebuilding nodes never invalidates memoized
  // node components (and never re-triggers effects that depend on these callbacks).
  const handlersRef = useRef({
    toggleColumnSelection: (_t: string, _c: string) => {},
    selectAllColumns: (_t: string) => {},
    clearColumns: (_t: string) => {},
    removeTable: (_t: string) => {},
    addFilterFromColumn: (_t: string, _c: string) => {},
    updateFilter: (_id: string, _updates: Partial<VisualFilterCondition>) => {},
    removeFilter: (_id: string) => {},
  });

  const tableHandlerCache = useRef(
    new Map<
      string,
      Pick<
        TableNodeData,
        "onToggleColumn" | "onSelectAllColumns" | "onClearColumns" | "onRemoveTable" | "onAddFilterFromColumn"
      >
    >()
  );

  const getTableHandlers = useCallback((tableName: string) => {
    let cached = tableHandlerCache.current.get(tableName);
    if (!cached) {
      cached = {
        onToggleColumn: (col: string) => handlersRef.current.toggleColumnSelection(tableName, col),
        onSelectAllColumns: () => handlersRef.current.selectAllColumns(tableName),
        onClearColumns: () => handlersRef.current.clearColumns(tableName),
        onRemoveTable: () => handlersRef.current.removeTable(tableName),
        onAddFilterFromColumn: (col: string) => handlersRef.current.addFilterFromColumn(tableName, col),
      };
      tableHandlerCache.current.set(tableName, cached);
    }
    return cached;
  }, []);

  const filterHandlers = useMemo(
    () => ({
      onUpdateFilter: (id: string, updates: Partial<VisualFilterCondition>) =>
        handlersRef.current.updateFilter(id, updates),
      onRemoveFilter: (id: string) => handlersRef.current.removeFilter(id),
    }),
    []
  );

  // Handle column selection toggle
  const toggleColumnSelection = useCallback(
    (tableName: string, colName: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if ((n.data as any).tableName === tableName) {
            const currentSelected = new Set<string>((n.data as any).selectedColumns);
            if (currentSelected.has(colName)) {
              currentSelected.delete(colName);
            } else {
              currentSelected.add(colName);
            }
            return {
              ...n,
              data: {
                ...n.data,
                selectedColumns: currentSelected,
              },
            };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  // Select all / Clear columns
  const selectAllColumns = useCallback(
    (tableName: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if ((n.data as any).tableName === tableName) {
            const allCols = ((n.data as any).columns as ColumnInfo[]).map((c) => c.name);
            return {
              ...n,
              data: {
                ...n.data,
                selectedColumns: new Set(allCols),
              },
            };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  const clearColumns = useCallback(
    (tableName: string) => {
      setNodes((nds) =>
        nds.map((n) => {
          if ((n.data as any).tableName === tableName) {
            return {
              ...n,
              data: {
                ...n.data,
                selectedColumns: new Set<string>(),
              },
            };
          }
          return n;
        })
      );
    },
    [setNodes]
  );

  // Synchronize filteredColumns on table nodes whenever filters list changes
  useEffect(() => {
    const filterMap: Record<string, Set<string>> = {};
    filters.forEach((f) => {
      if (f.table && f.column) {
        if (!filterMap[f.table]) filterMap[f.table] = new Set();
        filterMap[f.table].add(f.column);
      }
    });

    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        if (n.type !== "visualTable") return n;
        const tName = (n.data as any).tableName;
        const nextFiltered = filterMap[tName] || new Set<string>();
        const prevFiltered: Set<string> = (n.data as any).filteredColumns || new Set<string>();
        // Skip the allocation entirely when this table's filtered columns are unchanged,
        // otherwise every keystroke in a filter value rebuilds every table node.
        if (
          prevFiltered.size === nextFiltered.size &&
          Array.from(nextFiltered).every((c) => prevFiltered.has(c))
        ) {
          return n;
        }
        changed = true;
        return { ...n, data: { ...n.data, filteredColumns: nextFiltered } };
      });
      return changed ? next : nds;
    });
  }, [filters, setNodes]);

  // Filter conditions handlers
  const updateFilter = useCallback(
    (id: string, updates: Partial<VisualFilterCondition>) => {
      setFilters((prev) => {
        const next = prev.map((f) => (f.id === id ? { ...f, ...updates } : f));
        return next;
      });

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === id) {
            return {
              ...n,
              data: {
                ...n.data,
                ...updates,
              },
            };
          }
          return n;
        })
      );

      // Re-link edge whenever table or column is changed in the filter block
      setEdges((eds) => {
        const otherEdges = eds.filter((e) => e.target !== id);
        const targetTable = updates.table;
        const targetCol = updates.column;
        if (targetTable && targetCol) {
          const edgeId = `edge-filter-${targetTable}-${targetCol}-${id}`;
          const newEdge: Edge = {
            id: edgeId,
            source: `table-${targetTable}`,
            sourceHandle: `${targetCol}-source`,
            target: id,
            targetHandle: "filter-input-handle",
            animated: true,
            style: { stroke: "var(--accent-blue)", strokeWidth: 2, strokeDasharray: "4,4" },
            label: "WHERE",
            labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 9 },
            labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
          };
          return [...otherEdges, newEdge];
        }
        return eds;
      });
    },
    [setNodes, setEdges]
  );

  const removeFilter = useCallback(
    (id: string) => {
      setFilters((prev) => prev.filter((f) => f.id !== id));
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges]
  );

  // Add Visual Filter Block to Canvas
  const addFilterBlockToCanvas = useCallback(
    (targetTable?: string, targetColumn?: string, pos?: { x: number; y: number }) => {
      const currentTableNames = nodesRef.current
        .filter((n) => n.type === "visualTable")
        .map((n) => (n.data as any).tableName as string);
      const defaultTable = targetTable || currentTableNames[0] || tablesRef.current[0] || "";
      const defaultCol =
        targetColumn || tableSchemasRef.current[defaultTable]?.[0]?.name || "id";
      const filterId = `filter-${Date.now()}`;

      const newFilter: VisualFilterCondition = {
        id: filterId,
        table: defaultTable,
        column: defaultCol,
        operator: "=",
        value: "",
        logic: "AND",
      };

      setFilters((prev) => [...prev, newFilter]);

      // Calculate position neatly aligned next to the parent table node
      setNodes((nds) => {
        const parentNode = nds.find((n) => n.id === `table-${defaultTable}`);
        const sameTableFilters = nds.filter(
          (n) => n.type === "visualFilter" && (n.data as any).table === defaultTable
        );
        const position = pos || (parentNode ? {
          x: parentNode.position.x + 320,
          y: parentNode.position.y + 30 + sameTableFilters.length * 135,
        } : {
          x: 420 + Math.random() * 40,
          y: 100 + nds.filter((n) => n.type === "visualFilter").length * 135,
        });

        const filterNode: Node = {
          id: filterId,
          type: "visualFilter",
          position,
          data: {
            filterId,
            table: defaultTable,
            column: defaultCol,
            operator: "=",
            value: "",
            logic: "AND",
            tablesList: currentTableNames.length > 0 ? currentTableNames : tablesRef.current,
            tableSchemas: tableSchemasRef.current,
            ...filterHandlers,
          },
        };

        return [...nds, filterNode];
      });

      // Always create connected edge from table column to filter block!
      if (defaultTable && defaultCol) {
        const edgeId = `edge-filter-${defaultTable}-${defaultCol}-${filterId}`;
        const newEdge: Edge = {
          id: edgeId,
          source: `table-${defaultTable}`,
          sourceHandle: `${defaultCol}-source`,
          target: filterId,
          targetHandle: "filter-input-handle",
          animated: true,
          style: { stroke: "var(--accent-blue)", strokeWidth: 2, strokeDasharray: "4,4" },
          label: "WHERE",
          labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 9 },
          labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
        };
        setEdges((eds) => [...eds, newEdge]);
      }
    },
    [filterHandlers, setNodes, setEdges]
  );

  // Remove table from canvas
  const removeTable = useCallback(
    (tableName: string) => {
      const nodeId = `table-${tableName}`;
      setNodes((nds) => nds.filter((n) => (n.data as any).tableName !== tableName));
      // Match on node ids, not on the joins list: filter edges (`edge-filter-...`) have
      // no matching join and used to survive as edges pointing at a deleted node.
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setJoins((prev) => prev.filter((j) => j.fromTable !== tableName && j.toTable !== tableName));
      setFilters((prev) => prev.filter((f) => f.table !== tableName));
      setSorts((prev) => prev.filter((s) => s.table !== tableName));
    },
    [setNodes, setEdges]
  );

  // Keep the stable wrappers pointing at the current callbacks.
  useEffect(() => {
    handlersRef.current = {
      toggleColumnSelection,
      selectAllColumns,
      clearColumns,
      removeTable,
      addFilterFromColumn: (t: string, c: string) => addFilterBlockToCanvas(t, c),
      updateFilter,
      removeFilter,
    };
  });

  // Add table to canvas
  const addTableToCanvas = useCallback(
    (tableName: string, position?: { x: number; y: number }) => {
      if (canvasTableNames.includes(tableName)) return;

      const cols = tableSchemas[tableName] || [];
      const colNames = cols.map((c) => c.name);

      const defaultPos = position || {
        x: 60 + canvasTableNames.length * 300,
        y: 60 + (canvasTableNames.length % 2) * 40,
      };

      const newNode: Node = {
        id: `table-${tableName}`,
        type: "visualTable",
        position: defaultPos,
        data: {
          tableName,
          columns: cols,
          selectedColumns: new Set(colNames), // default select all columns
          ...getTableHandlers(tableName),
        },
      };

      setNodes((nds) => [...nds, newNode]);

      // Smart Auto-Join Suggestion: check against existing canvas tables using heuristic matching
      for (const existingTblName of canvasTableNames) {
        const existingCols = tableSchemas[existingTblName] || [];
        const match = findSmartJoinMatch(existingTblName, existingCols, tableName, cols);

        if (match && match.score >= 70) {
          const joinId = `join-${match.fromTable}-${match.fromColumn}-${match.toTable}-${match.toColumn}-${Date.now()}`;
          const newJoin: VisualJoinInfo = {
            id: joinId,
            joinType: "INNER",
            fromTable: match.fromTable,
            fromColumn: match.fromColumn,
            toTable: match.toTable,
            toColumn: match.toColumn,
          };

          setJoins((prev) => [...prev, newJoin]);
          setEdges((eds) => [
            ...eds,
            {
              id: joinId,
              source: `table-${match.fromTable}`,
              sourceHandle: `${match.fromColumn}-source`,
              target: `table-${match.toTable}`,
              targetHandle: `${match.toColumn}-target`,
              animated: true,
              style: { stroke: "var(--accent-blue)", strokeWidth: 2 },
              label: "INNER JOIN",
              labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 10 },
              labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 4 },
              markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
            },
          ]);
          break;
        }
      }
    },
    [canvasTableNames, tableSchemas, setNodes, setEdges, getTableHandlers]
  );

  // Auto-Connect All Tables on Canvas
  const handleAutoConnectAll = () => {
    if (canvasTableNames.length < 2) return;

    for (let i = 0; i < canvasTableNames.length; i++) {
      for (let k = i + 1; k < canvasTableNames.length; k++) {
        const tblA = canvasTableNames[i];
        const tblB = canvasTableNames[k];
        const colsA = tableSchemas[tblA] || [];
        const colsB = tableSchemas[tblB] || [];

        // Check if already joined
        const alreadyJoined = joins.some(
          (j) =>
            (j.fromTable === tblA && j.toTable === tblB) ||
            (j.fromTable === tblB && j.toTable === tblA)
        );

        if (!alreadyJoined) {
          const match = findSmartJoinMatch(tblA, colsA, tblB, colsB);
          if (match && match.score >= 70) {
            const joinId = `join-${match.fromTable}-${match.fromColumn}-${match.toTable}-${match.toColumn}-${Date.now()}`;
            const newJoin: VisualJoinInfo = {
              id: joinId,
              joinType: "INNER",
              fromTable: match.fromTable,
              fromColumn: match.fromColumn,
              toTable: match.toTable,
              toColumn: match.toColumn,
            };
            setJoins((prev) => [...prev, newJoin]);
            setEdges((eds) => [
              ...eds,
              {
                id: joinId,
                source: `table-${match.fromTable}`,
                sourceHandle: `${match.fromColumn}-source`,
                target: `table-${match.toTable}`,
                targetHandle: `${match.toColumn}-target`,
                animated: true,
                style: { stroke: "var(--accent-blue)", strokeWidth: 2 },
                label: "INNER JOIN",
                labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 10 },
                labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 4 },
                markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
              },
            ]);
          }
        }
      }
    }
  };

  // Clear all canvas items
  const handleClearCanvas = () => {
    setNodes([]);
    setEdges([]);
    setJoins([]);
    setFilters([]);
    setSorts([]);
    setQueryResult(null);
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setCommitMessage(null);
  };

  // Handle new connection (drag & drop line between handles)
  const onConnect = useCallback(
    (params: Connection) => {
      const sourceNodeId = params.source || "";
      const targetNodeId = params.target || "";
      const sourceHandle = params.sourceHandle || "";
      const targetHandle = params.targetHandle || "";

      if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;

      // Check if connecting to a Filter Block
      if (targetNodeId.startsWith("filter-")) {
        const fromTable = sourceNodeId.replace(/^table-/, "");
        const fromColumn = sourceHandle.replace(/-source$|-target$/, "");

        updateFilter(targetNodeId, {
          table: fromTable,
          column: fromColumn,
        });

        const filterEdgeId = `edge-filter-${sourceNodeId}-${targetNodeId}-${Date.now()}`;
        const newEdge: Edge = {
          id: filterEdgeId,
          source: sourceNodeId,
          sourceHandle: params.sourceHandle,
          target: targetNodeId,
          targetHandle: params.targetHandle,
          animated: true,
          style: { stroke: "var(--accent-blue)", strokeWidth: 2, strokeDasharray: "4,4" },
          label: "FILTER",
          labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 9 },
          labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 3 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
        };

        setEdges((eds) => addEdge(newEdge, eds));
        return;
      }

      // Normal Table-to-Table JOIN connection
      const fromTable = sourceNodeId.replace(/^table-/, "");
      const toTable = targetNodeId.replace(/^table-/, "");
      const fromColumn = sourceHandle.replace(/-source$|-target$/, "");
      const toColumn = targetHandle.replace(/-source$|-target$/, "");

      const joinId = `join-${fromTable}-${fromColumn}-${toTable}-${toColumn}-${Date.now()}`;
      const newJoin: VisualJoinInfo = {
        id: joinId,
        joinType: "INNER",
        fromTable,
        fromColumn,
        toTable,
        toColumn,
      };

      setJoins((prev) => [...prev, newJoin]);

      const newEdge: Edge = {
        id: joinId,
        source: sourceNodeId,
        sourceHandle: params.sourceHandle,
        target: targetNodeId,
        targetHandle: params.targetHandle,
        animated: true,
        style: { stroke: "var(--accent-blue)", strokeWidth: 2 },
        label: "INNER JOIN",
        labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 10 },
        labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 4 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
      };

      setEdges((eds) => addEdge(newEdge, eds));
    },
    [setEdges, updateFilter]
  );

  // Cycle join type on edge click
  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      setSelectedEdgeId(edge.id);
    },
    []
  );

  const updateJoinType = useCallback(
    (edgeId: string, newType: JoinType) => {
      setJoins((prev) =>
        prev.map((j) => (j.id === edgeId ? { ...j, joinType: newType } : j))
      );
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id === edgeId) {
            return {
              ...e,
              label: `${newType} JOIN`,
            };
          }
          return e;
        })
      );
    },
    [setEdges]
  );

  const deleteJoin = useCallback(
    (edgeId: string) => {
      setJoins((prev) => prev.filter((j) => j.id !== edgeId));
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdgeId(null);
    },
    [setEdges]
  );

  // Generate current SQL query from Canvas State.
  // xyflow replaces the whole `nodes` array on every pointer move during a drag, so the
  // SQL is memoized on a cheap value-signature of the selections instead — dragging a
  // node no longer re-runs buildVisualSql (and its O(n^2) join ordering) per mousemove.
  const selectionKey = useMemo(() => {
    const tableSelections: VisualTableSelection[] = nodes
      .filter((n) => n.type === "visualTable")
      .map((n) => {
        const d = n.data as any;
        return {
          tableName: d.tableName,
          selectedColumns: Array.from(d.selectedColumns || []) as string[],
        };
      });
    return JSON.stringify(tableSelections);
  }, [nodes]);

  const generatedSql = useMemo(() => {
    const dialect: DBType = activeProfile?.type || "mariadb";

    return buildVisualSql({
      tables: JSON.parse(selectionKey) as VisualTableSelection[],
      joins,
      filters,
      sorts,
      groupBys,
      having: havings,
      aggregates,
      limit,
      offset: page > 0 ? page * limit : undefined,
      dbType: dialect,
    });
  }, [selectionKey, joins, filters, sorts, groupBys, havings, aggregates, limit, page, activeProfile?.type]);

  // SQL text is shared with the SQL console tab (module-level store, survives unmount).
  const sqlText = useSharedSql();
  const [sqlParseError, setSqlParseError] = useState<string | null>(null);
  const lastPushedSqlRef = useRef<string | null>(null);
  // Bumped by an explicit "Sync to Canvas" so the canvas re-asserts its canonical SQL
  // even when the rebuild happened to produce an identical query.
  const [canvasRevision, setCanvasRevision] = useState(0);
  const sqlTextRef = useRef(sqlText);
  useEffect(() => {
    sqlTextRef.current = sqlText;
  });

  // Canvas -> SQL, automatic. Guarded by value (not by a one-shot flag): a flag that is
  // only cleared when `generatedSql` happens to change would silently swallow the next
  // genuine canvas edit whenever a sync produced an identical string.
  useEffect(() => {
    // An empty canvas emits a "-- Drag or add tables..." comment; never let that
    // clobber SQL the user typed in the SQL console tab.
    if (!generatedSql || generatedSql.trim().startsWith("--")) {
      // Canvas emptied: forget what we last published so the next real query always
      // gets pushed, even if it happens to match the one before the canvas was cleared.
      lastPushedSqlRef.current = null;
      return;
    }
    if (generatedSql === lastPushedSqlRef.current) return;
    lastPushedSqlRef.current = generatedSql;
    setSharedSql(generatedSql);
    setSqlParseError(null);
  }, [generatedSql, canvasRevision]);

  // Apply SQL Text -> Canvas State
  const handleSyncSqlToCanvas = useCallback(
    (customSql?: string) => {
      const targetSql = customSql !== undefined ? customSql : sqlTextRef.current;
      if (!targetSql || targetSql.trim().startsWith("--")) return;

      const tableSchemas = tableSchemasRef.current;
      const parsed = parseSqlToVisual(targetSql, tableSchemas);
      if (!parsed || parsed.tables.length === 0) {
        setSqlParseError("Unable to parse SQL query. Please check SELECT and FROM clauses.");
        return;
      }

      setSqlParseError(null);

      // Asynchronously fetch schema for any table not yet in tableSchemas
      if (activeProfile && activeDatabase) {
        parsed.tables.forEach(async (tbl) => {
          if (!tableSchemas[tbl.tableName]) {
            try {
              const res: any = await apiClient.getColumns(activeProfile.id, activeDatabase, tbl.tableName);
              if (res?.columns) {
                setTableSchemas((prev) => ({ ...prev, [tbl.tableName]: res.columns }));
              }
            } catch (e) {
              console.warn("Could not fetch schema for table:", tbl.tableName, e);
            }
          }
        });
      }

      // 1. Rebuild Table Nodes, keeping wherever the user already dragged them
      const prevNodes = nodesRef.current;
      const prevPositions = new Map(prevNodes.map((n) => [n.id, n.position]));
      const prevNodeIds = new Set(prevNodes.map((n) => n.id));
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];

      parsed.tables.forEach((tbl, idx) => {
        const cols = tableSchemas[tbl.tableName] || [];
        const selectedColsSet = new Set(
          tbl.selectedColumns.length > 0 ? tbl.selectedColumns : cols.map((c) => c.name)
        );

        const nodeId = `table-${tbl.tableName}`;
        const defaultPos = prevPositions.get(nodeId) || {
          x: 60 + idx * 300,
          y: 60 + (idx % 2) * 40,
        };

        newNodes.push({
          id: nodeId,
          type: "visualTable",
          position: defaultPos,
          data: {
            tableName: tbl.tableName,
            columns: cols,
            selectedColumns: selectedColsSet,
            ...getTableHandlers(tbl.tableName),
          },
        });
      });

      // 2. Rebuild JOIN Edges
      parsed.joins.forEach((j) => {
        newEdges.push({
          id: j.id,
          source: `table-${j.fromTable}`,
          sourceHandle: `${j.fromColumn}-source`,
          target: `table-${j.toTable}`,
          targetHandle: `${j.toColumn}-target`,
          animated: true,
          style: { stroke: "var(--accent-blue)", strokeWidth: 2 },
          label: `${j.joinType} JOIN`,
          labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 10 },
          labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 4 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
        });
      });

      // 3. Rebuild Filter Block Nodes and Edges directly linked to parent table
      const sameTableCount: Record<string, number> = {};
      parsed.filters.forEach((f, idx) => {
        const parentTableNode = newNodes.find((n) => n.id === `table-${f.table}`);
        const count = sameTableCount[f.table] || 0;
        sameTableCount[f.table] = count + 1;

        const filterPos =
          prevPositions.get(f.id) ||
          (parentTableNode
            ? {
                x: parentTableNode.position.x + 320,
                y: parentTableNode.position.y + 30 + count * 135,
              }
            : {
                x: 420 + (idx % 3) * 280,
                y: 340 + Math.floor(idx / 3) * 160,
              });

        const filterNode: Node = {
          id: f.id,
          type: "visualFilter",
          position: filterPos,
          data: {
            filterId: f.id,
            table: f.table,
            column: f.column,
            operator: f.operator,
            value: f.value,
            logic: f.logic,
            tablesList: parsed.tables.map((t) => t.tableName),
            tableSchemas,
            ...filterHandlers,
          },
        };
        newNodes.push(filterNode);

        if (f.table && f.column) {
          newEdges.push({
            id: `edge-filter-${f.table}-${f.column}-${f.id}`,
            source: `table-${f.table}`,
            sourceHandle: `${f.column}-source`,
            target: f.id,
            targetHandle: "filter-input-handle",
            animated: true,
            style: { stroke: "var(--accent-blue)", strokeWidth: 2, strokeDasharray: "4,4" },
            label: "WHERE",
            labelStyle: { fill: "var(--text-main)", fontWeight: 700, fontSize: 9 },
            labelBgStyle: { fill: "var(--bg-card)", stroke: "var(--border-light)", strokeWidth: 1, rx: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: "var(--accent-blue)" },
          });
        }
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setJoins(parsed.joins);
      setFilters(parsed.filters);
      setSorts(parsed.sorts);
      setGroupBys(parsed.groupBys || []);
      setHavings(parsed.having || []);
      setAggregates(parsed.aggregates || []);
      setLimit(parsed.limit);
      // The canvas we just built is now authoritative: re-publish its canonical SQL.
      lastPushedSqlRef.current = null;
      setCanvasRevision((r) => r + 1);

      // Only re-frame when the set of nodes actually changed; refitting on every sync
      // yanks the viewport out from under the user.
      const addedNode = newNodes.some((n) => !prevNodeIds.has(n.id));
      const removedNode = newNodes.length !== prevNodes.length;
      if (addedNode || removedNode) {
        setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
      }
    },
    [
      activeProfile,
      activeDatabase,
      setNodes,
      setEdges,
      getTableHandlers,
      filterHandlers,
      fitView,
    ]
  );

  const miniMapNodeColor = useCallback(
    () => (theme === "dark" ? "#3b82f6" : "#2563eb"),
    [theme]
  );

  // True when the SQL text has drifted away from what the canvas describes.
  const sqlDivergedFromCanvas = useMemo(() => {
    if (!sqlText.trim() || sqlText.trim().startsWith("--")) return false;
    return sqlText.trim() !== generatedSql.trim();
  }, [sqlText, generatedSql]);

  // Execute Query
  const handleRunQuery = async (customPage?: number) => {
    const activePg = customPage !== undefined ? customPage : page;
    const dialect: DBType = activeProfile?.type || "mariadb";
    const queryToRun = buildVisualSql({
      tables: JSON.parse(selectionKey) as VisualTableSelection[],
      joins,
      filters,
      sorts,
      limit,
      offset: activePg > 0 ? activePg * limit : undefined,
      dbType: dialect,
    });

    if (!queryToRun || queryToRun.startsWith("--")) return;

    setIsExecuting(true);
    setQueryResult(null);
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setCommitMessage(null);
    setBottomTab("results");
    if (isDrawerCollapsed) setIsDrawerCollapsed(false);
    const startTime = performance.now();

    try {
      setLastExecutedSql(queryToRun);
      const res = await onExecuteSql(queryToRun);
      const duration = performance.now() - startTime;
      setExecutionTimeMs(Math.round(duration));
      setQueryResult(res);
    } catch (err: any) {
      setQueryResult({
        error: err?.message || "Failed to execute query",
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Resizer drag handler
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingResize(true);
    const startY = e.clientY;
    const startHeight = drawerHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const maxH = Math.max(400, window.innerHeight * 0.85);
      const newHeight = Math.max(140, Math.min(maxH, startHeight + delta));
      setDrawerHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingResize(false);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // Helper to lookup column type from schemas
  const findColType = useCallback((fieldName: string): string | undefined => {
    const colOnly = fieldName.includes(".") ? fieldName.split(".").pop()! : fieldName;
    for (const tbl of Object.keys(tableSchemas)) {
      const matched = tableSchemas[tbl]?.find((c) => c.name === colOnly || c.name === fieldName);
      if (matched?.type) return matched.type;
    }
    return undefined;
  }, [tableSchemas]);

  // Open Content / Rich Text Editor Modal for cell in Visual Query Builder
  const openContentEditor = useCallback((
    rIdx: number,
    colName: string,
    currentVal: unknown,
    colType?: string
  ) => {
    setContentEditorModal({
      title: `Query Result — ${colName}`,
      subtitle: `Row #${rIdx + 1}`,
      colName,
      colType: colType || findColType(colName),
      value: currentVal,
      onSave: (newVal) => {
        setEditedCells((prev) => ({
          ...prev,
          [rIdx]: {
            ...(prev[rIdx] || {}),
            [colName]: newVal,
          },
        }));
      },
      onClose: () => setContentEditorModal(null),
    });
  }, [findColType]);

  // Start inline editing
  const startEditing = (rowIdx: number, colName: string, currentVal: unknown) => {
    setEditingCell({ rowIdx, colName, originalVal: currentVal });
    setEditValue(currentVal === null || currentVal === undefined ? "" : String(currentVal));
  };

  // Coerce value based on column definition or raw type
  const coerceValue = (rawStr: string, origVal: unknown): unknown => {
    if (rawStr === "" && origVal === null) return null;
    const trimmed = rawStr.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isSafeInteger(n)) return n;
    }
    if (/^-?\d+\.\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    if (["true", "t", "1"].includes(trimmed.toLowerCase())) return true;
    if (["false", "f", "0"].includes(trimmed.toLowerCase())) return false;
    return rawStr;
  };

  // Save inline editing
  const saveEditing = (rowIdx: number, colName: string, rawVal: string) => {
    if (!editingCell) return;
    const coerced = coerceValue(rawVal, editingCell.originalVal);

    setEditedCells((prev) => ({
      ...prev,
      [rowIdx]: {
        ...(prev[rowIdx] || {}),
        [colName]: coerced,
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

  // Discard all pending edits
  const handleDiscardChanges = () => {
    setEditedCells({});
    setDeletedRowIndices(new Set());
    setEditingCell(null);
    setCommitMessage(null);
  };

  // Helper to resolve the primary key value for a given table from a query result row
  const resolveTablePkValue = (
    targetTable: string,
    pkCol: string,
    origRow: Record<string, unknown>,
    joinsList: VisualJoinInfo[],
    baseTable: string
  ): unknown => {
    if (origRow[`${targetTable}_${pkCol}`] !== undefined && origRow[`${targetTable}_${pkCol}`] !== null) {
      return origRow[`${targetTable}_${pkCol}`];
    }
    if (origRow[`${targetTable}.${pkCol}`] !== undefined && origRow[`${targetTable}.${pkCol}`] !== null) {
      return origRow[`${targetTable}.${pkCol}`];
    }
    if (targetTable === baseTable && origRow[pkCol] !== undefined && origRow[pkCol] !== null) {
      return origRow[pkCol];
    }
    for (const j of joinsList) {
      if (j.toTable === targetTable && j.toColumn === pkCol) {
        if (origRow[j.fromColumn] !== undefined && origRow[j.fromColumn] !== null) {
          return origRow[j.fromColumn];
        }
        if (origRow[`${j.fromTable}_${j.fromColumn}`] !== undefined && origRow[`${j.fromTable}_${j.fromColumn}`] !== null) {
          return origRow[`${j.fromTable}_${j.fromColumn}`];
        }
      }
      if (j.fromTable === targetTable && j.fromColumn === pkCol) {
        if (origRow[j.toColumn] !== undefined && origRow[j.toColumn] !== null) {
          return origRow[j.toColumn];
        }
        if (origRow[`${j.toTable}_${j.toColumn}`] !== undefined && origRow[`${j.toTable}_${j.toColumn}`] !== null) {
          return origRow[`${j.toTable}_${j.toColumn}`];
        }
      }
    }
    // 5. Fallback to direct pkCol in origRow
    if (origRow[pkCol] !== undefined && origRow[pkCol] !== null) {
      return origRow[pkCol];
    }
    return undefined;
  };

  // Save / Commit pending changes
  const handleSaveCommitChanges = async () => {
    if (!queryResult?.rows || totalPending === 0) return;
    setIsSubmittingChanges(true);
    setCommitMessage(null);

    try {
      const dialect: DBType = toDialect(activeProfile?.type);

      const baseTable = canvasTableNames[0] || tables[0] || "";
      const updateStatements: string[] = [];
      const colMappings = extractColumnMappingsFromSql(lastExecutedSql || sqlText || generatedSql);

      for (const [rIdxStr, fields] of Object.entries(editedCells)) {
        const rIdx = Number(rIdxStr);
        if (deletedRowIndices.has(rIdx)) continue; // Deleted rows take precedence
        const origRow = queryResult.rows[rIdx];
        if (!origRow) continue;

        const editsByTable: Record<string, Record<string, unknown>> = {};

        for (const [colName, val] of Object.entries(fields)) {
          const mapping = colMappings[colName];
          if (mapping?.isExpression) {
            throw new Error(`Cannot update computed/expression column "${colName}".`);
          }
          let ownerTable = mapping?.tableName || "";
          let actualColName = mapping?.realColumn || colName;

          if (ownerTable) {
            if (!tableSchemas[ownerTable]) {
              const matched = canvasTableNames.find(
                (t) => t.toLowerCase() === ownerTable.toLowerCase() || t.startsWith(ownerTable)
              );
              if (matched) ownerTable = matched;
            }
          }

          if (!ownerTable) {
            for (const t of canvasTableNames) {
              if (actualColName.startsWith(`${t}_`)) {
                const stripped = actualColName.slice(t.length + 1);
                if (tableSchemas[t]?.some((c) => c.name === stripped)) {
                  ownerTable = t;
                  actualColName = stripped;
                  break;
                }
              } else if (actualColName.startsWith(`${t}.`)) {
                const stripped = actualColName.slice(t.length + 1);
                if (tableSchemas[t]?.some((c) => c.name === stripped)) {
                  ownerTable = t;
                  actualColName = stripped;
                  break;
                }
              }
            }
          }

          if (!ownerTable) {
            ownerTable =
              canvasTableNames.find((t) =>
                tableSchemas[t]?.some((c) => c.name === actualColName)
              ) ||
              tables.find((t) => tableSchemas[t]?.some((c) => c.name === actualColName)) ||
              baseTable;
          }

          if (!editsByTable[ownerTable]) {
            editsByTable[ownerTable] = {};
          }
          editsByTable[ownerTable][actualColName] = val;
        }

        for (const [tblName, tblFields] of Object.entries(editsByTable)) {
          if (!tblName || Object.keys(tblFields).length === 0) continue;
          const tableCols = tableSchemas[tblName] || [];
          const pkCols = tableCols.filter((c) => c.primaryKey).map((c) => c.name);

          const whereConditions: string[] = [];
          if (pkCols.length > 0) {
            for (const pk of pkCols) {
              let pkVal = resolveTablePkValue(tblName, pk, origRow, joins, baseTable);
              if (pkVal === undefined || pkVal === null) {
                const mapped = Object.values(colMappings).find(
                  (m) => m.realColumn === pk && (!m.tableName || m.tableName === tblName) && origRow[m.alias] !== undefined
                );
                if (mapped) pkVal = origRow[mapped.alias];
              }
              if (pkVal !== undefined && pkVal !== null) {
                const qCol = quoteIdent(pk, dialect);
                if (typeof pkVal === "number") {
                  whereConditions.push(`${qCol} = ${pkVal}`);
                } else if (typeof pkVal === "boolean") {
                  whereConditions.push(`${qCol} = ${pkVal ? "TRUE" : "FALSE"}`);
                } else {
                  whereConditions.push(`${qCol} = ${sqlLiteral(pkVal, dialect)}`);
                }
              }
            }
          }

          // Fallback if no PK could be resolved: match all available original columns belonging to this table
          if (whereConditions.length === 0) {
            const matchingCols = tableCols.filter((c) => {
              const isDirect = origRow[c.name] !== undefined && origRow[c.name] !== null;
              const isMapped = Object.values(colMappings).some(
                (m) => m.realColumn === c.name && (!m.tableName || m.tableName === tblName) && origRow[m.alias] !== undefined && origRow[m.alias] !== null
              );
              return isDirect || isMapped;
            });

            if (matchingCols.length > 0) {
              matchingCols.forEach((c) => {
                let v = origRow[c.name];
                if (v === undefined || v === null) {
                  const mapped = Object.values(colMappings).find(
                    (m) => m.realColumn === c.name && (!m.tableName || m.tableName === tblName) && origRow[m.alias] !== undefined
                  );
                  if (mapped) v = origRow[mapped.alias];
                }
                const qCol = quoteIdent(c.name, dialect);
                if (typeof v === "number") {
                  whereConditions.push(`${qCol} = ${v}`);
                } else if (typeof v === "boolean") {
                  whereConditions.push(`${qCol} = ${v ? "TRUE" : "FALSE"}`);
                } else {
                  whereConditions.push(`${qCol} = ${sqlLiteral(v, dialect)}`);
                }
              });
            } else if (origRow["id"] !== undefined && origRow["id"] !== null) {
              whereConditions.push(`${quoteIdent("id", dialect)} = ${origRow["id"]}`);
            }
          }

          if (whereConditions.length === 0) {
            throw new Error(
              `Cannot identify matching row for table "${tblName}". Please include its primary key column in the query.`
            );
          }

          const setClauses = Object.entries(tblFields).map(([k, v]) => {
            const qCol = quoteIdent(k, dialect);
            const colInfo = tableCols.find((c) => c.name === k);
            const colType = colInfo?.type?.toLowerCase() || "";
            const isBool = /bool|tinyint\(1\)|bit/i.test(colType);
            const isNumeric = /int|float|double|decimal|numeric|real|serial/i.test(colType) && !isBool;

            if (v === null || v === undefined) return `${qCol} = NULL`;
            if (typeof v === "boolean" || (isBool && (v === "true" || v === "false" || v === true || v === false))) {
              const b = v === true || v === "true";
              return `${qCol} = ${sqlLiteral(b, dialect)}`;
            }
            if (typeof v === "number" || (isNumeric && !isNaN(Number(v)) && String(v).trim() !== "")) {
              return `${qCol} = ${Number(v)}`;
            }
            return `${qCol} = ${sqlLiteral(v, dialect)}`;
          });

          const qTable = quoteTableIdent(tblName, dialect);
          updateStatements.push(
            `UPDATE ${qTable} SET ${setClauses.join(", ")} WHERE ${whereConditions.join(" AND ")};`
          );
        }
      }

      // Process deletes
      for (const rIdx of deletedRowIndices) {
        const origRow = queryResult.rows[rIdx];
        if (!origRow) continue;
        const targetTable = baseTable;
        const tableCols = tableSchemas[targetTable] || [];
        const pkCols = tableCols.filter((c) => c.primaryKey).map((c) => c.name);

        const whereConditions: string[] = [];
        if (pkCols.length > 0) {
          for (const pk of pkCols) {
            const pkVal = resolveTablePkValue(targetTable, pk, origRow, joins, baseTable);
            if (pkVal !== undefined && pkVal !== null) {
              const qCol = quoteIdent(pk, dialect);
              if (typeof pkVal === "number") {
                whereConditions.push(`${qCol} = ${pkVal}`);
              } else {
                whereConditions.push(`${qCol} = ${sqlLiteral(pkVal, dialect)}`);
              }
            }
          }
        } else if (origRow["id"] !== undefined) {
          whereConditions.push(`${quoteIdent("id", dialect)} = ${origRow["id"]}`);
        }

        if (whereConditions.length > 0) {
          const qTable = quoteTableIdent(targetTable, dialect);
          updateStatements.push(`DELETE FROM ${qTable} WHERE ${whereConditions.join(" AND ")};`);
        }
      }

      // Execute each statement sequentially
      for (const stmt of updateStatements) {
        await onExecuteSql(stmt);
      }

      // Optimistically update memory rows so UI reflects values immediately
      const updatedRows = queryResult.rows
        .map((row, idx) => {
          if (editedCells[idx]) {
            return { ...row, ...editedCells[idx] };
          }
          return row;
        })
        .filter((_, idx) => !deletedRowIndices.has(idx));

      setQueryResult({
        ...queryResult,
        rows: updatedRows,
      });

      setCommitMessage({
        success: true,
        text: `Successfully applied ${totalPending} change(s).`,
      });
      setEditedCells({});
      setDeletedRowIndices(new Set());
      setTimeout(() => setCommitMessage(null), 3500);
    } catch (err: any) {
      setCommitMessage({
        success: false,
        text: err?.message || "Failed to save changes",
      });
    } finally {
      setIsSubmittingChanges(false);
    }
  };

  // Copy SQL to clipboard
  const handleCopySql = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 1500);
  };

  // Export Results to CSV
  const handleExportCsv = () => {
    if (!queryResult?.rows || queryResult.rows.length === 0) return;
    const fields = queryResult.fields || Object.keys(queryResult.rows[0]);
    const csvHeader = fields.map((f) => `"${f.replace(/"/g, '""')}"`).join(",");
    const csvRows = queryResult.rows.map((row) =>
      fields
        .map((f) => {
          const val = row[f];
          if (val === null || val === undefined) return "";
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(",")
    );
    // Written as plain text. The old data: URI had to be encodeURI'd, which
    // mangled any value containing a # or a %.
    saveTextFileAsync(
      `visual_query_${Date.now()}.csv`,
      [csvHeader, ...csvRows].join("\n"),
    );
  };

  // Sort conditions handlers
  const addSort = () => {
    if (canvasTableNames.length === 0) return;
    const firstTable = canvasTableNames[0];
    const cols = tableSchemas[firstTable] || [];
    const firstCol = cols[0]?.name || "id";

    const newSort: VisualSortCondition = {
      id: `sort-${Date.now()}`,
      table: firstTable,
      column: firstCol,
      direction: "ASC",
    };
    setSorts((prev) => [...prev, newSort]);
  };

  const updateSort = (id: string, updates: Partial<VisualSortCondition>) => {
    setSorts((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const removeSort = (id: string) => {
    setSorts((prev) => prev.filter((s) => s.id !== id));
  };

  // Group By Handlers
  const addGroupBy = () => {
    if (canvasTableNames.length === 0) return;
    const firstTable = canvasTableNames[0];
    const cols = tableSchemas[firstTable] || [];
    const firstCol = cols[0]?.name || "id";

    setGroupBys((prev) => [
      ...prev,
      {
        id: `gb-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        table: firstTable,
        column: firstCol,
      },
    ]);
  };

  const updateGroupBy = (id: string, updates: Partial<VisualGroupByCondition>) => {
    setGroupBys((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...updates } : g))
    );
  };

  const removeGroupBy = (id: string) => {
    setGroupBys((prev) => prev.filter((g) => g.id !== id));
  };

  // Aggregate Handlers
  const addAggregate = () => {
    if (canvasTableNames.length === 0) return;
    const firstTable = canvasTableNames[0];
    const cols = tableSchemas[firstTable] || [];
    const firstCol = cols[0]?.name || "*";

    setAggregates((prev) => [
      ...prev,
      {
        id: `agg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        table: firstTable,
        column: firstCol,
        func: "COUNT",
        alias: `count_${firstCol === "*" ? "rows" : firstCol}`,
      },
    ]);
  };

  const updateAggregate = (id: string, updates: Partial<VisualAggregateItem>) => {
    setAggregates((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const removeAggregate = (id: string) => {
    setAggregates((prev) => prev.filter((a) => a.id !== id));
  };

  // HAVING Handlers
  const addHaving = () => {
    if (canvasTableNames.length === 0) return;
    const firstTable = canvasTableNames[0];
    const cols = tableSchemas[firstTable] || [];
    const firstCol = cols[0]?.name || "*";

    setHavings((prev) => [
      ...prev,
      {
        id: `hav-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        table: firstTable,
        column: firstCol,
        func: "COUNT",
        operator: ">",
        value: "0",
        logic: "AND",
      },
    ]);
  };

  const updateHaving = (id: string, updates: Partial<VisualHavingCondition>) => {
    setHavings((prev) =>
      prev.map((h) => (h.id === id ? { ...h, ...updates } : h))
    );
  };

  const removeHaving = (id: string) => {
    setHavings((prev) => prev.filter((h) => h.id !== id));
  };

  // Selected edge object for join editor modal
  const activeJoin = useMemo(() => {
    if (!selectedEdgeId) return null;
    return joins.find((j) => j.id === selectedEdgeId) || null;
  }, [selectedEdgeId, joins]);

  const filteredTablesList = tables.filter((t) =>
    t.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <div className="visual-query-container">
      {/* Top Header Bar */}
      <div className="vq-top-bar">
        <div className="bar-left">
          <Workflow size={15} className="head-icon" />
          <h2 className="head-title">Visual Query Builder</h2>
          <span className="db-pill font-mono">{activeDatabase}</span>
          <span className="count-tag font-mono">
            {canvasTableNames.length} {canvasTableNames.length === 1 ? "table" : "tables"} on canvas
          </span>
        </div>

        {/* Step Guide Bar */}
        <div className="steps-guide-bar">
          <div className={`step-item ${canvasTableNames.length > 0 ? "is-done" : "is-current"}`}>
            <span className="step-num font-mono">1</span>
            <span className="step-text">Add Tables</span>
          </div>
          <span className="step-arrow">→</span>
          <div className={`step-item ${joins.length > 0 || canvasTableNames.length <= 1 ? "is-done" : "is-current"}`}>
            <span className="step-num font-mono">2</span>
            <span className="step-text">Connect Joins</span>
          </div>
          <span className="step-arrow">→</span>
          <div className={`step-item ${filters.length > 0 ? "is-done" : ""}`}>
            <span className="step-num font-mono">3</span>
            <span className="step-text">Filters</span>
          </div>
          <span className="step-arrow">→</span>
          <div className="step-item step-run">
            <span className="step-num font-mono">4</span>
            <span className="step-text">Run</span>
          </div>
        </div>

        <div className="bar-right">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleCopySql}
            title="Copy Generated SQL"
          >
            {copiedSql ? <Check size={12} className="text-green" /> : <Copy size={12} />}
            <span>{copiedSql ? "Copied" : "Copy SQL"}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onOpenInSqlConsole(generatedSql)}
            title="Open in SQL Console"
          >
            <Terminal size={12} />
            <span>Open in SQL</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm run-query-main-btn"
            onClick={() => handleRunQuery()}
            disabled={isExecuting || canvasTableNames.length === 0}
            title="Execute Query (Run)"
          >
            <Play size={12} className={isExecuting ? "spin" : ""} />
            <span>{isExecuting ? "Running..." : "Run Query"}</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Area: Sidebar + Canvas */}
      <div className="vq-workspace">
        {/* Left Sidebar: Tables List */}
        <aside className={`vq-sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
          <div className="sidebar-header">
            {!isSidebarCollapsed ? (
              <>
                <div className="sidebar-header-top">
                  <div className="sidebar-title">
                    <Database size={12} />
                    <span>Tables ({tables.length})</span>
                  </div>
                  <button
                    type="button"
                    className="sidebar-toggle-btn"
                    onClick={() => setIsSidebarCollapsed(true)}
                    data-tooltip="Collapse Tables Sidebar"
                  >
                    <PanelLeftClose size={12} />
                  </button>
                </div>
                <div className="search-wrap">
                  <span className="search-icon-wrap">
                    <Search size={11} />
                  </span>
                  <input
                    type="text"
                    placeholder="Filter tables..."
                    value={tableSearch}
                    onChange={(e) => setTableSearch(e.target.value)}
                    className="search-field"
                  />
                  {tableSearch && (
                    <button
                      className="search-clear-btn"
                      onClick={() => setTableSearch("")}
                      title="Clear search"
                    >
                      <X size={10} />
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="sidebar-collapsed-header">
                <button
                  type="button"
                  className="sidebar-toggle-btn"
                  onClick={() => setIsSidebarCollapsed(false)}
                  data-tooltip="Expand Tables Sidebar"
                  data-tooltip-pos="right"
                >
                  <PanelLeftOpen size={14} />
                </button>
              </div>
            )}
          </div>

          {!isSidebarCollapsed ? (
            <div className="sidebar-table-list">
              {loadingSchemas ? (
                <div className="sidebar-loading">
                  <RefreshCw size={13} className="spin" />
                  <span>Loading schemas...</span>
                </div>
              ) : filteredTablesList.length === 0 ? (
                <div className="sidebar-empty">No tables found</div>
              ) : (
                filteredTablesList.map((tbl) => {
                  const isOnCanvas = canvasTableNames.includes(tbl);
                  const colCount = tableSchemas[tbl]?.length || 0;

                  return (
                    <div
                      key={tbl}
                      className={`sidebar-table-item ${isOnCanvas ? "is-added" : ""}`}
                      onClick={() => {
                        if (!isOnCanvas) {
                          addTableToCanvas(tbl);
                        }
                      }}
                      title={isOnCanvas ? "Already on canvas" : "Click to add table onto canvas"}
                    >
                      <div className="table-item-name-group">
                        <Table2 size={12} className="tbl-icon" />
                        <span className="tbl-name font-mono">{tbl}</span>
                      </div>
                      <div className="table-item-meta">
                        <span className="col-count font-mono">{colCount} cols</span>
                        {isOnCanvas ? (
                          <span className="added-badge">
                            <CheckCircle2 size={12} />
                          </span>
                        ) : (
                          <span className="add-icon">
                            <Plus size={12} />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div
              className="collapsed-sidebar-body"
              onClick={() => setIsSidebarCollapsed(false)}
              data-tooltip={`Tables (${tables.length}) - Click to expand`}
              data-tooltip-pos="right"
              style={{ cursor: "pointer" }}
            >
              <Table2 size={14} className="collapsed-tbl-icon" />
              <span className="collapsed-badge font-mono">{tables.length}</span>
            </div>
          )}
        </aside>

        {/* Center Canvas Area with Floating Action Pill */}
        <div className="vq-canvas-area">
          {/* Floating Action Toolbox */}
          <div className="canvas-floating-toolbox">
            <button
              type="button"
              className="toolbox-btn add-table-tb-btn"
              onClick={() => setShowQuickAddModal(!showQuickAddModal)}
              title="Add a table onto the canvas"
            >
              <Plus size={12} />
              <span>Table</span>
            </button>

            <button
              type="button"
              className="toolbox-btn add-filter-tb-btn"
              onClick={() => addFilterBlockToCanvas()}
              title="Add a WHERE Filter block"
            >
              <Filter size={12} />
              <span>Filter</span>
            </button>

            {canvasTableNames.length >= 2 && (
              <button
                type="button"
                className="toolbox-btn auto-link-tb-btn"
                onClick={handleAutoConnectAll}
                title="Automatically connect tables by Foreign Keys or ID"
              >
                <Zap size={12} />
                <span>Auto Join</span>
              </button>
            )}

            <button
              type="button"
              className="toolbox-btn fit-tb-btn"
              onClick={() => fitView({ padding: 0.25, duration: 400 })}
              title="Fit canvas to view"
            >
              <Layers size={12} />
              <span>Fit View</span>
            </button>

            {canvasTableNames.length > 0 && (
              <button
                type="button"
                className="toolbox-btn clear-tb-btn"
                onClick={handleClearCanvas}
                title="Clear all canvas items"
              >
                <Trash2 size={12} />
                <span>Clear</span>
              </button>
            )}
          </div>

          {/* Quick Table Picker Dropdown/Popover */}
          {showQuickAddModal && (
            <div className="quick-picker-popover">
              <div className="quick-picker-header">
                <span className="quick-picker-title">Add Table to Canvas</span>
                <button
                  type="button"
                  className="quick-picker-close"
                  onClick={() => setShowQuickAddModal(false)}
                >
                  <X size={12} />
                </button>
              </div>
              <div className="quick-picker-grid">
                {tables.map((t) => {
                  const isAdded = canvasTableNames.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={`quick-table-chip font-mono ${isAdded ? "is-added" : ""}`}
                      onClick={() => {
                        if (!isAdded) {
                          addTableToCanvas(t);
                          setShowQuickAddModal(false);
                        }
                      }}
                      disabled={isAdded}
                    >
                      <Table2 size={11} />
                      <span>{t}</span>
                      {isAdded && <Check size={10} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Canvas React Flow */}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={handleEdgeClick}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            colorMode={theme}
            fitView
            minZoom={0.2}
            maxZoom={2.0}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color={theme === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}
            />
            <Controls className="custom-flow-controls" showInteractive={false} />
            <MiniMap
              nodeColor={miniMapNodeColor}
              maskColor={theme === "dark" ? "rgba(0, 0, 0, 0.65)" : "rgba(240, 240, 243, 0.75)"}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-light)",
                borderRadius: "var(--radius-md)",
              }}
            />
          </ReactFlow>

          {/* Canvas Empty State */}
          {canvasTableNames.length === 0 && (
            <div className="canvas-empty-state">
              <div className="game-empty-card">
                <div className="game-sparkle-halo">
                  <Workflow size={24} className="game-sparkle-icon" />
                </div>
                <h3>Visual Query Builder</h3>
                <p>
                  1. Click on tables in the left sidebar to add them to your canvas.
                  <br />
                  2. Drag lines between column handles to create <strong>JOINs</strong>, or add <strong>Filter blocks</strong>.
                  <br />
                  3. Click <strong>Run Query</strong> to view the results instantly.
                </p>
                <div className="game-quick-tables">
                  {tables.slice(0, 4).map((tbl) => (
                    <button
                      key={tbl}
                      type="button"
                      className="game-quick-add-btn font-mono"
                      onClick={() => addTableToCanvas(tbl)}
                    >
                      <Plus size={11} />
                      <span>{tbl}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="game-quick-add-btn filter-highlight-btn"
                    onClick={() => addFilterBlockToCanvas()}
                  >
                    <Filter size={11} />
                    <span>+ Filter Block</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Active Join Popover / Modal */}
          {activeJoin && (
            <div className="join-popover">
              <div className="join-popover-header">
                <span className="popover-title font-mono">Configure JOIN</span>
                <button
                  type="button"
                  className="popover-close"
                  onClick={() => setSelectedEdgeId(null)}
                >
                  <X size={12} />
                </button>
              </div>

              <div className="join-popover-condition font-mono">
                <code>
                  {activeJoin.fromTable}.{activeJoin.fromColumn} = {activeJoin.toTable}.
                  {activeJoin.toColumn}
                </code>
              </div>

              <div className="join-types-selector">
                {(["INNER", "LEFT", "RIGHT", "FULL"] as JoinType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`join-type-btn font-mono ${activeJoin.joinType === t ? "active" : ""}`}
                    onClick={() => updateJoinType(activeJoin.id, t)}
                  >
                    {t} JOIN
                  </button>
                ))}
              </div>

              <div className="join-popover-footer">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => deleteJoin(activeJoin.id)}
                >
                  <Trash2 size={11} />
                  <span>Remove Join</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Panel: Results & Live SQL */}
      <div
        className={`vq-bottom-panel ${isDrawerCollapsed ? "is-collapsed" : ""}`}
        style={{ height: isDrawerCollapsed ? "34px" : `${drawerHeight}px` }}
      >
        {/* Resizer Handle */}
        {!isDrawerCollapsed && (
          <div
            className={`drawer-resizer-handle ${isDraggingResize ? "is-dragging" : ""}`}
            onMouseDown={handleMouseDownResize}
            title="Drag up/down to resize results panel height"
          >
            <div className="resizer-grip-bar" />
          </div>
        )}

        <div className="drawer-header">
          <div className="drawer-tabs">
            <button
              type="button"
              className={`drawer-tab-btn ${bottomTab === "results" ? "active" : ""}`}
              onClick={() => {
                setBottomTab("results");
                if (isDrawerCollapsed) setIsDrawerCollapsed(false);
              }}
            >
              <Play size={12} />
              <span>Results</span>
              {queryResult?.rowsReturned !== undefined && (
                <span className="tab-pill font-mono">{queryResult.rowsReturned} rows</span>
              )}
            </button>

            <button
              type="button"
              className={`drawer-tab-btn ${bottomTab === "sql" ? "active" : ""}`}
              onClick={() => {
                setBottomTab("sql");
                if (isDrawerCollapsed) setIsDrawerCollapsed(false);
              }}
            >
              <Code2 size={12} />
              <span>SQL Preview</span>
            </button>

            <button
              type="button"
              className={`drawer-tab-btn ${bottomTab === "filters" ? "active" : ""}`}
              onClick={() => {
                setBottomTab("filters");
                if (isDrawerCollapsed) setIsDrawerCollapsed(false);
              }}
            >
              <Filter size={12} />
              <span>Filters ({filters.length})</span>
            </button>

            <button
              type="button"
              className={`drawer-tab-btn ${bottomTab === "sort" ? "active" : ""}`}
              onClick={() => {
                setBottomTab("sort");
                if (isDrawerCollapsed) setIsDrawerCollapsed(false);
              }}
            >
              <ArrowUpDown size={12} />
              <span>Sorting & Limit</span>
            </button>

            <button
              type="button"
              className={`drawer-tab-btn ${bottomTab === "groupby" ? "active" : ""}`}
              onClick={() => {
                setBottomTab("groupby");
                if (isDrawerCollapsed) setIsDrawerCollapsed(false);
              }}
            >
              <Layers size={12} />
              <span>Group By ({groupBys.length + aggregates.length})</span>
            </button>
          </div>

          <div className="drawer-actions">
            {/* Pending Changes Actions */}
            {bottomTab === "results" && totalPending > 0 && (
              <div className="pending-actions-group">
                <span className="pending-badge font-mono">
                  {totalPending} unsaved change{totalPending > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleDiscardChanges}
                  disabled={isSubmittingChanges}
                  title="Discard all pending edits"
                >
                  <RotateCcw size={11} />
                  <span>Discard</span>
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-xs save-commit-btn"
                  onClick={handleSaveCommitChanges}
                  disabled={isSubmittingChanges}
                  title="Save changes to database"
                >
                  {isSubmittingChanges ? (
                    <RefreshCw size={11} className="spin" />
                  ) : (
                    <Save size={11} />
                  )}
                  <span>Save Changes</span>
                </button>
              </div>
            )}

            {bottomTab === "results" && queryResult?.rows && queryResult.rows.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleExportCsv}
                title="Export results as CSV"
              >
                <Download size={11} />
                <span>Export CSV</span>
              </button>
            )}

            <button
              type="button"
              className="drawer-toggle-btn"
              onClick={() => setIsDrawerCollapsed(!isDrawerCollapsed)}
              title={isDrawerCollapsed ? "Expand Drawer" : "Collapse Drawer"}
            >
              <ChevronDown size={14} className={isDrawerCollapsed ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {/* Drawer Body Content */}
        {!isDrawerCollapsed && (
          <div className="drawer-body">
            {/* Tab 1: Results DataGrid */}
            {bottomTab === "results" && (
              <div className="tab-content results-tab-content">
                {isExecuting ? (
                  <div className="results-status-center">
                    <RefreshCw size={18} className="spin" />
                    <span>Executing query...</span>
                  </div>
                ) : queryResult?.error ? (
                  <div className="results-error-banner font-mono">
                    <strong>Error:</strong> {queryResult.error}
                  </div>
                ) : queryResult?.rows ? (
                  <div className="results-table-container">
                    <div className="results-meta-bar">
                      <div className="results-meta-left">
                        <span>
                          Returned <strong>{queryResult.rows.length}</strong> rows
                        </span>
                        <span className="results-hint-tag font-mono">
                          Double-click any cell to edit inline
                        </span>
                      </div>
                      <div className="results-meta-right">
                        <div className="results-pagination-bar font-mono">
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            disabled={page === 0 || isExecuting}
                            onClick={() => {
                              const prevPg = Math.max(0, page - 1);
                              setPage(prevPg);
                              handleRunQuery(prevPg);
                            }}
                            title="Previous page"
                          >
                            <ChevronLeft size={11} />
                            <span>Prev</span>
                          </button>
                          <span className="pagination-page-tag">
                            Page <strong>{page + 1}</strong>
                          </span>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            disabled={!queryResult?.rows || queryResult.rows.length < limit || isExecuting}
                            onClick={() => {
                              const nextPg = page + 1;
                              setPage(nextPg);
                              handleRunQuery(nextPg);
                            }}
                            title="Next page"
                          >
                            <span>Next</span>
                            <ChevronRight size={11} />
                          </button>
                          <select
                            className="pagination-limit-select font-mono"
                            value={limit}
                            onChange={(e) => {
                              const newLim = parseInt(e.target.value, 10);
                              setLimit(newLim);
                              setPage(0);
                            }}
                            title="Rows per page"
                          >
                            <option value={25}>25 / page</option>
                            <option value={50}>50 / page</option>
                            <option value={100}>100 / page</option>
                            <option value={200}>200 / page</option>
                          </select>
                        </div>

                        {commitMessage && (
                          <span className={`commit-msg font-mono ${commitMessage.success ? "is-success" : "is-error"}`}>
                            {commitMessage.text}
                          </span>
                        )}
                        {executionTimeMs != null && (
                          <span className="meta-time font-mono">
                            <Clock size={11} /> {executionTimeMs}ms
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="results-table-wrapper">
                      <table className="results-table font-mono">
                        <thead>
                          <tr>
                            <th className="th-idx">#</th>
                            <th className="th-actions" style={{ width: "60px" }}>Actions</th>
                            {(queryResult.fields || Object.keys(queryResult.rows[0] || {})).map(
                              (f) => (
                                <th key={f}>{f}</th>
                              )
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.map((row, idx) => {
                            const isDeleted = deletedRowIndices.has(idx);
                            const rowEdits = editedCells[idx] || {};
                            const hasRowEdits = Object.keys(rowEdits).length > 0;
                            const fields =
                              queryResult.fields || Object.keys(queryResult.rows![0] || {});

                            return (
                              <tr
                                key={idx}
                                className={`result-data-row ${isDeleted ? "is-deleted" : ""} ${hasRowEdits ? "is-edited-row" : ""}`}
                              >
                                <td className="td-idx">
                                  {hasRowEdits ? (
                                    <span title="Row has edited cells">
                                      <Edit2 size={10} className="text-amber" />
                                    </span>
                                  ) : (
                                    idx + 1
                                  )}
                                </td>

                                <td className="td-actions">
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: "2px" }}>
                                    <button
                                      type="button"
                                      className="row-action-btn"
                                      onClick={() => {
                                        const targetField = fields.find((fld) => getContentInfo(row[fld], fld, findColType(fld))) || fields[0];
                                        if (targetField) {
                                          openContentEditor(idx, targetField, (editedCells[idx] || {})[targetField] ?? row[targetField], findColType(targetField));
                                        }
                                      }}
                                      title="Open row content in Text Editor"
                                    >
                                      <FileText size={11} />
                                    </button>
                                    <button
                                      type="button"
                                      className={`row-action-btn ${isDeleted ? "is-active-del" : ""}`}
                                      onClick={() => toggleDeleteRow(idx)}
                                      title={isDeleted ? "Undo delete row" : "Mark row for deletion"}
                                    >
                                      {isDeleted ? <RotateCcw size={11} /> : <Trash2 size={11} />}
                                    </button>
                                  </div>
                                </td>

                                {fields.map((f) => {
                                  const isCellEdited = f in rowEdits;
                                  const cellVal = isCellEdited ? rowEdits[f] : row[f];
                                  const isNull = cellVal === null || cellVal === undefined;
                                  const isCurrentlyEditing =
                                    editingCell?.rowIdx === idx && editingCell?.colName === f;
                                  const colType = findColType(f);
                                  const cInfo = !isNull ? getContentInfo(cellVal, f, colType) : null;

                                  if (isCurrentlyEditing) {
                                    return (
                                      <td key={f} className="td-editing-cell">
                                        <input
                                          ref={editInputRef}
                                          type="text"
                                          className="inline-cell-input font-mono"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                              saveEditing(idx, f, editValue);
                                            } else if (e.key === "Escape") {
                                              setEditingCell(null);
                                            }
                                          }}
                                          onBlur={() => saveEditing(idx, f, editValue)}
                                          autoFocus
                                        />
                                      </td>
                                    );
                                  }

                                  return (
                                    <td
                                      key={f}
                                      className={`result-cell ${isNull ? "is-null" : ""} ${isCellEdited ? "is-edited" : ""}`}
                                      onDoubleClick={() => {
                                        if (isDeleted) return;
                                        if (cInfo) {
                                          openContentEditor(idx, f, cellVal, colType);
                                        } else {
                                          startEditing(idx, f, cellVal);
                                        }
                                      }}
                                      title={
                                        cInfo
                                          ? `${cInfo.titleSnippet || cInfo.label} (Double-click or click badge to open Text Editor)`
                                          : "Double-click to edit cell"
                                      }
                                    >
                                      <div className="cell-content-box">
                                        {cInfo ? (
                                          <div className="content-cell-content">
                                            <span className="content-cell-text font-mono">
                                              {typeof cellVal === "object" ? JSON.stringify(cellVal) : String(cellVal)}
                                            </span>
                                            <button
                                              type="button"
                                              className={`content-editor-pill ${cInfo.badgeClass}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                openContentEditor(idx, f, cellVal, colType);
                                              }}
                                              title={cInfo.titleSnippet ? `${cInfo.titleSnippet} (Click to open Text Editor)` : `Open Text Editor (${cInfo.label})`}
                                            >
                                              <FileText size={10} />
                                              <span>{cInfo.label}</span>
                                            </button>
                                          </div>
                                        ) : (
                                          <span className="cell-value-text font-mono">
                                            {isNull ? "NULL" : String(cellVal)}
                                          </span>
                                        )}
                                        {isCellEdited && <span className="edited-dot" />}
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="empty-panel-msg">
                    Click <strong>&quot;Run Query&quot;</strong> in the toolbar above to execute and preview results here.
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: SQL Editor & Bidirectional Sync */}
            {bottomTab === "sql" && (
              <div className="tab-content sql-tab-content">
                <div className="sql-editor-toolbar">
                  <div className="sql-toolbar-left">
                    <span className="tab-tip">
                      Edit or paste SQL query here — click <strong>Sync to Canvas</strong> to reflect changes on the visual diagram.
                    </span>
                  </div>
                  <div className="sql-toolbar-right">
                    {sqlParseError ? (
                      <span className="sync-badge is-error font-mono" title={sqlParseError}>
                        {sqlParseError}
                      </span>
                    ) : sqlDivergedFromCanvas ? (
                      <span
                        className="sync-badge font-mono"
                        title="This SQL no longer matches the canvas — click Sync to Canvas to apply it"
                      >
                        SQL differs from canvas
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => {
                        setSharedSql(generatedSql);
                        setSqlParseError(null);
                        handleSyncSqlToCanvas(generatedSql);
                      }}
                      title="Reset SQL to match canvas"
                    >
                      <RotateCcw size={11} />
                      <span>Reset</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={handleCopySql}
                      title="Copy SQL to clipboard"
                    >
                      {copiedSql ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                      <span>{copiedSql ? "Copied" : "Copy"}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs sync-canvas-btn"
                      onClick={() => handleSyncSqlToCanvas()}
                      title="Apply SQL query onto Visual Canvas"
                    >
                      <Zap size={11} />
                      <span>Sync to Canvas</span>
                    </button>
                  </div>
                </div>

                <div className="sql-textarea-wrapper">
                  <textarea
                    className="sql-code-editor-textarea font-mono"
                    value={sqlText}
                    onChange={(e) => setSharedSql(e.target.value)}
                    placeholder="Write or paste SQL query here..."
                    spellCheck={false}
                  />
                </div>
              </div>
            )}

            {/* Tab 3: Filters (WHERE) */}
            {bottomTab === "filters" && (
              <div className="tab-content filters-tab-content">
                <div className="tab-toolbar">
                  <span className="tab-tip">
                    Define filter conditions for your WHERE clause (or add Filter blocks directly on the canvas)
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => addFilterBlockToCanvas()}
                  >
                    <Plus size={11} />
                    <span>Add Filter</span>
                  </button>
                </div>

                {filters.length === 0 ? (
                  <div className="empty-panel-msg">
                    No filters configured. Click <strong>&quot;Add Filter&quot;</strong> above to add a condition block.
                  </div>
                ) : (
                  <div className="conditions-list">
                    {filters.map((f, idx) => (
                      <div key={f.id} className="condition-row">
                        {idx > 0 && (
                          <select
                            value={f.logic}
                            onChange={(e) =>
                              updateFilter(f.id, { logic: e.target.value as "AND" | "OR" })
                            }
                            className="input-select logic-select font-mono"
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                        {idx === 0 && <span className="where-tag font-mono">WHERE</span>}

                        <select
                          value={f.table}
                          onChange={(e) => {
                            const newTbl = e.target.value;
                            const cols = tableSchemas[newTbl] || [];
                            updateFilter(f.id, {
                              table: newTbl,
                              column: cols[0]?.name || "",
                            });
                          }}
                          className="input-select table-select font-mono"
                        >
                          {(canvasTableNames.length > 0 ? canvasTableNames : tables).map((tbl) => (
                            <option key={tbl} value={tbl}>
                              {tbl}
                            </option>
                          ))}
                        </select>

                        <select
                          value={f.column}
                          onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                          className="input-select col-select font-mono"
                        >
                          {(tableSchemas[f.table] || []).map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name} ({c.type})
                            </option>
                          ))}
                        </select>

                        <select
                          value={f.operator}
                          onChange={(e) =>
                            updateFilter(f.id, {
                              operator: e.target.value as VisualFilterOperator,
                            })
                          }
                          className="input-select op-select font-mono"
                        >
                          <option value="=">=</option>
                          <option value="!=">!=</option>
                          <option value=">">&gt;</option>
                          <option value="<">&lt;</option>
                          <option value=">=">&gt;=</option>
                          <option value="<=">&lt;=</option>
                          <option value="LIKE">LIKE</option>
                          <option value="NOT LIKE">NOT LIKE</option>
                          <option value="IN">IN (...)</option>
                          <option value="IS NULL">IS NULL</option>
                          <option value="IS NOT NULL">IS NOT NULL</option>
                        </select>

                        {!["IS NULL", "IS NOT NULL"].includes(f.operator) && (
                          <input
                            type="text"
                            placeholder={f.operator === "IN" ? "val1, val2" : "Value..."}
                            value={f.value}
                            onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                            className="input-text value-input font-mono"
                          />
                        )}

                        <button
                          type="button"
                          className="btn-icon remove-filter-btn"
                          onClick={() => removeFilter(f.id)}
                          title="Remove filter"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: Sorting & Limit */}
            {bottomTab === "sort" && (
              <div className="tab-content sort-tab-content">
                <div className="sort-columns-section">
                  <div className="tab-toolbar">
                    <span className="tab-tip">Order results by one or more columns (ORDER BY)</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addSort}
                      disabled={canvasTableNames.length === 0}
                    >
                      <Plus size={11} />
                      <span>Add Sort</span>
                    </button>
                  </div>

                  {sorts.length === 0 ? (
                    <div className="empty-panel-msg">Default database order. Click &quot;Add Sort&quot; to specify column order.</div>
                  ) : (
                    <div className="conditions-list">
                      {sorts.map((s) => (
                        <div key={s.id} className="condition-row">
                          <select
                            value={s.table}
                            onChange={(e) => {
                              const newTbl = e.target.value;
                              const cols = tableSchemas[newTbl] || [];
                              updateSort(s.id, {
                                table: newTbl,
                                column: cols[0]?.name || "",
                              });
                            }}
                            className="input-select table-select font-mono"
                          >
                            {canvasTableNames.map((tbl) => (
                              <option key={tbl} value={tbl}>
                                {tbl}
                              </option>
                            ))}
                          </select>

                          <select
                            value={s.column}
                            onChange={(e) => updateSort(s.id, { column: e.target.value })}
                            className="input-select col-select font-mono"
                          >
                            {(tableSchemas[s.table] || []).map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name}
                              </option>
                            ))}
                          </select>

                          <select
                            value={s.direction}
                            onChange={(e) =>
                              updateSort(s.id, { direction: e.target.value as "ASC" | "DESC" })
                            }
                            className="input-select op-select font-mono"
                          >
                            <option value="ASC">ASC (Ascending)</option>
                            <option value="DESC">DESC (Descending)</option>
                          </select>

                          <button
                            type="button"
                            className="btn-icon remove-filter-btn"
                            onClick={() => removeSort(s.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="limit-section">
                  <div className="limit-header">
                    <span className="limit-label">Limit Rows (LIMIT):</span>
                    <select
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                      className="input-select limit-select font-mono"
                    >
                      <option value={25}>25 rows</option>
                      <option value={50}>50 rows</option>
                      <option value={100}>100 rows</option>
                      <option value={500}>500 rows</option>
                      <option value={1000}>1000 rows</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 5: Group By & Aggregations */}
            {bottomTab === "groupby" && (
              <div className="tab-content groupby-tab-content">
                {/* 1. GROUP BY Columns */}
                <div className="groupby-section">
                  <div className="tab-toolbar">
                    <div className="tab-tip-group">
                      <span className="section-badge font-mono">GROUP BY</span>
                      <span className="tab-tip">Group query rows by one or more columns</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addGroupBy}
                      disabled={canvasTableNames.length === 0}
                    >
                      <Plus size={11} />
                      <span>Add Group Column</span>
                    </button>
                  </div>

                  {groupBys.length === 0 ? (
                    <div className="empty-panel-msg">
                      No GROUP BY columns selected. Click <strong>&quot;Add Group Column&quot;</strong> to aggregate data by categories or keys.
                    </div>
                  ) : (
                    <div className="conditions-list">
                      {groupBys.map((g) => (
                        <div key={g.id} className="condition-row">
                          <span className="where-tag font-mono">GROUP BY</span>
                          <select
                            value={g.table}
                            onChange={(e) => {
                              const newTbl = e.target.value;
                              const cols = tableSchemas[newTbl] || [];
                              updateGroupBy(g.id, {
                                table: newTbl,
                                column: cols[0]?.name || "",
                              });
                            }}
                            className="input-select table-select font-mono"
                          >
                            {canvasTableNames.map((tbl) => (
                              <option key={tbl} value={tbl}>
                                {tbl}
                              </option>
                            ))}
                          </select>

                          <select
                            value={g.column}
                            onChange={(e) => updateGroupBy(g.id, { column: e.target.value })}
                            className="input-select col-select font-mono"
                          >
                            {(tableSchemas[g.table] || []).map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.type})
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            className="btn-icon remove-filter-btn"
                            onClick={() => removeGroupBy(g.id)}
                            title="Remove group by column"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Aggregate Functions (COUNT, SUM, AVG, MIN, MAX) */}
                <div className="groupby-section">
                  <div className="tab-toolbar">
                    <div className="tab-tip-group">
                      <span className="section-badge font-mono">AGGREGATES</span>
                      <span className="tab-tip">Calculate summary values (COUNT, SUM, AVG, MIN, MAX)</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addAggregate}
                      disabled={canvasTableNames.length === 0}
                    >
                      <Plus size={11} />
                      <span>Add Aggregate</span>
                    </button>
                  </div>

                  {aggregates.length === 0 ? (
                    <div className="empty-panel-msg">
                      No aggregate functions added. Click <strong>&quot;Add Aggregate&quot;</strong> to calculate totals or counts.
                    </div>
                  ) : (
                    <div className="conditions-list">
                      {aggregates.map((agg) => (
                        <div key={agg.id} className="condition-row">
                          <select
                            value={agg.func}
                            onChange={(e) =>
                              updateAggregate(agg.id, {
                                func: e.target.value as AggregateFunction,
                                alias: `${e.target.value.toLowerCase()}_${agg.column === "*" ? "rows" : agg.column}`,
                              })
                            }
                            className="input-select op-select font-mono agg-func-select"
                          >
                            <option value="COUNT">COUNT(...)</option>
                            <option value="COUNT_DISTINCT">COUNT(DISTINCT ...)</option>
                            <option value="SUM">SUM(...)</option>
                            <option value="AVG">AVG(...)</option>
                            <option value="MIN">MIN(...)</option>
                            <option value="MAX">MAX(...)</option>
                          </select>

                          <select
                            value={agg.table}
                            onChange={(e) => {
                              const newTbl = e.target.value;
                              const cols = tableSchemas[newTbl] || [];
                              updateAggregate(agg.id, {
                                table: newTbl,
                                column: cols[0]?.name || "*",
                              });
                            }}
                            className="input-select table-select font-mono"
                          >
                            {canvasTableNames.map((tbl) => (
                              <option key={tbl} value={tbl}>
                                {tbl}
                              </option>
                            ))}
                          </select>

                          <select
                            value={agg.column}
                            onChange={(e) => {
                              const newCol = e.target.value;
                              updateAggregate(agg.id, {
                                column: newCol,
                                alias: `${agg.func.toLowerCase()}_${newCol === "*" ? "rows" : newCol}`,
                              });
                            }}
                            className="input-select col-select font-mono"
                          >
                            {agg.func.startsWith("COUNT") && <option value="*">* (All rows)</option>}
                            {(tableSchemas[agg.table] || []).map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.type})
                              </option>
                            ))}
                          </select>

                          <span className="as-tag font-mono">AS</span>

                          <input
                            type="text"
                            placeholder="Alias (e.g. total_count)"
                            value={agg.alias || ""}
                            onChange={(e) => updateAggregate(agg.id, { alias: e.target.value })}
                            className="input-text value-input font-mono agg-alias-input"
                          />

                          <button
                            type="button"
                            className="btn-icon remove-filter-btn"
                            onClick={() => removeAggregate(agg.id)}
                            title="Remove aggregate"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. HAVING Clause */}
                <div className="groupby-section">
                  <div className="tab-toolbar">
                    <div className="tab-tip-group">
                      <span className="section-badge font-mono">HAVING</span>
                      <span className="tab-tip">Filter grouped summary results (HAVING conditions)</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={addHaving}
                      disabled={canvasTableNames.length === 0}
                    >
                      <Plus size={11} />
                      <span>Add HAVING Condition</span>
                    </button>
                  </div>

                  {havings.length === 0 ? (
                    <div className="empty-panel-msg">
                      No HAVING conditions configured. Click <strong>&quot;Add HAVING Condition&quot;</strong> to filter groups (e.g. COUNT(*) &gt; 5).
                    </div>
                  ) : (
                    <div className="conditions-list">
                      {havings.map((h, idx) => (
                        <div key={h.id} className="condition-row">
                          {idx > 0 && (
                            <select
                              value={h.logic}
                              onChange={(e) =>
                                updateHaving(h.id, { logic: e.target.value as "AND" | "OR" })
                              }
                              className="input-select logic-select font-mono"
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          )}
                          {idx === 0 && <span className="where-tag font-mono">HAVING</span>}

                          <select
                            value={h.func}
                            onChange={(e) =>
                              updateHaving(h.id, { func: e.target.value as AggregateFunction })
                            }
                            className="input-select op-select font-mono agg-func-select"
                          >
                            <option value="COUNT">COUNT(...)</option>
                            <option value="COUNT_DISTINCT">COUNT(DISTINCT ...)</option>
                            <option value="SUM">SUM(...)</option>
                            <option value="AVG">AVG(...)</option>
                            <option value="MIN">MIN(...)</option>
                            <option value="MAX">MAX(...)</option>
                            <option value="NONE">Column Value</option>
                          </select>

                          <select
                            value={h.table}
                            onChange={(e) => {
                              const newTbl = e.target.value;
                              const cols = tableSchemas[newTbl] || [];
                              updateHaving(h.id, {
                                table: newTbl,
                                column: cols[0]?.name || "*",
                              });
                            }}
                            className="input-select table-select font-mono"
                          >
                            {canvasTableNames.map((tbl) => (
                              <option key={tbl} value={tbl}>
                                {tbl}
                              </option>
                            ))}
                          </select>

                          <select
                            value={h.column}
                            onChange={(e) => updateHaving(h.id, { column: e.target.value })}
                            className="input-select col-select font-mono"
                          >
                            {h.func.startsWith("COUNT") && <option value="*">* (All rows)</option>}
                            {(tableSchemas[h.table] || []).map((c) => (
                              <option key={c.name} value={c.name}>
                                {c.name} ({c.type})
                              </option>
                            ))}
                          </select>

                          <select
                            value={h.operator}
                            onChange={(e) =>
                              updateHaving(h.id, {
                                operator: e.target.value as VisualFilterOperator,
                              })
                            }
                            className="input-select op-select font-mono"
                          >
                            <option value="=">=</option>
                            <option value="!=">!=</option>
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value=">=">&gt;=</option>
                            <option value="<=">&lt;=</option>
                          </select>

                          <input
                            type="text"
                            placeholder="Value (e.g. 10)"
                            value={h.value}
                            onChange={(e) => updateHaving(h.id, { value: e.target.value })}
                            className="input-text value-input font-mono"
                          />

                          <button
                            type="button"
                            className="btn-icon remove-filter-btn"
                            onClick={() => removeHaving(h.id)}
                            title="Remove HAVING condition"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {contentEditorModal && (
        <ContentEditorModal
          data={contentEditorModal}
          theme={theme}
        />
      )}

      <style jsx>{`
        .visual-query-container {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
          background: var(--bg-content);
          color: var(--text-main);
          position: relative;
          overflow: hidden;
        }

        /* Top Header Bar */
        .vq-top-bar {
          height: var(--header-h);
          padding: 0 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
          gap: 12px;
          z-index: 20;
        }

        .bar-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        :global(.head-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .head-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
        }

        .db-pill {
          font-size: 10px;
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.25);
          padding: 2px 7px;
          border-radius: var(--radius-xs);
          color: var(--accent-blue);
          font-weight: 600;
        }

        .count-tag {
          font-size: 10px;
          color: var(--text-muted);
        }

        /* Steps Guide Bar */
        .steps-guide-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-tertiary);
          padding: 3px 10px;
          border-radius: 20px;
          border: 1px solid var(--border-light);
        }

        .step-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .step-num {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: var(--bg-card);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
        }

        .step-item.is-done {
          color: var(--text-main);
        }

        .step-item.is-done .step-num {
          background: var(--accent-blue);
          color: #ffffff;
        }

        .step-item.is-current {
          color: var(--accent-blue);
          font-weight: 600;
        }

        .step-item.is-current .step-num {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          border: 1px solid var(--accent-blue);
        }

        .step-run .step-num {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
        }

        .step-arrow {
          color: var(--text-muted);
          font-size: 10px;
          opacity: 0.5;
        }

        .bar-right {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .run-query-main-btn {
          background: var(--btn-primary-bg) !important;
          color: var(--btn-primary-text) !important;
          font-weight: 700 !important;
          padding: 4px 12px !important;
          border-radius: var(--radius-xs) !important;
        }

        .btn-sm {
          padding: 4px 9px;
          font-size: 11px;
          height: 28px;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .btn-xs {
          padding: 2px 7px;
          font-size: 10px;
          height: 24px;
          display: flex;
          align-items: center;
          gap: 4px;
          border-radius: var(--radius-xs);
        }

        .vq-workspace {
          display: flex;
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* Sidebar */
        .vq-sidebar {
          width: var(--sidebar-w);
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          z-index: 10;
          transition: width 0.16s ease, min-width 0.16s ease, max-width 0.16s ease;
        }

        .vq-sidebar.collapsed {
          width: 38px !important;
          min-width: 38px !important;
          max-width: 38px !important;
          align-items: center;
          padding: 6px 0;
          overflow: hidden;
        }

        .sidebar-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .sidebar-collapsed-header {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        .sidebar-toggle-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 4px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          color: var(--accent-blue);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .sidebar-toggle-btn:hover {
          background: var(--accent-blue);
          color: #ffffff;
        }

        .collapsed-sidebar-body {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin-top: 12px;
          padding: 6px 0;
          width: 100%;
          color: var(--text-muted);
          transition: color 0.12s ease;
        }
        .collapsed-sidebar-body:hover {
          color: var(--accent-blue);
        }

        .collapsed-tbl-icon {
          color: var(--accent-blue);
        }

        .collapsed-badge {
          font-size: 8.5px;
          font-weight: 700;
          background: var(--accent-blue);
          color: #ffffff;
          padding: 1px 4px;
          border-radius: 6px;
          line-height: 1;
        }

        .sidebar-header {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .sidebar-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }

        .search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .search-icon-wrap {
          position: absolute;
          left: 8px;
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }

        .search-field {
          width: 100%;
          padding-left: 24px;
          padding-right: 20px;
          font-size: 11px;
          height: 26px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          color: var(--text-main);
          outline: none;
        }

        .search-field:focus {
          border-color: var(--border-focus);
        }

        .search-clear-btn {
          position: absolute;
          right: 4px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
        }

        .sidebar-table-list {
          flex: 1;
          overflow-y: auto;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sidebar-table-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          transition: background 0.12s ease;
          gap: 6px;
        }

        .sidebar-table-item:hover {
          background: var(--bg-hover);
        }

        .sidebar-table-item.is-added {
          opacity: 0.55;
          cursor: default;
          background: var(--bg-active);
        }

        .table-item-name-group {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        :global(.tbl-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .tbl-name {
          font-size: 11.5px;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .table-item-meta {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .col-count {
          font-size: 10px;
          color: var(--text-muted);
        }

        .add-icon {
          color: var(--text-muted);
          display: flex;
          align-items: center;
        }

        .sidebar-table-item:hover .add-icon {
          color: var(--accent-blue);
        }

        .added-badge {
          color: var(--accent-green);
          display: flex;
          align-items: center;
        }

        .sidebar-loading,
        .sidebar-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 24px 12px;
          font-size: 11px;
          color: var(--text-muted);
        }

        /* Canvas Area & Floating Action Toolbox */
        .vq-canvas-area {
          flex: 1;
          height: 100%;
          position: relative;
          background: var(--bg-content);
        }

        .canvas-floating-toolbox {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 3px 6px;
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-sm);
          display: flex;
          align-items: center;
          gap: 4px;
          z-index: 25;
        }

        .toolbox-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 4px 9px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all 0.12s ease;
        }

        .toolbox-btn:hover {
          background: var(--bg-hover);
        }

        .add-table-tb-btn {
          color: var(--accent-blue);
        }

        .add-filter-tb-btn {
          color: var(--text-main);
        }

        .auto-link-tb-btn {
          color: var(--accent-green);
        }

        .clear-tb-btn:hover {
          color: var(--accent-red);
        }

        /* Quick Table Picker Popover */
        .quick-picker-popover {
          position: absolute;
          top: 50px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 12px;
          width: 360px;
          max-height: 260px;
          box-shadow: var(--shadow-popup);
          z-index: 30;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .quick-picker-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .quick-picker-title {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-main);
        }

        .quick-picker-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }

        .quick-picker-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          max-height: 180px;
          overflow-y: auto;
        }

        .quick-table-chip {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 4px 8px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: all 0.12s ease;
        }

        .quick-table-chip:hover:not(:disabled) {
          background: var(--accent-blue);
          color: #ffffff;
          border-color: var(--accent-blue);
        }

        .quick-table-chip.is-added {
          opacity: 0.45;
          cursor: default;
        }

        /* Canvas Empty State */
        .canvas-empty-state {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 5;
        }

        .game-empty-card {
          pointer-events: auto;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          padding: 24px 32px;
          text-align: center;
          max-width: 420px;
          box-shadow: var(--shadow-popup);
        }

        .game-sparkle-halo {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: rgba(59, 130, 246, 0.12);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 10px auto;
        }

        :global(.game-sparkle-icon) {
          color: var(--accent-blue);
        }

        .game-empty-card h3 {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 6px;
          color: var(--text-main);
        }

        .game-empty-card p {
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.6;
          margin-bottom: 16px;
        }

        .game-quick-tables {
          display: flex;
          justify-content: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .game-quick-add-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 11px;
          padding: 4px 8px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.12s ease;
        }

        .game-quick-add-btn:hover {
          background: var(--accent-blue);
          color: #ffffff;
          border-color: var(--accent-blue);
        }

        .filter-highlight-btn {
          color: var(--accent-blue);
        }

        /* Join Popover */
        .join-popover {
          position: absolute;
          top: 16px;
          right: 16px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          padding: 12px;
          width: 270px;
          box-shadow: var(--shadow-popup);
          z-index: 30;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .join-popover-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .popover-title {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--text-main);
        }

        .popover-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
        }

        .join-popover-condition {
          background: var(--bg-tertiary);
          padding: 6px 8px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          word-break: break-all;
          color: var(--accent-blue);
        }

        .join-types-selector {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .join-type-btn {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 6px;
          border-radius: var(--radius-xs);
          font-size: 10.5px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .join-type-btn:hover {
          background: var(--bg-hover);
        }

        .join-type-btn.active {
          background: var(--accent-blue);
          border-color: var(--accent-blue);
          color: #ffffff;
        }

        .join-popover-footer {
          display: flex;
          justify-content: flex-end;
          border-top: 1px solid var(--border-light);
          padding-top: 8px;
        }

        /* Bottom Drawer Panel */
        .vq-bottom-panel {
          background: var(--bg-card);
          border-top: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          z-index: 20;
          position: relative;
          transition: height 0.05s ease-out;
        }

        .drawer-resizer-handle {
          position: absolute;
          top: -4px;
          left: 0;
          right: 0;
          height: 8px;
          cursor: ns-resize;
          z-index: 30;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .drawer-resizer-handle:hover .resizer-grip-bar,
        .drawer-resizer-handle.is-dragging .resizer-grip-bar {
          background: var(--accent-blue);
          height: 3px;
        }

        .resizer-grip-bar {
          width: 48px;
          height: 2px;
          background: var(--border-medium);
          border-radius: 2px;
          transition: all 0.15s ease;
        }

        .drawer-header {
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          user-select: none;
        }

        .drawer-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 100%;
        }

        .drawer-tab-btn {
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          padding: 0 10px;
          height: 100%;
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: color 0.15s ease, border-bottom-color 0.15s ease;
        }

        .drawer-tab-btn:hover {
          color: var(--text-main);
        }

        .drawer-tab-btn.active {
          color: var(--accent-blue);
          border-bottom-color: var(--accent-blue);
          font-weight: 700;
        }

        .tab-pill {
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          padding: 1px 6px;
          border-radius: 10px;
          font-size: 9.5px;
          font-weight: 600;
        }

        .drawer-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pending-actions-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .pending-badge {
          font-size: 10px;
          color: #d97706;
          background: rgba(245, 158, 11, 0.12);
          padding: 2px 6px;
          border-radius: var(--radius-xs);
          font-weight: 600;
        }

        .save-commit-btn {
          background: #10b981 !important;
          color: #ffffff !important;
          font-weight: 600 !important;
        }

        .save-commit-btn:hover:not(:disabled) {
          background: #059669 !important;
        }

        .drawer-toggle-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .drawer-body {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .tab-content {
          flex: 1;
          overflow-y: auto;
          padding: 10px 14px;
          display: flex;
          flex-direction: column;
        }

        .sql-tab-content {
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow: hidden;
        }

        .sql-editor-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          flex-shrink: 0;
        }

        .sql-toolbar-left {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .sql-toolbar-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .sync-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .sync-badge.is-success {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
        }

        .sync-badge.is-error {
          background: rgba(239, 68, 68, 0.12);
          color: var(--accent-red);
          max-width: 300px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sync-canvas-btn {
          background: var(--accent-blue) !important;
          color: #ffffff !important;
          font-weight: 600 !important;
        }

        .sql-textarea-wrapper {
          flex: 1;
          min-height: 140px;
          display: flex;
          position: relative;
        }

        .sql-code-editor-textarea {
          width: 100%;
          height: 100%;
          min-height: 140px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 10px 12px;
          color: var(--text-main);
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          line-height: 1.6;
          resize: none;
          outline: none;
          tab-size: 2;
          transition: border-color 0.15s ease;
        }

        .sql-code-editor-textarea:focus {
          border-color: var(--border-focus);
          background: var(--bg-card);
        }

        .tab-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .tab-tip {
          font-size: 11px;
          color: var(--text-muted);
        }

        .conditions-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .condition-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .where-tag {
          font-size: 11px;
          font-weight: 700;
          color: var(--accent-blue);
          width: 50px;
        }

        .logic-select {
          width: 65px;
        }

        .input-select,
        .input-text {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          padding: 4px 8px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          outline: none;
        }

        .input-select:focus,
        .input-text:focus {
          border-color: var(--border-focus);
        }

        .value-input {
          flex: 1;
          min-width: 140px;
        }

        .btn-icon {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
        }

        .btn-icon:hover {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.1);
        }

        .empty-panel-msg {
          font-size: 11px;
          color: var(--text-muted);
          padding: 16px 0;
          text-align: center;
        }

        .sort-tab-content {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        /* Group By & Aggregates Tab */
        .groupby-tab-content {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .groupby-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-bottom: 1px dashed var(--border-light);
          padding-bottom: 14px;
        }

        .groupby-section:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        .tab-tip-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .section-badge {
          font-size: 9.5px;
          font-weight: 700;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.25);
          padding: 2px 6px;
          border-radius: var(--radius-xs);
          letter-spacing: 0.5px;
        }

        .as-tag {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          padding: 0 4px;
        }

        .agg-func-select {
          min-width: 110px;
          font-weight: 600;
          color: var(--accent-blue);
        }

        .agg-alias-input {
          max-width: 160px;
        }

        .limit-section {
          display: flex;
          align-items: center;
          border-top: 1px solid var(--border-light);
          padding-top: 8px;
        }

        .limit-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .limit-label {
          font-size: 11px;
          color: var(--text-muted);
        }

        /* Results Tab */
        .results-tab-content {
          padding: 0;
          overflow: hidden;
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        .results-table-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }

        .results-meta-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          font-size: 11px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          flex-shrink: 0;
        }

        .results-meta-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .results-meta-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .results-pagination-bar {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .pagination-page-tag {
          font-size: 10.5px;
          color: var(--text-sub);
          padding: 0 4px;
          white-space: nowrap;
        }

        .pagination-limit-select {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 10px;
          padding: 1px 4px;
          border-radius: var(--radius-xs);
          outline: none;
          cursor: pointer;
        }

        .results-hint-tag {
          font-size: 10px;
          color: var(--text-muted);
          opacity: 0.8;
        }

        .commit-msg {
          font-size: 10.5px;
          padding: 1px 6px;
          border-radius: var(--radius-xs);
        }

        .commit-msg.is-success {
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.12);
        }

        .commit-msg.is-error {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.12);
        }

        .meta-time {
          display: flex;
          align-items: center;
          gap: 4px;
          color: var(--text-muted);
        }

        .results-table-wrapper {
          flex: 1;
          overflow: auto;
          min-height: 0;
          width: 100%;
        }

        .results-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        .results-table th {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 6px 10px;
          text-align: left;
          font-weight: 700;
          color: var(--text-sub);
          white-space: nowrap;
          z-index: 2;
        }

        .result-data-row {
          transition: background 0.12s ease;
        }

        .result-data-row:hover td {
          background: var(--bg-hover);
        }

        .result-data-row.is-deleted td {
          text-decoration: line-through;
          opacity: 0.6;
          background: rgba(239, 68, 68, 0.08) !important;
        }

        .result-data-row.is-edited-row {
          background: rgba(245, 158, 11, 0.04);
        }

        .results-table td {
          padding: 5px 10px;
          border-bottom: 1px solid var(--border-light);
          white-space: nowrap;
          color: var(--text-main);
          position: relative;
        }

        .th-idx,
        .td-idx {
          width: 36px;
          text-align: center !important;
          color: var(--text-muted) !important;
        }

        .th-actions,
        .td-actions {
          width: 44px;
          text-align: center !important;
          padding: 2px 4px !important;
        }

        .row-action-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: var(--radius-xs);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }

        .row-action-btn:hover {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.12);
        }

        .row-action-btn.is-active-del {
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.12);
        }

        .result-cell {
          cursor: pointer;
        }

        .result-cell.is-edited {
          background: rgba(245, 158, 11, 0.12) !important;
          color: #d97706;
          font-weight: 600;
        }

        .cell-content-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .edited-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #d97706;
          flex-shrink: 0;
        }

        .td-editing-cell {
          padding: 0 !important;
        }

        .inline-cell-input {
          width: 100%;
          height: 28px;
          padding: 0 8px;
          background: var(--bg-card);
          border: 1.5px solid var(--accent-blue);
          color: var(--text-main);
          font-size: 11px;
          outline: none;
        }

        .is-null {
          color: var(--text-muted) !important;
          font-style: italic;
        }

        .text-amber {
          color: #d97706;
        }

        .results-status-center {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 32px 0;
          font-size: 11.5px;
          color: var(--text-muted);
        }

        .results-error-banner {
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.25);
          color: var(--accent-red);
          padding: 8px 12px;
          border-radius: var(--radius-xs);
          font-size: 11px;
          margin: 10px;
        }

        .rotate-180 {
          transform: rotate(180deg);
        }

        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
};

export const VisualQueryBuilder: React.FC<VisualQueryBuilderProps> = (props) => {
  return (
    <ReactFlowProvider>
      <VisualQueryBuilderInner {...props} />
    </ReactFlowProvider>
  );
};
