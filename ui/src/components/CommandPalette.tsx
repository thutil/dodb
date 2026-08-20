import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Table,
  Database,
  Terminal,
  Shield,
  GitFork,
  Server,
  FileText,
  Sun,
  Moon,
  PlusCircle,
  ArrowRight,
  CornerDownLeft,
  X,
  Layers,
} from "lucide-react";
import { ConnectionProfile } from "../types";

interface CommandItem {
  id: string;
  title: string;
  category: "Tables" | "Navigation" | "Databases" | "Actions";
  icon: React.ReactNode;
  hint?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  tables: string[];
  activeTable: string | null;
  onSelectTable: (table: string) => void;
  databases: string[];
  activeDatabase: string;
  onSelectDatabase: (db: string) => void;
  activeView: "explorer" | "sql" | "admin" | "diagram";
  onChangeView: (view: "explorer" | "sql" | "admin" | "diagram") => void;
  onOpenConnections: () => void;
  onOpenCreateTable?: () => void;
  onOpenAuditLogs?: () => void;
  onToggleTheme: () => void;
  theme: "dark" | "light";
  activeProfile: ConnectionProfile | null;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  tables,
  activeTable,
  onSelectTable,
  databases,
  activeDatabase,
  onSelectDatabase,
  onChangeView,
  onOpenConnections,
  onOpenCreateTable,
  onOpenAuditLogs,
  onToggleTheme,
  theme,
  activeProfile,
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Build items list
  const allItems = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [];

    // 1. Tables & Views
    tables.forEach((tbl) => {
      items.push({
        id: `table-${tbl}`,
        title: tbl,
        category: "Tables",
        icon: <Table size={14} className="cmd-icon-table" />,
        hint: tbl === activeTable ? "Current active table" : "Jump to table",
        action: () => {
          onSelectTable(tbl);
          onChangeView("explorer");
          onClose();
        },
      });
    });

    // 2. Navigation Views
    items.push(
      {
        id: "nav-explorer",
        title: "Data Explorer (Table & JSON View)",
        category: "Navigation",
        icon: <Database size={14} className="cmd-icon-nav" />,
        hint: "View & edit rows",
        action: () => {
          onChangeView("explorer");
          onClose();
        },
      },
      {
        id: "nav-sql",
        title: "SQL Query Console",
        category: "Navigation",
        icon: <Terminal size={14} className="cmd-icon-nav" />,
        hint: "Run custom SQL scripts",
        action: () => {
          onChangeView("sql");
          onClose();
        },
      },
      {
        id: "nav-diagram",
        title: "ER Diagram (Schema Visualizer)",
        category: "Navigation",
        icon: <GitFork size={14} className="cmd-icon-nav" />,
        hint: "View table relations",
        action: () => {
          onChangeView("diagram");
          onClose();
        },
      },
      {
        id: "nav-admin",
        title: "Database Administration",
        category: "Navigation",
        icon: <Shield size={14} className="cmd-icon-nav" />,
        hint: "Users, stats & metrics",
        action: () => {
          onChangeView("admin");
          onClose();
        },
      }
    );

    // 3. Databases switching (if available)
    if (databases && databases.length > 1) {
      databases.forEach((db) => {
        items.push({
          id: `db-${db}`,
          title: `Switch Database: ${db}`,
          category: "Databases",
          icon: <Layers size={14} className="cmd-icon-db" />,
          hint: db === activeDatabase ? "Active" : "Switch",
          action: () => {
            onSelectDatabase(db);
            onClose();
          },
        });
      });
    }

    // 4. Quick Actions
    if (onOpenCreateTable && activeProfile) {
      items.push({
        id: "action-create-table",
        title: "Create New Table",
        category: "Actions",
        icon: <PlusCircle size={14} className="cmd-icon-action" />,
        hint: "Add table to database",
        action: () => {
          onOpenCreateTable();
          onClose();
        },
      });
    }

    items.push(
      {
        id: "action-connections",
        title: "Manage Connections",
        category: "Actions",
        icon: <Server size={14} className="cmd-icon-action" />,
        hint: "Add / switch profile",
        action: () => {
          onOpenConnections();
          onClose();
        },
      },
      {
        id: "action-theme",
        title: `Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`,
        category: "Actions",
        icon: theme === "dark" ? <Sun size={14} className="cmd-icon-action sun" /> : <Moon size={14} className="cmd-icon-action moon" />,
        hint: "Toggle UI theme",
        action: () => {
          onToggleTheme();
          onClose();
        },
      }
    );

    if (onOpenAuditLogs) {
      items.push({
        id: "action-audit",
        title: "View Audit Log & Execution History",
        category: "Actions",
        icon: <FileText size={14} className="cmd-icon-action" />,
        hint: "Inspect past queries",
        action: () => {
          onOpenAuditLogs();
          onClose();
        },
      });
    }

    return items;
  }, [
    tables,
    activeTable,
    databases,
    activeDatabase,
    activeProfile,
    theme,
    onSelectTable,
    onChangeView,
    onSelectDatabase,
    onOpenCreateTable,
    onOpenConnections,
    onToggleTheme,
    onOpenAuditLogs,
    onClose,
  ]);

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.toLowerCase().trim();
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        (item.hint && item.hint.toLowerCase().includes(q))
    );
  }, [allItems, query]);

  // Ensure selectedIndex is within bounds
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Auto scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector(".cmd-item.selected");
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Search header */}
        <div className="cmd-header">
          <Search size={16} className="cmd-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cmd-input"
            placeholder="Type a table name, navigation command, or action..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {query && (
            <button className="cmd-clear-btn" onClick={() => setQuery("")} title="Clear search">
              <X size={13} />
            </button>
          )}
          <kbd className="cmd-esc-kbd" onClick={onClose}>
            ESC
          </kbd>
        </div>

        {/* Results list */}
        <div className="cmd-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="cmd-empty">
              <span>No results found for &ldquo;{query}&rdquo;</span>
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={`cmd-item ${isSelected ? "selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="cmd-item-left">
                    <span className="cmd-icon-wrap">{item.icon}</span>
                    <span className="cmd-title">{item.title}</span>
                  </div>
                  <div className="cmd-item-right">
                    {item.hint && <span className="cmd-hint">{item.hint}</span>}
                    <span className="cmd-category-badge">{item.category}</span>
                    {isSelected && <CornerDownLeft size={12} className="cmd-enter-icon" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="cmd-footer">
          <div className="cmd-footer-shortcuts">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> Navigate
            </span>
            <span>
              <kbd>↵</kbd> Select
            </span>
            <span>
              <kbd>ESC</kbd> Close
            </span>
          </div>
          {activeProfile && (
            <span className="cmd-footer-ctx">
              Connected: <strong>{activeProfile.name}</strong> ({activeDatabase || "default"})
            </span>
          )}
        </div>
      </div>

      <style jsx>{`
        .cmd-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 12vh;
          z-index: 9999;
          animation: fadeIn 0.15s ease-out;
        }

        .cmd-dialog {
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border-focus);
          width: 580px;
          max-width: 92vw;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: scaleUp 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .cmd-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-tertiary);
        }
        .cmd-search-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .cmd-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-main);
          font-family: var(--font-sans);
          font-size: 13.5px;
          font-weight: 500;
        }
        .cmd-input::placeholder {
          color: var(--text-muted);
          font-weight: 400;
        }
        .cmd-clear-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          border-radius: 4px;
        }
        .cmd-clear-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .cmd-esc-kbd {
          font-size: 9.5px;
          font-family: var(--font-mono);
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          padding: 2px 6px;
          border-radius: 4px;
          cursor: pointer;
        }

        .cmd-list {
          max-height: 360px;
          overflow-y: auto;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .cmd-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background 0.1s ease, color 0.1s ease;
          user-select: none;
        }
        .cmd-item:hover,
        .cmd-item.selected {
          background: var(--bg-hover);
        }
        .cmd-item.selected {
          background: var(--bg-active);
          border-left: 2px solid var(--accent-blue);
        }

        .cmd-item-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
          flex: 1;
        }
        .cmd-icon-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-sub);
          flex-shrink: 0;
        }
        .cmd-item.selected .cmd-icon-wrap {
          color: var(--accent-blue);
        }

        .cmd-title {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-main);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .cmd-item-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .cmd-hint {
          font-size: 11px;
          color: var(--text-muted);
        }
        .cmd-category-badge {
          font-size: 9.5px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .cmd-enter-icon {
          color: var(--accent-blue);
          margin-left: 2px;
        }

        .cmd-empty {
          padding: 32px 16px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12.5px;
        }

        .cmd-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-top: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          font-size: 11px;
          color: var(--text-muted);
        }
        .cmd-footer-shortcuts {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cmd-footer-shortcuts kbd {
          font-family: var(--font-mono);
          font-size: 9px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 1px 4px;
          border-radius: 3px;
          color: var(--text-sub);
        }
        .cmd-footer-ctx strong {
          color: var(--text-main);
          font-weight: 600;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scaleUp {
          from {
            transform: scale(0.96) translateY(-8px);
            opacity: 0;
          }
          to {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};
