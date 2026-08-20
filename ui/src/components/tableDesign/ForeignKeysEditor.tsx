import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ForeignKeyDraft, ON_ACTIONS } from "../../utils/ddlBuilder";
import { newForeignKey } from "./draft";

interface ForeignKeysEditorProps {
  foreignKeys: ForeignKeyDraft[];
  /** Columns of the table being designed. */
  availableColumns: string[];
  /** Tables that can be referenced. */
  availableTables: string[];
  /** Resolves the column names of a referenced table. */
  onFetchColumns: (table: string) => Promise<string[]>;
  onChange: (foreignKeys: ForeignKeyDraft[]) => void;
}

export const ForeignKeysEditor: React.FC<ForeignKeysEditorProps> = ({
  foreignKeys,
  availableColumns,
  availableTables,
  onFetchColumns,
  onChange,
}) => {
  // Referenced-table columns are fetched lazily and cached for the modal's lifetime.
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

  const patch = (id: string, changes: Partial<ForeignKeyDraft>) =>
    onChange(foreignKeys.map((f) => (f.id === id ? { ...f, ...changes } : f)));

  const toggle = (fk: ForeignKeyDraft, key: "columns" | "refColumns", column: string) => {
    const current = fk[key];
    const next = current.includes(column) ? current.filter((c) => c !== column) : [...current, column];
    patch(fk.id, { [key]: next } as Partial<ForeignKeyDraft>);
  };

  const renderChips = (fk: ForeignKeyDraft, key: "columns" | "refColumns", options: string[]) => (
    <div className="col-picker">
      {options.length === 0 && <span className="empty-note">No columns available.</span>}
      {options.map((col) => {
        const on = fk[key].includes(col);
        const order = fk[key].indexOf(col) + 1;
        return (
          <button
            key={col}
            type="button"
            className={`col-chip font-mono ${on ? "on" : ""}`}
            onClick={() => toggle(fk, key, col)}
            title={on ? `Position ${order} — click to remove` : "Click to add"}
          >
            {on && <span className="chip-order">{order}</span>}
            {col}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="fk-editor">
      {foreignKeys.length === 0 && <div className="empty-note">No foreign keys defined.</div>}

      {foreignKeys.map((fk) => {
        const mismatch = fk.columns.length !== fk.refColumns.length;
        return (
          <div className="fk-card" key={fk.id}>
            <div className="fk-top">
              <input
                className="input font-mono fk-name"
                value={fk.name}
                placeholder="constraint_name (optional)"
                onChange={(e) => patch(fk.id, { name: e.target.value })}
              />
              <button
                type="button"
                className="mini-btn danger"
                title="Remove foreign key"
                onClick={() => onChange(foreignKeys.filter((f) => f.id !== fk.id))}
              >
                <Trash2 size={12} />
              </button>
            </div>

            <div className="fk-field">
              <span className="fk-label">Local columns</span>
              {renderChips(fk, "columns", availableColumns)}
            </div>

            <div className="fk-field">
              <span className="fk-label">References table</span>
              <select
                className="select font-mono"
                value={fk.refTable}
                onChange={(e) => {
                  patch(fk.id, { refTable: e.target.value, refColumns: [] });
                  ensureColumns(e.target.value);
                }}
              >
                <option value="">— select a table —</option>
                {availableTables.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {fk.refTable && (
              <div className="fk-field">
                <span className="fk-label">Referenced columns</span>
                {renderChips(fk, "refColumns", refColumns[fk.refTable] || [])}
              </div>
            )}

            <div className="fk-actions">
              <label className="action-field">
                <span className="fk-label">ON DELETE</span>
                <select
                  className="select"
                  value={fk.onDelete}
                  onChange={(e) => patch(fk.id, { onDelete: e.target.value as ForeignKeyDraft["onDelete"] })}
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
                  value={fk.onUpdate}
                  onChange={(e) => patch(fk.id, { onUpdate: e.target.value as ForeignKeyDraft["onUpdate"] })}
                >
                  {ON_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {mismatch && (
              <div className="fk-warn">
                Local and referenced column counts must match ({fk.columns.length} vs {fk.refColumns.length}).
              </div>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="btn btn-secondary add-btn"
        onClick={() => onChange([...foreignKeys, newForeignKey()])}
      >
        <Plus size={12} />
        <span>Add Foreign Key</span>
      </button>

      <style jsx>{`
        .fk-editor {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .fk-card {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px;
          background: var(--bg-tertiary);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .fk-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .fk-editor :global(.fk-name) {
          flex: 1;
          font-size: 11px;
          padding: 4px 6px;
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
          gap: 4px;
        }
        .col-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 10.5px;
          padding: 2px 7px;
          border-radius: 10px;
          border: 1px solid var(--border-light);
          background: var(--bg-card);
          color: var(--text-sub);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .col-chip:hover {
          border-color: var(--border-medium);
          color: var(--text-main);
        }
        .col-chip.on {
          background: var(--accent-blue);
          border-color: var(--accent-blue);
          color: #fff;
        }
        .chip-order {
          font-size: 8.5px;
          font-weight: 700;
          opacity: 0.85;
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
        .add-btn {
          align-self: flex-start;
        }
      `}</style>
    </div>
  );
};
