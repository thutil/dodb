import React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { DBType } from "../../types";
import { ColumnDraft } from "../../utils/ddlBuilder";
import { TYPE_SUGGESTIONS, newColumn } from "./draft";

interface ColumnsEditorProps {
  columns: ColumnDraft[];
  dbType: DBType;
  onChange: (columns: ColumnDraft[]) => void;
}

export const ColumnsEditor: React.FC<ColumnsEditorProps> = ({ columns, dbType, onChange }) => {
  const patch = (id: string, changes: Partial<ColumnDraft>) =>
    onChange(columns.map((c) => (c.id === id ? { ...c, ...changes } : c)));

  const remove = (id: string) => onChange(columns.filter((c) => c.id !== id));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  // Only one column may auto-increment, and it has to be in the primary key.
  const setAutoIncrement = (id: string, on: boolean) =>
    onChange(
      columns.map((c) => {
        if (c.id === id) {
          return on
            ? { ...c, autoIncrement: true, primaryKey: true, nullable: false, defaultValue: null }
            : { ...c, autoIncrement: false };
        }
        return on ? { ...c, autoIncrement: false } : c;
      })
    );

  const typeListId = `dodb-types-${dbType}`;

  return (
    <div className="cols-editor">
      <datalist id={typeListId}>
        {TYPE_SUGGESTIONS[dbType].map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="grid-head">
        <span />
        <span>Name</span>
        <span>Type</span>
        <span className="center">Null</span>
        <span className="center">PK</span>
        <span className="center">Auto</span>
        <span>Default</span>
        <span />
      </div>

      {columns.length === 0 && <div className="empty-note">No columns yet. Add one to get started.</div>}

      {columns.map((col, i) => (
        <div className={`grid-row ${col.originalName ? "" : "is-new"}`} key={col.id}>
          <div className="reorder">
            <button
              type="button"
              className="mini-btn"
              title="Move up"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={11} />
            </button>
            <button
              type="button"
              className="mini-btn"
              title="Move down"
              disabled={i === columns.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={11} />
            </button>
          </div>

          <input
            className="input font-mono"
            value={col.name}
            placeholder="column_name"
            title="Column name"
            onChange={(e) => patch(col.id, { name: e.target.value })}
          />

          <input
            className="input font-mono"
            list={typeListId}
            value={col.type}
            placeholder="TYPE"
            title="Column data type (select or type custom type)"
            onChange={(e) => patch(col.id, { type: e.target.value })}
          />

          <label className="center check-cell" title="Nullable: check to allow NULL values">
            <input
              type="checkbox"
              checked={col.nullable}
              disabled={col.autoIncrement || col.primaryKey}
              onChange={(e) => patch(col.id, { nullable: e.target.checked })}
            />
          </label>

          <label className="center check-cell" title="Primary Key: check to include in primary key">
            <input
              type="checkbox"
              checked={col.primaryKey}
              onChange={(e) =>
                patch(col.id, {
                  primaryKey: e.target.checked,
                  nullable: e.target.checked ? false : col.nullable,
                  autoIncrement: e.target.checked ? col.autoIncrement : false,
                })
              }
            />
          </label>

          <label className="center check-cell" title="Auto Increment: check to auto-generate values">
            <input
              type="checkbox"
              checked={col.autoIncrement}
              onChange={(e) => setAutoIncrement(col.id, e.target.checked)}
            />
          </label>

          <input
            className="input font-mono"
            value={col.defaultValue ?? ""}
            placeholder={col.autoIncrement ? "—" : "NULL"}
            disabled={col.autoIncrement}
            title="Default value (e.g. NULL, 0, CURRENT_TIMESTAMP, 'active')"
            onChange={(e) => patch(col.id, { defaultValue: e.target.value || null })}
          />

          <button
            type="button"
            className="mini-btn danger"
            title="Remove this column"
            onClick={() => remove(col.id)}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-secondary add-btn"
        onClick={() => onChange([...columns, newColumn()])}
        title="Add a new column definition"
      >
        <Plus size={13} />
        <span>Add Column</span>
      </button>

      <style jsx>{`
        .cols-editor {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .grid-head {
          display: grid;
          grid-template-columns: 24px 1.4fr 1.2fr 36px 36px 36px 1fr 28px;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          padding: 4px 6px;
          background: var(--bg-header);
          border-radius: var(--radius-xs);
        }
        .grid-row {
          display: grid;
          grid-template-columns: 24px 1.4fr 1.2fr 36px 36px 36px 1fr 28px;
          gap: 6px;
          align-items: center;
          padding: 3px 6px;
          border-radius: var(--radius-xs);
          background: var(--bg-card);
          border: 1px solid var(--border-light);
        }
        .grid-row.is-new {
          border-color: rgba(59, 130, 246, 0.35);
        }
        .center {
          text-align: center;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .check-cell {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        .check-cell input {
          cursor: pointer;
          accent-color: var(--accent-blue);
          width: 15px;
          height: 15px;
        }
        .check-cell input:disabled {
          cursor: not-allowed;
          opacity: 0.4;
        }
        .reorder {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cols-editor :global(.input) {
          width: 100%;
          font-size: 11.5px;
          height: 28px;
          padding: 4px 8px;
        }
        .mini-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 14px;
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .mini-btn:hover:not(:disabled) {
          color: var(--text-main);
          border-color: var(--border-medium);
        }
        .mini-btn:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }
        .mini-btn.danger {
          height: 28px;
          width: 28px;
        }
        .mini-btn.danger:hover {
          color: var(--accent-rose);
          border-color: rgba(244, 63, 94, 0.4);
          background: rgba(244, 63, 94, 0.1);
        }
        .empty-note {
          font-size: 11px;
          color: var(--text-muted);
          padding: 10px 4px;
        }
        .add-btn {
          align-self: flex-start;
          margin-top: 6px;
        }
      `}</style>
    </div>
  );
};
