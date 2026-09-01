import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, ArrowRight, Zap, X, AlertTriangle, Link2, Table2 } from "lucide-react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  NodeProps,
  BackgroundVariant,
  Edge,
  Node,
  ReactFlowProvider,
  Connection,
  type OnError,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ForeignKeyDraft, ColumnDraft, ON_ACTIONS } from "../../utils/ddlBuilder";
import { newForeignKey } from "./draft";

interface ForeignKeysEditorProps {
  foreignKeys: ForeignKeyDraft[];
  tableName?: string;
  /** Columns of the table being designed. */
  availableColumns: string[];
  /** Full column drafts with types */
  columnDrafts?: ColumnDraft[];
  /** Tables that can be referenced. */
  availableTables: string[];
  /** Resolves the column names of a referenced table. */
  onFetchColumns: (table: string) => Promise<string[]>;
  onChange: (foreignKeys: ForeignKeyDraft[]) => void;
}

interface FkFlowNodeData {
  title: string;
  columns: Array<{ name: string; type?: string }>;
  isSource: boolean;
  [key: string]: unknown;
}

const FkFlowNodeComponent: React.FC<NodeProps<Node<FkFlowNodeData>>> = ({ data }) => {
  const { title, columns = [], isSource } = data;
  return (
    <div className={`fk-flow-node ${isSource ? "is-source" : "is-target"}`}>
      <div className="flow-node-header">
        <Table2 size={11} className="node-tbl-icon" />
        <span className="node-tbl-title font-mono" title={title}>{title}</span>
        {!isSource && <span className="node-target-tag">Target</span>}
      </div>
      <div className="flow-node-body">
        {columns.length > 0 ? (
          columns.map((c) => (
            <div className="flow-node-row" key={c.name}>
              {!isSource && (
                <Handle
                  type="target"
                  position={Position.Left}
                  id={`tgt:${c.name}`}
                  className="flow-node-handle flow-handle-left"
                />
              )}
              <span className="flow-node-col-name font-mono">{c.name}</span>
              {c.type && <span className="flow-node-col-type font-mono">{c.type}</span>}
              {isSource && (
                <Handle
                  type="source"
                  position={Position.Right}
                  id={`src:${c.name}`}
                  className="flow-node-handle flow-handle-right"
                />
              )}
            </div>
          ))
        ) : (
          <div className="flow-node-empty font-mono">Loading columns...</div>
        )}
      </div>
    </div>
  );
};
const FkFlowNode = React.memo(FkFlowNodeComponent);

interface FkFlowCanvasProps {
  localTableName: string;
  localColumns: Array<{ name: string; type?: string }>;
  targetTableName: string;
  targetColumns: string[];
  columns: string[];
  refColumns: string[];
  onConnectPair: (localCol: string, refCol: string) => void;
}

const NODE_TYPES = Object.freeze({ fkNode: FkFlowNode });
const EDGE_TYPES = Object.freeze({});

const FkFlowCanvasInner: React.FC<FkFlowCanvasProps> = ({
  localTableName,
  localColumns,
  targetTableName,
  targetColumns,
  columns,
  refColumns,
  onConnectPair,
}) => {

  const nodes: Node<FkFlowNodeData>[] = useMemo(() => [
    {
      id: "source-table",
      type: "fkNode",
      position: { x: 20, y: 15 },
      data: {
        title: localTableName,
        columns: localColumns,
        isSource: true,
      },
    },
    {
      id: "target-table",
      type: "fkNode",
      position: { x: 280, y: 15 },
      data: {
        title: targetTableName,
        columns: targetColumns.map((name) => ({ name })),
        isSource: false,
      },
    },
  ], [localTableName, localColumns, targetTableName, targetColumns]);

  const edges: Edge[] = useMemo(() => {
    if (!targetColumns || targetColumns.length === 0) return [];
    return columns
      .map((localCol, idx) => {
        const refCol = refColumns[idx] || "";
        if (!localCol || !refCol) return null;
        const hasLocal = localColumns.some((c) => c.name === localCol);
        const hasRef = targetColumns.includes(refCol);
        if (!hasLocal || !hasRef) return null;

        return {
          id: `fk-edge-${localCol}-${refCol}-${idx}`,
          source: "source-table",
          target: "target-table",
          sourceHandle: `src:${localCol}`,
          targetHandle: `tgt:${refCol}`,
          type: "smoothstep",
          animated: true,
          style: { stroke: "#3b82f6", strokeWidth: 2 },
          label: `${localCol} ➔ ${refCol}`,
          labelStyle: { fill: "#93c5fd", fontSize: 9.5, fontFamily: "monospace", fontWeight: 600 },
          labelBgStyle: { fill: "#1e293b", fillOpacity: 0.95, rx: 4, ry: 4 },
        };
      })
      .filter(Boolean) as Edge[];
  }, [columns, refColumns, localColumns, targetColumns]);

  const handleConnect = useCallback((connection: Connection) => {
    const { sourceHandle, targetHandle } = connection;
    if (!sourceHandle || !targetHandle) return;
    const lCol = sourceHandle.replace(/^src:/, "");
    const rCol = targetHandle.replace(/^tgt:/, "");
    if (lCol && rCol) {
      onConnectPair(lCol, rCol);
    }
  }, [onConnectPair]);

  const nodeTypes = useMemo(() => NODE_TYPES, []);
  const edgeTypes = useMemo(() => EDGE_TYPES, []);

  const onFlowError: OnError = useCallback((id, message) => {
    if (id === "002") return;
    console.warn(`[React Flow]: ${message} (code #${id})`);
  }, []);

  return (
    <div
      className="flow-visual-box"
      style={{
        width: "100%",
        height: 250,
        minHeight: 250,
        position: "relative",
        display: "block",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onError={onFlowError}
        onConnect={handleConnect}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background variant={BackgroundVariant.Dots} gap={10} size={1} color="rgba(255, 255, 255, 0.1)" />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
    </div>
  );
};

const FkFlowCanvas: React.FC<FkFlowCanvasProps> = (props) => (
  <ReactFlowProvider>
    <FkFlowCanvasInner {...props} />
  </ReactFlowProvider>
);

export const ForeignKeysEditor: React.FC<ForeignKeysEditorProps> = ({
  foreignKeys,
  tableName = "current_table",
  availableColumns,
  columnDrafts = [],
  availableTables,
  onFetchColumns,
  onChange,
}) => {
  // Active Foreign Key Sub-Tab Index
  const [activeFkId, setActiveFkId] = useState<string>("");
  const [refColumns, setRefColumns] = useState<Record<string, string[]>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const ensureColumns = useCallback(
    async (table: string) => {
      if (!table || refColumns[table] || inFlight.current.has(table)) return;
      inFlight.current.add(table);
      try {
        const cols = await onFetchColumns(table);
        setRefColumns((prev) => ({ ...prev, [table]: cols }));
      } catch {
        setRefColumns((prev) => ({ ...prev, [table]: [] }));
      } finally {
        inFlight.current.delete(table);
      }
    },
    [onFetchColumns, refColumns]
  );

  useEffect(() => {
    foreignKeys.forEach((fk) => {
      if (fk.refTable) ensureColumns(fk.refTable);
    });
  }, [foreignKeys, ensureColumns]);

  // Keep active FK in sync
  const activeFk = useMemo(() => {
    if (foreignKeys.length === 0) return null;
    const found = foreignKeys.find((f) => f.id === activeFkId);
    return found || foreignKeys[0];
  }, [foreignKeys, activeFkId]);

  const patch = (id: string, changes: Partial<ForeignKeyDraft>) =>
    onChange(foreignKeys.map((f) => (f.id === id ? { ...f, ...changes } : f)));

  const toggle = (fk: ForeignKeyDraft, key: "columns" | "refColumns", column: string) => {
    const current = fk[key];
    const next = current.includes(column) ? current.filter((c) => c !== column) : [...current, column];
    patch(fk.id, { [key]: next } as Partial<ForeignKeyDraft>);
  };

  const addForeignKeyConstraint = () => {
    const newFk = newForeignKey();
    onChange([...foreignKeys, newFk]);
    setActiveFkId(newFk.id);
  };

  const removeForeignKeyConstraint = (id: string) => {
    const next = foreignKeys.filter((f) => f.id !== id);
    onChange(next);
    if (activeFkId === id && next.length > 0) {
      setActiveFkId(next[0].id);
    }
  };

  const addPair = (fk: ForeignKeyDraft, optLocal?: string, optRef?: string) => {
    const unusedLocal = optLocal || availableColumns.find((c) => !fk.columns.includes(c)) || availableColumns[0] || "";
    const targetCols = refColumns[fk.refTable] || [];
    const unusedRef = optRef || targetCols.find((c) => !fk.refColumns.includes(c)) || targetCols[0] || "";
    if (unusedLocal && unusedRef) {
      patch(fk.id, {
        columns: [...fk.columns, unusedLocal],
        refColumns: [...fk.refColumns, unusedRef],
      });
    }
  };

  const removePairAt = (fk: ForeignKeyDraft, index: number) => {
    const nextCols = fk.columns.filter((_, i) => i !== index);
    const nextRefCols = fk.refColumns.filter((_, i) => i !== index);
    patch(fk.id, { columns: nextCols, refColumns: nextRefCols });
  };

  const updateLocalColAt = (fk: ForeignKeyDraft, index: number, colName: string) => {
    const nextCols = [...fk.columns];
    nextCols[index] = colName;
    patch(fk.id, { columns: nextCols });
  };

  const updateRefColAt = (fk: ForeignKeyDraft, index: number, refColName: string) => {
    const nextRefCols = [...fk.refColumns];
    nextRefCols[index] = refColName;
    patch(fk.id, { refColumns: nextRefCols });
  };

  const autoMatchPairs = (fk: ForeignKeyDraft) => {
    if (!fk.refTable) return;
    const targetCols = refColumns[fk.refTable] || [];
    if (targetCols.length === 0) return;

    const matchedLocal: string[] = [];
    const matchedRef: string[] = [];

    // 1. Check exact column name matches
    availableColumns.forEach((lCol) => {
      const exactRef = targetCols.find((rCol) => rCol.toLowerCase() === lCol.toLowerCase());
      if (exactRef) {
        matchedLocal.push(lCol);
        matchedRef.push(exactRef);
      }
    });

    // 2. Check suffix patterns like [table]_id -> id
    if (matchedLocal.length === 0) {
      const cleanRefTable = fk.refTable.replace(/s$/, "").toLowerCase();
      availableColumns.forEach((lCol) => {
        const lLow = lCol.toLowerCase();
        if (lLow.includes(cleanRefTable) && (lLow.endsWith("_id") || lLow.endsWith("id"))) {
          const idRef = targetCols.find((rCol) => rCol.toLowerCase() === "id") || targetCols[0];
          if (idRef && !matchedLocal.includes(lCol)) {
            matchedLocal.push(lCol);
            matchedRef.push(idRef);
          }
        }
      });
    }

    if (matchedLocal.length > 0) {
      patch(fk.id, { columns: matchedLocal, refColumns: matchedRef });
    } else if (availableColumns.length > 0 && targetCols.length > 0) {
      // Fallback: pair first available column with target PK
      const pkRef = targetCols.find((r) => r.toLowerCase() === "id") || targetCols[0];
      patch(fk.id, { columns: [availableColumns[0]], refColumns: [pkRef] });
    }
  };

  const renderChips = (fk: ForeignKeyDraft, key: "columns" | "refColumns", options: string[]) => (
    <div className="col-picker">
      {options.length === 0 && <span className="empty-note">No columns available.</span>}
      {options.map((col) => {
        const on = fk[key].includes(col);
        const order = fk[key].indexOf(col) + 1;
        const colDef = key === "columns" ? columnDrafts.find((c) => c.name === col) : null;

        return (
          <button
            key={col}
            type="button"
            className={`col-chip font-mono ${on ? "on" : ""}`}
            onClick={() => toggle(fk, key, col)}
            data-tooltip={on ? `Position ${order} (Click to remove)` : `Click to link "${col}"`}
          >
            {on && <span className="chip-order">{order}</span>}
            <span className="chip-name">{col}</span>
            {colDef?.type && <span className="chip-type font-mono">{colDef.type}</span>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="fk-editor">
      {/* Sub-Tabs Bar for Foreign Keys */}
      <div className="fk-subtabs-bar">
        <div className="fk-subtabs-list">
          {foreignKeys.map((fk, idx) => {
            const isSelected = activeFk?.id === fk.id;
            const label = fk.refTable ? `FK: ${fk.refTable}` : `FK #${idx + 1}`;
            const pairsCount = fk.columns.length;

            return (
              <button
                key={fk.id}
                type="button"
                className={`fk-subtab-pill font-mono ${isSelected ? "active" : ""}`}
                onClick={() => setActiveFkId(fk.id)}
              >
                <Link2 size={11} className="subtab-icon" />
                <span className="subtab-label">{label}</span>
                {pairsCount > 0 && <span className="subtab-badge">{pairsCount}</span>}
                <span
                  className="subtab-delete-btn"
                  data-tooltip="Delete this Foreign Key"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeForeignKeyConstraint(fk.id);
                  }}
                >
                  <X size={10} />
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-xs fk-add-pill-btn font-mono"
          data-tooltip="Add another Foreign Key constraint"
          onClick={addForeignKeyConstraint}
        >
          <Plus size={12} />
          <span>+ Add FK</span>
        </button>
      </div>

      {/* Empty State */}
      {foreignKeys.length === 0 && (
        <div className="fk-empty-state-card">
          <Table2 size={32} className="empty-state-icon" />
          <h4 className="empty-state-title">No Foreign Keys Defined</h4>
          <p className="empty-state-desc">
            Foreign keys establish relationships between this table and other tables. Click &quot;Add Foreign Key&quot; to create one.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={addForeignKeyConstraint}
          >
            <Plus size={13} />
            <span>Add Foreign Key</span>
          </button>
        </div>
      )}

      {/* Active Foreign Key Configuration Card */}
      {activeFk && (
        <div className="fk-card" key={activeFk.id}>
          <div className="fk-top">
            <div className="fk-top-left">
              <Link2 size={13} className="fk-top-icon" />
              <input
                className="input font-mono fk-name"
                value={activeFk.name}
                placeholder={`fk_${activeFk.refTable || "table"}_constraint (optional)`}
                onChange={(e) => patch(activeFk.id, { name: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="mini-btn danger"
              data-tooltip="Delete this Foreign Key"
              onClick={() => removeForeignKeyConstraint(activeFk.id)}
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="fk-field">
            <span className="fk-label">1. References Target Table (ตารางปลายทาง)</span>
            <select
              className="select font-mono"
              value={activeFk.refTable}
              onChange={(e) => {
                const newTbl = e.target.value;
                patch(activeFk.id, { refTable: newTbl, refColumns: [] });
                if (newTbl) {
                  ensureColumns(newTbl);
                }
              }}
            >
              <option value="">— select a target table —</option>
              {availableTables.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          {/* Visual Column Mapping Area */}
          {activeFk.refTable && (
            <div className="fk-mapping-zone">
              <div className="mapping-header">
                <span className="fk-label">2. Visual Column Linker & Diagram (ลากเส้นเชื่อมโยง)</span>
                <div className="mapping-header-actions">
                  <button
                    type="button"
                    className="mini-action-btn font-mono"
                    data-tooltip="Auto-match columns by matching name or suffix"
                    onClick={() => autoMatchPairs(activeFk)}
                  >
                    <Zap size={11} />
                    <span>Auto Match</span>
                  </button>
                  <button
                    type="button"
                    className="mini-action-btn font-mono"
                    data-tooltip="Add column mapping pair"
                    onClick={() => addPair(activeFk)}
                  >
                    <Plus size={11} />
                    <span>Add Pair</span>
                  </button>
                </div>
              </div>

              {/* Embedded React Flow Canvas for Active FK */}
              <FkFlowCanvas
                localTableName={tableName}
                localColumns={availableColumns.map((name) => {
                  const d = columnDrafts.find((c) => c.name === name);
                  return { name, type: d?.type };
                })}
                targetTableName={activeFk.refTable}
                targetColumns={refColumns[activeFk.refTable] || []}
                columns={activeFk.columns}
                refColumns={activeFk.refColumns}
                onConnectPair={(lCol, rCol) => {
                  if (!activeFk.columns.includes(lCol)) {
                    addPair(activeFk, lCol, rCol);
                  } else {
                    const idx = activeFk.columns.indexOf(lCol);
                    updateRefColAt(activeFk, idx, rCol);
                  }
                }}
              />

              {activeFk.columns.length > 0 ? (
                <div className="mapping-rows-list">
                  {activeFk.columns.map((localCol, idx) => {
                    const refCol = activeFk.refColumns[idx] || "";
                    const targetCols = refColumns[activeFk.refTable] || [];

                    return (
                      <div className="mapping-pair-row" key={idx}>
                        <div className="pair-endpoint">
                          <select
                            className="select font-mono map-select"
                            value={localCol}
                            onChange={(e) => updateLocalColAt(activeFk, idx, e.target.value)}
                          >
                            <option value="">— local column —</option>
                            {availableColumns.map((c) => {
                              const d = columnDrafts.find((cd) => cd.name === c);
                              return (
                                <option key={c} value={c}>
                                  {c} {d?.type ? `(${d.type})` : ""}
                                </option>
                              );
                            })}
                          </select>
                        </div>

                        <div className="pair-arrow">
                          <ArrowRight size={13} />
                        </div>

                        <div className="pair-endpoint">
                          <select
                            className="select font-mono map-select"
                            value={refCol}
                            onChange={(e) => updateRefColAt(activeFk, idx, e.target.value)}
                          >
                            <option value="">— referenced column —</option>
                            {targetCols.map((rc) => (
                              <option key={rc} value={rc}>
                                {rc}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          className="mini-btn danger"
                          data-tooltip="Remove this column pair"
                          onClick={() => removePairAt(activeFk, idx)}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-mapping-hint">
                  <span>No column pairs linked yet. Drag handles on the diagram above or click </span>
                  <button type="button" className="btn-inline-link" onClick={() => autoMatchPairs(activeFk)}>
                    Auto Match
                  </button>
                </div>
              )}

              {/* Local & Referenced Column Chips for Fast Selection */}
              <div className="chips-section-wrapper">
                <div className="chip-sub-group">
                  <span className="chip-sub-label">Local Columns (คลิกเพื่อเลือก/ยกเลิก):</span>
                  {renderChips(activeFk, "columns", availableColumns)}
                </div>

                <div className="chip-sub-group">
                  <span className="chip-sub-label">Target &quot;{activeFk.refTable}&quot; Columns:</span>
                  {renderChips(activeFk, "refColumns", refColumns[activeFk.refTable] || [])}
                </div>
              </div>
            </div>
          )}

          <div className="fk-actions">
            <label className="action-field">
              <span className="fk-label">ON DELETE</span>
              <select
                className="select"
                value={activeFk.onDelete}
                onChange={(e) => patch(activeFk.id, { onDelete: e.target.value as ForeignKeyDraft["onDelete"] })}
              >
                {ON_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="action-field">
              <span className="fk-label">ON UPDATE</span>
              <select
                className="select"
                value={activeFk.onUpdate}
                onChange={(e) => patch(activeFk.id, { onUpdate: e.target.value as ForeignKeyDraft["onUpdate"] })}
              >
                {ON_ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeFk.columns.length !== activeFk.refColumns.length && (
            <div className="fk-warn">
              <AlertTriangle size={12} style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 4 }} />
              Local and referenced column counts must match ({activeFk.columns.length} vs {activeFk.refColumns.length}).
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .fk-editor {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }

        /* Sub-Tabs Navigation Bar */
        .fk-subtabs-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 2px 0 6px 0;
          border-bottom: 1px solid var(--border-light);
          flex-wrap: wrap;
        }
        .fk-subtabs-list {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          flex: 1;
        }
        .fk-subtab-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 8px;
          border-radius: 5px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-medium);
          color: var(--text-sub);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.12s ease;
          user-select: none;
        }
        .fk-subtab-pill:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--accent-blue);
        }
        .fk-subtab-pill.active {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          border-color: var(--accent-blue);
          font-weight: 600;
        }
        .subtab-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .subtab-label {
          letter-spacing: -0.01em;
        }
        .subtab-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 14px;
          height: 14px;
          padding: 0 3px;
          border-radius: 7px;
          background: var(--accent-blue);
          color: #ffffff;
          font-size: 8.5px;
          font-weight: 700;
          line-height: 1;
        }
        .subtab-delete-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: 3px;
          color: var(--text-muted);
          margin-left: 2px;
          transition: all 0.1s ease;
        }
        .subtab-delete-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          color: var(--accent-red);
        }
        .fk-add-pill-btn {
          color: var(--accent-blue) !important;
          border-color: var(--border-medium) !important;
        }
        .fk-add-pill-btn:hover {
          border-color: var(--accent-blue) !important;
          background: var(--bg-hover) !important;
        }

        /* Empty State */
        .fk-empty-state-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 36px 20px;
          background: var(--bg-card);
          border: 1px dashed var(--border-medium);
          border-radius: var(--radius-sm);
          text-align: center;
          gap: 10px;
        }
        .empty-state-icon {
          color: var(--accent-blue);
          opacity: 0.6;
        }
        .empty-state-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0;
        }
        .empty-state-desc {
          font-size: 11px;
          color: var(--text-muted);
          max-width: 360px;
          margin: 0;
          line-height: 1.4;
        }

        /* Active FK Card */
        .fk-card {
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-sm);
          padding: 10px;
          background: var(--bg-card);
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .fk-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fk-top-left {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          min-width: 0;
        }
        .fk-top-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .fk-editor :global(.fk-name) {
          flex: 1;
          font-size: 11px;
          padding: 4px 6px;
          min-width: 0;
        }
        .fk-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .fk-label {
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
        }
        .fk-editor :global(.select) {
          font-size: 11px;
          padding: 4px 6px;
          width: 100%;
        }

        /* Mapping Zone */
        .fk-mapping-zone {
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .mapping-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .mapping-header-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .mini-action-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          padding: 2px 7px;
          border-radius: 4px;
          border: 1px solid var(--border-medium);
          background: var(--bg-card);
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .mini-action-btn:hover {
          border-color: var(--accent-blue);
          color: var(--accent-blue);
          background: var(--bg-hover);
        }

        .flow-visual-box {
          height: 250px;
          width: 100%;
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-sm);
          background: var(--bg-content);
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.25);
        }

        .mapping-rows-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .mapping-pair-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 4px 6px;
        }
        .pair-endpoint {
          flex: 1;
        }
        .map-select {
          width: 100%;
          font-size: 11px;
          height: 26px;
          padding: 2px 6px;
        }
        .pair-arrow {
          color: var(--accent-blue);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .empty-mapping-hint {
          font-size: 11px;
          color: var(--text-muted);
          padding: 6px 4px;
        }
        .btn-inline-link {
          background: transparent;
          border: none;
          color: var(--accent-blue);
          font-weight: 600;
          cursor: pointer;
          padding: 0;
          font-size: inherit;
        }
        .btn-inline-link:hover {
          text-decoration: underline;
        }

        .chips-section-wrapper {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 4px;
          border-top: 1px dashed var(--border-light);
          padding-top: 6px;
        }
        .chip-sub-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .chip-sub-label {
          font-size: 9.5px;
          color: var(--text-muted);
          font-weight: 500;
        }
        .chip-type {
          font-size: 8.5px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.08);
          padding: 0 4px;
          border-radius: 3px;
          margin-left: 2px;
        }

        .fk-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .action-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .col-picker {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
          margin-top: 2px;
        }
        .col-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          padding: 3px 9px;
          border-radius: 6px;
          border: 1px solid var(--border-medium);
          background: var(--bg-card);
          color: var(--text-sub);
          cursor: pointer;
          transition: all 0.15s ease;
          line-height: 1.3;
          user-select: none;
        }
        .col-chip:hover {
          border-color: var(--accent-blue);
          color: var(--accent-blue);
          background: var(--bg-hover);
        }
        .col-chip.on {
          background: rgba(59, 130, 246, 0.15);
          border-color: var(--accent-blue);
          color: var(--accent-blue);
          font-weight: 600;
        }
        .chip-order {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: var(--accent-blue);
          color: #ffffff;
          font-size: 9px;
          font-weight: 700;
          line-height: 1;
          flex-shrink: 0;
        }
        .chip-name {
          font-family: var(--font-mono);
          letter-spacing: -0.01em;
        }
        .mini-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 22px;
          border: 1px solid var(--border-light);
          background: var(--bg-card);
          color: var(--text-sub);
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .mini-btn.danger:hover {
          color: var(--accent-red);
          border-color: var(--accent-red);
        }
        .fk-warn {
          font-size: 10.5px;
          color: var(--accent-amber);
        }
        .empty-note {
          font-size: 11px;
          color: var(--text-muted);
          padding: 6px 2px;
        }

        :global(.fk-flow-node) {
          width: 185px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-sm);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
          overflow: hidden;
        }
        :global(.fk-flow-node.is-source) {
          border-left: 3px solid var(--accent-blue);
        }
        :global(.fk-flow-node.is-target) {
          border-right: 3px solid #10b981;
        }

        :global(.flow-node-header) {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 5px;
          padding: 5px 8px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
        }
        :global(.node-tbl-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        :global(.flow-node-header .node-tbl-title) {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.node-target-tag) {
          font-size: 8.5px;
          color: #10b981;
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
          padding: 1px 4px;
          border-radius: 3px;
          font-weight: 600;
        }

        :global(.flow-node-body) {
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 150px;
          overflow-y: auto;
        }
        :global(.flow-node-row) {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 2.5px 6px;
          border-radius: 3px;
          font-size: 9.5px;
          transition: background 0.1s ease;
        }
        :global(.flow-node-row:hover) {
          background: var(--bg-hover);
        }
        :global(.flow-node-col-name) {
          color: var(--text-main);
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        :global(.flow-node-col-type) {
          font-size: 8.5px;
          color: var(--text-muted);
          margin-left: 4px;
        }
        :global(.flow-node-empty) {
          padding: 6px;
          text-align: center;
          font-size: 9px;
          color: var(--text-muted);
        }

        :global(.flow-node-handle) {
          width: 8px !important;
          height: 8px !important;
          background: var(--accent-blue) !important;
          border: 1.5px solid var(--bg-card) !important;
          border-radius: 50% !important;
          transition: transform 0.15s ease, background 0.15s ease !important;
          z-index: 10 !important;
        }
        :global(.flow-node-handle:hover) {
          transform: scale(1.4) !important;
          background: #60a5fa !important;
        }
        :global(.flow-handle-left) {
          left: -4px !important;
          background: #10b981 !important;
        }
        :global(.flow-handle-right) {
          right: -4px !important;
        }
      `}</style>
    </div>
  );
};
