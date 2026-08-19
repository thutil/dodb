import React from "react";
import { Database, Terminal, Server, Sun, Moon, Shield, GitFork, FileText, ChevronDown } from "lucide-react";
import { ConnectionProfile } from "../types";

interface HeaderProps {
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  databases: string[];
  onSelectDatabase: (db: string) => void;
  activeView: "explorer" | "sql" | "admin" | "diagram";
  onChangeView: (view: "explorer" | "sql" | "admin" | "diagram") => void;
  onOpenConnections: () => void;
  onOpenAuditLogs?: () => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeProfile,
  activeDatabase,
  databases,
  onSelectDatabase,
  activeView,
  onChangeView,
  onOpenConnections,
  onOpenAuditLogs,
  theme,
  onToggleTheme,
}) => {
  return (
    <header className="app-header">
      {/* Left: macOS traffic light space & brand */}
      <div className="header-left">
        <div className="brand" title="dodb Database Manager">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mascot.jpg" alt="dodb mascot" className="brand-mascot-img" />
          <span className="brand-title">dodb</span>
          <span className="brand-badge">macOS</span>
        </div>
      </div>

      {/* Center: Navigation tabs with responsive labels */}
      <div className="header-center">
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
      </div>

      {/* Right: Active connection chip & responsive action buttons */}
      <div className="header-right">
        {activeProfile ? (
          <div className="active-conn-chip">
            <span className="status-indicator online" />
            <span className="profile-title" title={activeProfile.name}>
              {activeProfile.name}
            </span>
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
          </div>
        ) : (
          <div className="active-conn-chip offline">
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
          flex-shrink: 0;
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
          font-weight: 700;
          font-size: 13px;
          letter-spacing: -0.3px;
        }
        .brand-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 4px;
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: no-drag;
          flex: 1;
          max-width: 540px;
        }
        .nav-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 2.5px;
          border-radius: 8px;
          border: 1px solid var(--border-light);
          gap: 2px;
          width: 100%;
          justify-content: space-between;
        }
        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 4px 10px;
          font-size: 11px;
          font-weight: 500;
          border: none;
          background: transparent;
          color: var(--text-sub);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.16s cubic-bezier(0.4, 0, 0.2, 1);
          height: 26px;
          white-space: nowrap;
        }
        .tab-icon {
          flex-shrink: 0;
          opacity: 0.8;
        }
        .tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .tab-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18), 0 0 0 1px var(--border-light);
        }
        .tab-btn.active .tab-icon {
          color: var(--accent-blue);
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
          height: 28px;
          border-radius: var(--radius-sm);
          font-size: 11px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .active-conn-chip.offline {
          color: var(--text-muted);
        }
        .status-indicator {
          width: 6.5px;
          height: 6.5px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-indicator.online {
          background: var(--accent-green);
          box-shadow: 0 0 8px rgba(16, 185, 129, 0.7);
        }
        .status-indicator.offline {
          background: var(--text-muted);
        }

        .profile-title {
          font-weight: 600;
          color: var(--text-main);
          max-width: 110px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .db-type-badge {
          font-size: 8.5px;
          font-weight: 700;
          padding: 1px 4px;
          border-radius: 3px;
          letter-spacing: 0.3px;
        }
        .db-type-badge.postgres {
          background: rgba(59, 130, 246, 0.18);
          color: #60a5fa;
        }
        .db-type-badge.mariadb {
          background: rgba(249, 115, 22, 0.18);
          color: #fb923c;
        }
        .db-type-badge.sqlite {
          background: rgba(16, 185, 129, 0.18);
          color: #34d399;
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
          border-color: var(--accent-blue);
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
        @media (max-width: 1080px) {
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
          .app-header { padding: 0 8px 0 72px; gap: 8px; }
        }

        @media (max-width: 680px) {
          .active-conn-chip { padding: 0 4px; }
          .header-divider { display: none; }
        }
      `}</style>
    </header>
  );
};
