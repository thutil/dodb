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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitFork, Network, Table2, Key, ArrowRight, Search, RefreshCw } from "lucide-react";
import { ConnectionProfile } from "../types";

interface SchemaDiagramProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  apiBase: string;
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
const TableNode: React.FC<NodeProps> = ({ data }) => {
  const table = data.table as TableData;
  const relations = (data.relations as Relation[]) || [];

  return (
    <div className="react-flow-table-card">
      <Handle type="target" position={Position.Left} id="target-all" className="flow-handle" />
      <Handle type="source" position={Position.Right} id="source-all" className="flow-handle" />

      <div className="card-header">
        <Table2 size={13} className="card-tbl-icon" />
        <h3 className="card-tbl-name font-mono">{table.name}</h3>
        <span className="card-col-count">{table.columns.length}</span>
      </div>

      <div className="card-body">
        {table.columns.map((c) => {
          const fkRelation = relations.find(
            (r) => r.fromTable === table.name && r.fromColumn === c.name
          );

          return (
            <div
              key={c.name}
              className={`col-row ${c.primaryKey ? "pk-row" : ""} ${fkRelation ? "fk-row" : ""}`}
            >
              <div className="col-name-group">
                {c.primaryKey ? (
                  <span title="Primary Key">
                    <Key size={11} className="pk-icon" />
                  </span>
                ) : fkRelation ? (
                  <span title={`FK -> ${fkRelation.toTable}.${fkRelation.toColumn}`}>
                    <GitFork size={11} className="fk-icon" />
                  </span>
                ) : (
                  <span className="bullet-dot" />
                )}
                <span className="col-name font-mono">{c.name}</span>
              </div>
              <span className="col-type font-mono">{c.type}</span>
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .react-flow-table-card {
          width: 250px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
          overflow: hidden;
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
        .card-tbl-icon { color: var(--accent-blue); }
        .card-tbl-name { font-size: 12px; font-weight: 700; color: var(--text-main); }
        .card-col-count {
          font-size: 9px;
          background: rgba(255, 255, 255, 0.08);
          padding: 1px 5px;
          border-radius: 3px;
          color: var(--text-muted);
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
        }
        .col-name-group { display: flex; align-items: center; gap: 6px; }
        .bullet-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--text-muted); }
        .pk-icon { color: #f59e0b; }
        .fk-icon { color: var(--accent-blue); }
        .pk-row .col-name { font-weight: 700; color: #f59e0b; }
        .fk-row .col-name { font-weight: 600; color: var(--accent-blue); }
        .col-name { color: var(--text-main); }
        .col-type { color: var(--text-muted); font-size: 9px; }
      `}</style>
    </div>
  );
};

export const SchemaDiagram: React.FC<SchemaDiagramProps> = ({
  activeProfile,
  activeDatabase,
  apiBase,
  theme = "dark",
}) => {
  const [tables, setTables] = useState<TableData[]>([]);
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  const fetchSchemaDiagram = useCallback(async () => {
    if (!activeProfile || !activeDatabase) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/list/schema-diagram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...activeProfile,
          database: activeDatabase,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const fetchedTables: TableData[] = data.tables || [];
        const fetchedRelations: Relation[] = data.relations || [];

        setTables(fetchedTables);
        setRelations(fetchedRelations);

        // Build React Flow Nodes with grid layout
        const colsInGrid = 4;
        const initialNodes: Node[] = fetchedTables.map((t, idx) => {
          const col = idx % colsInGrid;
          const row = Math.floor(idx / colsInGrid);
          return {
            id: t.name,
            type: "tableNode",
            position: { x: col * 320 + 40, y: row * 340 + 40 },
            data: { table: t, relations: fetchedRelations },
          };
        });

        // Build React Flow Edges with smooth curves & animations
        const initialEdges: Edge[] = fetchedRelations.map((rel, idx) => ({
          id: `e-${rel.fromTable}-${rel.toTable}-${idx}`,
          source: rel.fromTable,
          target: rel.toTable,
          animated: true,
          style: { stroke: "#3b82f6", strokeWidth: 2 },
          label: `${rel.fromColumn} -> ${rel.toColumn}`,
          labelStyle: { fill: theme === "dark" ? "#94a3b8" : "#475569", fontSize: 10, fontFamily: "monospace" },
          labelBgStyle: { fill: theme === "dark" ? "#1e293b" : "#e2e8f0", rx: 4, ry: 4 },
        }));

        setNodes(initialNodes);
        setEdges(initialEdges);
      }
    } catch (err) {
      console.error("Fetch ER Diagram schema error", err);
    } finally {
      setLoading(false);
    }
  }, [activeProfile, activeDatabase, apiBase, theme, setNodes, setEdges]);

  useEffect(() => {
    fetchSchemaDiagram();
  }, [fetchSchemaDiagram]);

  if (!activeProfile || !activeDatabase) {
    return (
      <div className="diagram-empty">
        <Network size={36} className="empty-icon" />
        <h3>ER Diagram & Relationship Visualizer</h3>
        <p>Connect to a database to inspect table relationships and foreign key schemas</p>
        <style jsx>{`
          .diagram-empty {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 12px;
            color: var(--text-muted);
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
          <span className="count-tag">{tables.length} tables, {relations.length} relationships</span>
        </div>

        <div className="bar-right">
          <div className="search-wrap">
            <Search size={12} className="search-icon" />
            <input
              type="text"
              className="input search-field"
              placeholder="Search tables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={fetchSchemaDiagram} disabled={loading}>
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            <span>Refresh Diagram</span>
          </button>
        </div>
      </div>

      {/* Relationships Summary Panel */}
      {relations.length > 0 && (
        <div className="relations-summary-bar">
          <span className="summary-title">Foreign Key Relations:</span>
          <div className="rel-chips-wrapper">
            {relations.map((rel, idx) => (
              <div key={idx} className="rel-chip">
                <span className="rel-table">{rel.fromTable}</span>
                <span className="rel-col">({rel.fromColumn})</span>
                <ArrowRight size={10} className="rel-arrow" />
                <span className="rel-table">{rel.toTable}</span>
                <span className="rel-col">({rel.toColumn})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* React Flow Drag & Drop Canvas with Theme Sync */}
      <div className="flow-wrapper">
        {loading && (
          <div className="diagram-loading-overlay">
            <RefreshCw size={28} className="spin loading-icon" />
            <span className="loading-text">Loading ER Diagram & Relationships...</span>
          </div>
        )}
        <ReactFlow
          nodes={nodes.filter((n) => n.id.toLowerCase().includes(searchQuery.toLowerCase()))}
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
          <MiniMap nodeStrokeWidth={3} zoomable pannable />
        </ReactFlow>
      </div>

      <style jsx>{`
        .diagram-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-content);
          overflow: hidden;
        }

        .diagram-header-bar {
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
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
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 2px 6px;
          border-radius: 4px;
          color: var(--accent-blue);
          font-weight: 600;
        }
        .count-tag { font-size: 10px; color: var(--text-muted); }

        .bar-right { display: flex; align-items: center; gap: 8px; }
        .search-wrap { position: relative; display: flex; align-items: center; }
        .search-icon { position: absolute; left: 8px; color: var(--text-muted); }
        .search-field { padding-left: 26px; width: 180px; font-size: 11px; }

        .relations-summary-bar {
          padding: 6px 14px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          gap: 10px;
          overflow-x: auto;
        }
        .summary-title { font-size: 10px; font-weight: 700; color: var(--text-sub); text-transform: uppercase; white-space: nowrap; }
        .rel-chips-wrapper { display: flex; gap: 6px; align-items: center; }
        .rel-chip {
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 10px;
          white-space: nowrap;
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
          background: var(--bg-content);
        }

        .diagram-loading-overlay {
          position: absolute;
          inset: 0;
          z-index: 100;
          background: rgba(18, 18, 22, 0.75);
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
