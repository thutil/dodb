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
  Sparkles,
  ZoomIn,
  Keyboard,
  History,
  Trash2,
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
  version?: string;
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
  version = process.env.NEXT_PUBLIC_APP_VERSION || "0.3.6",
}) => {
  const [activeTab, setActiveTab] = useState<"general" | "display" | "shortcuts">("general");

  const [historyLimit, setHistoryLimit] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dodb_sql_history_limit");
        if (saved) return Number(saved) || 100;
      } catch { }
    }
    return 100;
  });

  const [historyRetentionDays, setHistoryRetentionDays] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("dodb_sql_history_retention_days");
        if (saved !== null) return Number(saved);
      } catch { }
    }
    return 14;
  });

  const [historyCleared, setHistoryCleared] = useState(false);

  const handleUpdateHistoryLimit = (limit: number) => {
    setHistoryLimit(limit);
    try {
      localStorage.setItem("dodb_sql_history_limit", String(limit));
    } catch { }
  };

  const handleUpdateRetentionDays = (days: number) => {
    setHistoryRetentionDays(days);
    try {
      localStorage.setItem("dodb_sql_history_retention_days", String(days));
    } catch { }
  };

  const handleClearAllHistory = () => {
    try {
      localStorage.removeItem("dodb_sql_history_v1");
      setHistoryCleared(true);
      setTimeout(() => setHistoryCleared(false), 2500);
    } catch { }
  };

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Top Header */}
        <div className="modal-header">
          <div className="title-area">
            <div className="title-icon-box">
              <Settings size={15} />
            </div>
            <div className="title-text-group">
              <span className="modal-title">{t("settingsTitle", language)}</span>
              <span className="modal-subtitle">dodb Studio Preferences</span>
            </div>
          </div>
          <button className="icon-close-btn" onClick={onClose} title={t("close", language)}>
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation Segmented Bar */}
        <div className="modal-tabs-bar">
          <div className="tabs-segmented">
            <button
              className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
              onClick={() => setActiveTab("general")}
            >
              <Globe size={13} />
              <span>{t("tabGeneral", language)}</span>
            </button>
            <button
              className={`tab-btn ${activeTab === "display" ? "active" : ""}`}
              onClick={() => setActiveTab("display")}
            >
              <Monitor size={13} />
              <span>{t("tabDisplay", language)}</span>
            </button>
            <button
              className={`tab-btn ${activeTab === "shortcuts" ? "active" : ""}`}
              onClick={() => setActiveTab("shortcuts")}
            >
              <Keyboard size={13} />
              <span>{t("tabShortcuts", language)}</span>
            </button>
          </div>
        </div>

        {/* Modal Body Area */}
        <div className="modal-content-area custom-scrollbar">
          {/* TAB 1: GENERAL */}
          {activeTab === "general" && (
            <div className="tab-content">
              {/* Language Selection */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Globe size={13} className="head-icon" />
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
                    <div className="lang-code-badge en">EN</div>
                    <div className="option-info">
                      <div className="option-main-label">{t("langEnglish", language)}</div>
                      <div className="option-sub-label">{t("langEnglishSub", language)}</div>
                    </div>
                    <div className="selection-indicator">
                      {language === "en" ? <Check size={13} className="check-icon" /> : null}
                    </div>
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
                    <div className="selection-indicator">
                      {language === "th" ? <Check size={13} className="check-icon" /> : null}
                    </div>
                  </button>
                </div>
              </div>

              {/* Theme Selection */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Sparkles size={13} className="head-icon" />
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
                      <Moon size={14} />
                    </div>
                    <div className="option-info">
                      <div className="option-main-label">{t("themeDark", language)}</div>
                      <div className="option-sub-label">{t("themeDarkSub", language)}</div>
                    </div>
                    <div className="selection-indicator">
                      {theme === "dark" ? <Check size={13} className="check-icon" /> : null}
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`option-card ${theme === "light" ? "active" : ""}`}
                    onClick={() => {
                      if (theme !== "light") onToggleTheme();
                    }}
                  >
                    <div className="theme-preview light">
                      <Sun size={14} />
                    </div>
                    <div className="option-info">
                      <div className="option-main-label">{t("themeLight", language)}</div>
                      <div className="option-sub-label">{t("themeLightSub", language)}</div>
                    </div>
                    <div className="selection-indicator">
                      {theme === "light" ? <Check size={13} className="check-icon" /> : null}
                    </div>
                  </button>
                </div>
              </div>

              {/* Query Execution History Settings */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <History size={13} className="head-icon" />
                    <span>{t("historySettingsTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("historySettingsDesc", language)}</p>
                </div>

                <div className="history-settings-grid">
                  {/* Max Items Limit */}
                  <div className="history-setting-box">
                    <div className="setting-box-label">
                      <span className="label-title">{t("historyMaxItems", language)}</span>
                    </div>
                    <div className="segmented-selector">
                      {[50, 100, 200, 500].map((num) => (
                        <button
                          key={num}
                          type="button"
                          className={`segmented-choice font-mono ${historyLimit === num ? "active" : ""}`}
                          onClick={() => handleUpdateHistoryLimit(num)}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Retention Duration */}
                  <div className="history-setting-box">
                    <div className="setting-box-label">
                      <span className="label-title">{t("historyRetentionDays", language)}</span>
                    </div>
                    <div className="segmented-selector">
                      {[
                        { days: 7, label: t("historyDays7", language) },
                        { days: 14, label: t("historyDays14", language) },
                        { days: 30, label: t("historyDays30", language) },
                        { days: 0, label: t("historyDaysForever", language) },
                      ].map((item) => (
                        <button
                          key={item.days}
                          type="button"
                          className={`segmented-choice ${historyRetentionDays === item.days ? "active" : ""}`}
                          onClick={() => handleUpdateRetentionDays(item.days)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Clear All History Button */}
                <div className="history-clear-row">
                  <button
                    type="button"
                    className={`btn-clear-history-action ${historyCleared ? "cleared" : ""}`}
                    onClick={handleClearAllHistory}
                  >
                    <Trash2 size={12} />
                    <span>{historyCleared ? t("historyClearSuccess", language) : t("historyClearAll", language)}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DISPLAY (UI Scale Slider & Presets) */}
          {activeTab === "display" && (
            <div className="tab-content">
              {/* UI Scale Section */}
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <ZoomIn size={13} className="head-icon" />
                    <span>{t("uiScaleTitle", language)}</span>
                  </div>
                  <p className="section-head-desc">{t("uiScaleDesc", language)}</p>
                </div>

                <div className="scale-control-panel">
                  <div className="scale-slider-row">
                    <span className="scale-min font-mono">85%</span>
                    <input
                      type="range"
                      min="85"
                      max="125"
                      step="5"
                      value={uiScale}
                      onChange={(e) => onChangeUiScale(Number(e.target.value))}
                      className="scale-slider"
                    />
                    <span className="scale-max font-mono">125%</span>
                    <div className="scale-current-badge font-mono">{uiScale}%</div>
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
                        <RotateCcw size={11} />
                        <span>{t("reset", language)}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SHORTCUTS */}
          {activeTab === "shortcuts" && (
            <div className="tab-content">
              <div className="setting-section">
                <div className="section-head">
                  <div className="section-head-title">
                    <Command size={13} className="head-icon" />
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
                                  <kbd className="key-badge font-mono">{k}</kbd>
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
          <div className="footer-meta font-mono">dodb Studio • v{version}</div>
          <button type="button" className="btn btn-secondary btn-sm close-modal-btn" onClick={onClose}>
            {t("close", language)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 2000;
          padding: 16px;
          animation: fadeIn 0.15s ease-out;
        }

        .settings-modal-card {
          width: 600px;
          max-width: 95vw;
          max-height: 86vh;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg, 12px);
          box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .modal-header {
          padding: 12px 16px;
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
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm, 6px);
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
          border-radius: var(--radius-xs, 4px);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }
        .icon-close-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        /* Segmented Tabs Bar */
        .modal-tabs-bar {
          padding: 8px 16px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
        }

        .tabs-segmented {
          display: flex;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 2.5px;
          border-radius: var(--radius-sm, 6px);
          gap: 3px;
        }

        .tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          background: transparent;
          border: none;
          border-radius: var(--radius-xs, 4px);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .tab-btn:hover {
          color: var(--text-main);
        }

        .tab-btn.active {
          background: var(--bg-card);
          color: var(--accent-blue);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
        }

        /* Content Area */
        .modal-content-area {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: var(--border-medium);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }

        .tab-content {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .setting-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
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
          font-size: 11.5px;
          font-weight: 600;
          color: var(--text-main);
        }

        .head-icon {
          color: var(--accent-blue);
        }

        .section-head-desc {
          font-size: 10px;
          color: var(--text-muted);
          line-height: 1.35;
        }

        /* Options Grid */
        .options-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .option-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: var(--radius-sm, 6px);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-main);
          cursor: pointer;
          text-align: left;
          transition: all 0.12s ease;
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
          width: 28px;
          height: 28px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10.5px;
          font-weight: 700;
          font-family: var(--font-mono);
          flex-shrink: 0;
        }

        .lang-code-badge.en {
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          border: 1px solid rgba(59, 130, 246, 0.25);
        }

        .lang-code-badge.th {
          background: rgba(16, 185, 129, 0.12);
          color: var(--accent-green);
          border: 1px solid rgba(16, 185, 129, 0.25);
        }

        .theme-preview {
          width: 28px;
          height: 28px;
          border-radius: 5px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .theme-preview.dark {
          background: #14171f;
          color: #93c5fd;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .theme-preview.light {
          background: #ffffff;
          color: #d97706;
          border: 1px solid rgba(0, 0, 0, 0.12);
        }

        .option-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
        }

        .option-main-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-main);
        }

        .option-sub-label {
          font-size: 9.5px;
          color: var(--text-muted);
        }

        .selection-indicator {
          width: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .check-icon {
          color: var(--accent-blue);
        }

        /* History Settings Grid & Controls */
        .history-settings-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .history-setting-box {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm, 6px);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .setting-box-label .label-title {
          font-size: 10px;
          font-weight: 600;
          color: var(--text-sub);
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }

        .segmented-selector {
          display: flex;
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          padding: 2px;
          border-radius: var(--radius-xs, 4px);
          gap: 2px;
        }

        .segmented-choice {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 500;
          padding: 4px 6px;
          border-radius: 3px;
          cursor: pointer;
          text-align: center;
          transition: all 0.12s ease;
        }

        .segmented-choice:hover {
          color: var(--text-main);
        }

        .segmented-choice.active {
          background: var(--bg-card);
          color: var(--accent-blue);
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        }

        .history-clear-row {
          display: flex;
          justify-content: flex-end;
          margin-top: 2px;
        }

        .btn-clear-history-action {
          display: flex;
          align-items: center;
          gap: 5px;
          background: transparent;
          border: 1px solid var(--border-light);
          color: var(--text-muted);
          font-size: 10px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: var(--radius-xs, 4px);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .btn-clear-history-action:hover {
          color: var(--accent-red);
          border-color: rgba(239, 68, 68, 0.4);
          background: rgba(239, 68, 68, 0.08);
        }

        .btn-clear-history-action.cleared {
          color: var(--accent-green);
          border-color: rgba(16, 185, 129, 0.4);
          background: rgba(16, 185, 129, 0.08);
        }

        /* Scale Control Panel */
        .scale-control-panel {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm, 6px);
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .scale-slider-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .scale-min,
        .scale-max {
          font-size: 10px;
          color: var(--text-muted);
          min-width: 28px;
        }

        .scale-slider {
          flex: 1;
          accent-color: var(--accent-blue);
          cursor: pointer;
        }

        .scale-current-badge {
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          border: 1px solid rgba(59, 130, 246, 0.25);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          min-width: 38px;
          text-align: center;
        }

        .scale-presets-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }

        .preset-chip {
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          color: var(--text-sub);
          font-size: 10.5px;
          padding: 4px 10px;
          border-radius: var(--radius-xs, 4px);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .preset-chip:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .preset-chip.active {
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          border-color: var(--accent-blue);
          font-weight: 600;
        }

        .reset-scale-btn {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 10px;
          cursor: pointer;
        }

        .reset-scale-btn:hover {
          color: var(--text-main);
        }

        /* Shortcuts Container */
        .shortcuts-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .shortcut-group-block {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm, 6px);
          overflow: hidden;
        }

        .shortcut-group-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-sub);
          background: var(--bg-header);
          padding: 6px 12px;
          border-bottom: 1px solid var(--border-light);
        }

        .shortcuts-table {
          display: flex;
          flex-direction: column;
        }

        .shortcut-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 12px;
          border-bottom: 1px solid var(--border-light);
          font-size: 11px;
        }

        .shortcut-row:last-child {
          border-bottom: none;
        }

        .shortcut-desc {
          color: var(--text-main);
        }

        .shortcut-keys {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .key-separator {
          color: var(--text-muted);
          font-size: 10px;
        }

        .key-badge {
          background: var(--bg-secondary);
          border: 1px solid var(--border-medium);
          color: var(--text-main);
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 4px;
          box-shadow: 0 1px 0 var(--border-medium);
        }

        /* Footer */
        .modal-footer {
          padding: 10px 16px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .footer-meta {
          font-size: 10px;
          color: var(--text-muted);
        }

        .close-modal-btn {
          font-size: 11px;
          padding: 5px 12px;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
};
