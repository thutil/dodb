import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import {
  X,
  Maximize2,
  Minimize2,
  Check,
  FileText,
  Code2,
  Eye,
  Columns,
  Sparkles,
  AlignLeft,
  WrapText,
  Heading,
  Layers,
  AlertCircle,
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

  // Auto-switch viewMode if markdown or html is selected and has structure
  useEffect(() => {
    if ((selectedType === "markdown" || selectedType === "html") && content.length > 30) {
      // Default to split view if screen is wide
      if (typeof window !== "undefined" && window.innerWidth > 900) {
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
      return { valid: false, error: e.message || "Invalid JSON syntax" };
    }
  }, [selectedType, content]);

  // Prettify JSON
  const handlePrettifyJson = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore
    }
  };

  // Minify JSON
  const handleMinifyJson = () => {
    try {
      const parsed = JSON.parse(content);
      setContent(JSON.stringify(parsed));
    } catch {
      // ignore
    }
  };

  // Save handler
  const handleSave = useCallback(() => {
    if (isReadOnly) return;
    let finalVal: unknown = content;

    // If originally it was an object or JSON type and is valid JSON, pass parsed object
    if (
      selectedType === "json" ||
      typeof initialValue === "object" ||
      (colType && colType.toLowerCase().includes("json"))
    ) {
      try {
        if (content.trim() === "") {
          finalVal = null;
        } else {
          finalVal = JSON.parse(content);
        }
      } catch {
        finalVal = content;
      }
    }

    onSave(finalVal);
    onClose();
  }, [content, selectedType, initialValue, colType, isReadOnly, onSave, onClose]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, handleSave]);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  // Lightweight Pure-Text Markdown Parser (Strictly excluding images/assets)
  const renderedMarkdownHtml = useMemo(() => {
    if (selectedType !== "markdown") return "";

    let html = content
      // Escape basic HTML to avoid injection
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Remove or neutralize image tags ![alt](url) -> display clean text tag instead
    html = html.replace(/!\[(.*?)\]\(.*?\)/g, '<span class="md-asset-omitted">[image: $1]</span>');

    // Code blocks ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      return `<pre class="md-code-block"><div class="md-code-lang">${lang || "code"}</div><code>${code.trim()}</code></pre>`;
    });

    // Inline code `...`
    html = html.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');

    // Headings
    html = html.replace(/^###### (.*$)/gim, '<h6 class="md-h6">$1</h6>');
    html = html.replace(/^##### (.*$)/gim, '<h5 class="md-h5">$1</h5>');
    html = html.replace(/^#### (.*$)/gim, '<h4 class="md-h4">$1</h4>');
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

    // Links [text](url) -> safe styled link
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
        {/* Header */}
        <div className="content-modal-header">
          <div className="header-left">
            <div className="header-icon-wrap">
              <FileText size={18} className="header-main-icon" />
            </div>
            <div className="header-title-box">
              <div className="title-row">
                <span className="modal-title font-mono">{colName}</span>
                {colType && <span className="col-type-tag font-mono">{colType}</span>}
                {contentInfo?.label && (
                  <span className={`content-badge-tag ${contentInfo.badgeClass}`}>
                    {contentInfo.label}
                  </span>
                )}
                {contentInfo?.titleSnippet && (
                  <span className="snippet-meta-tag" title={contentInfo.titleSnippet}>
                    {contentInfo.type === "markdown" && <Heading size={10} />}
                    {contentInfo.type === "json" && <Code2 size={10} />}
                    <span>{contentInfo.titleSnippet}</span>
                  </span>
                )}
              </div>
              <div className="subtitle-row">
                <span>{title}</span>
                {subtitle && <span className="sub-crumb">• {subtitle}</span>}
              </div>
            </div>
          </div>

          <div className="header-center">
            {/* Format Type Selector Tabs */}
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
                  <AlignLeft size={13} />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${viewMode === "split" ? "active" : ""}`}
                  onClick={() => setViewMode("split")}
                  title="Side-by-side Editor & Preview"
                >
                  <Columns size={13} />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${viewMode === "preview" ? "active" : ""}`}
                  onClick={() => setViewMode("preview")}
                  title="Live Preview only"
                >
                  <Eye size={13} />
                  <span>Preview</span>
                </button>
              </div>
            )}

            {/* JSON Tools */}
            {selectedType === "json" && (
              <div className="json-tools-group">
                <button
                  type="button"
                  className="tool-btn"
                  onClick={handlePrettifyJson}
                  title="Format / Prettify JSON"
                >
                  <Sparkles size={12} />
                  <span>Format</span>
                </button>
                <button
                  type="button"
                  className="tool-btn"
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
              {copied ? <Check size={14} className="text-emerald" /> : <Copy size={14} />}
            </button>

            {/* Fullscreen / Focus Mode toggle */}
            <button
              type="button"
              className={`tool-icon-btn ${isFullScreen ? "active-focus" : ""}`}
              onClick={() => setIsFullScreen(!isFullScreen)}
              title={isFullScreen ? "Exit Fullscreen Focus (Esc)" : "Enter Fullscreen Focus Mode"}
            >
              {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

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
          {/* Split or Preview or Editor */}
          <div className={`editor-container view-${viewMode}`}>
            {/* Editor Pane */}
            {viewMode !== "preview" && (
              <div className="pane-editor">
                <Editor
                  height="100%"
                  language={selectedType === "plaintext" ? "plaintext" : selectedType}
                  theme={theme === "dark" ? "vs-dark" : "light"}
                  value={content}
                  onChange={(val) => setContent(val || "")}
                  options={{
                    readOnly: isReadOnly,
                    fontSize: 13,
                    fontFamily: "JetBrains Mono, Menlo, Monaco, 'Courier New', monospace",
                    lineNumbers: "on",
                    minimap: { enabled: isFullScreen },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    wordWrap: wordWrap,
                    folding: true,
                    padding: { top: 12, bottom: 12 },
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
                    <span>Live Preview ({selectedType.toUpperCase()})</span>
                  </span>
                  <span className="preview-hint font-mono">Clean Text Mode</span>
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
                        srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"/><style>body{font-family:sans-serif;padding:16px;color:${theme === "dark" ? "#e2e8f0" : "#1e293b"};background:${theme === "dark" ? "#0f172a" : "#ffffff"};margin:0;line-height:1.5;font-size:14px;}</style></head><body>${content}</body></html>`}
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
            <span className="stat-pill">{lineCount} lines</span>
            <span className="stat-pill">{wordCount} words</span>
            <span className="stat-pill">{charCount} characters</span>
            {selectedType === "json" && jsonStatus && (
              <span className={`stat-pill status-${jsonStatus.valid ? "valid" : "invalid"}`}>
                {jsonStatus.valid ? (
                  <>
                    <Check size={11} /> Valid JSON
                  </>
                ) : (
                  <>
                    <AlertCircle size={11} /> {jsonStatus.error}
                  </>
                )}
              </span>
            )}
          </div>

          <div className="footer-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
              Cancel
            </button>
            {!isReadOnly && (
              <button
                type="button"
                className="btn btn-primary btn-sm btn-save-content"
                onClick={handleSave}
              >
                <Check size={13} />
                <span>Apply Changes</span>
                <span className="shortcut-hint font-mono">⌘Enter</span>
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
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .content-modal-card {
          width: 92vw;
          max-width: 1200px;
          height: 85vh;
          max-height: 900px;
          background: var(--bg-card, #131722);
          border: 1px solid var(--border-medium, #2d3748);
          border-radius: 10px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
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
          padding: 10px 16px;
          background: var(--bg-secondary, #1a202c);
          border-bottom: 1px solid var(--border-medium, #2d3748);
          gap: 12px;
          flex-shrink: 0;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 220px;
        }

        .header-icon-wrap {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          background: var(--bg-hover, #2d3748);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--primary, #38bdf8);
        }

        .header-title-box {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .modal-title {
          font-weight: 600;
          font-size: 14px;
          color: var(--text-primary, #f1f5f9);
        }

        .col-type-tag {
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--bg-tertiary, #242c3d);
          color: var(--text-muted, #94a3b8);
          border: 1px solid var(--border-subtle, #334155);
        }

        .content-badge-tag {
          font-size: 10px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 3px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .badge-json {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }

        .badge-markdown {
          background: rgba(56, 189, 248, 0.15);
          color: #38bdf8;
          border: 1px solid rgba(56, 189, 248, 0.3);
        }

        .badge-html {
          background: rgba(249, 115, 22, 0.15);
          color: #fb923c;
          border: 1px solid rgba(249, 115, 22, 0.3);
        }

        .badge-txt {
          background: rgba(148, 163, 184, 0.15);
          color: #94a3b8;
          border: 1px solid rgba(148, 163, 184, 0.3);
        }

        .snippet-meta-tag {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(99, 102, 241, 0.12);
          color: #818cf8;
          border: 1px solid rgba(99, 102, 241, 0.25);
          max-width: 220px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .subtitle-row {
          font-size: 11px;
          color: var(--text-muted, #94a3b8);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .sub-crumb {
          opacity: 0.7;
        }

        .header-center {
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 1;
        }

        .type-segmented-control {
          display: flex;
          align-items: center;
          background: var(--bg-tertiary, #1f2736);
          border: 1px solid var(--border-medium, #2d3748);
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
        }

        .type-tab-btn {
          border: none;
          background: transparent;
          color: var(--text-secondary, #94a3b8);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .type-tab-btn:hover {
          color: var(--text-primary, #f1f5f9);
          background: rgba(255, 255, 255, 0.05);
        }

        .type-tab-btn.active {
          background: var(--primary, #3b82f6);
          color: #ffffff;
          font-weight: 600;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .view-mode-group {
          display: flex;
          align-items: center;
          background: var(--bg-tertiary, #1f2736);
          border: 1px solid var(--border-medium, #2d3748);
          border-radius: 6px;
          padding: 2px;
          gap: 2px;
        }

        .mode-btn {
          border: none;
          background: transparent;
          color: var(--text-secondary, #94a3b8);
          font-size: 11px;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        }

        .mode-btn:hover {
          color: var(--text-primary, #f1f5f9);
        }

        .mode-btn.active {
          background: var(--bg-hover, #334155);
          color: var(--text-primary, #f8fafc);
        }

        .json-tools-group {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .tool-btn {
          border: 1px solid var(--border-subtle, #334155);
          background: var(--bg-tertiary, #1f2736);
          color: var(--text-secondary, #cbd5e1);
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 5px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 4px;
          transition: all 0.15s ease;
        }

        .tool-btn:hover {
          background: var(--bg-hover, #2d3748);
          color: var(--text-primary, #f1f5f9);
        }

        .tool-icon-btn {
          width: 30px;
          height: 30px;
          border: 1px solid var(--border-subtle, #334155);
          background: var(--bg-tertiary, #1f2736);
          color: var(--text-secondary, #94a3b8);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tool-icon-btn:hover {
          background: var(--bg-hover, #2d3748);
          color: var(--text-primary, #f1f5f9);
        }

        .tool-icon-btn.active {
          background: var(--primary, #3b82f6);
          color: #ffffff;
          border-color: var(--primary, #3b82f6);
        }

        .tool-icon-btn.active-focus {
          background: #6366f1;
          color: #ffffff;
          border-color: #6366f1;
        }

        .tool-icon-btn.close-btn:hover {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
          border-color: rgba(239, 68, 68, 0.3);
        }

        .content-modal-body {
          flex: 1;
          min-height: 0;
          display: flex;
          background: var(--bg-primary, #0f172a);
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
          border-right: 1px solid var(--border-medium, #2d3748);
        }

        .editor-container.view-split .pane-preview {
          width: 50%;
        }

        .pane-editor {
          height: 100%;
          overflow: hidden;
        }

        .pane-preview {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-card, #131722);
          overflow: hidden;
        }

        .preview-top-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 14px;
          background: var(--bg-secondary, #1a202c);
          border-bottom: 1px solid var(--border-subtle, #2d3748);
          font-size: 11px;
          color: var(--text-muted, #94a3b8);
        }

        .preview-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 500;
          color: var(--text-secondary, #cbd5e1);
        }

        .preview-content-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
        }

        .html-preview-frame-wrap {
          width: 100%;
          height: 100%;
          border: none;
        }

        .html-preview-iframe {
          width: 100%;
          height: 100%;
          border: none;
          background: transparent;
        }

        /* Clean Markdown Rendering Styles (Text/Content focused, no asset clutter) */
        :global(.markdown-rendered-view) {
          color: var(--text-primary, #f1f5f9);
          font-size: 14px;
          line-height: 1.65;
        }

        :global(.markdown-rendered-view .md-h1) {
          font-size: 22px;
          font-weight: 700;
          margin: 0 0 14px 0;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border-subtle, #334155);
          color: var(--text-primary, #f8fafc);
        }

        :global(.markdown-rendered-view .md-h2) {
          font-size: 18px;
          font-weight: 600;
          margin: 18px 0 10px 0;
          color: var(--text-primary, #f8fafc);
        }

        :global(.markdown-rendered-view .md-h3) {
          font-size: 16px;
          font-weight: 600;
          margin: 14px 0 8px 0;
        }

        :global(.markdown-rendered-view .md-h4),
        :global(.markdown-rendered-view .md-h5),
        :global(.markdown-rendered-view .md-h6) {
          font-size: 14px;
          font-weight: 600;
          margin: 12px 0 6px 0;
        }

        :global(.markdown-rendered-view .md-paragraph-break) {
          height: 12px;
        }

        :global(.markdown-rendered-view .md-bold) {
          font-weight: 700;
          color: var(--text-primary, #ffffff);
        }

        :global(.markdown-rendered-view .md-italic) {
          font-style: italic;
        }

        :global(.markdown-rendered-view .md-blockquote) {
          margin: 10px 0;
          padding: 8px 14px;
          border-left: 3px solid var(--primary, #38bdf8);
          background: rgba(56, 189, 248, 0.08);
          color: var(--text-secondary, #cbd5e1);
          border-radius: 0 4px 4px 0;
        }

        :global(.markdown-rendered-view .md-code-block) {
          position: relative;
          background: var(--bg-tertiary, #0d1117);
          border: 1px solid var(--border-subtle, #30363d);
          border-radius: 6px;
          padding: 12px 14px;
          margin: 12px 0;
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          overflow-x: auto;
        }

        :global(.markdown-rendered-view .md-code-lang) {
          position: absolute;
          top: 4px;
          right: 8px;
          font-size: 10px;
          text-transform: uppercase;
          color: #8b949e;
          user-select: none;
        }

        :global(.markdown-rendered-view .md-inline-code) {
          font-family: var(--font-mono, monospace);
          font-size: 12px;
          padding: 2px 5px;
          border-radius: 4px;
          background: var(--bg-tertiary, #21262d);
          color: #f0883e;
          border: 1px solid rgba(240, 136, 62, 0.2);
        }

        :global(.markdown-rendered-view .md-li),
        :global(.markdown-rendered-view .md-li-num) {
          margin-left: 20px;
          padding: 2px 0;
        }

        :global(.markdown-rendered-view .md-link) {
          color: var(--primary, #38bdf8);
          text-decoration: underline;
          text-underline-offset: 2px;
        }

        :global(.markdown-rendered-view .md-asset-omitted) {
          display: inline-block;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 4px;
          background: var(--bg-tertiary, #21262d);
          color: var(--text-muted, #8b949e);
          border: 1px dashed var(--border-subtle, #30363d);
        }

        .content-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px;
          background: var(--bg-secondary, #1a202c);
          border-top: 1px solid var(--border-medium, #2d3748);
          flex-shrink: 0;
        }

        .footer-stats {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 11px;
          color: var(--text-muted, #94a3b8);
        }

        .stat-pill {
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--bg-tertiary, #242c3d);
        }

        .stat-pill.status-valid {
          color: #34d399;
          background: rgba(16, 185, 129, 0.12);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .stat-pill.status-invalid {
          color: #f87171;
          background: rgba(239, 68, 68, 0.12);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .footer-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .btn-save-content {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .shortcut-hint {
          font-size: 10px;
          opacity: 0.7;
          background: rgba(0, 0, 0, 0.2);
          padding: 1px 4px;
          border-radius: 3px;
        }

        .text-emerald {
          color: #34d399;
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
};
