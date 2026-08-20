import React from "react";
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
} from "lucide-react";
import { ConnectionProfile } from "../types";

interface HeaderProps {
  activeProfile: ConnectionProfile | null;
  profiles?: ConnectionProfile[];
  onSelectProfile?: (profile: ConnectionProfile) => void;
  activeDatabase: string;
  databases: string[];
  onSelectDatabase: (db: string) => void;
  activeTable?: string | null;
  activeView: "explorer" | "sql" | "admin" | "diagram";
  onChangeView: (view: "explorer" | "sql" | "admin" | "diagram") => void;
  onOpenConnections: () => void;
  onDisconnect?: () => void;
  onOpenAuditLogs?: () => void;
  onOpenCommandPalette?: () => void;
  latencyMs?: number | null;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeProfile,
  profiles,
  onSelectProfile,
  activeDatabase,
  databases,
  onSelectDatabase,
  activeTable,
  activeView,
  onChangeView,
  onOpenConnections,
  onDisconnect,
  onOpenAuditLogs,
  onOpenCommandPalette,
  latencyMs = 12,
  theme,
  onToggleTheme,
}) => {
  return (
    <header className="app-header">
      {/* Left: Brand logo & Context Breadcrumb */}
      <div className="header-left">
        <div className="brand" title="dodb Database Manager">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="dodb mascot" className="brand-mascot-img" />
          <span className="brand-title">DODB</span>
        </div>

        {activeProfile && (
          <div className="header-breadcrumb" title="Active Context Path">
            <span className="bc-divider">/</span>
            <span className="bc-item bc-host" title={`Host: ${activeProfile.host || activeProfile.name}`}>
              {activeProfile.name}
            </span>
            <ChevronRight size={10} className="bc-arrow" />
            <span className="bc-item bc-db" title={`Database: ${activeDatabase || "default"}`}>
              {activeDatabase || "default"}
            </span>
            {activeTable && (
              <>
                <ChevronRight size={10} className="bc-arrow" />
                <span className="bc-item bc-table" title={`Table: ${activeTable}`}>
                  <TableIcon size={10} className="bc-table-icon" />
                  {activeTable}
                </span>
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
          <Search size={12} className="search-icon" />
          <span className="search-text">
            {activeTable ? `Jump to table or command in ${activeTable}...` : "Quick Search tables, commands, actions..."}
          </span>
          <kbd className="search-shortcut">⌘K</kbd>
        </button>

        {activeProfile && (
          <div className="header-health-pill" title={`Server Status: Online (Ping: ${latencyMs ?? 12}ms)`}>
            <span className="health-dot" />
            <span className="health-ping">{latencyMs ?? 12}ms</span>
          </div>
        )}
      </div>

      {/* Right: Navigation tabs, Active connection chip & responsive action buttons */}
      <div className="header-right">
        <nav className="nav-tabs">
          <button
            className={`tab-btn ${activeView === "explorer" ? "active" : ""}`}
            onClick={() => onChangeView("explorer")}
            title="Data Explorer (Table & JSON View)"
          >
            <Database size={13} className="tab-icon" />
            <span className="tab-label-full">Data Explorer</span>
            <span className="tab-label-short">Explorer</span>
          </button>
          <button
            className={`tab-btn ${activeView === "sql" ? "active" : ""}`}
            onClick={() => onChangeView("sql")}
            title="SQL Query Console"
          >
            <Terminal size={13} className="tab-icon" />
            <span className="tab-label-full">SQL Console</span>
            <span className="tab-label-short">SQL</span>
          </button>
          <button
            className={`tab-btn ${activeView === "diagram" ? "active" : ""}`}
            onClick={() => onChangeView("diagram")}
            title="Entity-Relationship Diagram"
          >
            <GitFork size={13} className="tab-icon" />
            <span className="tab-label-full">ER Diagram</span>
            <span className="tab-label-short">ERD</span>
          </button>
          <button
            className={`tab-btn ${activeView === "admin" ? "active" : ""}`}
            onClick={() => onChangeView("admin")}
            title="Database Administration"
          >
            <Shield size={13} className="tab-icon" />
            <span className="tab-label-full">Database Admin</span>
            <span className="tab-label-short">Admin</span>
          </button>
        </nav>

        <div className="header-divider" />
        {activeProfile ? (
          <div className="active-conn-chip">
            <span className="status-indicator online" />

            {profiles && profiles.length > 1 ? (
              <div className="profile-select-wrap">
                <select
                  className="profile-switcher-select"
                  value={activeProfile.id}
                  onChange={(e) => {
                    const found = profiles.find((p) => p.id === e.target.value);
                    if (found && onSelectProfile) onSelectProfile(found);
                  }}
                  title="Switch Connection Profile"
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="profile-select-chevron" />
              </div>
            ) : (
              <span className="profile-title" title={activeProfile.name}>
                {activeProfile.name}
              </span>
            )}

            <span className={`db-type-badge ${activeProfile.type}`}>
              {activeProfile.type.toUpperCase()}
            </span>

            {databases.length > 0 && (
              <div className="db-select-wrap">
                <select
                  className="database-select"
                  value={activeDatabase}
                  onChange={(e) => onSelectDatabase(e.target.value)}
                  title="Switch Active Database"
                >
                  {databases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
                <ChevronDown size={10} className="db-select-chevron" />
              </div>
            )}

            {onDisconnect && (
              <button
                className="chip-disconnect-btn"
                onClick={onDisconnect}
                title="Disconnect from database"
              >
                <LogOut size={11} />
              </button>
            )}
          </div>
        ) : (
          <div className="active-conn-chip offline clickable" onClick={onOpenConnections} title="Click to Connect">
            <span className="status-indicator offline" />
            <span>Not Connected</span>
          </div>
        )}

        <div className="header-divider" />

        <div className="action-buttons-group">
          {onOpenAuditLogs && (
            <button className="btn btn-secondary header-btn" onClick={onOpenAuditLogs} title="View Audit Logs & History">
              <FileText size={13} />
              <span className="btn-text-responsive">Audit Log</span>
            </button>
          )}

          <button className="btn btn-secondary header-btn conn-btn" onClick={onOpenConnections} title="Manage Database Connections">
            <Server size={13} />
            <span className="btn-text-responsive">Connections</span>
          </button>

          <button className="btn btn-secondary header-icon-btn" onClick={onToggleTheme} title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}>
            {theme === "dark" ? <Sun size={13} className="theme-icon sun" /> : <Moon size={13} className="theme-icon moon" />}
          </button>
        </div>
      </div>

      <style jsx>{`
        .app-header {
          height: var(--header-h);
          background: var(--bg-header);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px 0 12px;
          gap: 12px;
          -webkit-app-region: drag;
          user-select: none;
          flex-shrink: 0;
          z-index: 100;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
          -webkit-app-region: no-drag;
        }

        .header-breadcrumb {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-muted);
          background: var(--bg-tertiary);
          padding: 3px 8px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          white-space: nowrap;
          overflow: hidden;
        }
        .bc-divider {
          color: var(--border-medium);
          margin-right: 2px;
        }
        .bc-arrow {
          color: var(--text-muted);
          opacity: 0.6;
          flex-shrink: 0;
        }
        .bc-item {
          font-weight: 500;
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
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .bc-table-icon {
          flex-shrink: 0;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex: 1;
          max-width: 440px;
          -webkit-app-region: no-drag;
          margin: 0 8px;
        }
        .header-quick-search {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 4px 10px;
          height: 28px;
          color: var(--text-muted);
          font-family: var(--font-sans);
          cursor: pointer;
          transition: all 0.12s ease;
          user-select: none;
          min-width: 140px;
          max-width: 360px;
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
          font-size: 11.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          text-align: left;
        }
        .search-shortcut {
          font-family: var(--font-mono);
          font-size: 9.5px;
          font-weight: 600;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          padding: 1px 5px;
          border-radius: 4px;
          box-shadow: var(--shadow-sm);
          flex-shrink: 0;
        }

        .header-health-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 3px 8px;
          height: 26px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
          flex-shrink: 0;
        }
        .health-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent-green);
          box-shadow: 0 0 6px var(--accent-green);
        }
        .health-ping {
          font-weight: 500;
          color: var(--text-sub);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 7px;
          color: var(--text-main);
          -webkit-app-region: no-drag;
          cursor: default;
        }
        .brand-mascot-img {
          width: 22px;
          height: 22px;
          border-radius: 5px;
          object-fit: cover;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        }
        .brand-title {
          font-weight: 600;
          font-size: 13px;
          letter-spacing: -0.2px;
        }
        .brand-badge {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 4px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .nav-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 2px;
          border-radius: 6px;
          border: 1px solid var(--border-light);
          gap: 2px;
          align-items: center;
        }
        .tab-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 3px 10px;
          font-size: 11px;
          font-weight: 500;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.12s ease;
          height: 24px;
          white-space: nowrap;
        }
        .tab-icon {
          flex-shrink: 0;
          opacity: 0.7;
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

        .tab-label-short {
          display: none;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 6px;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
        }

        .active-conn-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 0 8px;
          height: 26px;
          border-radius: var(--radius-sm);
          font-size: 11px;
        }
        .active-conn-chip.offline {
          color: var(--text-muted);
        }
        .active-conn-chip.clickable {
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .active-conn-chip.clickable:hover {
          border-color: var(--border-medium);
          background: var(--bg-hover);
        }
        .chip-disconnect-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 3px;
          border-radius: 4px;
          margin-left: 2px;
          transition: all 0.12s ease;
        }
        .chip-disconnect-btn:hover {
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
        }
        .status-indicator {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-indicator.online {
          background: var(--accent-green);
        }
        .status-indicator.offline {
          background: var(--text-muted);
        }

        .profile-title {
          font-weight: 500;
          color: var(--text-main);
          max-width: 110px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .profile-select-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .profile-switcher-select {
          background: transparent;
          border: none;
          color: var(--text-main);
          font-size: 11px;
          font-weight: 500;
          padding: 0 16px 0 0;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          max-width: 120px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .profile-switcher-select:hover {
          color: var(--text-main);
        }

        :global(.profile-select-chevron) {
          position: absolute;
          right: 2px;
          color: var(--text-muted);
          pointer-events: none;
        }

        .db-type-badge {
          font-size: 8.5px;
          font-family: var(--font-mono);
          font-weight: 600;
          padding: 1px 4px;
          border-radius: 3px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          letter-spacing: 0.2px;
        }

        .db-select-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .database-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 10.5px;
          border-radius: 4px;
          padding: 2px 18px 2px 5px;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          height: 20px;
          font-family: var(--font-mono);
          max-width: 100px;
        }
        .database-select:focus {
          border-color: var(--border-focus);
        }
        .db-select-chevron {
          position: absolute;
          right: 4px;
          pointer-events: none;
          color: var(--text-muted);
        }

        .header-divider {
          width: 1px;
          height: 18px;
          background: var(--border-light);
          margin: 0 2px;
        }

        .action-buttons-group {
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .header-btn {
          height: 28px;
          padding: 0 9px;
          font-size: 11px;
          border-radius: 6px;
        }

        .header-icon-btn {
          height: 28px;
          width: 28px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
        }

        .theme-icon.sun { color: #f59e0b; }
        .theme-icon.moon { color: #818cf8; }

        /* Responsive Media Queries for Small Screens */
        @media (max-width: 1280px) {
          .header-breadcrumb .bc-host { display: none; }
        }

        @media (max-width: 1100px) {
          .header-breadcrumb { display: none; }
          .tab-label-full { display: none; }
          .tab-label-short { display: inline; }
          .profile-title { max-width: 80px; }
          .database-select { max-width: 80px; }
          .btn-text-responsive { display: none; }
          .header-btn { padding: 0 7px; width: 28px; }
        }

        @media (max-width: 850px) {
          .tab-label-short { display: none; }
          .tab-btn { padding: 4px 6px; }
          .brand-title, .brand-badge { display: none; }
          .profile-title { display: none; }
          .db-type-badge { display: none; }
          .header-health-pill { display: none; }
          .header-center { max-width: 180px; }
          .search-text { display: none; }
          .app-header { padding: 0 8px 0 8px; gap: 8px; }
        }

        @media (max-width: 680px) {
          .header-center { display: none; }
          .active-conn-chip { padding: 0 4px; }
          .header-divider { display: none; }
        }
      `}</style>
    </header>
  );
};
