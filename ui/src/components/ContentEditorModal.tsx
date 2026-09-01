import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import {
  X,
  Maximize2,
  Minimize2,
  Check,
  FileText,
  Eye,
  Columns,
  Sparkles,
  AlignLeft,
  WrapText,
  Copy,
} from "lucide-react";
import { ContentType, detectContentType, getContentInfo } from "../utils/contentDetection";

export interface ContentEditorData {
  title: string;
  subtitle?: string;
  colName: string;
  colType?: string;
  value: unknown;
  onSave: (val: unknown) => void;
  onClose: () => void;
  isReadOnly?: boolean;
}

interface ContentEditorModalProps {
  data: ContentEditorData;
  theme?: "dark" | "light";
}

export const ContentEditorModal: React.FC<ContentEditorModalProps> = ({
  data,
  theme = "dark",
}) => {
  const { title, subtitle, colName, colType, value: initialValue, onSave, onClose, isReadOnly } = data;

  const [mounted, setMounted] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wordWrap, setWordWrap] = useState<"on" | "off">("on");
  const [viewMode, setViewMode] = useState<"editor" | "split" | "preview">("editor");

  // Initial text extraction
  const initialText = useMemo(() => {
    if (initialValue === null || initialValue === undefined) return "";
    if (typeof initialValue === "object") {
      try {
        return JSON.stringify(initialValue, null, 2);
      } catch {
        return String(initialValue);
      }
    }
    return String(initialValue);
  }, [initialValue]);

  const [content, setContent] = useState<string>(initialText);

  // Detect initial type
  const detectedType = useMemo<ContentType>(() => {
    return detectContentType(initialValue, colName, colType);
  }, [initialValue, colName, colType]);

  const [selectedType, setSelectedType] = useState<ContentType>(detectedType);

  // Content info for badges (tags)
  const contentInfo = useMemo(() => {
    return getContentInfo(content, colName, colType);
  }, [content, colName, colType]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-switch viewMode if markdown or html is selected and has substantial content
  useEffect(() => {
    if ((selectedType === "markdown" || selectedType === "html") && content.length > 50) {
      if (typeof window !== "undefined" && window.innerWidth > 1024) {
        setViewMode("split");
      }
    } else if (selectedType === "json" || selectedType === "plaintext") {
      setViewMode("editor");
    }
  }, [selectedType]);

  // JSON validity check
  const jsonStatus = useMemo(() => {
    if (selectedType !== "json") return null;
    if (!content.trim()) return { valid: true, error: null };
    try {
      JSON.parse(content);
      return { valid: true, error: null };
    } catch (e: any) {
      return { valid: false, error: e.message || "Invalid JSON" };
    }
  }, [content, selectedType]);

  // Handle Save
  const handleSave = useCallback(() => {
    if (isReadOnly) return;
    let valToSave: unknown = content;
    if (selectedType === "json") {
      try {
        valToSave = JSON.parse(content);
      } catch {
        valToSave = content;
      }
    }
    onSave(valToSave);
    onClose();
  }, [content, selectedType, isReadOnly, onSave, onClose]);

  // Keyboard shortcut ⌘Enter to save, Esc to exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        if (isFullScreen) {
          setIsFullScreen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, isFullScreen, onClose]);

  // Copy to clipboard
  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Prettify JSON
  const handlePrettifyJson = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
    } catch {
      // Ignore if invalid
    }
  };

  // Minify JSON
  const handleMinifyJson = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed));
    } catch {
      // Ignore if invalid
    }
  };

  // Safe Text-Only Markdown Renderer (Omits images/assets as requested)
  const renderedMarkdownHtml = useMemo(() => {
    if (selectedType !== "markdown") return "";
    let html = content;

    // Escape basic HTML to prevent injection
    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Explicitly omit images ![alt](url) -> replace with omitted tag
    html = html.replace(/!\[(.*?)\]\(.*?\)/g, '<span class="md-asset-omitted">[asset omitted]</span>');

    // Code fences
    html = html.replace(/```([\s\S]*?)```/g, '<pre class="md-code-block font-mono"><code>$1</code></pre>');

    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code font-mono">$1</code>');

    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="md-h1">$1</h1>');

    // Blockquotes
    html = html.replace(/^\> (.*$)/gim, '<blockquote class="md-blockquote">$1</blockquote>');

    // Bold and italics
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="md-bold">$1</strong>');
    html = html.replace(/__([^_]+)__/g, '<strong class="md-bold">$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em class="md-italic">$1</em>');
    html = html.replace(/_([^_]+)_/g, '<em class="md-italic">$1</em>');

    // Unordered list items
    html = html.replace(/^\s*[-*+]\s+(.*$)/gim, '<li class="md-li">$1</li>');

    // Ordered list items
    html = html.replace(/^\s*\d+\.\s+(.*$)/gim, '<li class="md-li-num">$1</li>');

    // Links [text](url)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>');

    // Paragraph linebreaks
    html = html.replace(/\n\n+/g, '<div class="md-paragraph-break"></div>');
    html = html.replace(/\n/g, '<br/>');

    return html;
  }, [content, selectedType]);

  // Stats
  const lineCount = useMemo(() => (content ? content.split("\n").length : 0), [content]);
  const charCount = useMemo(() => content.length, [content]);
  const wordCount = useMemo(() => (content.trim() ? content.trim().split(/\s+/).length : 0), [content]);

  if (!mounted) return null;

  const modalContent = (
    <div className="content-modal-overlay" onClick={onClose}>
      <div
        className={`content-modal-card ${isFullScreen ? "is-fullscreen" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Clean, Minimal & Theme-Native */}
        <div className="content-modal-header">
          <div className="header-left">
            <FileText size={15} className="header-icon" />
            <div className="header-title-group">
              <span className="modal-title font-mono">{colName}</span>
              {colType && <span className="col-type-tag font-mono">{colType}</span>}
              {contentInfo?.label && (
                <span className={`content-badge-tag ${contentInfo.badgeClass}`}>
                  {contentInfo.label}
                </span>
              )}
              {subtitle && <span className="subtitle-hint font-mono">• {subtitle}</span>}
            </div>
          </div>

          <div className="header-center">
            {/* Format Type Selector Tabs (Minimal Segmented Control) */}
            <div className="type-segmented-control" role="tablist">
              <button
                type="button"
                className={`type-tab-btn ${selectedType === "markdown" ? "active" : ""}`}
                onClick={() => setSelectedType("markdown")}
                title="Markdown formatted document"
              >
                <span>Markdown</span>
              </button>
              <button
                type="button"
                className={`type-tab-btn ${selectedType === "html" ? "active" : ""}`}
                onClick={() => setSelectedType("html")}
                title="HTML code and markup"
              >
                <span>HTML</span>
              </button>
              <button
                type="button"
                className={`type-tab-btn ${selectedType === "json" ? "active" : ""}`}
                onClick={() => setSelectedType("json")}
                title="Structured JSON data"
              >
                <span>JSON</span>
              </button>
              <button
                type="button"
                className={`type-tab-btn ${selectedType === "plaintext" ? "active" : ""}`}
                onClick={() => setSelectedType("plaintext")}
                title="Plain raw text"
              >
                <span>Plaintext</span>
              </button>
            </div>
          </div>

          <div className="header-right">
            {/* Markdown / HTML View Mode Toggles */}
            {(selectedType === "markdown" || selectedType === "html") && (
              <div className="view-mode-group">
                <button
                  type="button"
                  className={`mode-btn ${viewMode === "editor" ? "active" : ""}`}
                  onClick={() => setViewMode("editor")}
                  title="Editor only"
                >
                  <AlignLeft size={12} />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${viewMode === "split" ? "active" : ""}`}
                  onClick={() => setViewMode("split")}
                  title="Side-by-side Editor & Preview"
                >
                  <Columns size={12} />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${viewMode === "preview" ? "active" : ""}`}
                  onClick={() => setViewMode("preview")}
                  title="Live Preview only"
                >
                  <Eye size={12} />
                  <span>Preview</span>
                </button>
              </div>
            )}

            {/* JSON Tools */}
            {selectedType === "json" && (
              <div className="json-tools-group">
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={handlePrettifyJson}
                  title="Format / Prettify JSON"
                >
                  <Sparkles size={12} />
                  <span>Format</span>
                </button>
                <button
                  type="button"
                  className="subtle-btn"
                  onClick={handleMinifyJson}
                  title="Minify JSON to single line"
                >
                  <span>Minify</span>
                </button>
              </div>
            )}

            {/* Word wrap toggle */}
            <button
              type="button"
              className={`tool-icon-btn ${wordWrap === "on" ? "active" : ""}`}
              onClick={() => setWordWrap(wordWrap === "on" ? "off" : "on")}
              title={`Toggle Word Wrap (${wordWrap === "on" ? "Enabled" : "Disabled"})`}
            >
              <WrapText size={14} />
            </button>

            {/* Copy button */}
            <button
              type="button"
              className="tool-icon-btn"
              onClick={handleCopy}
              title="Copy content to clipboard"
            >
              {copied ? <Check size={14} style={{ color: "var(--accent-green)" }} /> : <Copy size={14} />}
            </button>

            {/* Fullscreen / Focus Mode toggle */}
            <button
              type="button"
              className={`tool-icon-btn ${isFullScreen ? "active" : ""}`}
              onClick={() => setIsFullScreen(!isFullScreen)}
              title={isFullScreen ? "Exit Fullscreen Focus (Esc)" : "Enter Fullscreen Focus Mode"}
            >
              {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            <div className="header-divider" />

            {/* Close button */}
            <button
              type="button"
              className="tool-icon-btn close-btn"
              onClick={onClose}
              title="Close without saving (Esc)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="content-modal-body">
          <div className={`editor-container view-${viewMode}`}>
            {/* Editor Pane */}
            {viewMode !== "preview" && (
              <div className="pane-editor">
                <Editor
                  height="100%"
                  language={selectedType === "plaintext" ? "plaintext" : selectedType}
                  theme={theme === "light" ? "light" : "vs-dark"}
                  value={content}
                  onChange={(val) => setContent(val || "")}
                  options={{
                    readOnly: isReadOnly,
                    fontSize: 13,
                    fontFamily: "var(--font-mono, monospace)",
                    lineNumbers: "on",
                    minimap: { enabled: isFullScreen },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: wordWrap,
                    folding: true,
                    padding: { top: 10, bottom: 10 },
                    renderLineHighlight: "all",
                    smoothScrolling: true,
                  }}
                />
              </div>
            )}

            {/* Live Preview Pane */}
            {(viewMode === "split" || viewMode === "preview") && (
              <div className="pane-preview">
                <div className="preview-top-banner">
                  <span className="preview-label">
                    <Eye size={12} />
                    <span>Preview ({selectedType.toUpperCase()})</span>
                  </span>
                  <span className="preview-hint font-mono">Text only</span>
                </div>

                <div className="preview-content-scroll">
                  {selectedType === "markdown" ? (
                    <div
                      className="markdown-rendered-view"
                      dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
                    />
                  ) : selectedType === "html" ? (
                    <div className="html-preview-frame-wrap">
                      <iframe
                        title="HTML Preview"
                        sandbox="allow-same-origin"
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"/><style>body{font-family:sans-serif;padding:16px;color:${theme === "light" ? "#18181b" : "#ededed"};background:${theme === "light" ? "#ffffff" : "#0f0f11"};margin:0;line-height:1.6;font-size:13px;}</style></head><body>${content}</body></html>`}
                        className="html-preview-iframe"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer Status & Actions */}
        <div className="content-modal-footer">
          <div className="footer-stats font-mono">
            <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
            <span className="stat-separator">•</span>
            <span>{wordCount} {wordCount === 1 ? "word" : "words"}</span>
            <span className="stat-separator">•</span>
            <span>{charCount} {charCount === 1 ? "char" : "chars"}</span>
            {selectedType === "json" && jsonStatus && (
              <>
                <span className="stat-separator">•</span>
                <span className={`json-status ${jsonStatus.valid ? "is-valid" : "is-invalid"}`}>
                  {jsonStatus.valid ? "Valid JSON" : "Invalid JSON"}
                </span>
              </>
            )}
          </div>

          <div className="footer-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            {!isReadOnly && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleSave}
              >
                <Check size={13} />
                <span>Apply Changes</span>
                <span className="shortcut-badge font-mono">⌘Enter</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <style jsx>{`
        .content-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .content-modal-card {
          width: 90vw;
          max-width: 1080px;
          height: 82vh;
          max-height: 760px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: all 0.15s ease;
        }

        .content-modal-card.is-fullscreen {
          position: fixed;
          inset: 0;
          width: 100vw !important;
          max-width: 100vw !important;
          height: 100vh !important;
          max-height: 100vh !important;
          border-radius: 0;
          border: none;
          z-index: 100000;
        }

        .content-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          gap: 12px;
          flex-shrink: 0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }

        .header-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .header-title-group {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .modal-title {
          font-weight: 600;
          font-size: 13px;
          color: var(--text-main);
        }

        .col-type-tag {
          font-size: 11px;
          padding: 0 5px;
          border-radius: var(--radius-xs);
          background: var(--bg-tertiary);
          color: var(--text-muted);
          border: 1px solid var(--border-light);
        }

        .content-badge-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 0 5px;
          border-radius: var(--radius-xs);
          text-transform: uppercase;
        }

        .subtitle-hint {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .type-segmented-control {
          display: inline-flex;
          align-items: center;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 2px;
          gap: 2px;
        }

        .type-tab-btn {
          border: none;
          background: transparent;
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          transition: all 0.12s ease;
          font-family: var(--font-sans);
        }

        .type-tab-btn:hover {
          color: var(--text-main);
        }

        .type-tab-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }

        .view-mode-group {
          display: flex;
          align-items: center;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          padding: 2px;
          gap: 2px;
          margin-right: 4px;
        }

        .mode-btn {
          border: none;
          background: transparent;
          color: var(--text-sub);
          font-size: 11px;
          font-weight: 500;
          padding: 2px 7px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.12s ease;
        }

        .mode-btn:hover {
          color: var(--text-main);
        }

        .mode-btn.active {
          background: var(--bg-card);
          color: var(--text-main);
          font-weight: 600;
          box-shadow: var(--shadow-sm);
          border: 1px solid var(--border-light);
        }

        .json-tools-group {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-right: 4px;
        }

        .subtle-btn {
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          color: var(--text-sub);
          font-size: 11px;
          padding: 2px 7px;
          border-radius: var(--radius-xs);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.12s ease;
        }

        .subtle-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--border-medium);
        }

        .tool-icon-btn {
          width: 26px;
          height: 26px;
          border-radius: var(--radius-xs);
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-sub);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .tool-icon-btn:hover {
          background: var(--bg-hover);
          color: var(--text-main);
          border-color: var(--border-light);
        }

        .tool-icon-btn.active {
          background: var(--bg-tertiary);
          color: var(--accent-blue);
          border-color: var(--border-medium);
        }

        .header-divider {
          width: 1px;
          height: 16px;
          background: var(--border-light);
          margin: 0 4px;
        }

        .content-modal-body {
          flex: 1;
          min-height: 0;
          display: flex;
          background: var(--bg-content);
        }

        .editor-container {
          flex: 1;
          display: flex;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }

        .editor-container.view-editor .pane-editor {
          width: 100%;
        }

        .editor-container.view-preview .pane-preview {
          width: 100%;
        }

        .editor-container.view-split .pane-editor {
          width: 50%;
          border-right: 1px solid var(--border-light);
        }

        .editor-container.view-split .pane-preview {
          width: 50%;
        }

        .pane-editor {
          height: 100%;
          overflow: hidden;
          background: var(--bg-content);
        }

        .pane-preview {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-card);
          overflow: hidden;
        }

        .preview-top-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 14px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
        }

        .preview-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-sub);
        }

        .preview-hint {
          font-size: 10px;
          color: var(--text-muted);
        }

        .preview-content-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          background: var(--bg-content);
          color: var(--text-main);
          font-size: 13px;
          line-height: 1.6;
        }

        .html-preview-frame-wrap {
          width: 100%;
          height: 100%;
        }

        .html-preview-iframe {
          width: 100%;
          height: 100%;
          border: none;
          background: transparent;
        }

        :global(.markdown-rendered-view h1),
        :global(.markdown-rendered-view .md-h1) {
          font-size: 18px;
          font-weight: 600;
          margin: 0 0 10px 0;
          color: var(--text-main);
          border-bottom: 1px solid var(--border-light);
          padding-bottom: 6px;
        }

        :global(.markdown-rendered-view h2),
        :global(.markdown-rendered-view .md-h2) {
          font-size: 15px;
          font-weight: 600;
          margin: 14px 0 8px 0;
          color: var(--text-main);
        }

        :global(.markdown-rendered-view h3),
        :global(.markdown-rendered-view .md-h3) {
          font-size: 13px;
          font-weight: 600;
          margin: 12px 0 6px 0;
          color: var(--text-main);
        }

        :global(.markdown-rendered-view .md-blockquote) {
          margin: 8px 0;
          padding: 4px 12px;
          border-left: 3px solid var(--border-medium);
          color: var(--text-sub);
          background: var(--bg-tertiary);
          border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
        }

        :global(.markdown-rendered-view .md-code-block) {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 10px;
          font-size: 12px;
          overflow-x: auto;
          margin: 8px 0;
          color: var(--text-main);
        }

        :global(.markdown-rendered-view .md-inline-code) {
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: 3px;
          padding: 1px 5px;
          font-size: 11px;
          color: var(--accent-blue);
        }

        :global(.markdown-rendered-view .md-link) {
          color: var(--accent-blue);
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        :global(.markdown-rendered-view .md-asset-omitted) {
          display: inline-block;
          font-size: 11px;
          padding: 1px 5px;
          border-radius: var(--radius-xs);
          background: var(--bg-tertiary);
          color: var(--text-muted);
          border: 1px dashed var(--border-light);
        }

        .content-modal-footer {
          height: 44px;
          padding: 0 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          flex-shrink: 0;
        }

        .footer-stats {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: var(--text-muted);
        }

        .stat-separator {
          opacity: 0.5;
        }

        .json-status.is-valid {
          color: var(--accent-green);
        }

        .json-status.is-invalid {
          color: var(--accent-red);
        }

        .footer-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .shortcut-badge {
          font-size: 10px;
          padding: 1px 4px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.2);
          margin-left: 4px;
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
};
