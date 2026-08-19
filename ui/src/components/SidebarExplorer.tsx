import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Database, Table2, RefreshCw, Search, HardDrive, X, Layers, Terminal, Copy, Check } from "lucide-react";

interface SidebarExplorerProps {
  databases: string[];
  activeDatabase: string;
  onSelectDatabase: (db: string) => void;
  tables: string[];
  activeTable: string | null;
  onSelectTable: (table: string) => void;
  onViewStructure?: (table: string) => void;
  onOpenInSql?: (sql: string) => void;
  onRefresh: () => void;
  loading: boolean;
  dbType?: string;
}

export const SidebarExplorer: React.FC<SidebarExplorerProps> = ({
  databases,
  activeDatabase,
  onSelectDatabase,
  tables,
  activeTable,
  onSelectTable,
  onViewStructure,
  onOpenInSql,
  onRefresh,
  loading,
  dbType,
}) => {
  const [mounted, setMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; table: string } | null>(null);
  const [copiedItem, setCopiedItem] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const quoteIdent = (name: string) => {
    if (dbType === "mariadb" || dbType === "mysql") {
      return `\`${name}\``;
    }
    return `"${name}"`;
  };

  const filteredTables = tables.filter((table) =>
    table.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Close context menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleOutsideClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };

    window.addEventListener("click", handleOutsideClick);
    window.addEventListener("contextmenu", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleOutsideClick);
      window.removeEventListener("contextmenu", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleCopyName = (tableName: string) => {
    navigator.clipboard.writeText(tableName);
    setCopiedItem(true);
    setTimeout(() => {
      setCopiedItem(false);
      setContextMenu(null);
    }, 600);
  };

  const handleCopySelect = (tableName: string) => {
    navigator.clipboard.writeText(`SELECT * FROM ${quoteIdent(tableName)} LIMIT 50;`);
    setCopiedItem(true);
    setTimeout(() => {
      setCopiedItem(false);
      setContextMenu(null);
    }, 600);
  };

  return (
    <aside className="sidebar">
      {/* Database selection group */}
      <div className="sidebar-group">
        <div className="group-header">
          <div className="group-label">
            <HardDrive size={12} />
            <span>Database</span>
          </div>
          <button className="icon-action-btn" onClick={onRefresh} title="Refresh Databases & Tables">
            <RefreshCw size={11} className={loading ? "spin" : ""} />
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

      {/* Filter tables input with clear button */}
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
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm("")} title="Clear filter">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Tables list */}
      <div className="sidebar-group tables-group">
        <div className="group-header">
          <div className="group-label">
            <Database size={12} />
            <span>Tables</span>
          </div>
          <span className="table-count-badge">{filteredTables.length}</span>
        </div>

        {loading ? (
          <div className="sidebar-message">
            <RefreshCw size={14} className="spin loading-icon" />
            <span>Loading tables...</span>
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="sidebar-message">
            {searchTerm ? "No tables match filter" : "No tables in database"}
          </div>
        ) : (
          <div className="table-tree">
            {filteredTables.map((table) => {
              const isActive = activeTable === table;
              return (
                <div
                  key={table}
                  className={`tree-item ${isActive ? "active" : ""}`}
                  onClick={() => onSelectTable(table)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({
                      x: Math.min(e.clientX, window.innerWidth - 200),
                      y: Math.min(e.clientY, window.innerHeight - 200),
                      table,
                    });
                  }}
                  title={`${table} (Right-click for options)`}
                >
                  <Table2 size={14} className={`tree-icon ${isActive ? "active-icon" : ""}`} />
                  <span className="tree-label">{table}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && mounted && typeof document !== "undefined" && createPortal(
        <div
          className="sidebar-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 999999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="context-menu-header">
            <Table2 size={12} className="menu-header-icon" />
            <span className="menu-header-name font-mono">{contextMenu.table}</span>
          </div>

          <div className="context-menu-divider" />

          {onViewStructure && (
            <button
              className="context-menu-item highlight"
              onClick={() => {
                onViewStructure(contextMenu.table);
                setContextMenu(null);
              }}
            >
              <Layers size={13} />
              <span>View Structure</span>
            </button>
          )}

          <button
            className="context-menu-item"
            onClick={() => {
              onSelectTable(contextMenu.table);
              setContextMenu(null);
            }}
          >
            <Database size={13} />
            <span>Open in Data Explorer</span>
          </button>

          {onOpenInSql && (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenInSql(`SELECT * FROM ${quoteIdent(contextMenu.table)} LIMIT 100;`);
                setContextMenu(null);
              }}
            >
              <Terminal size={13} />
              <span>Select Top 100 Rows</span>
            </button>
          )}

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => handleCopyName(contextMenu.table)}
          >
            {copiedItem ? <Check size={13} className="copy-check" /> : <Copy size={13} />}
            <span>{copiedItem ? "Copied Name!" : "Copy Table Name"}</span>
          </button>

          <button
            className="context-menu-item"
            onClick={() => handleCopySelect(contextMenu.table)}
          >
            <Copy size={13} />
            <span>Copy SELECT Query</span>
          </button>
        </div>,
        document.body
      )}

      <style jsx>{`
        .sidebar {
          width: var(--sidebar-w);
          height: 100%;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-light);
          display: flex;
          flex-direction: column;
          padding: 8px 10px;
          gap: 10px;
          user-select: none;
          flex-shrink: 0;
          position: relative;
        }

        .sidebar-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
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
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
        }

        .table-count-badge {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 1.5px 6px;
          border-radius: 10px;
          border: 1px solid var(--border-light);
        }

        .icon-action-btn {
          background: transparent;
          border: none;
          color: var(--text-sub);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          transition: all 0.12s ease;
        }
        .icon-action-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .spin {
          animation: spin 0.9s linear infinite;
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
          font-size: 12px;
          height: 30px;
          padding: 4px 8px;
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
          padding-right: 24px;
          width: 100%;
          font-size: 11.5px;
          height: 28px;
          border-radius: 5px;
        }
        .clear-search-btn {
          position: absolute;
          right: 6px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          padding: 2px;
          border-radius: 3px;
        }
        .clear-search-btn:hover {
          color: var(--text-main);
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
          padding-right: 2px;
        }

        .tree-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 6px;
          cursor: pointer;
          color: var(--text-sub);
          font-size: 12.5px;
          transition: all 0.12s ease;
          position: relative;
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
        .tree-item.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 3px;
          background: var(--accent-blue);
          border-radius: 2px;
        }

        .tree-icon {
          flex-shrink: 0;
          opacity: 0.75;
        }
        .tree-icon.active-icon {
          opacity: 1;
          color: var(--accent-blue);
        }

        .tree-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: -0.2px;
        }

        .sidebar-message {
          padding: 24px 8px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .loading-icon {
          color: var(--accent-blue);
        }

        :global(.sidebar-context-menu) {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-sm);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.08);
          padding: 4px;
          min-width: 190px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          animation: contextFade 0.12s ease;
        }
        @keyframes contextFade {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }

        :global(.context-menu-header) {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 5px 8px 3px 8px;
          color: var(--text-muted);
          font-size: 10.5px;
        }
        :global(.menu-header-icon) {
          color: var(--accent-blue);
        }
        :global(.menu-header-name) {
          font-weight: 700;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        :global(.context-menu-divider) {
          height: 1px;
          background: var(--border-light);
          margin: 2px 0;
        }

        :global(.context-menu-item) {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          background: transparent;
          border: none;
          color: var(--text-main);
          font-size: 11.5px;
          font-weight: 500;
          border-radius: 4px;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.1s ease;
        }
        :global(.context-menu-item:hover) {
          background: var(--accent-blue);
          color: #ffffff;
        }
        :global(.context-menu-item.highlight) {
          color: var(--accent-blue);
          font-weight: 600;
        }
        :global(.context-menu-item.highlight:hover) {
          background: var(--accent-blue);
          color: #ffffff;
        }

        :global(.copy-check) {
          color: var(--accent-green);
        }

        @media (max-width: 900px) {
          .sidebar {
            width: 210px;
            padding: 6px 8px;
          }
        }
      `}</style>
    </aside>
  );
};
