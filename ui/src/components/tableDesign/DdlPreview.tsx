import React, { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";

interface DdlPreviewProps {
  statements: string[];
  /** Blocking problems; when non-empty the caller should refuse to apply. */
  errors?: string[];
  /** Shown when a previous apply failed part-way through. */
  failure?: { failedIndex: number; executed: number; error: string } | null;
}

export const DdlPreview: React.FC<DdlPreviewProps> = ({ statements, errors = [], failure = null }) => {
  const [copied, setCopied] = useState(false);

  const sql = statements.join("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="ddl-preview">
      {errors.length > 0 && (
        <div className="issue-box">
          <AlertTriangle size={13} className="issue-icon" />
          <div className="issue-list">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        </div>
      )}

      <div className="preview-head">
        <span className="preview-title">
          {statements.length === 0
            ? "No changes to apply"
            : `${statements.length} statement${statements.length === 1 ? "" : "s"}`}
        </span>
        {statements.length > 0 && (
          <button type="button" className="btn btn-secondary btn-copy" onClick={handleCopy}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            <span>{copied ? "Copied" : "Copy SQL"}</span>
          </button>
        )}
      </div>

      {statements.length > 0 && (
        <div className="stmt-list">
          {statements.map((stmt, i) => {
            const failed = failure?.failedIndex === i;
            const applied = failure ? i < failure.executed : false;
            return (
              <div className={`stmt ${failed ? "failed" : ""} ${applied ? "applied" : ""}`} key={`${i}-${stmt}`}>
                <span className="stmt-num">{i + 1}</span>
                <pre className="stmt-sql font-mono">{stmt}</pre>
              </div>
            );
          })}
        </div>
      )}

      {failure && (
        <div className="failure-box">
          <AlertTriangle size={13} className="issue-icon" />
          <div>
            <div className="failure-title">
              Statement {failure.failedIndex + 1} failed. {failure.executed} of the earlier statement
              {failure.executed === 1 ? " was" : "s were"} already applied and{" "}
              {failure.executed === 1 ? "has" : "have"} not been rolled back.
            </div>
            <div className="failure-msg font-mono">{failure.error}</div>
          </div>
        </div>
      )}

      <style jsx>{`
        .ddl-preview {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .preview-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .preview-title {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
        }
        .ddl-preview :global(.btn-copy) {
          height: 22px;
          font-size: 10.5px;
          padding: 2px 7px;
        }
        .stmt-list {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .stmt {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-xs);
          padding: 6px 8px;
        }
        .stmt.applied {
          opacity: 0.5;
        }
        .stmt.failed {
          border-color: var(--accent-red);
        }
        .stmt-num {
          font-size: 9.5px;
          color: var(--text-muted);
          min-width: 14px;
          text-align: right;
          padding-top: 1px;
          user-select: none;
        }
        .stmt-sql {
          margin: 0;
          font-size: 11px;
          line-height: 1.5;
          color: var(--text-main);
          white-space: pre-wrap;
          word-break: break-word;
          user-select: text;
          flex: 1;
        }
        .issue-box,
        .failure-box {
          display: flex;
          gap: 7px;
          align-items: flex-start;
          padding: 7px 9px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-light);
          background: var(--bg-tertiary);
          font-size: 11px;
        }
        .issue-box {
          color: var(--accent-amber);
        }
        .failure-box {
          color: var(--accent-red);
        }
        .ddl-preview :global(.issue-icon) {
          flex-shrink: 0;
          margin-top: 1px;
        }
        .issue-list {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .failure-title {
          margin-bottom: 3px;
        }
        .failure-msg {
          color: var(--text-sub);
          font-size: 10.5px;
          user-select: text;
        }
      `}</style>
    </div>
  );
};
