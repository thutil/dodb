import React, { useState, useEffect } from "react";
import {
  Settings,
  X,
  Globe,
  Monitor,
  Command,
  Sun,
  Moon,
  Check,
  RotateCcw,
  Sliders,
  Sparkles,
  Maximize2,
  ZoomIn,
  Compass,
  Play,
  Terminal,
  Keyboard,
} from "lucide-react";
import { Language, t } from "../utils/i18n";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  uiScale: number;
  onChangeUiScale: (scale: number) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  apiBase?: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  language,
  onChangeLanguage,
  uiScale,
  onChangeUiScale,
  theme,
  onToggleTheme,
  apiBase = "http://localhost:5820/api",
}) => {
  const [activeTab, setActiveTab] = useState<"general" | "display" | "shortcuts">("general");

  // Window Dimension state
  const [windowWidth, setWindowWidth] = useState<number>(1280);
  const [windowHeight, setWindowHeight] = useState<number>(850);
  const [savingDim, setSavingDim] = useState(false);
  const [dimStatusMsg, setDimStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const baseUrl = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
      fetch(`${baseUrl}/admin/gui-size`)
        .then((res) => res.json())
        .then((data) => {
          if (data.width && data.height) {
            setWindowWidth(data.width);
            setWindowHeight(data.height);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, apiBase]);

  // Keyboard escape listener to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const scalePresets = [
    { label: t("uiScaleCompact", language), value: 85 },
    { label: t("uiScaleStandard", language), value: 100 },
    { label: t("uiScaleComfortable", language), value: 115 },
    { label: t("uiScaleLarge", language), value: 125 },
  ];

  const windowPresets = [
    { label: "Compact Standard", w: 1280, h: 850 },
    { label: 'MacBook 14"', w: 1440, h: 900 },
    { label: 'MacBook 16"', w: 1600, h: 1000 },
    { label: "Full HD 1080p", w: 1920, h: 1080 },
  ];

  const shortcutSections = [
    {
      group: language === "th" ? "การนำทางและมุมมอง" : "Navigation & Views",
      items: [
        { key: "⌘, / Ctrl+,", desc: t("shortcutSettings", language) },
        { key: "⌘K / Ctrl+K", desc: t("shortcutCommandPalette", language) },
        { key: "⌘1 .. ⌘5", desc: `${t("shortcutExplorerView", language)}, ${t("shortcutSqlView", language)}, ${t("shortcutVisualQueryView", language)}, ${t("shortcutErdView", language)}, ${t("shortcutAdminView", language)}` },
        { key: "⌘B / Ctrl+B", desc: t("shortcutToggleSidebar", language) },
      ],
    },
    {
      group: language === "th" ? "การจัดการและคำสั่ง" : "Actions & Management",
      items: [
        { key: "⌘N / Ctrl+N", desc: t("shortcutCreateTable", language) },
        { key: "⌘O / Ctrl+O", desc: t("shortcutConnections", language) },
        { key: "⌘I / Ctrl+I", desc: t("shortcutImport", language) },
        { key: "⌘L / Ctrl+L", desc: t("shortcutAuditLogs", language) },
        { key: "F5 / ⌘R", desc: t("shortcutRefresh", language) },
        { key: "⌘Shift+D / Ctrl+Shift+D", desc: t("shortcutToggleTheme", language) },
      ],
    },
    {
      group: language === "th" ? "หน้าต่างคำสั่ง SQL" : "SQL & Query",
      items: [
        { key: "⌘Enter / Ctrl+Enter", desc: t("shortcutRunQuery", language) },
        { key: "⌘Shift+F / Ctrl+Shift+F", desc: t("shortcutFormatSql", language) },
        { key: "⌘T / Ctrl+T", desc: t("shortcutNewQuery", language) },
        { key: "Esc", desc: t("shortcutCloseModal", language) },
      ],
    },
  ];

  const handleApplyWindowSize = async (targetW?: number, targetH?: number) => {
    const w = targetW || windowWidth;
    const h = targetH || windowHeight;

    if (w < 800 || h < 550) {
      setDimStatusMsg({ type: "error", text: t("minDimNotice", language) });
      return;
    }

    setSavingDim(true);
    setDimStatusMsg(null);

    try {
      const baseUrl = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
      const res = await fetch(`${baseUrl}/admin/gui-size`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ width: w, height: h }),
      });

      if (res.ok) {
        setWindowWidth(w);
        setWindowHeight(h);
        setDimStatusMsg({ type: "success", text: t("windowSizeUpdated", language) });
        setTimeout(() => setDimStatusMsg(null), 3000);
      } else {
        setDimStatusMsg({ type: "error", text: t("windowSizeFailed", language) });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setDimStatusMsg({ type: "error", text: `Error: ${msg}` });
    } finally {
      setSavingDim(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="modal-header">
          <div className="title-area">
            <div className="title-icon-box">
              <Settings size={17} />
            </div>
            <div className="title-text-group">
              <span className="modal-title">{t("settingsTitle", language)}</span>
              <span className="modal-subtitle">dodb Studio</span>
            </div>
          </div>
          <button className="icon-close-btn" onClick={onClose} title={t("close", language)}>
            <X size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="modal-tabs">
          <button
            className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            <Globe size={14} />
            <span>{t("tabGeneral", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "display" ? "active" : ""}`}
            onClick={() => setActiveTab("display")}
          >
            <Monitor size={14} />
            <span>{t("tabDisplay", language)}</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "shortcuts" ? "active" : ""}`}
            onClick={() => setActiveTab("shortcuts")}
          >
            <Keyboard size={14} />
            <span>{t("tabShortcuts", language)}</span>
          </button>
        </div>

        {/* Modal Body with constant fixed height & clean scroll */}
        <div className="modal-content-area">
          {/* TAB 1: GENERAL */}
          {activeTab === "general" && (
            <div className="tab-content">
              {/* Language Selection */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Globe size={14} className="head-icon" />
                    <span>{t("languageSectionTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("languageSectionDesc", language)}</p>
                </div>

                <div className="options-grid">
                  <button
                    type="button"
                    className={`option-card ${language === "en" ? "active" : ""}`}
                    onClick={() => onChangeLanguage("en")}
                  >
                    <div className="lang-code-badge">EN</div>
                    <div className="option-info">
                      <div className="option-main-label">{t("langEnglish", language)}</div>
                      <div className="option-sub-label">{t("langEnglishSub", language)}</div>
                    </div>
                    {language === "en" && <Check size={15} className="active-check-icon" />}
                  </button>

                  <button
                    type="button"
                    className={`option-card ${language === "th" ? "active" : ""}`}
                    onClick={() => onChangeLanguage("th")}
                  >
                    <div className="lang-code-badge th">TH</div>
                    <div className="option-info">
                      <div className="option-main-label">{t("langThai", language)}</div>
                      <div className="option-sub-label">{t("langThaiSub", language)}</div>
                    </div>
                    {language === "th" && <Check size={15} className="active-check-icon" />}
                  </button>
                </div>
              </div>

              {/* Theme Selection */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Sparkles size={14} className="head-icon" />
                    <span>{t("themeSectionTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("themeSectionDesc", language)}</p>
                </div>

                <div className="options-grid">
                  <button
                    type="button"
                    className={`option-card ${theme === "dark" ? "active" : ""}`}
                    onClick={() => {
                      if (theme !== "dark") onToggleTheme();
                    }}
                  >
                    <div className="theme-preview dark">
                      <Moon size={15} />
                    </div>
                    <div className="option-info">
                      <div className="option-main-label">{t("themeDark", language)}</div>
                      <div className="option-sub-label">{t("themeDarkSub", language)}</div>
                    </div>
                    {theme === "dark" && <Check size={15} className="active-check-icon" />}
                  </button>

                  <button
                    type="button"
                    className={`option-card ${theme === "light" ? "active" : ""}`}
                    onClick={() => {
                      if (theme !== "light") onToggleTheme();
                    }}
                  >
                    <div className="theme-preview light">
                      <Sun size={15} />
                    </div>
                    <div className="option-info">
                      <div className="option-main-label">{t("themeLight", language)}</div>
                      <div className="option-sub-label">{t("themeLightSub", language)}</div>
                    </div>
                    {theme === "light" && <Check size={15} className="active-check-icon" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DISPLAY & WINDOW */}
          {activeTab === "display" && (
            <div className="tab-content">
              {/* UI Scale Section */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <ZoomIn size={14} className="head-icon" />
                    <span>{t("uiScaleTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("uiScaleDesc", language)}</p>
                </div>

                <div className="scale-control-panel">
                  <div className="scale-slider-row">
                    <span className="scale-min">80%</span>
                    <input
                      type="range"
                      min="80"
                      max="130"
                      step="5"
                      value={uiScale}
                      onChange={(e) => onChangeUiScale(Number(e.target.value))}
                      className="scale-slider"
                    />
                    <span className="scale-max">130%</span>
                    <div className="scale-current-badge">{uiScale}%</div>
                  </div>

                  <div className="scale-presets-bar">
                    {scalePresets.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        className={`preset-chip ${uiScale === p.value ? "active" : ""}`}
                        onClick={() => onChangeUiScale(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                    {uiScale !== 100 && (
                      <button
                        type="button"
                        className="reset-scale-btn"
                        onClick={() => onChangeUiScale(100)}
                        title={t("uiScaleReset", language)}
                      >
                        <RotateCcw size={12} />
                        <span>{t("reset", language)}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* GUI Window Dimensions */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Maximize2 size={14} className="head-icon" />
                    <span>{t("windowDimTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("windowDimDesc", language)}</p>
                </div>

                <div className="window-presets-grid">
                  {windowPresets.map((p) => {
                    const isSelected = windowWidth === p.w && windowHeight === p.h;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className={`win-preset-card ${isSelected ? "active" : ""}`}
                        onClick={() => handleApplyWindowSize(p.w, p.h)}
                      >
                        <Sliders size={13} className="win-preset-icon" />
                        <div className="win-preset-info">
                          <span className="win-preset-title">{p.label}</span>
                          <span className="win-preset-dim">{p.w} × {p.h} px</span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="custom-dim-box">
                  <span className="custom-dim-label">{t("customResolution", language)}</span>
                  <div className="custom-inputs-row">
                    <div className="dim-field">
                      <label>{t("widthPx", language)}</label>
                      <input
                        type="number"
                        className="input font-mono"
                        min="800"
                        max="3840"
                        value={windowWidth}
                        onChange={(e) => setWindowWidth(Number(e.target.value))}
                      />
                    </div>
                    <span className="dim-times">×</span>
                    <div className="dim-field">
                      <label>{t("heightPx", language)}</label>
                      <input
                        type="number"
                        className="input font-mono"
                        min="550"
                        max="2160"
                        value={windowHeight}
                        onChange={(e) => setWindowHeight(Number(e.target.value))}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary apply-dim-btn"
                      onClick={() => handleApplyWindowSize()}
                      disabled={savingDim}
                    >
                      <Check size={13} />
                      <span>{t("applySize", language)}</span>
                    </button>
                  </div>
                </div>

                {dimStatusMsg && (
                  <div className={`status-banner ${dimStatusMsg.type}`}>
                    {dimStatusMsg.text}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: SHORTCUTS */}
          {activeTab === "shortcuts" && (
            <div className="tab-content">
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Command size={14} className="head-icon" />
                    <span>{t("shortcutsTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("shortcutsDesc", language)}</p>
                </div>

                <div className="shortcuts-container">
                  {shortcutSections.map((sec, secIdx) => (
                    <div key={secIdx} className="shortcut-group-block">
                      <div className="shortcut-group-title">{sec.group}</div>
                      <div className="shortcuts-table">
                        {sec.items.map((item, idx) => (
                          <div key={idx} className="shortcut-row">
                            <span className="shortcut-desc">{item.desc}</span>
                            <div className="shortcut-keys">
                              {item.key.split(" / ").map((k, kidx) => (
                                <React.Fragment key={kidx}>
                                  {kidx > 0 && <span className="key-separator">/</span>}
                                  <kbd className="key-badge">{k}</kbd>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <div className="footer-meta">dodb Studio • v0.2.3</div>
          <button type="button" className="btn btn-secondary close-btn" onClick={onClose}>
            {t("close", language)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: 16px;
        }

        .settings-modal-card {
          width: 590px;
          height: 530px;
          max-width: 95vw;
          max-height: 86vh;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg, 12px);
          box-shadow: var(--shadow-popup, 0 20px 40px rgba(0,0,0,0.5));
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalAppear 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes modalAppear {
          from {
            opacity: 0;
            transform: scale(0.96) translateY(6px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .modal-header {
          padding: 12px 18px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
        }

        .title-area {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .title-icon-box {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: var(--radius-md, 8px);
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
        }

        .title-text-group {
          display: flex;
          flex-direction: column;
        }

        .modal-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
        }

        .modal-subtitle {
          font-size: 10px;
          color: var(--text-muted);
        }

        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          border-radius: var(--radius-sm, 6px);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .icon-close-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        /* Tabs */
        .modal-tabs {
          display: flex;
          padding: 6px 14px 0 14px;
          background: var(--bg-sidebar);
          border-bottom: 1px solid var(--border-light);
          gap: 4px;
          flex-shrink: 0;
        }

        .tab-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-sub);
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          transition: all 0.15s ease;
          border-radius: 4px 4px 0 0;
        }
        .tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .tab-btn.active {
          color: var(--accent-blue);
          border-bottom-color: var(--accent-blue);
          background: var(--bg-card);
        }

        /* Content Area: Stays flex 1 and scrolls cleanly */
        .modal-content-area {
          padding: 16px 18px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .tab-content {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .setting-section {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .section-head {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .section-head-title {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-main);
        }

        .head-icon {
          color: var(--accent-blue);
        }

        .section-head-desc {
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        /* Options Grid */
        .options-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .option-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--radius-md, 8px);
          border: 1px solid var(--border-light);
          background: var(--bg-secondary, var(--bg-tertiary));
          color: var(--text-main);
          cursor: pointer;
          text-align: left;
          transition: all 0.15s ease;
          position: relative;
        }
        .option-card:hover {
          border-color: var(--border-medium);
          background: var(--bg-hover);
        }
        .option-card.active {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.08);
        }

        .lang-code-badge {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          font-family: var(--font-mono);
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          border: 1px solid rgba(59, 130, 246, 0.25);
          flex-shrink: 0;
        }
        .lang-code-badge.th {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
          border-color: rgba(16, 185, 129, 0.25);
        }

        .theme-preview {
          width: 30px;
          height: 30px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .theme-preview.dark {
          background: #18181b;
          color: #f4f4f5;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .theme-preview.light {
          background: #ffffff;
          color: #18181b;
          border: 1px solid rgba(0, 0, 0, 0.15);
        }

        .option-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-width: 0;
        }

        .option-main-label {
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }

        .option-sub-label {
          font-size: 10px;
          color: var(--text-muted);
        }

        .active-check-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        /* Scale Control */
        .scale-control-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 12px 14px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md, 8px);
        }

        .scale-slider-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .scale-min,
        .scale-max {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-muted);
          font-family: var(--font-mono);
          width: 32px;
        }

        .scale-slider {
          flex: 1;
          height: 6px;
          border-radius: 3px;
          background: var(--border-medium);
          accent-color: var(--accent-blue);
          cursor: pointer;
        }

        .scale-current-badge {
          min-width: 44px;
          text-align: center;
          padding: 3px 8px;
          background: var(--accent-blue);
          color: #ffffff;
          font-size: 11px;
          font-weight: 700;
          font-family: var(--font-mono);
          border-radius: var(--radius-xs, 4px);
        }

        .scale-presets-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .preset-chip {
          padding: 4px 9px;
          font-size: 10.5px;
          font-weight: 500;
          border-radius: var(--radius-sm, 6px);
          background: var(--bg-card);
          color: var(--text-sub);
          border: 1px solid var(--border-light);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .preset-chip:hover {
          color: var(--text-main);
          border-color: var(--border-medium);
        }
        .preset-chip.active {
          background: var(--accent-blue);
          color: #ffffff;
          border-color: var(--accent-blue);
          font-weight: 600;
        }

        .reset-scale-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 9px;
          font-size: 10.5px;
          color: var(--text-muted);
          background: transparent;
          border: 1px dashed var(--border-medium);
          border-radius: var(--radius-sm, 6px);
          cursor: pointer;
          margin-left: auto;
          transition: all 0.12s ease;
        }
        .reset-scale-btn:hover {
          color: var(--text-main);
          border-color: var(--text-muted);
        }

        /* Window Presets */
        .window-presets-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .win-preset-card {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          cursor: pointer;
          transition: all 0.12s ease;
          text-align: left;
        }
        .win-preset-card:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .win-preset-card.active {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.1);
          color: var(--text-main);
        }

        .win-preset-icon {
          color: var(--accent-blue);
        }

        .win-preset-info {
          display: flex;
          flex-direction: column;
        }

        .win-preset-title {
          font-size: 11px;
          font-weight: 600;
        }

        .win-preset-dim {
          font-size: 10px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }

        /* Custom Dimensions */
        .custom-dim-box {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 2px;
        }

        .custom-dim-label {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }

        .custom-inputs-row {
          display: flex;
          align-items: flex-end;
          gap: 8px;
        }

        .dim-field {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dim-field label {
          font-size: 10px;
          color: var(--text-sub);
        }

        .dim-times {
          font-size: 13px;
          color: var(--text-muted);
          padding-bottom: 6px;
        }

        .apply-dim-btn {
          height: 30px;
          white-space: nowrap;
          font-size: 11px;
        }

        .status-banner {
          font-size: 11px;
          padding: 6px 10px;
          border-radius: var(--radius-sm, 6px);
          text-align: center;
        }
        .status-banner.success {
          color: var(--accent-green);
          background: rgba(16, 185, 129, 0.12);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }
        .status-banner.error {
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.12);
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        /* Shortcuts Container */
        .shortcuts-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .shortcut-group-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .shortcut-group-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.5px;
        }

        .shortcuts-table {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md, 8px);
          overflow: hidden;
          background: var(--bg-tertiary);
        }

        .shortcut-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-light);
          gap: 12px;
        }
        .shortcut-row:last-child {
          border-bottom: none;
        }

        .shortcut-desc {
          font-size: 11px;
          color: var(--text-main);
          flex: 1;
        }

        .shortcut-keys {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .key-separator {
          font-size: 10px;
          color: var(--text-muted);
        }

        .key-badge {
          display: inline-block;
          padding: 2px 6px;
          font-size: 10px;
          font-family: var(--font-mono);
          font-weight: 600;
          color: var(--text-main);
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: 4px;
          box-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
        }

        /* Footer */
        .modal-footer {
          padding: 10px 18px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
        }

        .footer-meta {
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }

        .close-btn {
          height: 28px;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
};
