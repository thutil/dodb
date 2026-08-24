import React, { useState, useEffect, useRef } from "react";
import {
  Database,
  Terminal,
  Server,
  Sun,
  Moon,
  Shield,
  GitFork,
  FileText,
  ChevronDown,
  ChevronRight,
  LogOut,
  Search,
  Activity,
  Table as TableIcon,
  Check,
  Copy,
  Layers,
  RefreshCw,
  ExternalLink,
  Plus,
  Workflow,
  Upload,
  Settings as SettingsIcon,
} from "lucide-react";
import { ConnectionProfile, DBType } from "../types";
import { quoteTableIdent } from "../utils/ddlBuilder";
import { Language, t } from "../utils/i18n";

interface HeaderProps {
  activeProfile: ConnectionProfile | null;
  profiles?: ConnectionProfile[];
  onSelectProfile?: (profile: ConnectionProfile) => void;
  activeDatabase: string;
  databases: string[];
  onSelectDatabase: (db: string) => void;
  tables?: string[];
  activeTable?: string | null;
  onSelectTable?: (table: string) => void;
  activeView: "explorer" | "sql" | "admin" | "diagram" | "visual-query";
  onChangeView: (view: "explorer" | "sql" | "admin" | "diagram" | "visual-query") => void;
  onOpenConnections: () => void;
  onDisconnect?: () => void;
  onOpenAuditLogs?: () => void;
  onOpenImport?: () => void;
  onOpenCommandPalette?: () => void;
  onOpenAbout?: () => void;
  onOpenSettings?: () => void;
  onViewStructure?: (table: string) => void;
  onOpenInSql?: (sql: string) => void;
  onRefreshDatabases?: () => void;
  latencyMs?: number | null;
  isConnecting?: boolean;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  language?: Language;
}

export const Header: React.FC<HeaderProps> = ({
  activeProfile,
  profiles,
  onSelectProfile,
  activeDatabase,
  databases,
  onSelectDatabase,
  tables = [],
  activeTable,
  onSelectTable,
  activeView,
  onChangeView,
  onOpenConnections,
  onDisconnect,
  onOpenAuditLogs,
  onOpenImport,
  onOpenCommandPalette,
  onOpenAbout,
  onOpenSettings,
  onViewStructure,
  onOpenInSql,
  onRefreshDatabases,
  latencyMs,
  isConnecting = false,
  theme,
  onToggleTheme,
  language = "en",
}) => {
  const [openMenu, setOpenMenu] = useState<"host" | "db" | "table" | null>(null);
  const [dbSearch, setDbSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [copiedTable, setCopiedTable] = useState(false);
  const breadcrumbRef = useRef<HTMLDivElement>(null);

  // Close breadcrumb dropdown when clicking outside or pressing Escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (breadcrumbRef.current && !breadcrumbRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleCopyTableName = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(name);
    setCopiedTable(true);
    setTimeout(() => setCopiedTable(false), 1200);
  };

  const handleOpenTableInSql = (tbl: string) => {
    setOpenMenu(null);
    const dialect: DBType =
      activeProfile?.type === "mariadb"
        ? "mariadb"
        : activeProfile?.type === "sqlite"
          ? "sqlite"
          : "postgres";
    const quoted = quoteTableIdent(tbl, dialect);
    const sql = `SELECT * FROM ${quoted} LIMIT 100;`;
    if (onOpenInSql) {
      onOpenInSql(sql);
    } else {
      onChangeView("sql");
    }
  };

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(dbSearch.toLowerCase())
  );

  const filteredTables = tables.filter((t) =>
    t.toLowerCase().includes(tableSearch.toLowerCase())
  );

  return (
    <header className="app-header">
      {/* Left: Brand logo & Context Breadcrumb */}
      <div className="header-left">
        <div
          className="brand clickable"
          onClick={() => {
            if (onOpenAbout) {
              onOpenAbout();
            } else {
              onChangeView("explorer");
            }
          }}
          title="dodb Database Manager - Click to view About & Version"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="dodb mascot" className="brand-mascot-img" />
          <span className="brand-title">DODB</span>
        </div>

        {activeProfile && (
          <div className="header-breadcrumb" ref={breadcrumbRef} title="Active Context Path (Click to switch or navigate)">
            <span className="bc-divider">/</span>

            {/* Segment 1: Host / Connection Profile */}
            <div className="bc-segment-wrap">
              <button
                type="button"
                className={`bc-item bc-host bc-interactive ${openMenu === "host" ? "is-open" : ""}`}
                onClick={() => {
                  setOpenMenu((prev) => (prev === "host" ? null : "host"));
                  setDbSearch("");
                  setTableSearch("");
                }}
                title={`Connected Profile: ${activeProfile.name} (${activeProfile.host || "Local"}) - Click to switch profile or manage connections`}
              >
                <Server size={11} className="bc-segment-icon" />
                <span className="bc-label">{activeProfile.name}</span>
                <ChevronDown size={9} className={`bc-caret ${openMenu === "host" ? "caret-up" : ""}`} />
              </button>

              {openMenu === "host" && (
                <div className="bc-dropdown-popover">
                  <div className="bc-dropdown-header">
                    <div className="bc-dropdown-title">{t("hostConnection", language)}</div>
                    <span className={`db-type-badge ${activeProfile.type}`}>
                      {activeProfile.type.toUpperCase()}
                    </span>
                  </div>
                  <div className="bc-dropdown-subinfo">
                    {activeProfile.host ? `${activeProfile.host}:${activeProfile.port || "default"}` : "Local Database"}
                  </div>

                  {profiles && profiles.length > 0 && (
                    <>
                      <div className="bc-dropdown-section-title">{t("switchConnection", language)}</div>
                      <div className="bc-dropdown-list">
                        {profiles.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`bc-dropdown-item ${p.id === activeProfile.id ? "active" : ""}`}
                            onClick={() => {
                              setOpenMenu(null);
                              if (p.id !== activeProfile.id && onSelectProfile) {
                                onSelectProfile(p);
                              }
                            }}
                          >
                            <Server size={12} className="item-icon" />
                            <span className="item-text">{p.name}</span>
                            <span className={`db-type-badge small ${p.type}`}>{p.type}</span>
                            {p.id === activeProfile.id && <Check size={12} className="check-icon" />}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="bc-dropdown-divider" />
                  <button
                    type="button"
                    className="bc-dropdown-item action-item"
                    onClick={() => {
                      setOpenMenu(null);
                      onOpenConnections();
                    }}
                  >
                    <Plus size={12} className="item-icon" />
                    <span>{t("manageConnections", language)}</span>
                  </button>

                  {onDisconnect && (
                    <button
                      type="button"
                      className="bc-dropdown-item action-item danger"
                      onClick={() => {
                        setOpenMenu(null);
                        onDisconnect();
                      }}
                    >
                      <LogOut size={12} className="item-icon" />
                      <span>{t("disconnect", language)}</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <ChevronRight size={10} className="bc-arrow" />

            {/* Segment 2: Active Database */}
            <div className="bc-segment-wrap">
              <button
                type="button"
                className={`bc-item bc-db bc-interactive ${openMenu === "db" ? "is-open" : ""} ${isConnecting ? "is-connecting" : ""}`}
                onClick={() => {
                  if (isConnecting) return;
                  setOpenMenu((prev) => (prev === "db" ? null : "db"));
                  setDbSearch("");
                  setTableSearch("");
                }}
                title={isConnecting ? t("connecting", language) : `Database: ${activeDatabase || "default"} - Click to switch database`}
              >
                {isConnecting ? (
                  <RefreshCw size={11} className="bc-segment-icon spin" />
                ) : (
                  <Database size={11} className="bc-segment-icon" />
                )}
                <span className="bc-label">{isConnecting ? t("connecting", language) : (activeDatabase || "default")}</span>
                {!isConnecting && (
                  <ChevronDown size={9} className={`bc-caret ${openMenu === "db" ? "caret-up" : ""}`} />
                )}
              </button>

              {openMenu === "db" && (
                <div className="bc-dropdown-popover">
                  <div className="bc-dropdown-header">
                    <div className="bc-dropdown-title">
                      {t("databases", language)} {isConnecting ? "" : `(${databases.length})`}
                    </div>
                    {onRefreshDatabases && (
                      <button
                        type="button"
                        className="bc-icon-btn-inline"
                        disabled={isConnecting}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRefreshDatabases();
                        }}
                        title={t("refresh", language)}
                      >
                        <RefreshCw size={10} className={isConnecting ? "spin" : ""} />
                      </button>
                    )}
                  </div>

                  {isConnecting ? (
                    <div className="bc-dropdown-empty" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "12px 0" }}>
                      <RefreshCw size={12} className="spin" />
                      <span>{t("connecting", language)}</span>
                    </div>
                  ) : (
                    <>
                      {databases.length > 5 && (
                        <div className="bc-dropdown-search">
                          <Search size={11} className="search-inline-icon" />
                          <input
                            type="text"
                            placeholder={t("filterDatabases", language)}
                            value={dbSearch}
                            onChange={(e) => setDbSearch(e.target.value)}
                            autoFocus
                            className="bc-search-input"
                          />
                        </div>
                      )}

                      <div className="bc-dropdown-list">
                        {filteredDatabases.length === 0 ? (
                          <div className="bc-dropdown-empty">{t("noDbFound", language)}</div>
                        ) : (
                          filteredDatabases.map((db) => (
                            <button
                              key={db}
                              type="button"
                              className={`bc-dropdown-item ${db === activeDatabase ? "active" : ""}`}
                              onClick={() => {
                                setOpenMenu(null);
                                onSelectDatabase(db);
                                if (activeView !== "explorer") {
                                  onChangeView("explorer");
                                }
                              }}
                            >
                              <Database size={12} className="item-icon" />
                              <span className="item-text">{db}</span>
                              {db === activeDatabase && <Check size={12} className="check-icon" />}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Segment 3: Active Table (if selected) */}
            {activeTable && (
              <>
                <ChevronRight size={10} className="bc-arrow" />
                <div className="bc-segment-wrap">
                  <button
                    type="button"
                    className={`bc-item bc-table bc-interactive ${openMenu === "table" ? "is-open" : ""}`}
                    onClick={() => {
                      setOpenMenu((prev) => (prev === "table" ? null : "table"));
                      setDbSearch("");
                      setTableSearch("");
                    }}
                    title={`Table: ${activeTable} - Click for table actions or quick switch`}
                  >
                    <TableIcon size={11} className="bc-segment-icon" />
                    <span className="bc-label">{activeTable}</span>
                    <ChevronDown size={9} className={`bc-caret ${openMenu === "table" ? "caret-up" : ""}`} />
                  </button>

                  {openMenu === "table" && (
                    <div className="bc-dropdown-popover">
                      <div className="bc-dropdown-header">
                        <div className="bc-dropdown-title">{t("tableActions", language)}</div>
                        <span className="bc-table-chip">{activeTable}</span>
                      </div>

                      <div className="bc-dropdown-actions">
                        <button
                          type="button"
                          className="bc-dropdown-item action-item"
                          onClick={() => {
                            setOpenMenu(null);
                            if (activeView !== "explorer") onChangeView("explorer");
                          }}
                        >
                          <Database size={12} className="item-icon" />
                          <span>{t("showInDataExplorer", language)}</span>
                        </button>

                        {onViewStructure && (
                          <button
                            type="button"
                            className="bc-dropdown-item action-item"
                            onClick={() => {
                              setOpenMenu(null);
                              onViewStructure(activeTable);
                            }}
                          >
                            <Layers size={12} className="item-icon" />
                            <span>{t("viewStructure", language)}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          className="bc-dropdown-item action-item"
                          onClick={() => handleOpenTableInSql(activeTable)}
                        >
                          <Terminal size={12} className="item-icon" />
                          <span>{t("openInSqlConsole", language)}</span>
                        </button>

                        <button
                          type="button"
                          className="bc-dropdown-item action-item"
                          onClick={(e) => handleCopyTableName(e, activeTable)}
                        >
                          {copiedTable ? <Check size={12} className="item-icon text-green" /> : <Copy size={12} className="item-icon" />}
                          <span>{copiedTable ? t("copiedTableName", language) : t("copyTableName", language)}</span>
                        </button>
                      </div>

                      {tables.length > 1 && (
                        <>
                          <div className="bc-dropdown-divider" />
                          <div className="bc-dropdown-section-title">{t("switchTable", language)} ({tables.length})</div>

                          {tables.length > 6 && (
                            <div className="bc-dropdown-search">
                              <Search size={11} className="search-inline-icon" />
                              <input
                                type="text"
                                placeholder={t("filterTables", language)}
                                value={tableSearch}
                                onChange={(e) => setTableSearch(e.target.value)}
                                autoFocus
                                className="bc-search-input"
                              />
                            </div>
                          )}

                          <div className="bc-dropdown-list max-h">
                            {filteredTables.length === 0 ? (
                              <div className="bc-dropdown-empty">{t("noTableFound", language)}</div>
                            ) : (
                              filteredTables.map((tItem) => (
                                <button
                                  key={tItem}
                                  type="button"
                                  className={`bc-dropdown-item ${tItem === activeTable ? "active" : ""}`}
                                  onClick={() => {
                                    setOpenMenu(null);
                                    if (onSelectTable) {
                                      onSelectTable(tItem);
                                    }
                                    if (activeView !== "explorer") {
                                      onChangeView("explorer");
                                    }
                                  }}
                                >
                                  <TableIcon size={12} className="item-icon" />
                                  <span className="item-text">{tItem}</span>
                                  {tItem === activeTable && <Check size={12} className="check-icon" />}
                                </button>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Center: Global Quick Search / Command Palette Bar */}
      <div className="header-center">
        <button
          className="header-quick-search"
          onClick={onOpenCommandPalette}
          title="Global Quick Search & Command Palette (⌘K / Ctrl+K)"
        >
          <span className="search-text">
            {activeTable ? t("quickSearchInTable", language, { table: activeTable }) : t("quickSearchPlaceholder", language)}
          </span>
          <kbd className="search-shortcut">⌘K</kbd>
        </button>

        {activeProfile && (
          <div
            className={`header-health-pill ${latencyMs == null ? "is-connecting" : latencyMs > 200 ? "is-slow" : latencyMs > 80 ? "is-medium" : "is-good"}`}
            title={`Server Status: ${latencyMs != null ? `Online (${latencyMs}ms latency)` : "Connecting..."}`}
          >
            <span className="health-dot" />
            <span className="health-ping">{latencyMs != null ? `${latencyMs}ms` : "..."}</span>
          </div>
        )}
      </div>

      {/* Right: Navigation tabs & action buttons */}
      <div className="header-right">
        <nav className="nav-tabs">
          <button
            className={`tab-btn ${activeView === "explorer" ? "active" : ""}`}
            onClick={() => onChangeView("explorer")}
            title="Data Explorer (Table & JSON View)"
          >
            <Database size={12} className="tab-icon" />
            <span className="tab-label">{t("navExplorer", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeView === "sql" ? "active" : ""}`}
            onClick={() => onChangeView("sql")}
            title="SQL Query Console"
          >
            <Terminal size={12} className="tab-icon" />
            <span className="tab-label">{t("navSql", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeView === "visual-query" ? "active" : ""}`}
            onClick={() => onChangeView("visual-query")}
            title="Visual Query Builder (Drag-and-Drop JOIN & Filters)"
          >
            <Workflow size={12} className="tab-icon" />
            <span className="tab-label">{t("navVisualQuery", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeView === "diagram" ? "active" : ""}`}
            onClick={() => onChangeView("diagram")}
            title="Entity-Relationship Diagram"
          >
            <GitFork size={12} className="tab-icon" />
            <span className="tab-label">{t("navErd", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeView === "admin" ? "active" : ""}`}
            onClick={() => onChangeView("admin")}
            title="Database Administration"
          >
            <Shield size={12} className="tab-icon" />
            <span className="tab-label">{t("navAdmin", language)}</span>
          </button>
        </nav>

        <div className="header-divider" />

        <div className="action-buttons-group">
          {onOpenImport && (
            <button className="btn btn-secondary header-icon-btn" onClick={onOpenImport} title={t("shortcutImport", language)}>
              <Upload size={13} />
            </button>
          )}

          {onOpenAuditLogs && (
            <button className="btn btn-secondary header-icon-btn" onClick={onOpenAuditLogs} title={t("shortcutAuditLogs", language)}>
              <FileText size={13} />
            </button>
          )}

          <button className="btn btn-secondary header-icon-btn conn-btn" onClick={onOpenConnections} title={t("shortcutConnections", language)}>
            <Server size={13} />
          </button>

          {onOpenSettings && (
            <button
              className="btn btn-secondary header-icon-btn"
              onClick={onOpenSettings}
              title={t("settingsTitle", language)}
            >
              <SettingsIcon size={13} className="settings-icon" />
            </button>
          )}

          <button className="btn btn-secondary header-icon-btn" onClick={onToggleTheme} title={theme === "dark" ? t("switchThemeLight", language) : t("switchThemeDark", language)}>
            {theme === "dark" ? <Sun size={13} className="theme-icon sun" /> : <Moon size={13} className="theme-icon moon" />}
          </button>
        </div>
      </div>

      <style jsx>{`
        .app-header {
          height: var(--header-h, 44px);
          background: var(--bg-header);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          gap: 10px;
          -webkit-app-region: drag;
          user-select: none;
          flex-shrink: 0;
          z-index: 100;
          width: 100%;
          box-sizing: border-box;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          flex: 0 1 auto;
          -webkit-app-region: no-drag;
        }

        .brand {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: var(--text-main);
          -webkit-app-region: no-drag;
          cursor: default;
          padding: 3px 6px;
          height: 28px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid transparent;
          transition: all 0.15s ease;
          flex-shrink: 0;
          box-sizing: border-box;
        }
        .brand.clickable {
          cursor: pointer;
        }
        .brand.clickable:hover {
          background: var(--bg-hover);
          border-color: var(--border-light);
        }
        .brand-mascot-img {
          width: 20px;
          height: 20px;
          border-radius: 5px;
          object-fit: cover;
          flex-shrink: 0;
        }
        .brand-title {
          font-weight: 700;
          font-size: 12px;
          letter-spacing: -0.2px;
          line-height: 1;
        }

        .header-breadcrumb {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 2px 6px;
          height: 28px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid var(--border-light);
          white-space: nowrap;
          position: relative;
          min-width: 0;
          flex-shrink: 1;
          box-sizing: border-box;
        }
        .bc-divider {
          color: var(--border-medium);
          margin: 0 1px;
          font-size: 11px;
          flex-shrink: 0;
        }
        .bc-arrow {
          color: var(--text-muted);
          opacity: 0.5;
          flex-shrink: 0;
        }
        .bc-segment-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          min-width: 0;
        }
        .bc-item {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          font-weight: 500;
          padding: 0 6px;
          height: 22px;
          border-radius: 4px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          cursor: pointer;
          transition: all 0.12s ease;
          user-select: none;
          font-family: inherit;
          text-decoration: none;
          line-height: 1;
          min-width: 0;
          max-width: 140px;
          box-sizing: border-box;
        }
        .bc-item:hover, .bc-item.is-open {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--border-light);
        }
        .bc-item.is-open {
          background: var(--bg-card);
          box-shadow: var(--shadow-sm);
        }
        .bc-item.bc-host {
          color: var(--text-sub);
        }
        .bc-item.bc-db {
          color: var(--text-main);
          font-weight: 600;
        }
        .bc-item.bc-table {
          color: var(--accent-blue);
          font-weight: 600;
        }
        .bc-item.is-connecting {
          color: var(--accent-amber, #f59e0b);
          cursor: wait;
        }
        .bc-item.is-connecting .bc-segment-icon {
          color: var(--accent-amber, #f59e0b);
        }
        .bc-segment-icon {
          flex-shrink: 0;
          opacity: 0.85;
        }
        .bc-label {
          max-width: 110px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bc-caret {
          flex-shrink: 0;
          opacity: 0.6;
          transition: transform 0.15s ease;
        }
        .bc-caret.caret-up {
          transform: rotate(180deg);
        }

        /* Breadcrumb Dropdown Popovers */
        .bc-dropdown-popover {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          min-width: 220px;
          max-width: 280px;
          background: var(--bg-card);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid var(--border-medium, var(--border-light));
          border-radius: var(--radius-md, 8px);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35), 0 0 1px rgba(255, 255, 255, 0.1);
          padding: 6px;
          z-index: 1000;
          animation: popoverFadeIn 0.12s ease-out;
        }
        @keyframes popoverFadeIn {
          from {
            opacity: 0;
            transform: translateY(-4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .bc-dropdown-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 8px 6px 8px;
          border-bottom: 1px solid var(--border-light);
          gap: 6px;
        }
        .bc-dropdown-title {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        .bc-dropdown-subinfo {
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          padding: 4px 8px 6px 8px;
        }
        .bc-dropdown-section-title {
          font-size: 9.5px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          padding: 6px 8px 3px 8px;
          letter-spacing: 0.3px;
        }
        .bc-table-chip {
          font-size: 9.5px;
          font-family: var(--font-mono);
          font-weight: 600;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.1);
          padding: 1px 6px;
          border-radius: 4px;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bc-icon-btn-inline {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .bc-icon-btn-inline:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        .bc-dropdown-search {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: 4px;
          padding: 3px 8px;
          margin: 4px 4px 6px 4px;
        }
        .search-inline-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .bc-search-input {
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-main);
          font-size: 11px;
          font-family: var(--font-sans);
          width: 100%;
        }
        .bc-search-input::placeholder {
          color: var(--text-muted);
        }

        .bc-dropdown-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
          max-height: 220px;
          overflow-y: auto;
        }
        .bc-dropdown-list.max-h {
          max-height: 200px;
        }
        .bc-dropdown-actions {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .bc-dropdown-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 8px;
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-sub);
          background: transparent;
          border: none;
          cursor: pointer;
          text-align: left;
          width: 100%;
          transition: all 0.12s ease;
          user-select: none;
          font-family: inherit;
        }
        .bc-dropdown-item:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .bc-dropdown-item.active {
          background: var(--bg-hover);
          color: var(--text-main);
          font-weight: 600;
        }
        .bc-dropdown-item.action-item {
          color: var(--text-main);
        }
        .bc-dropdown-item.action-item.danger {
          color: var(--accent-red);
        }
        .bc-dropdown-item.action-item.danger:hover {
          background: rgba(239, 68, 68, 0.12);
        }

        .item-icon {
          flex-shrink: 0;
          opacity: 0.75;
        }
        .item-icon.text-green {
          color: var(--accent-green);
          opacity: 1;
        }
        .item-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .check-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .db-type-badge {
          font-size: 8px;
          font-family: var(--font-mono);
          font-weight: 600;
          padding: 1px 4px;
          border-radius: 3px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          letter-spacing: 0.2px;
        }
        .db-type-badge.small {
          font-size: 7.5px;
          padding: 0 3px;
        }
        .bc-dropdown-divider {
          height: 1px;
          background: var(--border-light);
          margin: 4px 2px;
        }
        .bc-dropdown-empty {
          font-size: 11px;
          color: var(--text-muted);
          padding: 8px;
          text-align: center;
          font-style: italic;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          flex: 0 1 200px;
          min-width: 50px;
          max-width: 260px;
          -webkit-app-region: no-drag;
        }
        .header-quick-search {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm, 6px);
          padding: 0 8px;
          height: 28px;
          color: var(--text-muted);
          font-family: var(--font-sans);
          cursor: pointer;
          transition: all 0.15s ease;
          user-select: none;
          min-width: 40px;
          box-sizing: border-box;
        }
        .header-quick-search:hover {
          background: var(--bg-hover);
          border-color: var(--border-medium);
          color: var(--text-sub);
        }
        .search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .search-text {
          font-size: 10.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          text-align: left;
        }
        .search-shortcut {
          font-family: var(--font-mono);
          font-size: 9px;
          font-weight: 600;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          padding: 1px 4px;
          border-radius: 3px;
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        .header-health-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 6px;
          height: 28px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm, 6px);
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          flex-shrink: 0;
          box-sizing: border-box;
        }
        .health-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 6px var(--accent-green);
          transition: all 0.2s ease;
        }
        .header-health-pill.is-connecting .health-dot {
          background: var(--text-muted);
          box-shadow: none;
        }
        .header-health-pill.is-medium .health-dot {
          background: var(--accent-amber, #f59e0b);
          box-shadow: 0 0 6px var(--accent-amber, #f59e0b);
        }
        .header-health-pill.is-slow .health-dot {
          background: var(--accent-rose, #ef4444);
          box-shadow: 0 0 6px var(--accent-rose, #ef4444);
        }
        .health-ping {
          font-weight: 500;
          color: var(--text-sub);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 6px;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
          margin-left: auto;
        }

        .nav-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 2px;
          height: 28px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid var(--border-light);
          gap: 2px;
          align-items: center;
          box-sizing: border-box;
        }
        .tab-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 0 8px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.12s ease;
          height: 22px;
          white-space: nowrap;
          box-sizing: border-box;
        }
        .tab-icon {
          flex-shrink: 0;
          opacity: 0.75;
        }
        .tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .tab-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          border-color: var(--border-light);
          box-shadow: var(--shadow-sm);
        }
        .tab-btn.active .tab-icon {
          color: var(--text-main);
          opacity: 1;
        }

        .header-divider {
          width: 1px;
          height: 18px;
          background: var(--border-light);
          margin: 0 1px;
          flex-shrink: 0;
        }

        .action-buttons-group {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .header-btn {
          height: 28px;
          padding: 0 8px;
          font-size: 11px;
          font-weight: 500;
          border-radius: var(--radius-sm, 6px);
          gap: 4px;
          display: inline-flex;
          align-items: center;
          box-sizing: border-box;
          transition: all 0.12s ease;
        }

        .header-icon-btn {
          height: 28px;
          width: 28px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--radius-sm, 6px);
          box-sizing: border-box;
          transition: all 0.12s ease;
        }

        .theme-icon.sun { color: #f59e0b; }
        .theme-icon.moon { color: #818cf8; }

        /* Responsive Breakpoints */
        @media (max-width: 1380px) {
          .btn-text-responsive {
            display: none;
          }
          .header-btn {
            padding: 0 7px;
          }
          .header-breadcrumb .bc-label {
            max-width: 80px;
          }
        }

        @media (max-width: 1150px) {
          .header-breadcrumb .bc-segment-wrap:first-of-type,
          .header-breadcrumb .bc-arrow:first-of-type {
            display: none;
          }
          .search-text {
            display: none;
          }
          .search-shortcut {
            display: none;
          }
          .header-center {
            flex: 0 0 auto;
            min-width: 0;
          }
        }

        @media (max-width: 950px) {
          .tab-label {
            display: none;
          }
          .tab-btn {
            padding: 0 6px;
          }
          .brand-title {
            display: none;
          }
          .header-health-pill {
            display: none;
          }
        }

        @media (max-width: 650px) {
          .header-center {
            display: none;
          }
          .header-breadcrumb {
            max-width: 120px;
          }
        }
      `}</style>
    </header>
  );
};
