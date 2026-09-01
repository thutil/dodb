import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  X,
  Download,
  Printer,
  FileImage,
  Layout,
  RefreshCw,
  BookOpen,
  FileText,
  CheckCircle2,
  Layers,
  Sparkles,
  Info,
} from "lucide-react";
import {
  DiagramExportOptions,
  ExportFormat,
  PaperSize,
  PaperOrientation,
  ExportScope,
  ExportScale,
  ReportType,
  downloadDiagramImage,
  printDiagram,
} from "../utils/diagramExport";
import { Language, t } from "../utils/i18n";

interface ErdExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  flowContainerRef: React.RefObject<HTMLDivElement | null>;
  databaseName: string;
  totalTablesCount: number;
  selectedTablesCount: number;
  selectedTableIds?: Set<string>;
  nodes?: Array<any>;
  edges?: Array<any>;
  theme?: "dark" | "light";
  language?: Language;
}

export const ErdExportModal: React.FC<ErdExportModalProps> = ({
  isOpen,
  onClose,
  flowContainerRef,
  databaseName,
  totalTablesCount,
  selectedTablesCount,
  selectedTableIds,
  nodes,
  edges,
  theme = "dark",
  language = "en",
}) => {
  const activeLanguage = useMemo<Language>(() => {
    if (language) return language;
    if (typeof window !== "undefined") {
      return (localStorage.getItem("dodb_language") as Language) || "en";
    }
    return "en";
  }, [language]);

  const [format, setFormat] = useState<ExportFormat>("print");
  const [reportType, setReportType] = useState<ReportType>("full_report");
  const [paperSize, setPaperSize] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<PaperOrientation>("landscape");
  const [scope, setScope] = useState<ExportScope>(selectedTablesCount > 0 ? "selected" : "all");
  const [scale, setScale] = useState<ExportScale>(2);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Paper Aspect Ratio calculation for preview card
  const previewRatio = useMemo(() => {
    if (paperSize === "Fit") return orientation === "landscape" ? 1.5 : 0.75;
    if (paperSize === "A4" || paperSize === "A3") {
      return orientation === "landscape" ? 1.414 : 1 / 1.414;
    }
    // Letter
    return orientation === "landscape" ? 1.294 : 1 / 1.294;
  }, [paperSize, orientation]);

  const activeCount = scope === "selected" ? selectedTablesCount : totalTablesCount;

  const handleExecuteExport = useCallback(async () => {
    if (!flowContainerRef.current || isExporting) return;
    setIsExporting(true);
    setExportError(null);
    setExportSuccess(null);

    const options: DiagramExportOptions = {
      format,
      paperSize,
      orientation,
      scope,
      scale,
      reportType,
      isTransparent: format === "png" && isTransparent,
      theme,
      databaseName,
      nodesData: nodes,
      edgesData: edges,
    };

    try {
      if (format === "print") {
        await printDiagram(flowContainerRef.current, options, selectedTableIds);
        setExportSuccess(activeLanguage === "th" ? "เปิดหน้าต่างพิมพ์แล้ว" : "Print dialog opened");
        setTimeout(() => {
          onClose();
        }, 800);
      } else {
        const savedPath = await downloadDiagramImage(flowContainerRef.current, options, selectedTableIds);
        if (savedPath) {
          const fileName = savedPath.split("/").pop() || savedPath;
          setExportSuccess(activeLanguage === "th" ? `บันทึกแล้ว: ${fileName}` : `Saved: ${fileName}`);
          setTimeout(() => {
            onClose();
          }, 1200);
        } else {
          // Native save dialog was cancelled by user
          setIsExporting(false);
        }
      }
    } catch (err: any) {
      console.error("Export diagram failed:", err);
      setExportError(err?.message || (activeLanguage === "th" ? "ไม่สามารถส่งออกแผนภาพได้ กรุณาลองใหม่อีกครั้ง" : "Failed to export diagram. Please try again."));
      setIsExporting(false);
    }
  }, [
    flowContainerRef,
    isExporting,
    format,
    paperSize,
    orientation,
    scope,
    scale,
    reportType,
    isTransparent,
    theme,
    databaseName,
    nodes,
    edges,
    selectedTableIds,
    onClose,
  ]);

  // Keyboard accessibility: Escape to close, Cmd+Enter / Ctrl+Enter to export
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (
        (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "Enter" && e.target === document.body)
      ) {
        e.preventDefault();
        handleExecuteExport();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleExecuteExport, onClose]);

  if (!isOpen) return null;

  return (
    <div className="erd-export-modal-backdrop" onClick={onClose}>
      <div className="erd-export-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="icon-badge">
              {format === "print" ? <Printer size={15} /> : <FileImage size={15} />}
            </div>
            <div>
              <h3 className="modal-title">{t("erdExportTitle", activeLanguage)}</h3>
              <p className="modal-sub font-mono">{databaseName}</p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>

        {/* Primary Format Tab Switcher */}
        <div className="format-bar">
          <button
            type="button"
            className={`format-tab-btn ${format === "print" ? "active" : ""}`}
            onClick={() => {
              setFormat("print");
              setExportError(null);
            }}
          >
            <Printer size={13} />
            <span className="tab-text">{t("erdExportTabPrint", activeLanguage)}</span>
            <span className="tab-pill">{t("erdExportPillDocument", activeLanguage)}</span>
          </button>
          <button
            type="button"
            className={`format-tab-btn ${format === "png" ? "active" : ""}`}
            onClick={() => {
              setFormat("png");
              setExportError(null);
            }}
          >
            <FileImage size={13} />
            <span className="tab-text">{t("erdExportTabPng", activeLanguage)}</span>
            <span className="tab-pill">{t("erdExportPillLossless", activeLanguage)}</span>
          </button>
          <button
            type="button"
            className={`format-tab-btn ${format === "jpg" ? "active" : ""}`}
            onClick={() => {
              setFormat("jpg");
              setExportError(null);
            }}
          >
            <FileImage size={13} />
            <span className="tab-text">{t("erdExportTabJpg", activeLanguage)}</span>
            <span className="tab-pill">{t("erdExportPillCompact", activeLanguage)}</span>
          </button>
        </div>

        {/* Modal Body: Stable Height 2-Column Balanced Layout */}
        <div className="modal-body">
          {/* Left Column: Contextual Settings */}
          <div className="settings-column">
            {format === "print" ? (
              /* Settings for Print / PDF Report */
              <>
                {/* 1. Report Mode Selection */}
                <div className="option-section">
                  <label className="section-label">{t("erdExportContentLabel", activeLanguage)}</label>
                  <div className="report-types-grid">
                    <div
                      className={`report-card ${reportType === "full_report" ? "is-selected" : ""}`}
                      onClick={() => setReportType("full_report")}
                    >
                      <div className="report-card-top">
                        <BookOpen size={13} className="report-icon" />
                        <span className="report-badge">{t("erdExportRecommended", activeLanguage)}</span>
                      </div>
                      <span className="report-card-title">{t("erdExportFullReport", activeLanguage)}</span>
                      <span className="report-card-desc">{t("erdExportFullReportDesc", activeLanguage)}</span>
                    </div>

                    <div
                      className={`report-card ${reportType === "diagram_only" ? "is-selected" : ""}`}
                      onClick={() => setReportType("diagram_only")}
                    >
                      <div className="report-card-top">
                        <FileImage size={13} className="report-icon" />
                      </div>
                      <span className="report-card-title">{t("erdExportDiagramOnly", activeLanguage)}</span>
                      <span className="report-card-desc">{t("erdExportDiagramOnlyDesc", activeLanguage)}</span>
                    </div>

                    <div
                      className={`report-card ${reportType === "dictionary_only" ? "is-selected" : ""}`}
                      onClick={() => setReportType("dictionary_only")}
                    >
                      <div className="report-card-top">
                        <FileText size={13} className="report-icon" />
                      </div>
                      <span className="report-card-title">{t("erdExportDictionaryOnly", activeLanguage)}</span>
                      <span className="report-card-desc">{t("erdExportDictionaryOnlyDesc", activeLanguage)}</span>
                    </div>
                  </div>
                </div>

                {/* 2. Paper Size & Orientation */}
                <div className="form-grid-row">
                  <div className="option-section flex-1">
                    <label className="section-label">{t("erdExportPaperSize", activeLanguage)}</label>
                    <select
                      value={paperSize}
                      onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                      className="input-select font-mono"
                    >
                      <option value="A4">A4 (210 × 297 mm)</option>
                      <option value="A3">A3 (297 × 420 mm)</option>
                      <option value="Letter">US Letter (8.5 × 11 in)</option>
                      <option value="Fit">{activeLanguage === "th" ? "พอดีกับเนื้อหา (อัตโนมัติ)" : "Fit to Content (Auto)"}</option>
                    </select>
                  </div>

                  <div className="option-section flex-1">
                    <label className="section-label">{t("erdExportOrientation", activeLanguage)}</label>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className={`segment-btn ${orientation === "landscape" ? "active" : ""}`}
                        onClick={() => setOrientation("landscape")}
                      >
                        <Layout size={13} />
                        <span>{t("erdExportLandscape", activeLanguage)}</span>
                      </button>
                      <button
                        type="button"
                        className={`segment-btn ${orientation === "portrait" ? "active" : ""}`}
                        onClick={() => setOrientation("portrait")}
                      >
                        <Layout size={13} className="rotate-90" />
                        <span>{t("erdExportPortrait", activeLanguage)}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Diagram Scope Selection */}
                <div className="option-section">
                  <label className="section-label">{t("erdExportScope", activeLanguage)}</label>
                  <div className="scope-cards-grid">
                    <div
                      className={`scope-card ${scope === "all" ? "is-selected" : ""}`}
                      onClick={() => setScope("all")}
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportAllTables", activeLanguage)}</span>
                        <span className="scope-desc font-mono">{totalTablesCount} {activeLanguage === "th" ? "ตาราง" : "tables"}</span>
                      </div>
                    </div>

                    <div
                      className={`scope-card ${scope === "selected" ? "is-selected" : ""} ${
                        selectedTablesCount === 0 ? "is-disabled" : ""
                      }`}
                      onClick={() => {
                        if (selectedTablesCount > 0) setScope("selected");
                      }}
                      title={
                        selectedTablesCount === 0
                          ? t("erdExportSelectHint", activeLanguage)
                          : ""
                      }
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportSelectedOnly", activeLanguage)}</span>
                        <span className="scope-desc font-mono">
                          {selectedTablesCount > 0
                            ? (activeLanguage === "th" ? `เลือกอยู่ ${selectedTablesCount} ตาราง` : `${selectedTablesCount} selected`)
                            : (activeLanguage === "th" ? "ยังไม่ได้เลือก" : "0 selected")}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`scope-card ${scope === "viewport" ? "is-selected" : ""}`}
                      onClick={() => setScope("viewport")}
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportViewport", activeLanguage)}</span>
                        <span className="scope-desc font-mono">{t("erdExportVisibleArea", activeLanguage)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* Settings for Image Export (PNG / JPG) */
              <>
                {/* 1. Diagram Scope Selection */}
                <div className="option-section">
                  <label className="section-label">{t("erdExportScope", activeLanguage)}</label>
                  <div className="scope-cards-grid">
                    <div
                      className={`scope-card ${scope === "all" ? "is-selected" : ""}`}
                      onClick={() => setScope("all")}
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportAllTables", activeLanguage)}</span>
                        <span className="scope-desc font-mono">{totalTablesCount} {activeLanguage === "th" ? "ตาราง" : "tables"}</span>
                      </div>
                    </div>

                    <div
                      className={`scope-card ${scope === "selected" ? "is-selected" : ""} ${
                        selectedTablesCount === 0 ? "is-disabled" : ""
                      }`}
                      onClick={() => {
                        if (selectedTablesCount > 0) setScope("selected");
                      }}
                      title={
                        selectedTablesCount === 0
                          ? t("erdExportSelectHint", activeLanguage)
                          : ""
                      }
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportSelectedOnly", activeLanguage)}</span>
                        <span className="scope-desc font-mono">
                          {selectedTablesCount > 0
                            ? (activeLanguage === "th" ? `เลือกอยู่ ${selectedTablesCount} ตาราง` : `${selectedTablesCount} selected`)
                            : (activeLanguage === "th" ? "ยังไม่ได้เลือก" : "0 selected")}
                        </span>
                      </div>
                    </div>

                    <div
                      className={`scope-card ${scope === "viewport" ? "is-selected" : ""}`}
                      onClick={() => setScope("viewport")}
                    >
                      <div className="scope-radio">
                        <div className="radio-dot" />
                      </div>
                      <div className="scope-info">
                        <span className="scope-title">{t("erdExportViewport", activeLanguage)}</span>
                        <span className="scope-desc font-mono">{t("erdExportVisibleArea", activeLanguage)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Resolution Scale */}
                <div className="option-section">
                  <label className="section-label">{t("erdExportResolution", activeLanguage)}</label>
                  <div className="segmented-control">
                    <button
                      type="button"
                      className={`segment-btn ${scale === 1 ? "active" : ""}`}
                      onClick={() => setScale(1)}
                    >
                      <span>1x ({activeLanguage === "th" ? "มาตรฐาน" : "96 DPI"})</span>
                    </button>
                    <button
                      type="button"
                      className={`segment-btn ${scale === 2 ? "active" : ""}`}
                      onClick={() => setScale(2)}
                    >
                      <Sparkles size={11} />
                      <span>2x ({activeLanguage === "th" ? "คมชัดสูง" : "High DPI"})</span>
                    </button>
                    <button
                      type="button"
                      className={`segment-btn ${scale === 3 ? "active" : ""}`}
                      onClick={() => setScale(3)}
                    >
                      <span>3x ({activeLanguage === "th" ? "ละเอียดพิเศษ" : "Ultra Crisp"})</span>
                    </button>
                  </div>
                </div>

                {/* 3. Background Style (PNG Only) */}
                {format === "png" ? (
                  <div className="option-section">
                    <label className="section-label">{t("erdExportBackground", activeLanguage)}</label>
                    <div className="segmented-control">
                      <button
                        type="button"
                        className={`segment-btn ${!isTransparent ? "active" : ""}`}
                        onClick={() => setIsTransparent(false)}
                      >
                        <span>{t("erdExportSolidTheme", activeLanguage)}</span>
                      </button>
                      <button
                        type="button"
                        className={`segment-btn ${isTransparent ? "active" : ""}`}
                        onClick={() => setIsTransparent(true)}
                      >
                        <Sparkles size={11} />
                        <span>{t("erdExportTransparent", activeLanguage)}</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="option-section">
                    <label className="section-label">{t("erdExportQualityCompression", activeLanguage)}</label>
                    <div className="info-banner">
                      <Info size={13} className="info-icon" />
                      <span>{t("erdExportJpgTip", activeLanguage)}</span>
                    </div>
                  </div>
                )}

                {/* 4. Asset Guide Card */}
                <div className="asset-tip-card font-mono">
                  {format === "png" && isTransparent ? (
                    <span>
                      {t("erdExportPngTransTip", activeLanguage)}
                    </span>
                  ) : (
                    <span>
                      {t("erdExportPngSolidTip", activeLanguage, { theme })}
                    </span>
                  )}
                </div>
              </>
            )}

            {exportError && <div className="error-banner font-mono">{exportError}</div>}
          </div>

          {/* Right Column: Live Responsive Visual Preview */}
          <div className="preview-column">
            <div className="preview-header">
              <label className="section-label">{t("erdExportLivePreview", activeLanguage)}</label>
              <span className="preview-badge font-mono">
                {format === "print"
                  ? `${paperSize} • ${orientation.toUpperCase()}`
                  : `${format.toUpperCase()} • ${scale}x`}
              </span>
            </div>

            <div className="paper-preview-canvas">
              {format === "print" && reportType === "full_report" ? (
                <div className="multi-page-preview-wrapper">
                  {/* Page 1: ERD Diagram */}
                  <div
                    className="paper-sheet page-1-preview"
                    style={{
                      aspectRatio: `${previewRatio}`,
                      maxHeight: orientation === "portrait" ? "120px" : "98px",
                    }}
                  >
                    <div className="preview-header-line">
                      <div className="preview-dot" />
                      <div className="preview-line" />
                    </div>
                    <div className="paper-inner-diagram">
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                    </div>
                    <div className="paper-label-pill font-mono">{t("erdExportPage1Label", activeLanguage)}</div>
                  </div>

                  {/* Page 2: Data Dictionary */}
                  <div
                    className="paper-sheet page-2-preview"
                    style={{
                      aspectRatio: `${previewRatio}`,
                      maxHeight: orientation === "portrait" ? "120px" : "98px",
                    }}
                  >
                    <div className="preview-header-line">
                      <div className="preview-dot" />
                      <div className="preview-line" />
                    </div>
                    <div className="dictionary-sketch-lines">
                      <div className="sketch-tbl-row" />
                      <div className="sketch-tbl-row" />
                      <div className="sketch-tbl-row" />
                    </div>
                    <div className="paper-label-pill font-mono">{t("erdExportPage2Label", activeLanguage)}</div>
                  </div>
                </div>
              ) : format === "print" ? (
                <div
                  className="paper-sheet single-page-preview"
                  style={{
                    aspectRatio: `${previewRatio}`,
                    maxHeight: orientation === "portrait" ? "210px" : "165px",
                    maxWidth: orientation === "landscape" ? "230px" : "160px",
                  }}
                >
                  <div className="preview-header-line">
                    <div className="preview-dot" />
                    <div className="preview-line" />
                  </div>
                  {reportType === "diagram_only" ? (
                    <div className="paper-inner-diagram">
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                    </div>
                  ) : (
                    <div className="dictionary-sketch-lines">
                      <div className="sketch-tbl-row" />
                      <div className="sketch-tbl-row" />
                      <div className="sketch-tbl-row" />
                    </div>
                  )}
                  <div className="paper-label-pill font-mono">
                    {reportType === "diagram_only"
                      ? (activeLanguage === "th" ? "แผนภาพ ERD" : "ERD DIAGRAM")
                      : (activeLanguage === "th" ? "พจนานุกรมข้อมูล" : "DATA DICTIONARY")}
                  </div>
                </div>
              ) : (
                /* Image Export Live Preview (PNG / JPG) */
                <div
                  className={`paper-sheet image-preview-sheet ${
                    isTransparent && format === "png" ? "is-transparent-sheet" : theme === "dark" ? "is-dark-sheet" : "is-light-sheet"
                  }`}
                  style={{
                    aspectRatio: "1.45",
                    maxHeight: "170px",
                    maxWidth: "230px",
                  }}
                >
                  <div className="paper-inner-diagram">
                    <div className="diagram-sketch-box-themed" />
                    <div className="diagram-sketch-box-themed" />
                    <div className="diagram-sketch-box-themed" />
                  </div>
                  <div className="paper-label-pill font-mono">
                    {isTransparent && format === "png"
                      ? (activeLanguage === "th" ? "PNG โปร่งใส" : "TRANSPARENT PNG")
                      : `${format.toUpperCase()} (${scale}x)`}
                  </div>
                </div>
              )}
            </div>

            {/* Live Specifications Footer in Preview */}
            <div className="preview-spec-card font-mono">
              <div className="spec-item">
                <span className="spec-key">{activeLanguage === "th" ? "ฐานข้อมูล" : "DATABASE"}</span>
                <span className="spec-val" title={databaseName}>{databaseName}</span>
              </div>
              <div className="spec-item">
                <span className="spec-key">{activeLanguage === "th" ? "ขอบเขต" : "SCOPE"}</span>
                <span className="spec-val">
                  <Layers size={10} />
                  {activeCount} {activeLanguage === "th" ? "ตาราง" : activeCount === 1 ? "table" : "tables"}
                </span>
              </div>
              <div className="spec-item">
                <span className="spec-key">{activeLanguage === "th" ? "ผลลัพธ์" : "OUTPUT"}</span>
                <span className="spec-val">
                  {format === "print"
                    ? `${paperSize} ${orientation}`
                    : `${format.toUpperCase()} @ ${scale}x scale`}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClose}
            disabled={isExporting}
          >
            {t("erdExportCancel", activeLanguage)}
          </button>
          <button
            type="button"
            className={`btn btn-primary btn-sm export-submit-btn ${exportSuccess ? "btn-success" : ""}`}
            onClick={handleExecuteExport}
            disabled={isExporting || (scope === "selected" && selectedTablesCount === 0)}
          >
            {isExporting ? (
              <>
                <RefreshCw size={13} className="spin" />
                <span>{format === "print" ? t("erdExportPreparingPrint", activeLanguage) : t("erdExportSavingFile", activeLanguage)}</span>
              </>
            ) : exportSuccess ? (
              <>
                <CheckCircle2 size={13} />
                <span>{exportSuccess}</span>
              </>
            ) : format === "print" ? (
              <>
                <Printer size={13} />
                <span>{t("erdExportOpenPrint", activeLanguage, { count: activeCount })}</span>
              </>
            ) : (
              <>
                <Download size={13} />
                <span>{t("erdExportSaveImage", activeLanguage, { format: format.toUpperCase(), count: activeCount })}</span>
              </>
            )}
          </button>
        </div>
      </div>

      <style jsx>{`
        .erd-export-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          animation: fadeIn 0.15s ease-out;
        }

        .erd-export-modal {
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          width: 820px;
          max-width: 95vw;
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .modal-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-header);
        }

        .modal-title-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .icon-badge {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-sm);
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .modal-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0;
        }

        .modal-sub {
          font-size: 10.5px;
          color: var(--text-muted);
          margin: 0;
        }

        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 6px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.12s ease;
        }

        .close-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
        }

        /* Format Tabs Bar */
        .format-bar {
          display: flex;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          padding: 4px 14px;
          gap: 6px;
        }

        .format-tab-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 7px 12px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          cursor: pointer;
          font-size: 11.5px;
          font-weight: 500;
          transition: all 0.14s ease;
        }

        .format-tab-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .format-tab-btn.active {
          background: var(--bg-card);
          color: var(--accent-blue);
          border-color: var(--border-light);
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .tab-text {
          white-space: nowrap;
        }

        .tab-pill {
          font-size: 8px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.4px;
          padding: 1.5px 5px;
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.06);
          color: var(--text-muted);
        }

        .format-tab-btn.active .tab-pill {
          background: rgba(59, 130, 246, 0.12);
          color: var(--accent-blue);
        }

        /* Modal Body: Stable Height Layout */
        .modal-body {
          display: grid;
          grid-template-columns: 1fr 270px;
          padding: 16px 18px;
          gap: 18px;
          min-height: 470px;
          max-height: 72vh;
          overflow-y: auto;
        }

        .settings-column {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 440px;
        }

        .option-section {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .section-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-sub);
          text-transform: uppercase;
          letter-spacing: 0.6px;
        }

        .report-types-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .report-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 3px;
          transition: all 0.15s ease;
        }

        .report-card:hover {
          border-color: var(--accent-blue);
          background: var(--bg-hover);
        }

        .report-card.is-selected {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.08);
        }

        .report-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .report-icon {
          color: var(--accent-blue);
        }

        .report-badge {
          font-size: 8px;
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          padding: 1px 4px;
          border-radius: 6px;
          font-weight: 600;
        }

        .report-card-title {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-main);
        }

        .report-card-desc {
          font-size: 9px;
          color: var(--text-muted);
          line-height: 1.25;
        }

        .segmented-control {
          display: flex;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 2.5px;
          border-radius: var(--radius-sm);
          gap: 2px;
        }

        .segment-btn {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text-muted);
          padding: 5px 8px;
          font-size: 11px;
          font-weight: 500;
          border-radius: var(--radius-xs);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          transition: all 0.12s ease;
        }

        .segment-btn:hover {
          color: var(--text-main);
        }

        .segment-btn.active {
          background: var(--bg-card);
          color: var(--accent-blue);
          font-weight: 600;
          box-shadow: var(--shadow-sm);
        }

        .form-grid-row {
          display: flex;
          gap: 10px;
        }

        .flex-1 {
          flex: 1;
        }

        .input-select {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          color: var(--text-main);
          font-size: 11px;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          outline: none;
          cursor: pointer;
          width: 100%;
        }

        .scope-cards-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
        }

        .scope-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 3px;
          transition: all 0.15s ease;
        }

        .scope-card:hover {
          border-color: var(--accent-blue);
          background: var(--bg-hover);
        }

        .scope-card.is-selected {
          border-color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.08);
        }

        .scope-card.is-disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .scope-radio {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 1.5px solid var(--border-medium);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .scope-card.is-selected .scope-radio {
          border-color: var(--accent-blue);
        }

        .radio-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: transparent;
        }

        .scope-card.is-selected .radio-dot {
          background: var(--accent-blue);
        }

        .scope-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .scope-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-main);
        }

        .scope-desc {
          font-size: 9px;
          color: var(--text-muted);
        }

        .info-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(59, 130, 246, 0.06);
          border: 1px solid rgba(59, 130, 246, 0.18);
          border-radius: var(--radius-xs);
          padding: 6px 9px;
          font-size: 10.5px;
          color: var(--text-sub);
        }

        .info-icon {
          color: var(--accent-blue);
          flex-shrink: 0;
        }

        .asset-tip-card {
          margin-top: auto;
          background: rgba(59, 130, 246, 0.06);
          border: 1px solid rgba(59, 130, 246, 0.16);
          padding: 8px 10px;
          border-radius: var(--radius-sm);
          font-size: 10px;
          color: var(--accent-blue);
          line-height: 1.4;
        }

        .error-banner {
          font-size: 11px;
          color: var(--accent-red);
          background: rgba(239, 68, 68, 0.1);
          padding: 6px 10px;
          border-radius: var(--radius-xs);
          border: 1px solid rgba(239, 68, 68, 0.25);
        }

        /* Right Preview Column */
        .preview-column {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 440px;
        }

        .preview-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .preview-badge {
          font-size: 8.5px;
          font-weight: 700;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
        }

        .paper-preview-canvas {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
          min-height: 220px;
          padding: 12px;
          position: relative;
          overflow: hidden;
        }

        .multi-page-preview-wrapper {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          align-items: center;
        }

        .paper-sheet {
          background: #ffffff;
          border-radius: 4px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          width: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 8px 10px;
          position: relative;
          transition: all 0.2s ease;
        }

        .image-preview-sheet.is-dark-sheet {
          background: #14171f;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .image-preview-sheet.is-light-sheet {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
        }

        .paper-sheet.is-transparent-sheet {
          background: repeating-conic-gradient(#cbd5e1 0% 25%, #f1f5f9 0% 50%) 50% / 14px 14px !important;
          box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        }

        .preview-header-line {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-bottom: 4px;
        }

        .preview-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #3b82f6;
        }

        .preview-line {
          height: 2px;
          width: 40px;
          background: #cbd5e1;
          border-radius: 1px;
        }

        .paper-inner-diagram {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          flex: 1;
          align-items: center;
          justify-content: center;
          opacity: 0.85;
          padding: 6px 0;
        }

        .diagram-sketch-box {
          width: 34px;
          height: 20px;
          border: 1px solid #94a3b8;
          border-radius: 2px;
          background: #f8fafc;
        }

        .diagram-sketch-box-themed {
          width: 38px;
          height: 22px;
          border: 1px solid var(--accent-blue);
          border-radius: 3px;
          background: rgba(59, 130, 246, 0.12);
        }

        .dictionary-sketch-lines {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 4px 0;
          opacity: 0.85;
        }

        .sketch-tbl-row {
          height: 3px;
          background: #cbd5e1;
          border-radius: 1px;
        }

        .paper-label-pill {
          font-size: 8px;
          color: #475569;
          background: #f1f5f9;
          padding: 2px 5px;
          border-radius: 3px;
          text-align: center;
          margin-top: 4px;
          font-weight: 600;
        }

        .is-dark-sheet .paper-label-pill {
          background: rgba(255, 255, 255, 0.12);
          color: #cbd5e1;
        }

        /* Live Specifications Footer in Preview */
        .preview-spec-card {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .spec-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 9.5px;
        }

        .spec-key {
          color: var(--text-muted);
          font-weight: 600;
          letter-spacing: 0.3px;
        }

        .spec-val {
          color: var(--text-main);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 4px;
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Footer */
        .modal-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          background: var(--bg-header);
        }

        .export-submit-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 14px;
          font-weight: 600;
          font-size: 11.5px;
          transition: all 0.15s ease;
        }

        .btn-success {
          background: #10b981 !important;
          border-color: #10b981 !important;
          color: #ffffff !important;
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
