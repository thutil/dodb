/* eslint-disable @typescript-eslint/no-explicit-any */
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
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GitFork, Table2, Key, ArrowRight, Search, RefreshCw,
  Database, Globe, LayoutGrid, Maximize2, Sparkles, X, Eye, Layers, Filter,
  ChevronDown, ChevronUp, PanelLeftClose, PanelLeftOpen, Printer, Download
} from "lucide-react";
import { ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";
import { isGeometryColumn, isCoordinateColumn } from "../utils/gisUtils";
import { Language, t } from "../utils/i18n";
import { ErdExportModal } from "./ErdExportModal";

interface SchemaDiagramProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  activeTable?: string | null;
  apiBase?: string;
  theme?: "dark" | "light";
  language?: Language;
}

interface TableColumn {
  name: string;
  type: string;
  primaryKey: boolean;
}

interface TableData {
  name: string;
  columns: TableColumn[];
}

interface Relation {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

type ViewMode = "all" | "compact" | "keys_only";

interface TableNodeData {
  table: TableData;
  fkMap: Record<string, Relation>;
  searchQuery: string;
  highlighted: boolean;
  viewMode: ViewMode;
  [key: string]: unknown;
}

// Memoized Custom React Flow Table Node Component for maximum 60fps performance
const TableNodeComponent: React.FC<NodeProps<Node<TableNodeData>>> = ({ data, selected }) => {
  const table = data.table;
  const fkMap = data.fkMap || {};
  const searchQuery = (data.searchQuery || "").toLowerCase();
  const viewMode = data.viewMode || "compact";
  const [expanded, setExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Filter columns by search query if any
  const matchedColumns = useMemo(() => {
    if (!searchQuery) return table.columns;
    return table.columns.filter(
      (c) => c.name.toLowerCase().includes(searchQuery) || c.type.toLowerCase().includes(searchQuery)
    );
  }, [table.columns, searchQuery]);

  // Keys-only or compact truncation
  const visibleColumns = useMemo(() => {
    if (isCollapsed) return [];
    if (expanded || viewMode === "all") return matchedColumns;
    if (viewMode === "keys_only") {
      return matchedColumns.filter((c) => c.primaryKey || fkMap[c.name]);
    }
    if (viewMode === "compact") {
      // In compact mode: ALWAYS keep PKs and FKs visible, then add up to 8 other columns
      const keySet = new Set(matchedColumns.filter((c) => c.primaryKey || fkMap[c.name]).map((c) => c.name));
      const otherCols = matchedColumns.filter((c) => !keySet.has(c.name)).slice(0, 8);
      otherCols.forEach((c) => keySet.add(c.name));
      return matchedColumns.filter((c) => keySet.has(c.name));
    }
    return matchedColumns;
  }, [matchedColumns, viewMode, expanded, fkMap, isCollapsed]);

  const hiddenCount = matchedColumns.length - visibleColumns.length;

  return (
    <div
      className={`react-flow-table-card ${data.highlighted ? "is-highlighted" : ""} ${
        selected ? "is-selected" : ""
      } ${isCollapsed ? "is-collapsed" : ""}`}
    >
      {/* Hidden fallback handles for all table columns to completely eliminate React Flow #008 warnings */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0 }}>
        {table.columns.map((col) => (
          <React.Fragment key={`fb-h-${col.name}`}>
            <Handle type="target" position={Position.Left} id={`${table.name}:${col.name}`} style={{ top: 20 }} />
            <Handle type="source" position={Position.Right} id={`${table.name}:${col.name}`} style={{ top: 20 }} />
          </React.Fragment>
        ))}
      </div>

      {/* Header with Table Name & Collapse Toggle Button */}
      <div className="card-header" onClick={() => setIsCollapsed((prev) => !prev)}>
        <div className="card-title-group">
          <Table2 size={13} className="card-tbl-icon" />
          <span className="card-tbl-name font-mono" title={table.name}>
            {table.name}
          </span>
        </div>
        <div className="card-header-actions">
          <span className="card-col-count font-mono">{table.columns.length}</span>
          <button
            type="button"
            className="card-collapse-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed((prev) => !prev);
            }}
            title={isCollapsed ? "Expand table columns" : "Collapse table columns"}
          >
            {isCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
      </div>

      {/* Columns list */}
      {!isCollapsed && (
        <div className="card-body">
          {visibleColumns.map((col) => {
            const isFk = !!fkMap[col.name];
            const isPk = col.primaryKey;
            const isGeom = isGeometryColumn(col.type);
            const isCoord = isCoordinateColumn(col.name);

            return (
              <div
                key={col.name}
                className={`col-row ${isPk ? "pk-row" : ""} ${isFk ? "fk-row" : ""}`}
              >
                {/* Target handle for foreign keys targeting this table/column */}
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`${table.name}:${col.name}`}
                  className="flow-handle handle-left"
                />

                <div className="col-name-group">
                  {isPk && <Key size={10} className="pk-icon" />}
                  {isFk && !isPk && <GitFork size={10} className="fk-icon" />}
                  {isGeom && <Globe size={10} className="gis-icon" />}
                  <span className={`col-name font-mono ${isPk ? "bold" : ""}`}>{col.name}</span>
                </div>

                <div className="col-right">
                  <span className="col-type font-mono">{col.type}</span>
                  {isCoord && <span className="gis-pill font-mono">GIS</span>}
                </div>

                {/* Source handle for relations starting from this column */}
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`${table.name}:${col.name}`}
                  className="flow-handle handle-right"
                />
              </div>
            );
          })}

          {hiddenCount > 0 && !expanded && (
            <button
              type="button"
              className="expand-cols-btn font-mono"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              + {hiddenCount} more column{hiddenCount === 1 ? "" : "s"}
            </button>
          )}

          {expanded && matchedColumns.length > 8 && (
            <button
              type="button"
              className="expand-cols-btn font-mono"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              Collapse columns
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const TableNode = React.memo(TableNodeComponent);

const NODE_TYPES = Object.freeze({
  tableNode: TableNode,
});

const EDGE_TYPES = Object.freeze({});

const SchemaDiagramInner: React.FC<SchemaDiagramProps> = ({
  activeProfile,
  activeDatabase,
  activeTable,
  theme = "dark",
  language = "en",
}) => {
  const [tables, setTables] = useState<TableData[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRelationIdx, setSelectedRelationIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [filterConnectedOnly, setFilterConnectedOnly] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const flowWrapperRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  const selectedTableIds = useMemo(() => {
    const ids = new Set<string>();
    nodes.forEach((n) => {
      if (n.selected || n.data?.highlighted) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [nodes]);

  // Compute Intelligent Topological Layered Layout:
  // Groups tables into dependency ranks (Root Parent -> Core Entity -> Child Detail)
  // to minimize edge crossings and eliminate table overlap.
  const arrangeLayout = useCallback((tablesList: TableData[], relationsList: Relation[], currentMode: ViewMode) => {
    // Precalculate FK map per table
    const tableFkMaps: Record<string, Record<string, Relation>> = {};
    const outgoingTargets: Record<string, Set<string>> = {};
    const incomingSources: Record<string, Set<string>> = {};

    tablesList.forEach((t) => {
      tableFkMaps[t.name] = {};
      outgoingTargets[t.name] = new Set();
      incomingSources[t.name] = new Set();
    });

    relationsList.forEach((r) => {
      if (tableFkMaps[r.fromTable]) {
        tableFkMaps[r.fromTable][r.fromColumn] = r;
      }
      if (outgoingTargets[r.fromTable]) {
        outgoingTargets[r.fromTable].add(r.toTable);
      }
      if (incomingSources[r.toTable]) {
        incomingSources[r.toTable].add(r.fromTable);
      }
    });

    // 1. Calculate Dependency Rank for each table (Sugiyama Layering)
    const tableRanks: Record<string, number> = {};

    tablesList.forEach((t) => {
      const outCount = outgoingTargets[t.name]?.size || 0;
      const inCount = incomingSources[t.name]?.size || 0;

      if (outCount === 0 && inCount === 0) {
        // Standalone isolated tables
        tableRanks[t.name] = 0;
      } else if (outCount === 0 && inCount > 0) {
        // Root Parent tables (e.g. users, categories)
        tableRanks[t.name] = 0;
      } else if (outCount > 0 && inCount > 0) {
        // Intermediate Core Entities (e.g. properties)
        tableRanks[t.name] = 1;
      } else {
        // Child Leaf Entities (e.g. property_images, reviews)
        tableRanks[t.name] = 2;
      }
    });

    // 2. Group into Layer Columns
    const maxRank = 3;
    const layers: TableData[][] = Array.from({ length: maxRank + 1 }, () => []);

    tablesList.forEach((t) => {
      const rank = Math.min(maxRank, tableRanks[t.name] ?? 0);
      layers[rank].push(t);
    });

    // 3. If a layer has too many tables, split into sub-columns
    const columnsGrid: TableData[][] = [];
    const maxTablesPerCol = 4;

    layers.forEach((layerTables) => {
      if (layerTables.length === 0) return;
      // Sort tables in layer by connected parent affinity to minimize crossings
      layerTables.sort((a, b) => {
        const aTarget = Array.from(outgoingTargets[a.name] || [])[0] || "";
        const bTarget = Array.from(outgoingTargets[b.name] || [])[0] || "";
        return aTarget.localeCompare(bTarget);
      });

      for (let i = 0; i < layerTables.length; i += maxTablesPerCol) {
        columnsGrid.push(layerTables.slice(i, i + maxTablesPerCol));
      }
    });

    if (columnsGrid.length === 0) {
      columnsGrid.push([...tablesList]);
    }

    const cardWidth = 280;
    const colGap = 100;
    const vGap = 50;

    // 4. Calculate coordinates with dynamic vertical stacking per column
    const newNodes: Node<TableNodeData>[] = [];

    columnsGrid.forEach((colTables, colIdx) => {
      const colX = colIdx * (cardWidth + colGap) + 50;
      let currY = 50;

      colTables.forEach((t) => {
        const renderedColsCount =
          currentMode === "keys_only"
            ? Math.max(1, t.columns.filter((c) => c.primaryKey || tableFkMaps[t.name]?.[c.name]).length)
            : currentMode === "compact"
            ? Math.min(10, Math.max(1, t.columns.length))
            : Math.max(1, t.columns.length);

        const cardH = 38 + renderedColsCount * 28 + 14;

        newNodes.push({
          id: t.name,
          type: "tableNode",
          position: { x: colX, y: currY },
          data: {
            table: t,
            fkMap: tableFkMaps[t.name] || {},
            searchQuery,
            highlighted: false,
            viewMode: currentMode,
          },
        });

        currY += cardH + vGap;
      });
    });

    setNodes(newNodes);

    const isLargeSchema = relationsList.length > 20;

    const newEdges: Edge[] = relationsList.map((rel, idx) => ({
      id: `e-${rel.fromTable}-${rel.toTable}-${idx}`,
      source: rel.fromTable,
      target: rel.toTable,
      sourceHandle: `${rel.fromTable}:${rel.fromColumn}`,
      targetHandle: `${rel.toTable}:${rel.toColumn}`,
      type: "smoothstep",
      animated: !isLargeSchema,
      style: {
        stroke: theme === "dark" ? "#3b82f6" : "#2563eb",
        strokeWidth: 2,
        opacity: 0.9,
      },
      label: `${rel.fromColumn} ➔ ${rel.toColumn}`,
      labelStyle: {
        fill: theme === "dark" ? "#93c5fd" : "#1e40af",
        fontSize: 9.5,
        fontFamily: "monospace",
        fontWeight: 600,
      },
      labelBgStyle: {
        fill: theme === "dark" ? "#1e293b" : "#e2e8f0",
        fillOpacity: 0.95,
        rx: 4,
        ry: 4,
      },
    }));

    setEdges(newEdges);
    setTimeout(() => {
      fitView({ padding: 0.15, duration: 350 });
    }, 60);
  }, [searchQuery, theme, setNodes, setEdges, fitView]);

  const fetchSchemaDiagram = useCallback(async () => {
    if (!activeProfile || !activeDatabase) return;
    setLoading(true);
    setError(null);
    setSelectedRelationIdx(null);
    try {
      const data: any = await apiClient.getSchemaDiagram(
        activeProfile.id,
        activeDatabase
      );

      const fetchedTables: TableData[] = data?.tables || [];
      const fetchedRelations: Relation[] = data?.relations || [];

      // Auto-pick mode: if > 15 tables, default to compact mode to keep diagram smooth
      const recommendedMode: ViewMode = fetchedTables.length > 15 ? "compact" : "all";
      setViewMode(recommendedMode);

      setTables(fetchedTables);
      setRelations(fetchedRelations);

      arrangeLayout(fetchedTables, fetchedRelations, recommendedMode);
    } catch (err: any) {
      console.error("Fetch ER Diagram schema error", err);
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [activeProfile, activeDatabase, arrangeLayout]);

  useEffect(() => {
    fetchSchemaDiagram();
  }, [fetchSchemaDiagram]);

  // Update node viewMode or search without full remount
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          searchQuery,
          viewMode,
        },
      }))
    );
  }, [searchQuery, viewMode, setNodes]);

  // Handle clicking a relation chip in the summary bar
  const handleSelectRelation = (idx: number) => {
    const rel = relations[idx];
    if (!rel) return;

    if (selectedRelationIdx === idx) {
      setSelectedRelationIdx(null);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, highlighted: false },
        }))
      );
      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          animated: relations.length <= 20,
          style: { stroke: "#3b82f6", strokeWidth: 1.8, opacity: 0.9 },
        }))
      );
    } else {
      setSelectedRelationIdx(idx);
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            highlighted: n.id === rel.fromTable || n.id === rel.toTable,
          },
        }))
      );
      setEdges((eds) =>
        eds.map((e, eIdx) => ({
          ...e,
          animated: eIdx === idx,
          style: {
            stroke: eIdx === idx ? "#10b981" : "#475569",
            strokeWidth: eIdx === idx ? 3 : 1.2,
            opacity: eIdx === idx ? 1 : 0.35,
          },
        }))
      );
    }
  };

  // Filter nodes if filterConnectedOnly is turned on
  const filteredNodes = useMemo(() => {
    if (!filterConnectedOnly) return nodes;
    const connectedTableNames = new Set<string>();
    relations.forEach((r) => {
      connectedTableNames.add(r.fromTable);
      connectedTableNames.add(r.toTable);
    });
    return nodes.filter((n) => connectedTableNames.has(n.id));
  }, [nodes, relations, filterConnectedOnly]);

  if (!activeProfile) {
    return (
      <div className="diagram-pane">
        <div className="diagram-empty">
          <Database size={48} className="empty-icon" />
          <h3>No Database Connection Selected</h3>
          <p>Please select a connection and database to view the Schema ER Diagram.</p>
        </div>
        <style jsx>{`
          .diagram-pane {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--bg-content);
            height: 100%;
          }
          .empty-icon { color: var(--accent-blue); }
          .diagram-empty h3 { color: var(--text-main); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="diagram-pane">
      <div className="diagram-header-bar">
        <div className="bar-left">
          <GitFork size={16} className="head-icon" />
          <h2 className="head-title">Database ER Diagram</h2>
          <span className="db-pill font-mono">{activeDatabase}</span>
          <span className="count-tag font-mono">
            {tables.length} table{tables.length === 1 ? "" : "s"}, {relations.length} FK{relations.length === 1 ? "" : "s"}
          </span>
          <div
            className="read-only-badge font-mono"
            data-tooltip={
              language === "th"
                ? "ไดอะแกรมสำหรับดูโครงสร้างภาพรวมเท่านั้น ไม่มีการแก้ไขฐานข้อมูลโดยตรง"
                : "Read-only overview diagram (visual inspection only, no direct modifications)"
            }
          >
            <Eye size={11} className="read-only-icon" />
            <span>{language === "th" ? "ดูโครงสร้างเท่านั้น (Read Only)" : "Read Only View"}</span>
          </div>
        </div>

        <div className="bar-right">
          {/* View mode toggle */}
          <div className="view-mode-selector">
            <button
              type="button"
              className={`mode-btn ${viewMode === "compact" ? "active" : ""}`}
              onClick={() => setViewMode("compact")}
              title="Compact: Truncate long column lists (Recommended for 20+ tables)"
            >
              <Layers size={11} />
              <span>Compact</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "keys_only" ? "active" : ""}`}
              onClick={() => setViewMode("keys_only")}
              title="Keys Only: Show PK & FK columns only (High-performance for 50+ tables)"
            >
              <Key size={11} />
              <span>Keys Only</span>
            </button>
            <button
              type="button"
              className={`mode-btn ${viewMode === "all" ? "active" : ""}`}
              onClick={() => setViewMode("all")}
              title="Full: Show all columns"
            >
              <Eye size={11} />
              <span>All Columns</span>
            </button>
          </div>

          {/* Connected only filter */}
          {relations.length > 0 && (
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${filterConnectedOnly ? "active-filter" : ""}`}
              onClick={() => setFilterConnectedOnly((prev) => !prev)}
              title="Toggle to show only tables with foreign key relations"
            >
              <Filter size={11} />
              <span>{filterConnectedOnly ? "Linked Only" : "All Tables"}</span>
            </button>
          )}

          <div className="search-wrap">
            <span className="search-icon-wrap">
              <Search size={12} />
            </span>
            <input
              type="text"
              className="input search-field font-mono"
              placeholder="Filter tables & columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="search-clear-btn" onClick={() => setSearchQuery("")} title="Clear search">
                <X size={11} />
              </button>
            )}
          </div>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => arrangeLayout(tables, relations, viewMode)}
            title="Auto-organize table layout"
          >
            <LayoutGrid size={12} />
            <span>Layout</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => fitView({ padding: 0.15, duration: 350 })}
            title="Zoom to Fit Canvas"
          >
            <Maximize2 size={12} />
            <span>Fit</span>
          </button>

          <button
            className="btn btn-secondary btn-sm export-print-btn"
            onClick={() => setIsExportModalOpen(true)}
            disabled={tables.length === 0}
            title="Export PNG, JPG, or Print PDF"
          >
            <Printer size={12} />
            <span>Export / Print</span>
          </button>

          <button className="btn btn-primary btn-sm" onClick={fetchSchemaDiagram} disabled={loading} title="Reload schema">
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            <span>{loading ? "..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Error alert if any */}
      {error && (
        <div className="diagram-error-banner">
          <span>Failed to load schema: {error}</span>
          <button className="btn-retry" onClick={fetchSchemaDiagram}>Retry</button>
        </div>
      )}

      {/* Relationships Summary Panel */}
      {relations.length > 0 && (
        <div className="relations-summary-bar">
          <div className="summary-label">
            <Sparkles size={11} style={{ color: "#f59e0b" }} />
            <span className="summary-title">Relations ({relations.length}):</span>
          </div>
          <div className="rel-chips-wrapper">
            {relations.map((rel, idx) => {
              const isSelected = selectedRelationIdx === idx;
              return (
                <button
                  key={idx}
                  className={`rel-chip ${isSelected ? "is-active" : ""}`}
                  onClick={() => handleSelectRelation(idx)}
                  title={`Click to highlight: ${rel.fromTable}.${rel.fromColumn} -> ${rel.toTable}.${rel.toColumn}`}
                >
                  <span className="rel-table font-mono">{rel.fromTable}</span>
                  <span className="rel-col font-mono">({rel.fromColumn})</span>
                  <ArrowRight size={10} className="rel-arrow" />
                  <span className="rel-table font-mono">{rel.toTable}</span>
                  <span className="rel-col font-mono">({rel.toColumn})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Diagram Body Layout: Left Collapsible Tables Sidebar + Right Canvas */}
      <div className="diagram-main-layout">
        {/* Left Side: Collapsible Tables Sidebar */}
        <div className={`schema-tables-sidebar ${isSidebarCollapsed ? "collapsed" : ""}`}>
          <div className="sidebar-header">
            {!isSidebarCollapsed && (
              <div className="sidebar-title">
                <Table2 size={12} className="sidebar-icon" />
                <span>Tables ({tables.length})</span>
              </div>
            )}
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              data-tooltip={isSidebarCollapsed ? "Expand Tables Panel" : "Collapse Tables Panel"}
            >
              {isSidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            </button>
          </div>

          {!isSidebarCollapsed ? (
            <>
              <div className="sidebar-search-box">
                <Search size={11} className="search-icon" />
                <input
                  type="text"
                  className="input font-mono sidebar-search-input"
                  placeholder="Filter tables..."
                  value={sidebarSearch}
                  onChange={(e) => setSidebarSearch(e.target.value)}
                />
              </div>

              <div className="sidebar-tables-list">
                {tables
                  .filter((t) => t.name.toLowerCase().includes(sidebarSearch.toLowerCase()))
                  .map((t) => {
                    const isSelected = selectedTableIds.has(t.name);
                    return (
                      <button
                        key={t.name}
                        type="button"
                        className={`sidebar-table-item font-mono ${isSelected ? "active" : ""}`}
                        onClick={(e) => {
                          const isMulti = e.metaKey || e.ctrlKey || e.shiftKey;
                          if (isMulti) {
                            // Toggle selection on Command / Ctrl / Shift + Click
                            setNodes((nds) =>
                              nds.map((n) => {
                                if (n.id === t.name) {
                                  const nextState = !isSelected;
                                  return {
                                    ...n,
                                    selected: nextState,
                                    data: { ...n.data, highlighted: nextState },
                                  };
                                }
                                return n;
                              })
                            );
                          } else {
                            // Single click: focus & highlight this table
                            fitView({ nodes: [{ id: t.name }], padding: 0.5, duration: 400 });
                            setNodes((nds) =>
                              nds.map((n) => ({
                                ...n,
                                selected: n.id === t.name,
                                data: { ...n.data, highlighted: n.id === t.name },
                              }))
                            );
                          }
                        }}
                      >
                        <Table2 size={11} className="tbl-item-icon" />
                        <span className="tbl-item-name" title={t.name}>{t.name}</span>
                        <span className="tbl-item-count font-mono">{t.columns.length}</span>
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <div className="collapsed-sidebar-items">
              <span className="collapsed-count font-mono" title={`${tables.length} tables`}>{tables.length}</span>
            </div>
          )}
        </div>

        {/* Right Side: React Flow Canvas */}
        <div className="flow-wrapper" ref={flowWrapperRef}>
          {loading && (
            <div className="diagram-loading-overlay">
              <RefreshCw size={28} className="spin loading-icon" />
              <span className="loading-text">Discovering Schema & Relations...</span>
            </div>
          )}

          {!loading && tables.length === 0 && !error ? (
            <div className="no-tables-view">
              <Database size={32} className="no-tables-icon" />
              <p>No tables found in database &quot;{activeDatabase}&quot;</p>
            </div>
          ) : (
            <ReactFlow
              key={`${activeProfile.id}-${activeDatabase}-${tables.length}-${viewMode}`}
              nodes={filteredNodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              onlyRenderVisibleElements={true}
              minZoom={0.05}
              maxZoom={2}
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              fitView
              colorMode={theme}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                color={theme === "dark" ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.15)"}
              />
              <Controls />
              <MiniMap
                nodeStrokeWidth={3}
                zoomable
                pannable
                style={{
                  backgroundColor: theme === "dark" ? "#14171f" : "#f8fafc",
                  borderColor: theme === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
                }}
              />
            </ReactFlow>
          )}
        </div>
      </div>

      <ErdExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        flowContainerRef={flowWrapperRef}
        databaseName={activeDatabase}
        totalTablesCount={tables.length}
        selectedTablesCount={selectedTableIds.size}
        selectedTableIds={selectedTableIds}
        nodes={nodes}
        edges={edges}
        theme={theme}
      />

      <style jsx>{`
        .diagram-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
          height: 100%;
          min-height: 0;
          position: relative;
        }

        .diagram-header-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
          gap: 12px;
        }

        .bar-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .head-icon { color: var(--accent-blue); }
        .head-title { font-size: 14px; font-weight: 700; }
        .db-pill {
          font-size: 10px;
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.25);
          padding: 2px 7px;
          border-radius: 4px;
          color: var(--accent-blue);
          font-weight: 600;
        }
        .count-tag { font-size: 10px; color: var(--text-muted); }
        .read-only-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          border-radius: 4px;
          background: rgba(100, 116, 139, 0.12);
          border: 1px solid rgba(100, 116, 139, 0.25);
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 500;
          user-select: none;
        }
        .read-only-icon {
          color: var(--accent-blue);
        }

        .bar-right { display: flex; align-items: center; gap: 8px; }

        .view-mode-selector {
          display: flex;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 2px;
          gap: 2px;
        }
        .mode-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 10.5px;
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .mode-btn:hover {
          color: var(--text-main);
        }
        .mode-btn.active {
          background: var(--bg-card);
          color: var(--accent-blue);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .active-filter {
          background: rgba(59, 130, 246, 0.18) !important;
          color: var(--accent-blue) !important;
          border-color: var(--accent-blue) !important;
        }

        .search-wrap { position: relative; display: flex; align-items: center; }
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
        .search-field { padding-left: 26px; padding-right: 22px; width: 170px; font-size: 11px; height: 28px; }
        .search-clear-btn {
          position: absolute;
          right: 6px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          z-index: 2;
        }
        .search-clear-btn:hover { color: var(--text-main); }

        .btn-sm {
          padding: 4px 9px;
          font-size: 11px;
          height: 28px;
        }

        .diagram-error-banner {
          background: rgba(239, 68, 68, 0.15);
          border-bottom: 1px solid rgba(239, 68, 68, 0.3);
          color: #ef4444;
          padding: 6px 14px;
          font-size: 11px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .btn-retry {
          background: #ef4444;
          color: #fff;
          border: none;
          border-radius: 3px;
          padding: 2px 8px;
          font-size: 10px;
          cursor: pointer;
        }

        .relations-summary-bar {
          padding: 5px 12px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          gap: 10px;
          overflow-x: auto;
          flex-shrink: 0;
        }
        .summary-label {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .summary-title { font-size: 10.5px; font-weight: 700; color: var(--text-sub); white-space: nowrap; }
        .rel-chips-wrapper { display: flex; gap: 6px; align-items: center; }
        .rel-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 10px;
          white-space: nowrap;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .rel-chip:hover {
          border-color: var(--accent-blue);
          background: var(--bg-hover);
        }
        .rel-chip.is-active {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.18);
          box-shadow: 0 0 0 1px var(--accent-blue);
        }
        .rel-table { font-weight: 600; color: var(--text-main); }
        .rel-col { color: var(--text-muted); }
        .rel-arrow { color: var(--accent-blue); }

        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }

        .diagram-main-layout {
          display: flex;
          flex: 1;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }

        /* Collapsible Tables Sidebar in Schema Diagram */
        .schema-tables-sidebar {
          width: 210px;
          min-width: 210px;
          max-width: 210px;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
          transition: width 0.16s ease, min-width 0.16s ease, max-width 0.16s ease;
          z-index: 10;
        }
        .schema-tables-sidebar.collapsed {
          width: 38px;
          min-width: 38px;
          max-width: 38px;
          align-items: center;
          padding: 6px 0;
        }

        .sidebar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-bottom: 1px solid var(--border-light);
          gap: 6px;
        }
        .schema-tables-sidebar.collapsed .sidebar-header {
          padding: 4px 0;
          border-bottom: none;
          justify-content: center;
          width: 100%;
        }

        .sidebar-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-main);
        }
        .sidebar-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .sidebar-toggle-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
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

        .sidebar-search-box {
          position: relative;
          padding: 6px 8px;
          border-bottom: 1px solid var(--border-light);
        }
        .sidebar-search-box :global(.search-icon) {
          position: absolute;
          left: 14px;
          top: 13px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .sidebar-search-input {
          width: 100%;
          font-size: 10.5px;
          padding: 3px 6px 3px 22px;
          height: 24px;
        }

        .sidebar-tables-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .sidebar-table-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px;
          border-radius: 4px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-sub);
          font-size: 10.5px;
          cursor: pointer;
          text-align: left;
          gap: 6px;
          transition: all 0.1s ease;
        }
        .sidebar-table-item:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .sidebar-table-item.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: var(--accent-blue);
          color: var(--accent-blue);
          font-weight: 600;
        }
        .tbl-item-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .tbl-item-name {
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tbl-item-count {
          font-size: 8.5px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.08);
          padding: 0 4px;
          border-radius: 3px;
        }

        .collapsed-sidebar-items {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          margin-top: 6px;
        }
        .collapsed-count {
          font-size: 9px;
          background: var(--accent-blue);
          color: #ffffff;
          padding: 1px 4px;
          border-radius: 6px;
          font-weight: 700;
        }

        .flow-wrapper {
          position: relative;
          flex: 1;
          width: 100%;
          height: 100%;
          min-height: 0;
          background: var(--bg-content);
        }

        .no-tables-view {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .no-tables-icon {
          color: var(--accent-blue);
          opacity: 0.7;
        }

        .diagram-loading-overlay {
          position: absolute;
          inset: 0;
          z-index: 100;
          background: ${theme === "dark" ? "rgba(20, 23, 31, 0.85)" : "rgba(255, 255, 255, 0.85)"};
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: var(--text-main);
        }

        .loading-icon {
          color: var(--accent-blue);
        }

        .loading-text {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-sub);
        }

        :global(.react-flow-table-card) {
          width: 270px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        :global(.react-flow-table-card.is-collapsed) {
          width: 220px;
          border-color: var(--border-medium);
        }
        :global(.react-flow-table-card.is-selected),
        :global(.react-flow-table-card.is-highlighted) {
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        :global(.react-flow-table-card.is-match) {
          border-color: #f59e0b;
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45);
        }

        :global(.react-flow-table-card .card-header) {
          padding: 6px 8px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          cursor: pointer;
          user-select: none;
        }
        :global(.react-flow-table-card.is-collapsed .card-header) {
          border-bottom: none;
          background: var(--bg-card);
        }
        :global(.react-flow-table-card .card-title-group) {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
          flex: 1;
        }
        :global(.react-flow-table-card .card-header-actions) {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        :global(.react-flow-table-card .card-collapse-btn) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 3px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          transition: all 0.1s ease;
        }
        :global(.react-flow-table-card .card-collapse-btn:hover) {
          background: var(--bg-hover);
          color: var(--accent-blue);
        }
        :global(.react-flow-table-card .card-tbl-icon) { color: var(--accent-blue); flex-shrink: 0; }
        :global(.react-flow-table-card .card-tbl-name) {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.react-flow-table-card .card-col-count) {
          font-size: 9.5px;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 5px;
          border-radius: 3px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        :global(.react-flow-table-card .card-body) {
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 280px;
          overflow-y: auto;
        }

        :global(.react-flow-table-card .col-row) {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 3px 6px;
          border-radius: 3px;
          font-size: 10px;
          transition: background 0.1s ease;
        }
        :global(.react-flow-table-card .col-row:hover) {
          background: var(--bg-hover);
        }
        :global(.react-flow-table-card .col-match) {
          background: rgba(245, 158, 11, 0.15) !important;
        }
        :global(.react-flow-table-card .col-name-group) {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
        }
        :global(.react-flow-table-card .bullet-dot) { width: 4px; height: 4px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
        :global(.react-flow-table-card .pk-icon) { color: #f59e0b; flex-shrink: 0; }
        :global(.react-flow-table-card .fk-icon) { color: var(--accent-blue); flex-shrink: 0; }
        :global(.react-flow-table-card .pk-row .col-name) { font-weight: 700; color: #f59e0b; }
        :global(.react-flow-table-card .fk-row .col-name) { font-weight: 600; color: var(--accent-blue); }
        :global(.react-flow-table-card .col-name) {
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.react-flow-table-card .col-type) {
          color: var(--text-muted);
          font-size: 9px;
          flex-shrink: 0;
          margin-left: 6px;
        }
        :global(.react-flow-table-card .no-cols) {
          padding: 8px;
          text-align: center;
          font-size: 10px;
          color: var(--text-muted);
        }
        :global(.react-flow-table-card .expand-cols-btn) {
          margin-top: 4px;
          background: var(--bg-tertiary);
          border: 1px dashed var(--border-light);
          color: var(--accent-blue);
          font-size: 9.5px;
          padding: 3px 6px;
          border-radius: 3px;
          cursor: pointer;
          text-align: center;
          width: 100%;
          transition: background 0.12s ease;
        }
        :global(.react-flow-table-card .expand-cols-btn:hover) {
          background: var(--bg-hover);
        }
      `}</style>
    </div>
  );
};

export const SchemaDiagram: React.FC<SchemaDiagramProps> = (props) => {
  return (
    <ReactFlowProvider>
      <SchemaDiagramInner {...props} />
    </ReactFlowProvider>
  );
};
