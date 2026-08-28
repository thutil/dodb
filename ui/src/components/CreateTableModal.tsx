import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Table2, X } from "lucide-react";
import { DBType } from "../types";
import { TableDraft, buildCreateTable } from "../utils/ddlBuilder";
import { DdlResult, emptyDraft, validateDraft } from "./tableDesign/draft";
import { DesignerTab, TableDesignerBody } from "./tableDesign/TableDesignerBody";
import { DdlPreview } from "./tableDesign/DdlPreview";

interface CreateTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  dbType: DBType;
  activeDatabase: string;
  availableTables: string[];
  onFetchColumns: (table: string) => Promise<string[]>;
  onApplyDdl: (statements: string[]) => Promise<DdlResult>;
  onCreated: (tableName: string) => void;
}

export const CreateTableModal: React.FC<CreateTableModalProps> = ({
  isOpen,
  onClose,
  dbType,
  activeDatabase,
  availableTables,
  onFetchColumns,
  onApplyDdl,
  onCreated,
}) => {
  const [mounted, setMounted] = useState(false);
  const [draft, setDraft] = useState<TableDraft>(() => emptyDraft(dbType));
  const [tab, setTab] = useState<DesignerTab>("columns");
  const [step, setStep] = useState<"design" | "review">("design");
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<DdlResult | null>(null);

  useEffect(() => setMounted(true), []);

  // Reset to a clean slate whenever the modal is opened.
  useEffect(() => {
    if (isOpen) {
      setDraft(emptyDraft(dbType));
      setTab("columns");
      setStep("design");
      setFailure(null);
      setApplying(false);
    }
  }, [isOpen, dbType]);

  const handleClose = useCallback(() => {
    if (applying) return;
    onClose();
  }, [applying, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (step === "review") setStep("design");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, step]);

  const errors = useMemo(() => validateDraft(draft), [draft]);

  const statements = useMemo(() => {
    if (errors.length > 0) return [];
    try {
      return buildCreateTable(draft, dbType);
    } catch {
      return [];
    }
  }, [draft, dbType, errors]);

  const handleApply = async () => {
    if (statements.length === 0 || applying) return;
    setApplying(true);
    setFailure(null);
    try {
      const result = await onApplyDdl(statements);
      if (result.success) {
        onCreated(draft.name.trim());
        onClose();
      } else {
        setFailure(result);
      }
    } catch (err: unknown) {
      setFailure({
        success: false,
        executed: 0,
        failedIndex: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  const content = (
    <div className="create-table-portal-root">
      <div className="modal-overlay">
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div className="title-group">
              <Table2 size={16} className="table-header-icon" />
              <div className="title-text">
                <span className="modal-title">Create Table</span>
                <span className="modal-sub font-mono">{activeDatabase}</span>
              </div>
            </div>
            <button className="icon-btn" onClick={handleClose} title="Close" disabled={applying}>
              <X size={15} />
            </button>
          </div>

          {step === "design" ? (
            <>
              <div className="name-bar">
                <label className="name-label">Table name</label>
                <input
                  className="input font-mono name-input"
                  value={draft.name}
                  placeholder="my_table"
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </div>

              <TableDesignerBody
                draft={draft}
                dbType={dbType}
                activeTab={tab}
                onTabChange={setTab}
                availableTables={availableTables}
                onFetchColumns={onFetchColumns}
                onChange={setDraft}
              />

              <div className="modal-footer">
                <span className="footer-hint">
                  {errors.length > 0 ? `${errors.length} issue${errors.length === 1 ? "" : "s"} to fix` : ""}
                </span>
                <div className="footer-actions">
                  <button className="btn btn-secondary" onClick={handleClose}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={errors.length > 0 || draft.columns.length === 0}
                    onClick={() => setStep("review")}
                  >
                    Review SQL
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="review-body">
                <DdlPreview
                  statements={statements}
                  errors={errors}
                  failure={
                    failure
                      ? {
                          failedIndex: failure.failedIndex ?? 0,
                          executed: failure.executed,
                          error: failure.error || "Unknown error",
                        }
                      : null
                  }
                />
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setStep("design")} disabled={applying}>
                  <ArrowLeft size={12} />
                  <span>Back to design</span>
                </button>
                <div className="footer-actions">
                  <button className="btn btn-primary" onClick={handleApply} disabled={applying || statements.length === 0}>
                    {applying ? <Loader2 size={12} className="spin" /> : null}
                    <span>{applying ? "Creating…" : "Create Table"}</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        .modal-overlay {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999999;
          animation: fadeIn 0.15s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .modal-card {
          width: 940px;
          max-width: 96vw;
          height: 700px;
          max-height: 92vh;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.1);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
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
        .title-group {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .create-table-portal-root :global(.table-header-icon) {
          color: var(--accent-blue);
          flex-shrink: 0;
        }
        .title-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .modal-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-main);
        }
        .modal-sub {
          font-size: 10px;
          color: var(--text-muted);
        }
        .icon-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: inline-flex;
          padding: 4px;
          border-radius: var(--radius-xs);
          transition: all 0.12s ease;
        }
        .icon-btn:hover:not(:disabled) {
          color: var(--text-main);
          background: var(--bg-hover);
        }
        .icon-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .name-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 16px;
          border-bottom: 1px solid var(--border-light);
          flex-shrink: 0;
        }
        .name-label {
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          font-weight: 600;
          white-space: nowrap;
        }
        .create-table-portal-root :global(.name-input) {
          flex: 1;
          max-width: 320px;
        }
        .review-body {
          padding: 14px 16px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .modal-footer {
          padding: 10px 16px;
          background: var(--bg-header);
          border-top: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-shrink: 0;
        }
        .footer-hint {
          font-size: 10.5px;
          color: var(--accent-amber);
        }
        .footer-actions {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        .create-table-portal-root :global(.spin) {
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
