import React, { useState } from "react";
import {
  Database,
  X,
  Copy,
  Check,
  ExternalLink,
  Cpu,
  Layers,
  Sparkles,
  Shield,
  Terminal,
  Workflow,
  GitFork,
  Heart,
  HardDrive
} from "lucide-react";

import { Language, t } from "../utils/i18n";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  version?: string;
  language?: Language;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  version = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0-dev",
  language = "en",
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopyInfo = () => {
    const info = `DODB Database Manager\nVersion: v${version}\nPlatform: macOS (Native Desktop)\nEngines: PostgreSQL, MySQL, MariaDB, SQLite\nStack: Tauri v2 + Next.js + SQLx`;
    navigator.clipboard.writeText(info);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="about-modal-overlay" onClick={onClose}>
      <div className="about-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header decoration with close button */}
        <div className="about-modal-header">
          <div></div>
          <button className="icon-close-btn" onClick={onClose} title={t("close", language)}>
            <X size={15} />
          </button>
        </div>

        {/* Hero Section */}
        <div className="about-hero">
          <div className="app-logo-wrapper">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="DODB Icon" className="app-logo-img" />
            <span className="app-logo-glow" />
          </div>
          <div className="app-meta">
            <div className="app-title-row">
              <h2 className="app-name font-mono">DODB</h2>
              <span className="app-version-chip font-mono">v{version}</span>
            </div>
            <p className="app-tagline">
              {language === "th"
                ? "Fast, lightweight & native desktop database client"
                : "Fast, lightweight & native desktop database client"}
            </p>
          </div>
        </div>

        {/* Modal Body Info */}
        <div className="about-body">
          {/* Supported Databases Grid */}
          <div className="section-box">
            <div className="section-title">
              <HardDrive size={12} className="section-icon" />
              <span>Supported Database Engines</span>
            </div>
            <div className="engines-grid">
              <div className="engine-chip pg">
                <span className="engine-dot pg" />
                <span className="engine-name">PostgreSQL</span>
              </div>
              <div className="engine-chip mysql">
                <span className="engine-dot mysql" />
                <span className="engine-name">MySQL</span>
              </div>
              <div className="engine-chip mariadb">
                <span className="engine-dot mariadb" />
                <span className="engine-name">MariaDB</span>
              </div>
              <div className="engine-chip sqlite">
                <span className="engine-dot sqlite" />
                <span className="engine-name">SQLite</span>
              </div>
            </div>
          </div>

          {/* Core Modules Grid */}
          <div className="section-box">
            <div className="section-title">
              <Layers size={12} className="section-icon" />
              <span>Built-in Workspace Tools</span>
            </div>
            <div className="features-grid">
              <div className="feature-item">
                <Database size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">Data Explorer</div>
                  <div className="feat-desc">Visual grid, filters & inline editing</div>
                </div>
              </div>
              <div className="feature-item">
                <Terminal size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">SQL Console</div>
                  <div className="feat-desc">Multi-tab queries & explain plan</div>
                </div>
              </div>
              <div className="feature-item">
                <Workflow size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">Visual Query</div>
                  <div className="feat-desc">Drag & drop JOIN & aggregate builder</div>
                </div>
              </div>
              <div className="feature-item">
                <GitFork size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">ER Diagram</div>
                  <div className="feat-desc">Interactive schema & relationship graph</div>
                </div>
              </div>
              <div className="feature-item">
                <Shield size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">Process & Admin</div>
                  <div className="feat-desc">Kill processes, manage users & dumps</div>
                </div>
              </div>
              <div className="feature-item">
                <Cpu size={13} className="feat-icon" />
                <div>
                  <div className="feat-title">Native Core</div>
                  <div className="feat-desc">Rust SQLx connection pool & memory safety</div>
                </div>
              </div>
            </div>
          </div>

          {/* Stack & System Meta */}
          <div className="system-meta-bar font-mono">
            <span>Tauri 2.0 • Rust Core • Next.js</span>
            <button
              type="button"
              className="copy-info-btn"
              onClick={handleCopyInfo}
              title="Copy system and version info"
            >
              {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
              <span>{copied ? "Copied Info!" : "Copy System Info"}</span>
            </button>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="about-modal-footer">
          <div className="footer-left-text">
            <span>Made with </span>
            <Heart size={11} className="heart-icon" />
            <span> by THUTIL Team</span>
          </div>
          <button className="btn btn-secondary btn-sm close-modal-btn" onClick={onClose}>
            {t("close", language)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .about-modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2500;
          animation: overlayFadeIn 0.15s ease-out;
        }
        @keyframes overlayFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .about-modal-card {
          width: 500px;
          max-width: 92vw;
          max-height: 86vh;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg, 12px);
          box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.15);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalScaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes modalScaleUp {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(6px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .about-modal-header {
          padding: 12px 14px 6px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .header-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.12);
          border: 1px solid rgba(59, 130, 246, 0.25);
          padding: 2px 8px;
          border-radius: 12px;
        }
        .badge-sparkle { color: #f59e0b; }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 4px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .icon-close-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .about-hero {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 10px 18px 16px 18px;
        }

        .app-logo-wrapper {
          position: relative;
          width: 54px;
          height: 54px;
          flex-shrink: 0;
        }
        .app-logo-img {
          width: 100%;
          height: 100%;
          border-radius: 12px;
          object-fit: cover;
          position: relative;
          z-index: 2;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
        }
        .app-logo-glow {
          position: absolute;
          inset: -4px;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.45) 0%, rgba(59, 130, 246, 0) 70%);
          border-radius: 16px;
          z-index: 1;
          filter: blur(6px);
        }

        .app-meta {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .app-title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .app-name {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-main);
          letter-spacing: -0.5px;
          margin: 0;
        }
        .app-version-chip {
          font-size: 10.5px;
          font-weight: 600;
          color: #60a5fa;
          background: rgba(59, 130, 246, 0.15);
          border: 1px solid rgba(59, 130, 246, 0.3);
          padding: 1px 7px;
          border-radius: 4px;
        }
        .app-tagline {
          font-size: 11.5px;
          color: var(--text-sub);
          margin: 0;
          line-height: 1.4;
        }

        .about-body {
          padding: 0 18px 14px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }

        .section-box {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md, 8px);
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          color: var(--text-muted);
        }
        .section-icon { color: var(--accent-blue); }

        .engines-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
        }
        .engine-chip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          padding: 5px 8px;
          border-radius: 5px;
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-main);
        }
        .engine-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .engine-dot.pg { background: #336791; }
        .engine-dot.mysql { background: #f29111; }
        .engine-dot.mariadb { background: #c0765a; }
        .engine-dot.sqlite { background: #003b57; }

        .features-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 6px;
          border-radius: 5px;
          background: rgba(255, 255, 255, 0.02);
        }
        .feat-icon {
          color: var(--accent-blue);
          margin-top: 2px;
          flex-shrink: 0;
        }
        .feat-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-main);
        }
        .feat-desc {
          font-size: 9.5px;
          color: var(--text-muted);
          line-height: 1.3;
        }

        .system-meta-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: 6px;
          font-size: 10px;
          color: var(--text-muted);
        }

        .copy-info-btn {
          background: transparent;
          border: none;
          color: var(--text-sub);
          font-size: 10px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 5px;
          border-radius: 3px;
          transition: all 0.12s ease;
        }
        .copy-info-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .text-green { color: var(--accent-green); }

        .about-modal-footer {
          padding: 10px 18px;
          background: var(--bg-tertiary);
          border-top: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .footer-left-text {
          font-size: 10.5px;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .heart-icon {
          color: #ef4444;
          display: inline-block;
          animation: pulse 1.5s ease infinite;
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15); }
        }

        .close-modal-btn {
          min-width: 68px;
          height: 28px;
        }
      `}</style>
    </div>
  );
};
