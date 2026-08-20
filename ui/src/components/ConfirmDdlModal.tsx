import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import { DdlResult } from "./tableDesign/draft";

export interface ConfirmDdlRequest {
  title: string;
  description: string;
  /** Exact SQL that will run, shown before the user commits. */
  statements: string[];
  confirmLabel: string;
  /** Require the user to type the table name for the truly irreversible ones. */
  typeToConfirm?: string;
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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setTyped("");
    setError(null);
    setRunning(false);
  }, [request]);

  const handleCancel = useCallback(() => {
    if (running) return;
    onCancel();
  }, [running, onCancel]);

  if (!request || !mounted || typeof document === "undefined") return null;

  const needsTyping = !!request.typeToConfirm;
  const canRun = !running && (!needsTyping || typed.trim() === request.typeToConfirm);

  const handleRun = async () => {
    if (!canRun) return;
    setRunning(true);
    setError(null);
    try {
      const result = await onApplyDdl(request.statements);
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

  const content = (
    <div className="confirm-ddl-portal-root">
      <div className="submodal-overlay">
        <div className="submodal-card" onClick={(e) => e.stopPropagation()}>
          <div className="submodal-header danger-header">
            <AlertTriangle size={14} className="danger-icon" />
            <span>{request.title}</span>
          </div>

          <div className="submodal-body">
            <p className="submodal-desc">{request.description}</p>

            <div className="sql-block font-mono">
              {request.statements.map((s, i) => (
                <div key={`${i}-${s}`}>{s}</div>
              ))}
            </div>

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

            {error && <div className="error-box font-mono">{error}</div>}
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
          width: 460px;
          max-width: 92vw;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          overflow: hidden;
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
        .error-box {
          font-size: 10.5px;
          color: var(--accent-red);
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 7px 9px;
          user-select: text;
          word-break: break-word;
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
