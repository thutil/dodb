/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  GitFork, Network, Table2, Key, ArrowRight, Search, RefreshCw,
  Database, Globe, LayoutGrid, Maximize2, Sparkles, X, Eye, Layers, Filter
} from "lucide-react";
import { ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";
import { isGeometryColumn } from "../utils/gisUtils";

interface SchemaDiagramProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  apiBase?: string;
  theme?: "dark" | "light";
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
  const highlighted = Boolean(data.highlighted);
  const viewMode: ViewMode = data.viewMode || "all";
  const [expanded, setExpanded] = useState(false);

  const isTableMatch = searchQuery && table.name.toLowerCase().includes(searchQuery);

  const displayedColumns = useMemo(() => {
    const cols = table.columns || [];
    if (viewMode === "keys_only") {
      return cols.filter((c) => c.primaryKey || Boolean(fkMap[c.name]));
    }
    if (viewMode === "compact" && !expanded && cols.length > 6) {
      return cols.slice(0, 6);
    }
    return cols;
  }, [table.columns, viewMode, expanded, fkMap]);

  const hiddenCount = (table.columns?.length || 0) - displayedColumns.length;

  return (
    <div className={`react-flow-table-card ${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""} ${isTableMatch ? "is-match" : ""}`}>
      {/* 4 Multi-directional handles for clean relation wiring */}
      <Handle type="target" position={Position.Left} id="target-left" className="flow-handle" />
      <Handle type="source" position={Position.Right} id="source-right" className="flow-handle" />
      <Handle type="target" position={Position.Top} id="target-top" className="flow-handle" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" className="flow-handle" />

      <div className="card-header">
        <div className="card-title-group">
          <Table2 size={13} className="card-tbl-icon" />
          <h3 className="card-tbl-name font-mono" title={table.name}>{table.name}</h3>
        </div>
        <span className="card-col-count font-mono">{table.columns?.length || 0} cols</span>
      </div>

      <div className="card-body">
        {displayedColumns.length > 0 ? (
          displayedColumns.map((c) => {
            const fkRelation = fkMap[c.name];
            const isGeom = isGeometryColumn(c.type, c.name);
            const isColMatch = searchQuery && c.name.toLowerCase().includes(searchQuery);

            return (
              <div
                key={c.name}
                className={`col-row ${c.primaryKey ? "pk-row" : ""} ${fkRelation ? "fk-row" : ""} ${isColMatch ? "col-match" : ""}`}
              >
                <div className="col-name-group">
                  {c.primaryKey ? (
                    <span title="Primary Key (PK)">
                      <Key size={11} className="pk-icon" />
                    </span>
                  ) : fkRelation ? (
                    <span title={`Foreign Key: ${c.name} -> ${fkRelation.toTable}.${fkRelation.toColumn}`}>
                      <GitFork size={11} className="fk-icon" />
                    </span>
                  ) : isGeom ? (
                    <span title="GIS Geometry Column">
                      <Globe size={11} className="pk-icon" style={{ color: "var(--accent-blue)" }} />
                    </span>
                  ) : (
                    <span className="bullet-dot" />
                  )}
                  <span className="col-name font-mono" title={c.name}>{c.name}</span>
                </div>
                <span className="col-type font-mono">{c.type}</span>
              </div>
            );
          })
        ) : (
          <div className="no-cols font-mono">
            {viewMode === "keys_only" ? "No PK / FK columns" : "No columns found"}
          </div>
        )}

        {viewMode === "compact" && hiddenCount > 0 && (
          <button
            type="button"
            className="expand-cols-btn font-mono"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(true);
            }}
          >
            +{hiddenCount} more columns
          </button>
        )}
        {viewMode === "compact" && expanded && (table.columns?.length || 0) > 6 && (
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
    </div>
  );
};

const TableNode = React.memo(TableNodeComponent);

const SchemaDiagramInner: React.FC<SchemaDiagramProps> = ({
  activeProfile,
  activeDatabase,
  theme = "dark",
}) => {
  const [tables, setTables] = useState<TableData[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRelationIdx, setSelectedRelationIdx] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [filterConnectedOnly, setFilterConnectedOnly] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TableNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  // Compute Layout: Organizes nodes into a clean grid based on topology
  const arrangeLayout = useCallback((tablesList: TableData[], relationsList: Relation[], currentMode: ViewMode) => {
    // Precalculate FK map per table
    const tableFkMaps: Record<string, Record<string, Relation>> = {};
    tablesList.forEach((t) => {
      tableFkMaps[t.name] = {};
    });
    relationsList.forEach((r) => {
      if (tableFkMaps[r.fromTable]) {
        tableFkMaps[r.fromTable][r.fromColumn] = r;
      }
    });

    const colsInGrid = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(tablesList.length * 1.6))));
    const cardWidth = 280;
    const cardHeight = currentMode === "keys_only" ? 220 : currentMode === "compact" ? 280 : 340;

    const newNodes: Node<TableNodeData>[] = tablesList.map((t, idx) => {
      const col = idx % colsInGrid;
      const row = Math.floor(idx / colsInGrid);
      return {
        id: t.name,
        type: "tableNode",
        position: { x: col * (cardWidth + 60) + 40, y: row * (cardHeight + 60) + 40 },
        data: {
          table: t,
          fkMap: tableFkMaps[t.name] || {},
          searchQuery,
          highlighted: false,
          viewMode: currentMode,
        },
      };
    });

    setNodes(newNodes);

    const isLargeSchema = relationsList.length > 20;

    const newEdges: Edge[] = relationsList.map((rel, idx) => ({
      id: `e-${rel.fromTable}-${rel.toTable}-${idx}`,
      source: rel.fromTable,
      target: rel.toTable,
      type: "smoothstep",
      animated: !isLargeSchema || selectedRelationIdx === idx,
      style: {
        stroke: selectedRelationIdx === idx ? "#60a5fa" : "#3b82f6",
        strokeWidth: selectedRelationIdx === idx ? 3.5 : 1.8,
        opacity: selectedRelationIdx === null || selectedRelationIdx === idx ? 0.9 : 0.25,
      },
      label: `${rel.fromColumn} → ${rel.toColumn}`,
      labelStyle: {
        fill: theme === "dark" ? "#cbd5e1" : "#334155",
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
  }, [searchQuery, selectedRelationIdx, theme, setNodes, setEdges, fitView]);

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
            stroke: eIdx === idx ? "#60a5fa" : "rgba(100, 116, 139, 0.2)",
            strokeWidth: eIdx === idx ? 3.5 : 1,
            opacity: eIdx === idx ? 1 : 0.2,
          },
        }))
      );
    }
  };

  const connectedTableNames = useMemo(() => {
    const set = new Set<string>();
    relations.forEach((r) => {
      set.add(r.fromTable);
      set.add(r.toTable);
    });
    return set;
  }, [relations]);

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (filterConnectedOnly) {
      result = result.filter((n) => connectedTableNames.has(n.id));
    }
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter((n) => {
      const table = (n.data?.table as TableData) || { name: "", columns: [] };
      const tableMatch = table.name.toLowerCase().includes(q);
      const colMatch = table.columns?.some((c) => c.name.toLowerCase().includes(q));
      return tableMatch || colMatch;
    });
  }, [nodes, searchQuery, filterConnectedOnly, connectedTableNames]);

  if (!activeProfile || !activeDatabase) {
    return (
      <div className="diagram-empty">
        <Network size={36} className="empty-icon" />
        <h3>Database ER Diagram & Schema Visualizer</h3>
        <p>Connect to an active database to inspect tables, primary keys, and foreign key relationships</p>
        <style jsx>{`
          .diagram-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: var(--text-muted);
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
            <Search size={12} className="search-icon" />
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

      {/* React Flow Canvas */}
      <div className="flow-wrapper">
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
            nodeTypes={nodeTypes}
            onlyRenderVisibleElements={true}
            minZoom={0.05}
            maxZoom={2}
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
        .search-icon { position: absolute; left: 8px; color: var(--text-muted); }
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
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        :global(.react-flow-table-card .card-title-group) {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
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
