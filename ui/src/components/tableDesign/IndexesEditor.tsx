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
            <label className="unique-toggle" title="Enforce uniqueness">
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
              title="Remove index"
              onClick={() => onChange(indexes.filter((i) => i.id !== idx.id))}
            >
              <Trash2 size={12} />
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
                  title={on ? `Position ${order} — click to remove` : "Click to add"}
                >
                  {on && <span className="chip-order">{order}</span>}
                  {col}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button type="button" className="btn btn-secondary add-btn" onClick={() => onChange([...indexes, newIndex()])}>
        <Plus size={12} />
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
