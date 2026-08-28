import React from "react";
import { Columns3, KeyRound, Link2 } from "lucide-react";
import { DBType } from "../../types";
import { ColumnDraft, ForeignKeyDraft, IndexDraft, TableDraft } from "../../utils/ddlBuilder";
import { ColumnsEditor } from "./ColumnsEditor";
import { IndexesEditor } from "./IndexesEditor";
import { ForeignKeysEditor } from "./ForeignKeysEditor";

export type DesignerTab = "columns" | "indexes" | "foreignKeys";

interface TableDesignerBodyProps {
  draft: TableDraft;
  dbType: DBType;
  activeTab: DesignerTab;
  onTabChange: (tab: DesignerTab) => void;
  availableTables: string[];
  onFetchColumns: (table: string) => Promise<string[]>;
  onChange: (draft: TableDraft) => void;
}

/**
 * The three editable tabs, shared by the create-table and alter-table flows so
 * there is exactly one implementation of the column/index/FK editing surface.
 */
export const TableDesignerBody: React.FC<TableDesignerBodyProps> = ({
  draft,
  dbType,
  activeTab,
  onTabChange,
  availableTables,
  onFetchColumns,
  onChange,
}) => {
  const columnNames = draft.columns.map((c) => c.name.trim()).filter(Boolean);

  const tabs: Array<{ key: DesignerTab; label: string; icon: React.ReactNode; count: number }> = [
    { key: "columns", label: "Columns", icon: <Columns3 size={12} />, count: draft.columns.length },
    { key: "indexes", label: "Indexes", icon: <KeyRound size={12} />, count: draft.indexes.length },
    { key: "foreignKeys", label: "Foreign Keys", icon: <Link2 size={12} />, count: draft.foreignKeys.length },
  ];

  return (
    <div className="designer-body">
      <div className="designer-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`designer-tab ${activeTab === t.key ? "active" : ""}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.icon}
            <span>{t.label}</span>
            <span className="tab-count">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="designer-panel">
        {activeTab === "columns" && (
          <ColumnsEditor
            columns={draft.columns}
            dbType={dbType}
            onChange={(columns: ColumnDraft[]) => onChange({ ...draft, columns })}
          />
        )}

        {activeTab === "indexes" && (
          <IndexesEditor
            indexes={draft.indexes}
            availableColumns={columnNames}
            onChange={(indexes: IndexDraft[]) => onChange({ ...draft, indexes })}
          />
        )}

        {activeTab === "foreignKeys" && (
          <ForeignKeysEditor
            foreignKeys={draft.foreignKeys}
            tableName={draft.name || "current_table"}
            availableColumns={columnNames}
            columnDrafts={draft.columns}
            availableTables={availableTables}
            onFetchColumns={onFetchColumns}
            onChange={(foreignKeys: ForeignKeyDraft[]) => onChange({ ...draft, foreignKeys })}
          />
        )}
      </div>

      <style jsx>{`
        .designer-body {
          display: flex;
          flex-direction: column;
          min-height: 0;
          flex: 1;
          max-width: 100%;
          overflow: hidden;
        }
        .designer-tabs {
          display: flex;
          gap: 2px;
          padding: 0 16px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-card);
          flex-shrink: 0;
          overflow-x: auto;
          max-width: 100%;
        }
        .designer-tab {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: none;
          border-bottom: 1.5px solid transparent;
          color: var(--text-muted);
          font-family: var(--font-sans);
          font-size: 11.5px;
          font-weight: 500;
          padding: 8px 10px;
          cursor: pointer;
          transition: color 0.12s ease, border-color 0.12s ease;
          white-space: nowrap;
        }
        .designer-tab:hover {
          color: var(--text-main);
        }
        .designer-tab.active {
          color: var(--text-main);
          border-bottom-color: var(--accent-blue);
        }
        .tab-count {
          font-size: 9.5px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: 8px;
          padding: 0 4px;
          min-width: 15px;
          text-align: center;
        }
        .designer-panel {
          padding: 12px 16px;
          overflow-y: auto;
          overflow-x: hidden;
          flex: 1;
          min-height: 0;
          max-width: 100%;
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
};

