import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Database, Table2, RefreshCw, Search, HardDrive, X, Layers, Terminal, Copy, Check, Plus, Pencil, Trash2, Eraser, Upload } from "lucide-react";
import { DBType } from "../types";
import { quoteTableIdent } from "../utils/ddlBuilder";
import { Language, t } from "../utils/i18n";

interface SidebarExplorerProps {
  databases: string[];
  activeDatabase: string;
  onSelectDatabase: (db: string) => void;
  tables: string[];
  activeTable: string | null;
  onSelectTable: (table: string) => void;
  onViewStructure?: (table: string) => void;
  onOpenInSql?: (sql: string) => void;
  onCreateTable?: () => void;
  onEditStructure?: (table: string) => void;
  onTruncateTable?: (table: string) => void;
  onDropTable?: (table: string) => void;
  onTruncateTables?: (tables: string[]) => void;
  onDropTables?: (tables: string[]) => void;
  onImportIntoDatabase?: () => void;
  onImportIntoTable?: (table: string) => void;
  onRefresh: () => void;
  loading: boolean;
  isConnecting?: boolean;
  dbType?: string;
  language?: Language;
}

/** Right-click target: a specific table, multiple tables, or empty space. */
type MenuTarget =
  | { kind: "table"; x: number; y: number; table: string }
  | { kind: "multi_tables"; x: number; y: number; tables: string[] }
  | { kind: "blank"; x: number; y: number };

export const SidebarExplorer: React.FC<SidebarExplorerProps> = ({
  databases,
  activeDatabase,
  onSelectDatabase,
  tables,
  activeTable,
  onSelectTable,
  onViewStructure,
  onOpenInSql,
  onCreateTable,
  onEditStructure,
  onTruncateTable,
  onDropTable,
  onTruncateTables,
  onDropTables,
  onImportIntoDatabase,
  onImportIntoTable,
  onRefresh,
  loading,
  isConnecting = false,
  dbType,
  language = "en",
}) => {
  const [mounted, setMounted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [lastSelectedTable, setLastSelectedTable] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuTarget | null>(null);
  const [copiedItem, setCopiedItem] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Prune selectedTables whenever the tables list changes (e.g., after drop or database switch)
  useEffect(() => {
    setSelectedTables((prev) => {
      const valid = new Set<string>();
      prev.forEach((t) => {
        if (tables.includes(t)) {
          valid.add(t);
        }
      });
      // If activeTable exists in tables and nothing else is valid, keep activeTable selected
      if (valid.size === 0 && activeTable && tables.includes(activeTable)) {
        valid.add(activeTable);
      }
      return valid;
    });
  }, [tables, activeTable]);

  // Synchronize activeTable with selectedTables if not multi-selecting
  useEffect(() => {
    if (activeTable && selectedTables.size <= 1 && !selectedTables.has(activeTable) && tables.includes(activeTable)) {
      setSelectedTables(new Set([activeTable]));
      setLastSelectedTable(activeTable);
    }
  }, [activeTable, tables]);

  // Structure editing is unavailable on SQLite (its ALTER TABLE cannot express it).
  const isSqlite = dbType === "sqlite";
  const dialect: DBType = dbType === "mariadb" || dbType === "mysql" ? "mariadb" : isSqlite ? "sqlite" : "postgres";
  const quoteIdent = (name: string) => quoteTableIdent(name, dialect);

  const filteredTables = tables.filter((table) =>
    table.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  const handleTableClick = (e: React.MouseEvent, table: string) => {
    if (e.metaKey || e.ctrlKey) {
      // Toggle selection with Command / Ctrl
      setSelectedTables((prev) => {
        const next = new Set(prev);
        if (next.has(table)) {
          next.delete(table);
        } else {
          next.add(table);
        }
        if (next.size === 1) {
          onSelectTable(Array.from(next)[0]);
        }
        return next;
      });
      setLastSelectedTable(table);
    } else if (e.shiftKey && lastSelectedTable && filteredTables.includes(lastSelectedTable)) {
      // Range selection with Shift
      const startIdx = filteredTables.indexOf(lastSelectedTable);
      const endIdx = filteredTables.indexOf(table);
      if (startIdx !== -1 && endIdx !== -1) {
        const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const range = filteredTables.slice(low, high + 1);
        setSelectedTables(new Set(range));
      }
    } else {
      // Normal single selection
      setSelectedTables(new Set([table]));
      setLastSelectedTable(table);
      onSelectTable(table);
    }
  };

  const openMenu = (e: React.MouseEvent, target: { kind: "table"; table: string } | { kind: "blank" }) => {
    e.preventDefault();
    e.stopPropagation();

    if (target.kind === "table") {
      if (selectedTables.has(target.table) && selectedTables.size > 1) {
        setContextMenu({
          kind: "multi_tables",
          tables: Array.from(selectedTables),
          x: Math.min(e.clientX, window.innerWidth - 210),
          y: Math.min(e.clientY, window.innerHeight - 300),
        });
        return;
      } else {
        setSelectedTables(new Set([target.table]));
        setLastSelectedTable(target.table);
      }
    }

    setContextMenu({
      ...target,
      x: Math.min(e.clientX, window.innerWidth - 210),
      y: Math.min(e.clientY, window.innerHeight - 300),
    } as MenuTarget);
  };

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

  const handleCopyMultipleNames = (tbls: string[]) => {
    navigator.clipboard.writeText(tbls.join("\n"));
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

  const handleClearSelection = () => {
    if (activeTable) {
      setSelectedTables(new Set([activeTable]));
    } else {
      setSelectedTables(new Set());
    }
  };

  const handleBatchDrop = (tbls: string[]) => {
    if (onDropTables) {
      onDropTables(tbls);
    } else if (onDropTable && tbls.length > 0) {
      onDropTable(tbls[0]);
    }
  };

  const handleBatchTruncate = (tbls: string[]) => {
    if (onTruncateTables) {
      onTruncateTables(tbls);
    } else if (onTruncateTable && tbls.length > 0) {
      onTruncateTable(tbls[0]);
    }
  };

  return (
    <aside className="sidebar">
      {/* Database selection group */}
      <div className="sidebar-group">
        <div className="group-header">
          <div className="group-label">
            <HardDrive size={12} />
            <span>{t("sidebarDatabase", language)}</span>
          </div>
          <button
            className="icon-action-btn"
            onClick={onRefresh}
            disabled={isConnecting}
            title={t("shortcutRefresh", language)}
            suppressHydrationWarning
          >
            <RefreshCw size={11} className={loading || isConnecting ? "spin" : ""} />
          </button>
        </div>
        <div className="select-container">
          <select
            className="select db-dropdown"
            value={isConnecting ? "" : activeDatabase}
            onChange={(e) => onSelectDatabase(e.target.value)}
            disabled={isConnecting}
            suppressHydrationWarning
          >
            {isConnecting ? (
              <option value="">{t("connecting", language)}</option>
            ) : databases.length === 0 ? (
              <option value="">{t("noDbFound", language)}</option>
            ) : null}
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
          <span className="search-icon-wrap">
            <Search size={12} />
          </span>
          <input
            type="text"
            className="input search-field"
            placeholder={t("sidebarFilterTables", language)}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && filteredTables.length > 0) {
                onSelectTable(filteredTables[0]);
              }
            }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {searchTerm && (
            <button className="clear-search-btn" onClick={() => setSearchTerm("")} title={t("close", language)}>
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Multi-Selection Action Banner */}
      {selectedTables.size > 1 && (
        <div className="multi-select-banner">
          <div className="multi-select-info">
            <span className="multi-count">{selectedTables.size}</span>
            <span>{t("gridRowsSelected", language)}</span>
          </div>
          <div className="multi-select-actions">
            <button
              type="button"
              className="btn-multi-action"
              onClick={() => handleCopyMultipleNames(Array.from(selectedTables))}
              title={t("copyTableName", language)}
            >
              <Copy size={11} />
            </button>
            {!isSqlite && (onTruncateTables || onTruncateTable) && (
              <button
                type="button"
                className="btn-multi-action danger"
                onClick={() => handleBatchTruncate(Array.from(selectedTables))}
                title="Truncate selected tables"
              >
                <Eraser size={11} />
              </button>
            )}
            {(onDropTables || onDropTable) && (
              <button
                type="button"
                className="btn-multi-action danger"
                onClick={() => handleBatchDrop(Array.from(selectedTables))}
                title="Drop selected tables"
              >
                <Trash2 size={11} />
              </button>
            )}
            <button
              type="button"
              className="btn-multi-action"
              onClick={handleClearSelection}
              title={t("gridClearSelection", language)}
            >
              <X size={11} />
            </button>
          </div>
        </div>
      )}

      {/* Tables list */}
      <div
        className="sidebar-group tables-group"
        onContextMenu={(e) => openMenu(e, { kind: "blank" })}
      >
        <div className="group-header">
          <div className="group-label">
            <Database size={12} />
            <span>{t("sidebarTables", language)}</span>
          </div>
          <div className="group-header-right">
            <span className="table-count-badge">{filteredTables.length}</span>
            {onCreateTable && (
              <button
                className="icon-action-btn"
                onClick={onCreateTable}
                title={t("sidebarCreateTable", language)}
                disabled={!activeDatabase}
                suppressHydrationWarning
              >
                <Plus size={12} />
              </button>
            )}
          </div>
        </div>

        {isConnecting ? (
          <div className="sidebar-message">
            <RefreshCw size={14} className="spin loading-icon" />
            <span>{t("connecting", language)}</span>
          </div>
        ) : loading ? (
          <div className="sidebar-message">
            <RefreshCw size={14} className="spin loading-icon" />
            <span>{t("loading", language)}</span>
          </div>
        ) : filteredTables.length === 0 ? (
          <div className="sidebar-message">
            {searchTerm ? t("sidebarNoTables", language) : t("noTableFound", language)}
          </div>
        ) : (
          <div className="table-tree">
            {filteredTables.map((table) => {
              const isSelected = selectedTables.has(table);
              const isActive = activeTable === table && selectedTables.size <= 1;
              return (
                <div
                  key={table}
                  className={`tree-item ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
                  onClick={(e) => handleTableClick(e, table)}
                  onContextMenu={(e) => openMenu(e, { kind: "table", table })}
                  title={`${table} (⌘/Ctrl+Click to multi-select, Right-click for options)`}
                >
                  <Table2 size={14} className={`tree-icon ${isActive || isSelected ? "active-icon" : ""}`} />
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
          {contextMenu.kind === "blank" ? (
            <>
              <div className="context-menu-header">
                <Database size={12} className="menu-header-icon" />
                <span className="menu-header-name font-mono">{activeDatabase || "No database"}</span>
              </div>

              <div className="context-menu-divider" />

              {onCreateTable && (
                <button
                  className="context-menu-item highlight"
                  disabled={!activeDatabase}
                  onClick={() => {
                    onCreateTable();
                    setContextMenu(null);
                  }}
                >
                  <Plus size={13} />
                  <span>Create Table</span>
                </button>
              )}

              {onImportIntoDatabase && (
                <button
                  className="context-menu-item"
                  disabled={!activeDatabase}
                  onClick={() => {
                    onImportIntoDatabase();
                    setContextMenu(null);
                  }}
                >
                  <Upload size={13} />
                  <span>Import Data…</span>
                </button>
              )}

              <button
                className="context-menu-item"
                onClick={() => {
                  onRefresh();
                  setContextMenu(null);
                }}
              >
                <RefreshCw size={13} />
                <span>Refresh Tables</span>
              </button>
            </>
          ) : contextMenu.kind === "multi_tables" ? (
            <>
              <div className="context-menu-header">
                <Database size={12} className="menu-header-icon" />
                <span className="menu-header-name">{contextMenu.tables.length} Tables Selected</span>
              </div>

              <div className="context-menu-divider" />

              <button
                className="context-menu-item"
                onClick={() => handleCopyMultipleNames(contextMenu.tables)}
              >
                {copiedItem ? <Check size={13} className="copy-check" /> : <Copy size={13} />}
                <span>{copiedItem ? "Copied Names!" : `Copy ${contextMenu.tables.length} Table Names`}</span>
              </button>

              {(onTruncateTables || onTruncateTable || onDropTables || onDropTable) && (
                <div className="context-menu-divider" />
              )}

              {!isSqlite && (onTruncateTables || onTruncateTable) && (
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    handleBatchTruncate(contextMenu.tables);
                    setContextMenu(null);
                  }}
                >
                  <Eraser size={13} />
                  <span>Truncate {contextMenu.tables.length} Tables</span>
                </button>
              )}

              {(onDropTables || onDropTable) && (
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    handleBatchDrop(contextMenu.tables);
                    setContextMenu(null);
                  }}
                >
                  <Trash2 size={13} />
                  <span>Drop {contextMenu.tables.length} Tables</span>
                </button>
              )}

              <div className="context-menu-divider" />

              <button
                className="context-menu-item"
                onClick={() => {
                  handleClearSelection();
                  setContextMenu(null);
                }}
              >
                <X size={13} />
                <span>Clear Selection</span>
              </button>
            </>
          ) : (
            <>
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

              {onEditStructure && !isSqlite && (
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onEditStructure(contextMenu.table);
                    setContextMenu(null);
                  }}
                >
                  <Pencil size={13} />
                  <span>Edit Structure</span>
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

              {onImportIntoTable && (
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onImportIntoTable(contextMenu.table);
                    setContextMenu(null);
                  }}
                >
                  <Upload size={13} />
                  <span>Import into this Table…</span>
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

              {(onTruncateTable || onDropTable) && <div className="context-menu-divider" />}

              {onTruncateTable && !isSqlite && (
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    onTruncateTable(contextMenu.table);
                    setContextMenu(null);
                  }}
                >
                  <Eraser size={13} />
                  <span>Truncate Table</span>
                </button>
              )}

              {onDropTable && (
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    onDropTable(contextMenu.table);
                    setContextMenu(null);
                  }}
                >
                  <Trash2 size={13} />
                  <span>Drop Table</span>
                </button>
              )}
            </>
          )}
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

        .group-header-right {
          display: flex;
          align-items: center;
          gap: 3px;
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
        .icon-action-btn:hover:not(:disabled) {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .icon-action-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
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
        .search-icon-wrap {
          position: absolute;
          left: 8px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-muted);
          pointer-events: none;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2;
        }
        .search-field {
          padding-left: 26px;
          padding-right: 24px;
          width: 100%;
          font-size: 11.5px;
          height: 28px;
          border-radius: 5px;
          box-sizing: border-box;
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

        .multi-select-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 8px;
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.3);
          border-radius: var(--radius-xs);
          animation: slideDown 0.14s ease;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .multi-select-info {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-main);
          font-weight: 500;
        }
        .multi-count {
          background: var(--accent-blue);
          color: #fff;
          font-weight: 700;
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 10px;
        }
        .multi-select-actions {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .btn-multi-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .btn-multi-action:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .btn-multi-action.danger:hover {
          background: rgba(244, 63, 94, 0.2);
          color: var(--accent-red);
          border-color: rgba(244, 63, 94, 0.4);
        }

        .tables-group {
          min-height: 0;
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
          padding: 5px 9px;
          border-radius: 5px;
          cursor: pointer;
          color: var(--text-sub);
          font-size: 12px;
          transition: all 0.12s ease;
          position: relative;
        }
        .tree-item:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .tree-item.selected {
          background: rgba(59, 130, 246, 0.18);
          color: var(--text-main);
          font-weight: 500;
          border: 1px solid rgba(59, 130, 246, 0.35);
        }
        .tree-item.active {
          background: var(--bg-active);
          color: var(--text-main);
          font-weight: 600;
        }
        .tree-item.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 5px;
          bottom: 5px;
          width: 2.5px;
          background: var(--text-main);
          border-radius: 2px;
        }

        .tree-icon {
          flex-shrink: 0;
          opacity: 0.7;
        }
        .tree-icon.active-icon {
          opacity: 1;
          color: var(--text-main);
        }

        .tree-label {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: var(--font-mono);
          font-size: 11.5px;
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

        :global(.context-menu-item.danger) {
          color: var(--accent-red);
        }
        :global(.context-menu-item.danger:hover) {
          background: var(--accent-red);
          color: #ffffff;
        }
        :global(.context-menu-item:disabled) {
          opacity: 0.4;
          cursor: not-allowed;
        }
        :global(.context-menu-item:disabled:hover) {
          background: transparent;
          color: var(--text-muted);
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
