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
  Database, Globe, LayoutGrid, Maximize2, Sparkles, X
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

// Custom React Flow Table Node Component
const TableNode: React.FC<NodeProps> = ({ data, selected }) => {
  const table = data.table as TableData;
  const relations = (data.relations as Relation[]) || [];
  const searchQuery = ((data.searchQuery as string) || "").toLowerCase();
  const highlighted = Boolean(data.highlighted);

  const isTableMatch = searchQuery && table.name.toLowerCase().includes(searchQuery);

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
        {table.columns && table.columns.length > 0 ? (
          table.columns.map((c) => {
            const fkRelation = relations.find(
              (r) => r.fromTable === table.name && r.fromColumn === c.name
            );

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
          <div className="no-cols">No columns found</div>
        )}
      </div>

      <style jsx>{`
        .react-flow-table-card {
          width: 270px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .react-flow-table-card.is-selected,
        .react-flow-table-card.is-highlighted {
          border-color: var(--accent-blue);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .react-flow-table-card.is-match {
          border-color: #f59e0b;
          box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.45);
        }

        .card-header {
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .card-title-group {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
        }
        .card-tbl-icon { color: var(--accent-blue); flex-shrink: 0; }
        .card-tbl-name {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .card-col-count {
          font-size: 9.5px;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 5px;
          border-radius: 3px;
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .card-body {
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 280px;
          overflow-y: auto;
        }

        .col-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 3px 6px;
          border-radius: 3px;
          font-size: 10px;
          transition: background 0.1s ease;
        }
        .col-row:hover {
          background: var(--bg-hover);
        }
        .col-match {
          background: rgba(245, 158, 11, 0.15) !important;
        }
        .col-name-group {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
        }
        .bullet-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
        .pk-icon { color: #f59e0b; flex-shrink: 0; }
        .fk-icon { color: var(--accent-blue); flex-shrink: 0; }
        .pk-row .col-name { font-weight: 700; color: #f59e0b; }
        .fk-row .col-name { font-weight: 600; color: var(--accent-blue); }
        .col-name {
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .col-type {
          color: var(--text-muted);
          font-size: 9px;
          flex-shrink: 0;
          margin-left: 6px;
        }
        .no-cols {
          padding: 8px;
          text-align: center;
          font-size: 10px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
};

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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  // Compute Layout: Organizes nodes intelligently into columns based on topology
  const arrangeLayout = useCallback((tablesList: TableData[], relationsList: Relation[]) => {
    const tableNames = tablesList.map((t) => t.name);
    // Calculate in-degree / out-degree for topological column placement
    const inDegree: Record<string, number> = {};
    const outDegree: Record<string, number> = {};
    tableNames.forEach((name) => {
      inDegree[name] = 0;
      outDegree[name] = 0;
    });

    relationsList.forEach((rel) => {
      if (inDegree[rel.toTable] !== undefined) inDegree[rel.toTable]++;
      if (outDegree[rel.fromTable] !== undefined) outDegree[rel.fromTable]++;
    });

    const colsInGrid = Math.max(3, Math.min(5, Math.ceil(Math.sqrt(tablesList.length * 1.5))));
    const newNodes: Node[] = tablesList.map((t, idx) => {
      const col = idx % colsInGrid;
      const row = Math.floor(idx / colsInGrid);
      return {
        id: t.name,
        type: "tableNode",
        position: { x: col * 330 + 40, y: row * 350 + 40 },
        data: {
          table: t,
          relations: relationsList,
          searchQuery,
          highlighted: false,
        },
      };
    });

    setNodes(newNodes);

    const newEdges: Edge[] = relationsList.map((rel, idx) => ({
      id: `e-${rel.fromTable}-${rel.toTable}-${idx}`,
      source: rel.fromTable,
      target: rel.toTable,
      animated: true,
      style: {
        stroke: selectedRelationIdx === idx ? "#60a5fa" : "#3b82f6",
        strokeWidth: selectedRelationIdx === idx ? 3.5 : 2,
      },
      label: `${rel.fromColumn} → ${rel.toColumn}`,
      labelStyle: {
        fill: theme === "dark" ? "#cbd5e1" : "#334155",
        fontSize: 10,
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
      fitView({ padding: 0.15, duration: 400 });
    }, 50);
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

      setTables(fetchedTables);
      setRelations(fetchedRelations);

      arrangeLayout(fetchedTables, fetchedRelations);
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

  // Update node data when search query changes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          searchQuery,
        },
      }))
    );
  }, [searchQuery, setNodes]);

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
          style: { stroke: "#3b82f6", strokeWidth: 2 },
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
          style: {
            stroke: eIdx === idx ? "#60a5fa" : "rgba(100, 116, 139, 0.3)",
            strokeWidth: eIdx === idx ? 3.5 : 1.5,
          },
        }))
      );
    }
  };

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter((n) => {
      const table = (n.data?.table as TableData) || { name: "", columns: [] };
      const tableMatch = table.name.toLowerCase().includes(q);
      const colMatch = table.columns?.some((c) => c.name.toLowerCase().includes(q));
      return tableMatch || colMatch;
    });
  }, [nodes, searchQuery]);

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
            {tables.length} table{tables.length === 1 ? "" : "s"}, {relations.length} foreign key{relations.length === 1 ? "" : "s"}
          </span>
        </div>

        <div className="bar-right">
          <div className="search-wrap">
            <Search size={12} className="search-icon" />
            <input
              type="text"
              className="input search-field"
              placeholder="Search tables & columns..."
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
            onClick={() => arrangeLayout(tables, relations)}
            title="Auto-organize table layout"
          >
            <LayoutGrid size={12} />
            <span>Auto Layout</span>
          </button>

          <button
            className="btn btn-secondary btn-sm"
            onClick={() => fitView({ padding: 0.15, duration: 400 })}
            title="Zoom to Fit Canvas"
          >
            <Maximize2 size={12} />
            <span>Fit View</span>
          </button>

          <button className="btn btn-primary btn-sm" onClick={fetchSchemaDiagram} disabled={loading} title="Reload schema">
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            <span>{loading ? "Loading..." : "Refresh"}</span>
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
                  <span className="rel-table">{rel.fromTable}</span>
                  <span className="rel-col">({rel.fromColumn})</span>
                  <ArrowRight size={10} className="rel-arrow" />
                  <span className="rel-table">{rel.toTable}</span>
                  <span className="rel-col">({rel.toColumn})</span>
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
            key={`${activeProfile.id}-${activeDatabase}-${tables.length}`}
            nodes={filteredNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
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
        .search-wrap { position: relative; display: flex; align-items: center; }
        .search-icon { position: absolute; left: 8px; color: var(--text-muted); }
        .search-field { padding-left: 26px; padding-right: 22px; width: 190px; font-size: 11px; height: 28px; }
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
