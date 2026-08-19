import React from "react";
import { Database, Terminal, Server, Sun, Moon, Shield, GitFork, FileText, Sliders, ChevronDown } from "lucide-react";
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
  onOpenGuiSize?: () => void;
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
  onOpenGuiSize,
  theme,
  onToggleTheme,
}) => {
  return (
    <header className="app-header">
      {/* macOS traffic light spacer & brand */}
      <div className="header-left">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mascot.jpg" alt="dodb mascot" className="brand-mascot-img" />
          <span className="brand-title">dodb</span>
          <span className="brand-badge">macOS</span>
        </div>
      </div>

      {/* Centered navigation tabs */}
      <div className="header-center">
        <nav className="nav-tabs">
          <button
            className={`tab-btn ${activeView === "explorer" ? "active" : ""}`}
            onClick={() => onChangeView("explorer")}
          >
            <Database size={13} />
            <span>Data Explorer</span>
          </button>
          <button
            className={`tab-btn ${activeView === "sql" ? "active" : ""}`}
            onClick={() => onChangeView("sql")}
          >
            <Terminal size={13} />
            <span>SQL Console</span>
          </button>
          <button
            className={`tab-btn ${activeView === "diagram" ? "active" : ""}`}
            onClick={() => onChangeView("diagram")}
          >
            <GitFork size={13} />
            <span>ER Diagram</span>
          </button>
          <button
            className={`tab-btn ${activeView === "admin" ? "active" : ""}`}
            onClick={() => onChangeView("admin")}
          >
            <Shield size={13} />
            <span>Database Admin</span>
          </button>
        </nav>
      </div>

      {/* Right actions */}
      <div className="header-right">
        {activeProfile ? (
          <div className="active-conn-chip">
            <span className="status-indicator online" />
            <span className="profile-title">{activeProfile.name}</span>
            <span className={`db-type-badge ${activeProfile.type}`}>
              {activeProfile.type.toUpperCase()}
            </span>

            {databases.length > 0 && (
              <div className="db-select-wrap">
                <select
                  className="database-select"
                  value={activeDatabase}
                  onChange={(e) => onSelectDatabase(e.target.value)}
                >
                  {databases.map((db) => (
                    <option key={db} value={db}>
                      {db}
                    </option>
                  ))}
                </select>
                <ChevronDown size={11} className="db-select-chevron" />
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

        {onOpenAuditLogs && (
          <button className="btn btn-secondary header-btn" onClick={onOpenAuditLogs} title="View Audit Logs & History">
            <FileText size={13} />
            <span>Audit Log</span>
          </button>
        )}

        {onOpenGuiSize && (
          <button className="btn btn-secondary header-icon-btn" onClick={onOpenGuiSize} title="GUI Window Size Settings">
            <Sliders size={13} />
          </button>
        )}

        <button className="btn btn-secondary header-btn conn-btn" onClick={onOpenConnections}>
          <Server size={13} />
          <span>Connections</span>
        </button>

        <button className="btn btn-secondary header-icon-btn" onClick={onToggleTheme} title="Toggle Theme">
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </div>

      <style jsx>{`
        .app-header {
          height: var(--header-h);
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 14px 0 80px;
          gap: 16px;
          -webkit-app-region: drag;
          user-select: none;
          flex-shrink: 0;
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
        }
        .brand-mascot-img {
          width: 22px;
          height: 22px;
          border-radius: 5px;
          object-fit: cover;
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
          border-radius: 3px;
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          text-transform: uppercase;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-app-region: no-drag;
        }
        .nav-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 3px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          gap: 3px;
        }
        .tab-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          font-size: 11px;
          font-weight: 500;
          border: none;
          background: transparent;
          color: var(--text-sub);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.14s ease;
          height: 26px;
        }
        .tab-btn:hover {
          color: var(--text-main);
        }
        .tab-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 8px;
          -webkit-app-region: no-drag;
          flex-shrink: 0;
        }

        .active-conn-chip {
          display: flex;
          align-items: center;
          gap: 7px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 0 10px;
          height: 28px;
          border-radius: var(--radius-sm);
          font-size: 11px;
        }
        .active-conn-chip.offline {
          color: var(--text-muted);
        }
        .status-indicator {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .status-indicator.online {
          background: var(--accent-green);
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.6);
        }
        .status-indicator.offline {
          background: var(--text-muted);
        }

        .profile-title {
          font-weight: 600;
          color: var(--text-main);
          max-width: 130px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .db-type-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 3px;
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
          font-size: 11px;
          border-radius: 4px;
          padding: 2px 20px 2px 6px;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          cursor: pointer;
          height: 22px;
          font-family: var(--font-mono);
        }
        .db-select-chevron {
          position: absolute;
          right: 5px;
          pointer-events: none;
          color: var(--text-muted);
        }

        .header-divider {
          width: 1px;
          height: 18px;
          background: var(--border-light);
          margin: 0 2px;
        }

        .header-btn {
          height: 28px;
          padding: 0 10px;
          font-size: 11px;
        }

        .header-icon-btn {
          height: 28px;
          width: 28px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
      `}</style>
    </header>
  );
};
