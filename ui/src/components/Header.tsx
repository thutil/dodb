import React from "react";
import { Database, Terminal, Server, Sun, Moon, Shield, GitFork, FileText, Sliders } from "lucide-react";
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
      <div className="header-drag-region">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mascot.jpg" alt="dodb mascot" className="brand-mascot-img" />
          <span className="brand-title">dodb</span>
          <span className="brand-badge">macOS</span>
        </div>
      </div>

      <div className="header-nav">
        <div className="nav-tabs">
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
        </div>
      </div>

      <div className="header-actions">
        {activeProfile ? (
          <div className="active-conn-chip">
            <span className="status-indicator online" />
            <span className="profile-title">{activeProfile.name}</span>
            <span className={`db-type-badge ${activeProfile.type}`}>
              {activeProfile.type.toUpperCase()}
            </span>

            {databases.length > 0 && (
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
            )}
          </div>
        ) : (
          <div className="active-conn-chip offline">
            <span className="status-indicator offline" />
            <span>Not Connected</span>
          </div>
        )}

        {onOpenAuditLogs && (
          <button className="btn btn-secondary conn-btn" onClick={onOpenAuditLogs} title="View Audit Logs & History">
            <FileText size={13} />
            <span>Audit Log</span>
          </button>
        )}

        {onOpenGuiSize && (
          <button className="btn btn-secondary theme-btn" onClick={onOpenGuiSize} title="GUI Window Size Settings">
            <Sliders size={13} />
          </button>
        )}

        <button className="btn btn-secondary conn-btn" onClick={onOpenConnections}>
          <Server size={13} />
          <span>Connections</span>
        </button>

        <button className="btn btn-secondary theme-btn" onClick={onToggleTheme} title="Toggle Theme">
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
          padding: 0 14px 0 76px;
          gap: 16px;
          -webkit-app-region: drag;
        }

        .header-drag-region {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 6px;
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
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          text-transform: uppercase;
        }

        .header-nav {
          display: flex;
          align-items: center;
          -webkit-app-region: no-drag;
        }
        .nav-tabs {
          display: flex;
          background: var(--bg-tertiary);
          padding: 3px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          gap: 2px;
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
          transition: all 0.12s ease;
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

        .header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          -webkit-app-region: no-drag;
        }

        .active-conn-chip {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 3px 10px;
          border-radius: var(--radius-sm);
          font-size: 11px;
        }
        .status-indicator {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }
        .status-indicator.online {
          background: var(--accent-green);
          box-shadow: 0 0 6px rgba(16, 185, 129, 0.5);
        }
        .status-indicator.offline {
          background: var(--text-muted);
        }

        .profile-title {
          font-weight: 600;
          color: var(--text-main);
        }

        .db-type-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 4px;
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

        .database-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 11px;
          border-radius: 4px;
          padding: 2px 6px;
          outline: none;
        }

        .theme-btn {
          padding: 5px 8px;
        }
      `}</style>
    </header>
  );
};
