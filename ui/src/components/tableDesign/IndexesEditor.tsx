import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { IndexDraft } from "../../utils/ddlBuilder";
import { newIndex } from "./draft";

interface IndexesEditorProps {
  indexes: IndexDraft[];
  /** Column names available to index (the current draft's columns). */
  availableColumns: string[];
  onChange: (indexes: IndexDraft[]) => void;
}

export const IndexesEditor: React.FC<IndexesEditorProps> = ({ indexes, availableColumns, onChange }) => {
  const patch = (id: string, changes: Partial<IndexDraft>) =>
    onChange(indexes.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const toggleColumn = (idx: IndexDraft, column: string) => {
    const next = idx.columns.includes(column)
      ? idx.columns.filter((c) => c !== column)
      : [...idx.columns, column];
    patch(idx.id, { columns: next });
  };

  return (
    <div className="idx-editor">
      {indexes.length === 0 && (
        <div className="empty-note">No secondary indexes. The primary key is managed on the Columns tab.</div>
      )}

      {indexes.map((idx) => (
        <div className="idx-card" key={idx.id}>
          <div className="idx-top">
            <input
              className="input font-mono idx-name"
              value={idx.name}
              placeholder="index_name"
              onChange={(e) => patch(idx.id, { name: e.target.value })}
            />
            <label className="unique-toggle" data-tooltip="Enforce distinct values (UNIQUE)">
              <input
                type="checkbox"
                checked={idx.unique}
                onChange={(e) => patch(idx.id, { unique: e.target.checked })}
              />
              <span>Unique</span>
            </label>
            <button
              type="button"
              className="mini-btn danger"
              data-tooltip="Remove this index"
              onClick={() => onChange(indexes.filter((i) => i.id !== idx.id))}
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div className="col-picker">
            {availableColumns.length === 0 && <span className="empty-note">Add columns first.</span>}
            {availableColumns.map((col) => {
              const on = idx.columns.includes(col);
              const order = idx.columns.indexOf(col) + 1;
              return (
                <button
                  key={col}
                  type="button"
                  className={`col-chip font-mono ${on ? "on" : ""}`}
                  onClick={() => toggleColumn(idx, col)}
                  data-tooltip={on ? `Position ${order} in index (Click to remove)` : `Click to add "${col}" to index`}
                >
                  {on && <span className="chip-order">{order}</span>}
                  <span className="chip-name">{col}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-secondary add-btn"
        onClick={() => onChange([...indexes, newIndex()])}
        data-tooltip="Add a new index definition"
      >
        <Plus size={13} />
        <span>Add Index</span>
      </button>

      <style jsx>{`
        .idx-editor {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .idx-card {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px;
          background: var(--bg-tertiary);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .idx-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .idx-editor :global(.idx-name) {
          flex: 1;
          font-size: 11px;
          padding: 4px 6px;
        }
        .unique-toggle {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--text-sub);
          cursor: pointer;
          white-space: nowrap;
        }
        .unique-toggle input {
          cursor: pointer;
          accent-color: var(--accent-blue);
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
