import React, { useState, useMemo } from "react";
import {
  X,
  Download,
  Printer,
  FileImage,
  Layout,
  RefreshCw,
  BookOpen,
  FileText,
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
}) => {
  const [format, setFormat] = useState<ExportFormat>("print");
  const [reportType, setReportType] = useState<ReportType>("full_report");
  const [paperSize, setPaperSize] = useState<PaperSize>("A4");
  const [orientation, setOrientation] = useState<PaperOrientation>("landscape");
  const [scope, setScope] = useState<ExportScope>(selectedTablesCount > 0 ? "selected" : "all");
  const [scale, setScale] = useState<ExportScale>(2);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
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

  if (!isOpen) return null;

  const handleExecuteExport = async () => {
    if (!flowContainerRef.current) return;
    setIsExporting(true);
    setExportError(null);

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
      } else {
        await downloadDiagramImage(flowContainerRef.current, options, selectedTableIds);
      }
      onClose();
    } catch (err: any) {
      console.error("Export diagram failed:", err);
      setExportError(err?.message || "Failed to export diagram. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const activeCount = scope === "selected" ? selectedTablesCount : totalTablesCount;

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
              <h3 className="modal-title">Export &amp; Print Schema Report</h3>
              <p className="modal-sub font-mono">{databaseName}</p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        {/* Modal Body: 2-Column Balanced Layout */}
        <div className="modal-body">
          {/* Left: Options Settings */}
          <div className="settings-column">
            {/* 1. Report Mode Selection */}
            <div className="option-section">
              <label className="section-label">Report Content</label>
              <div className="report-types-grid">
                <div
                  className={`report-card ${reportType === "full_report" ? "is-selected" : ""}`}
                  onClick={() => setReportType("full_report")}
                >
                  <div className="report-card-top">
                    <BookOpen size={13} className="report-icon" />
                    <span className="report-badge">Recommended</span>
                  </div>
                  <span className="report-card-title">2-Page Full Report</span>
                  <span className="report-card-desc">Page 1: ERD &bull; Page 2: Dictionary</span>
                </div>

                <div
                  className={`report-card ${reportType === "diagram_only" ? "is-selected" : ""}`}
                  onClick={() => setReportType("diagram_only")}
                >
                  <div className="report-card-top">
                    <FileImage size={13} className="report-icon" />
                  </div>
                  <span className="report-card-title">ERD Diagram Only</span>
                  <span className="report-card-desc">Visual schema diagram</span>
                </div>

                <div
                  className={`report-card ${reportType === "dictionary_only" ? "is-selected" : ""}`}
                  onClick={() => setReportType("dictionary_only")}
                >
                  <div className="report-card-top">
                    <FileText size={13} className="report-icon" />
                  </div>
                  <span className="report-card-title">Data Dictionary Only</span>
                  <span className="report-card-desc">Tables &amp; foreign keys</span>
                </div>
              </div>
            </div>

            {/* 2. Output Format */}
            <div className="option-section">
              <label className="section-label">Output Format</label>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segment-btn ${format === "print" ? "active" : ""}`}
                  onClick={() => setFormat("print")}
                >
                  <Printer size={13} />
                  <span>Print / PDF</span>
                </button>
                <button
                  type="button"
                  className={`segment-btn ${format === "png" ? "active" : ""}`}
                  onClick={() => setFormat("png")}
                >
                  <FileImage size={13} />
                  <span>PNG Image</span>
                </button>
                <button
                  type="button"
                  className={`segment-btn ${format === "jpg" ? "active" : ""}`}
                  onClick={() => setFormat("jpg")}
                >
                  <FileImage size={13} />
                  <span>JPG Image</span>
                </button>
              </div>
            </div>

            {/* 3. Paper Size & Orientation */}
            <div className="form-grid-row">
              <div className="option-section flex-1">
                <label className="section-label">Paper Size</label>
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                  className="input-select font-mono"
                >
                  <option value="A4">A4 (210 × 297 mm)</option>
                  <option value="A3">A3 (297 × 420 mm)</option>
                  <option value="Letter">US Letter (8.5 × 11 in)</option>
                  <option value="Fit">Fit to Content (Auto)</option>
                </select>
              </div>

              <div className="option-section flex-1">
                <label className="section-label">Orientation</label>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={`segment-btn ${orientation === "landscape" ? "active" : ""}`}
                    onClick={() => setOrientation("landscape")}
                  >
                    <Layout size={13} />
                    <span>Landscape</span>
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${orientation === "portrait" ? "active" : ""}`}
                    onClick={() => setOrientation("portrait")}
                  >
                    <Layout size={13} className="rotate-90" />
                    <span>Portrait</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 4. Diagram Scope Selection */}
            <div className="option-section">
              <label className="section-label">Diagram Scope</label>
              <div className="scope-cards-grid">
                <div
                  className={`scope-card ${scope === "all" ? "is-selected" : ""}`}
                  onClick={() => setScope("all")}
                >
                  <div className="scope-radio">
                    <div className="radio-dot" />
                  </div>
                  <div className="scope-info">
                    <span className="scope-title">All Tables</span>
                    <span className="scope-desc font-mono">{totalTablesCount} tables</span>
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
                      ? "Select tables on canvas (Click / Shift+Click) or sidebar (Cmd+Click)"
                      : ""
                  }
                >
                  <div className="scope-radio">
                    <div className="radio-dot" />
                  </div>
                  <div className="scope-info">
                    <span className="scope-title">Selected Only</span>
                    <span className="scope-desc font-mono">
                      {selectedTablesCount > 0
                        ? `${selectedTablesCount} selected`
                        : "0 selected (Cmd+Click)"}
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
                    <span className="scope-title">Current Viewport</span>
                    <span className="scope-desc font-mono">Visible screen</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 5. PNG Transparency Options */}
            {format === "png" && (
              <div className="option-section">
                <label className="section-label">Background Style</label>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={`segment-btn ${!isTransparent ? "active" : ""}`}
                    onClick={() => setIsTransparent(false)}
                  >
                    <span>Solid Background</span>
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${isTransparent ? "active" : ""}`}
                    onClick={() => setIsTransparent(true)}
                  >
                    <span>Transparent (No Watermark)</span>
                  </button>
                </div>
                {isTransparent && (
                  <span className="transparent-hint font-mono">
                    ✓ Clean asset: No background, grid, title banner, or watermark text.
                  </span>
                )}
              </div>
            )}

            {/* 6. Resolution Scale */}
            {format !== "print" && (
              <div className="option-section">
                <label className="section-label">Resolution Scale</label>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={`segment-btn ${scale === 1 ? "active" : ""}`}
                    onClick={() => setScale(1)}
                  >
                    <span>1x (96 DPI)</span>
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${scale === 2 ? "active" : ""}`}
                    onClick={() => setScale(2)}
                  >
                    <span>2x (High DPI)</span>
                  </button>
                  <button
                    type="button"
                    className={`segment-btn ${scale === 3 ? "active" : ""}`}
                    onClick={() => setScale(3)}
                  >
                    <span>3x (Ultra Crisp)</span>
                  </button>
                </div>
              </div>
            )}

            {exportError && <div className="error-banner font-mono">{exportError}</div>}
          </div>

          {/* Right: Paper Visual Live Preview */}
          <div className="preview-column">
            <label className="section-label">Report Preview</label>
            <div className="paper-preview-canvas">
              {reportType === "full_report" ? (
                <div className="multi-page-preview-wrapper">
                  {/* Page 1 Preview */}
                  <div
                    className={`paper-sheet page-1-preview ${
                      isTransparent && format === "png" ? "is-transparent-sheet" : ""
                    }`}
                    style={{
                      aspectRatio: `${previewRatio}`,
                      maxHeight: orientation === "portrait" ? "125px" : "105px",
                    }}
                  >
                    {!isTransparent && (
                      <div className="preview-header-line">
                        <div className="preview-dot" />
                        <div className="preview-line" />
                      </div>
                    )}
                    <div className="paper-inner-diagram">
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                      <div className="diagram-sketch-box" />
                    </div>
                    <div className="paper-label-pill font-mono">Page 1 &bull; ERD Diagram</div>
                  </div>

                  {/* Page 2 Preview */}
                  <div
                    className="paper-sheet page-2-preview"
                    style={{
                      aspectRatio: `${previewRatio}`,
                      maxHeight: orientation === "portrait" ? "125px" : "105px",
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
                    <div className="paper-label-pill font-mono">Page 2 &bull; Data Dictionary</div>
                  </div>
                </div>
              ) : (
                <div
                  className={`paper-sheet ${
                    isTransparent && format === "png" ? "is-transparent-sheet" : ""
                  }`}
                  style={{
                    aspectRatio: `${previewRatio}`,
                    maxHeight: orientation === "portrait" ? "210px" : "175px",
                    maxWidth: orientation === "landscape" ? "240px" : "170px",
                  }}
                >
                  {!isTransparent && (
                    <div className="preview-header-line">
                      <div className="preview-dot" />
                      <div className="preview-line" />
                    </div>
                  )}
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
                    {isTransparent && format === "png"
                      ? "TRANSPARENT PNG"
                      : `${paperSize} • ${orientation.toUpperCase()}`}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm export-submit-btn"
            onClick={handleExecuteExport}
            disabled={isExporting || (scope === "selected" && selectedTablesCount === 0)}
          >
            {isExporting ? (
              <>
                <RefreshCw size={13} className="spin" />
                <span>Generating Report...</span>
              </>
            ) : format === "print" ? (
              <>
                <Printer size={13} />
                <span>Open Print / PDF ({activeCount} tables)</span>
              </>
            ) : (
              <>
                <Download size={13} />
                <span>Download {format.toUpperCase()} ({activeCount} tables)</span>
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
          width: 800px;
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

        .modal-body {
          display: grid;
          grid-template-columns: 1fr 260px;
          padding: 16px 18px;
          gap: 18px;
          max-height: 72vh;
          overflow-y: auto;
        }

        .settings-column {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .option-section {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .section-label {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--text-sub);
          text-transform: uppercase;
          letter-spacing: 0.5px;
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
          opacity: 0.5;
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

        .transparent-hint {
          font-size: 9.5px;
          color: var(--accent-blue);
          background: rgba(59, 130, 246, 0.08);
          padding: 4px 8px;
          border-radius: var(--radius-xs);
          border: 1px solid rgba(59, 130, 246, 0.2);
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

        .paper-sheet.is-transparent-sheet {
          background: repeating-conic-gradient(#e2e8f0 0% 25%, #ffffff 0% 50%) 50% / 14px 14px !important;
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
        }

        .diagram-sketch-box {
          width: 34px;
          height: 20px;
          border: 1px solid #94a3b8;
          border-radius: 2px;
          background: #f8fafc;
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
          padding: 6px 12px;
          font-weight: 600;
          font-size: 11.5px;
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
