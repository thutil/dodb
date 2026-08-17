import React, { useState } from "react";
import { Database, Table2, RefreshCw, Search, HardDrive } from "lucide-react";

interface SidebarExplorerProps {
  databases: string[];
  activeDatabase: string;
  onSelectDatabase: (db: string) => void;
  tables: string[];
  activeTable: string | null;
  onSelectTable: (table: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

export const SidebarExplorer: React.FC<SidebarExplorerProps> = ({
  databases,
  activeDatabase,
  onSelectDatabase,
  tables,
  activeTable,
  onSelectTable,
  onRefresh,
  loading,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredTables = tables.filter((table) =>
    table.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-group">
        <div className="group-header">
          <div className="group-label">
            <HardDrive size={13} />
            <span>Database</span>
          </div>
          <button className="icon-action-btn" onClick={onRefresh} title="Refresh Databases & Tables">
            <RefreshCw size={12} className={loading ? "spin" : ""} />
          </button>
        </div>
        <div className="select-container">
          <select
            className="select db-dropdown"
            value={activeDatabase}
            onChange={(e) => onSelectDatabase(e.target.value)}
          >
            {databases.length === 0 && <option value="">No Databases</option>}
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sidebar-group search-group">
        <div className="search-box">
          <Search size={12} className="search-icon" />
          <input
            type="text"
            className="input search-field"
            placeholder="Filter tables..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="sidebar-group tables-group">
        <div className="group-header">
          <div className="group-label">
            <Database size={13} />
            <span>Tables ({filteredTables.length})</span>
          </div>
        </div>

        {loading ? (
          <div className="sidebar-message">Loading tables...</div>
        ) : filteredTables.length === 0 ? (
          <div className="sidebar-message">
            {searchTerm ? "No tables match filter" : "No tables in database"}
          </div>
        ) : (
          <div className="table-tree">
            {filteredTables.map((table) => (
              <div
                key={table}
                className={`tree-item ${activeTable === table ? "active" : ""}`}
                onClick={() => onSelectTable(table)}
              >
                <Table2 size={13} className="tree-icon" />
                <span className="tree-label">{table}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx>{`
        .sidebar {
          width: var(--sidebar-w);
          height: 100%;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          padding: 10px;
          gap: 12px;
        }

        .sidebar-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .group-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0 4px;
        }

        .group-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          color: var(--text-muted);
        }

        .icon-action-btn {
          background: transparent;
          border: none;
          color: var(--text-sub);
          cursor: pointer;
          padding: 2px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          transition: color 0.12s ease;
        }
        .icon-action-btn:hover {
          color: var(--text-main);
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }

        .select-container {
          width: 100%;
        }
        .db-dropdown {
          width: 100%;
          font-weight: 600;
        }

        .search-box {
          position: relative;
          display: flex;
          align-items: center;
        }
        .search-icon {
          position: absolute;
          left: 8px;
          color: var(--text-muted);
          pointer-events: none;
        }
        .search-field {
          padding-left: 26px;
          width: 100%;
          font-size: 11px;
        }

        .tables-group {
          flex: 1;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .table-tree {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 4px;
        }

        .tree-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          color: var(--text-sub);
          font-size: 11px;
          transition: all 0.1s ease;
        }
        .tree-item:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .tree-item.active {
          background: var(--bg-active);
          color: var(--accent-blue);
          font-weight: 600;
        }

        .tree-icon {
          flex-shrink: 0;
        }

        .tree-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .sidebar-message {
          padding: 16px 8px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
        }
      `}</style>
    </aside>
  );
};
