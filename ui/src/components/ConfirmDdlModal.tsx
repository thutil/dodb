import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2, Copy, Check } from "lucide-react";
import { DdlResult } from "./tableDesign/draft";

export interface ConfirmDdlRequest {
  title: string;
  description: string;
  /** Exact SQL that will run, shown before the user commits. */
  statements: string[];
  confirmLabel: string;
  /** Require the user to type the table name for the truly irreversible ones. */
  typeToConfirm?: string;
  /** Optional statements to execute if CASCADE is toggled. */
  cascadeStatements?: string[];
  /** Whether CASCADE toggle is permitted (defaults to auto-detect for DROP/TRUNCATE). */
  allowCascade?: boolean;
}

interface ConfirmDdlModalProps {
  request: ConfirmDdlRequest | null;
  onCancel: () => void;
  onApplyDdl: (statements: string[]) => Promise<DdlResult>;
  onDone: () => void;
}

export const ConfirmDdlModal: React.FC<ConfirmDdlModalProps> = ({
  request,
  onCancel,
  onApplyDdl,
  onDone,
}) => {
  const [mounted, setMounted] = useState(false);
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedError, setCopiedError] = useState(false);
  const [useCascade, setUseCascade] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setTyped("");
    setError(null);
    setRunning(false);
    setCopiedError(false);
    setUseCascade(false);
  }, [request]);

  const handleCancel = useCallback(() => {
    if (running) return;
    onCancel();
  }, [running, onCancel]);

  if (!request || !mounted || typeof document === "undefined") return null;

  const isCascadeEligible =
    request.allowCascade !== false &&
    ((request.cascadeStatements && request.cascadeStatements.length > 0) ||
      request.statements.some((s) => /^\s*(DROP|TRUNCATE)\s+TABLE/i.test(s)));

  const effectiveCascadeStatements =
    request.cascadeStatements ??
    request.statements.map((s) => {
      if (/^\s*DROP\s+TABLE/i.test(s) && !/CASCADE/i.test(s)) {
        return s.replace(/;?\s*$/, " CASCADE;");
      }
      if (/^\s*TRUNCATE(\s+TABLE)?/i.test(s) && !/CASCADE/i.test(s)) {
        return s.replace(/;?\s*$/, " CASCADE;");
      }
      return s;
    });

  const activeStatements = useCascade && isCascadeEligible ? effectiveCascadeStatements : request.statements;

  const needsTyping = !!request.typeToConfirm;
  const canRun = !running && (!needsTyping || typed.trim() === request.typeToConfirm);

  const executeStatements = async (stmts: string[]) => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const result = await onApplyDdl(stmts);
      if (result.success) {
        onDone();
      } else {
        setError(result.error || "The statement failed.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleRun = () => executeStatements(activeStatements);

  const handleRetryWithCascade = () => {
    setUseCascade(true);
    executeStatements(effectiveCascadeStatements);
  };

  const handleCopyError = () => {
    if (!error) return;
    navigator.clipboard.writeText(error);
    setCopiedError(true);
    setTimeout(() => setCopiedError(false), 2000);
  };

  const isDependencyError =
    !!error &&
    /depend|cascade|constraint|foreign key|referenced/i.test(error);

  const content = (
    <div className="confirm-ddl-portal-root">
      <div className="submodal-overlay">
        <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
          <div className="submodal-header">
            <AlertTriangle size={14} className="danger-icon" />
            <span>{request.title}</span>
          </div>

          <div className="submodal-body">
            <p className="submodal-desc">{request.description}</p>

            <div className="sql-block font-mono">
              {activeStatements.map((s, i) => (
                <div key={i}>{s}</div>
              ))}
            </div>

            {isCascadeEligible && (
              <label className="cascade-option">
                <input
                  type="checkbox"
                  checked={useCascade}
                  onChange={(e) => setUseCascade(e.target.checked)}
                  disabled={running}
                />
                <div className="cascade-text">
                  <span className="cascade-label">Cascade (Drop dependent objects)</span>
                  <span className="cascade-desc">Automatically drop referencing foreign keys, views, or triggers.</span>
                </div>
              </label>
            )}

            {needsTyping && (
              <div className="type-field">
                <label className="type-label">
                  Type <span className="font-mono type-target">{request.typeToConfirm}</span> to confirm
                </label>
                <input
                  className="input font-mono"
                  value={typed}
                  autoFocus
                  placeholder={request.typeToConfirm}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
            )}

            {error && (
              <div className="error-wrap">
                <div className="error-head">
                  <span className="error-label">Execution Error</span>
                  <button
                    type="button"
                    className="btn-copy-error"
                    onClick={handleCopyError}
                    title="Copy error message"
                  >
                    {copiedError ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedError ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <div className="error-box font-mono">{error}</div>
                {isDependencyError && isCascadeEligible && !useCascade && (
                  <div className="cascade-hint-box">
                    <div className="hint-text">
                      Other objects depend on this table. You can retry with <strong>CASCADE</strong> to drop dependent constraints and views.
                    </div>
                    <button
                      type="button"
                      className="btn-retry-cascade"
                      onClick={handleRetryWithCascade}
                      disabled={running || !canRun}
                    >
                      {running ? <Loader2 size={11} className="spin" /> : null}
                      <span>Retry with CASCADE</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="submodal-actions">
            <button className="btn btn-secondary" onClick={handleCancel} disabled={running}>
              Cancel
            </button>
            <button className="btn btn-danger" onClick={handleRun} disabled={!canRun}>
              {running ? <Loader2 size={12} className="spin" /> : null}
              <span>{running ? "Running…" : request.confirmLabel}</span>
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .submodal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000001;
          animation: fadeIn 0.14s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .submodal-card {
          width: 480px;
          max-width: 92vw;
          max-height: 85vh;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: slideUp 0.16s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(8px) scale(0.985); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .submodal-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 14px;
          border-bottom: 1px solid var(--border-light);
          font-size: 12.5px;
          font-weight: 600;
          background: var(--bg-header);
          flex-shrink: 0;
        }
        .danger-header {
          color: var(--accent-red);
        }
        .confirm-ddl-portal-root :global(.danger-icon) {
          flex-shrink: 0;
        }
        .submodal-body {
          padding: 13px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .submodal-desc {
          font-size: 11.5px;
          color: var(--text-sub);
          line-height: 1.55;
          margin: 0;
        }
        .sql-block {
          font-size: 11px;
          line-height: 1.6;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 7px 9px;
          color: var(--text-main);
          user-select: text;
          word-break: break-word;
        }
        .cascade-option {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          cursor: pointer;
          user-select: none;
        }
        .cascade-option input {
          margin-top: 2px;
          cursor: pointer;
        }
        .cascade-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cascade-label {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-main);
        }
        .cascade-desc {
          font-size: 10px;
          color: var(--text-muted);
          line-height: 1.35;
        }
        .type-field {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .type-label {
          font-size: 10.5px;
          color: var(--text-sub);
        }
        .type-target {
          color: var(--text-main);
          font-weight: 600;
        }
        .confirm-ddl-portal-root :global(.input) {
          width: 100%;
        }
        .error-wrap {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .error-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .error-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--accent-red);
          font-weight: 600;
        }
        .btn-copy-error {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 7px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-xs);
          font-size: 10px;
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .btn-copy-error:hover {
          background: var(--bg-hover);
          border-color: var(--text-muted);
        }
        .error-box {
          font-size: 11px;
          color: var(--accent-red);
          background: var(--bg-tertiary);
          border: 1px solid rgba(244, 63, 94, 0.35);
          border-radius: var(--radius-xs);
          padding: 8px 10px;
          user-select: text;
          word-break: break-word;
          line-height: 1.45;
        }
        .cascade-hint-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 10px;
          background: rgba(244, 63, 94, 0.08);
          border: 1px solid rgba(244, 63, 94, 0.25);
          border-radius: var(--radius-xs);
        }
        .hint-text {
          font-size: 11px;
          color: var(--text-main);
          line-height: 1.4;
        }
        .btn-retry-cascade {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          background: var(--accent-red);
          color: #fff;
          border: none;
          border-radius: var(--radius-xs);
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity 0.15s ease;
        }
        .btn-retry-cascade:hover:not(:disabled) {
          opacity: 0.9;
        }
        .btn-retry-cascade:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .submodal-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          padding: 10px 14px;
          border-top: 1px solid var(--border-light);
          background: var(--bg-header);
        }
        .confirm-ddl-portal-root :global(.spin) {
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
};
