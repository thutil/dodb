import React, { useEffect } from "react";
import { Language, t } from "../utils/i18n";

interface DiscardQueryModalProps {
  isOpen: boolean;
  tableName: string;
  onKeepSql: () => void;
  onDiscardAndReplace: () => void;
  onCancel: () => void;
  language?: Language;
}

export const DiscardQueryModal: React.FC<DiscardQueryModalProps> = ({
  isOpen,
  tableName,
  onKeepSql,
  onDiscardAndReplace,
  onCancel,
  language = "en",
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="discard-modal-overlay" onClick={onCancel}>
      <div className="discard-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="discard-modal-body">
          <h4 className="discard-title">{t("sqlDiscardTitle", language)}</h4>
          <p className="discard-desc">
            {t("sqlDiscardDesc", language, { table: tableName })}
          </p>
        </div>

        <div className="discard-modal-footer">
          <button type="button" className="btn-modal-keep" onClick={onKeepSql}>
            {t("sqlDiscardKeep", language)}
          </button>
          <button type="button" className="btn-modal-discard" onClick={onDiscardAndReplace}>
            {t("sqlDiscardReplace", language)}
          </button>
        </div>
      </div>

      <style jsx>{`
        .discard-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999999;
          animation: fadeIn 0.12s ease-out;
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        .discard-modal-card {
          width: 360px;
          max-width: calc(100vw - 32px);
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-popup);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: slideUp 0.15s cubic-bezier(0.16, 1, 0.3, 1);
        }

        @keyframes slideUp {
          from {
            transform: translateY(6px) scale(0.99);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }

        .discard-modal-body {
          padding: 18px 20px 14px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .discard-title {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-main);
        }

        .discard-desc {
          margin: 0;
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--text-sub);
        }

        .discard-modal-footer {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          padding: 12px 20px 16px;
        }

        .btn-modal-keep {
          height: 30px;
          padding: 0 14px;
          border-radius: var(--radius-xs, 4px);
          font-size: 12px;
          font-weight: 500;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-medium);
          color: var(--text-main);
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .btn-modal-keep:hover {
          background: var(--bg-hover);
          border-color: var(--border-focus);
        }

        .btn-modal-discard {
          height: 30px;
          padding: 0 14px;
          border-radius: var(--radius-xs, 4px);
          font-size: 12px;
          font-weight: 500;
          background: #ef4444;
          border: 1px solid #dc2626;
          color: #ffffff;
          cursor: pointer;
          transition: all 0.12s ease;
        }

        .btn-modal-discard:hover {
          background: #dc2626;
        }
      `}</style>
    </div>
  );
};
