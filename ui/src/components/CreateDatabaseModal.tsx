import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { Database, X, Plus, Copy, Check, AlertCircle, Code2 } from "lucide-react";
import { ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";
import {
  MYSQL_CHARSETS,
  POSTGRES_ENCODINGS,
  POSTGRES_COLLATIONS,
  CharsetOption,
} from "../utils/charsetUtils";

interface CreateDatabaseModalProps {
  activeProfile: ConnectionProfile;
  currentDb: string;
  onClose: () => void;
  onSuccess: (newDbName: string) => void;
}

export const CreateDatabaseModal: React.FC<CreateDatabaseModalProps> = ({
  activeProfile,
  currentDb,
  onClose,
  onSuccess,
}) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPostgres = activeProfile.type === "postgres";

  // Form states
  const [dbName, setDbName] = useState("");
  const [charset, setCharset] = useState<string>(isPostgres ? "UTF8" : "utf8mb4");
  const [collation, setCollation] = useState<string>(
    isPostgres ? "" : "utf8mb4_unicode_ci"
  );
  const [customCharset, setCustomCharset] = useState("");
  const [customCollation, setCustomCollation] = useState("");
  const [isCustomCharset, setIsCustomCharset] = useState(false);
  const [isCustomCollation, setIsCustomCollation] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedSql, setCopiedSql] = useState(false);

  // Available collations for currently selected MySQL charset
  const currentCharsetObj: CharsetOption | undefined = useMemo(() => {
    if (isPostgres) return undefined;
    return MYSQL_CHARSETS.find((c) => c.charset === charset);
  }, [isPostgres, charset]);

  // When MySQL charset changes, update collation to match default
  const handleCharsetChange = (newCs: string) => {
    if (newCs === "__custom__") {
      setIsCustomCharset(true);
      setCharset(customCharset || "");
      setIsCustomCollation(true);
    } else {
      setIsCustomCharset(false);
      setCharset(newCs);
      if (!isPostgres) {
        const found = MYSQL_CHARSETS.find((c) => c.charset === newCs);
        if (found) {
          setIsCustomCollation(false);
          setCollation(found.defaultCollation);
        }
      }
    }
  };

  const activeCharsetVal = isCustomCharset ? customCharset.trim() : charset;
  const activeCollationVal = isCustomCollation ? customCollation.trim() : collation;

  // Generated SQL preview
  const generatedSql = useMemo(() => {
    const clean = dbName.trim();
    if (!clean) return "-- Enter a database name to preview SQL";

    if (isPostgres) {
      const qName = `"${clean.replace(/"/g, '""')}"`;
      let sql = `CREATE DATABASE ${qName}`;
      if (activeCharsetVal) {
        sql += ` ENCODING '${activeCharsetVal.replace(/'/g, "''")}'`;
      }
      if (activeCollationVal) {
        const esc = activeCollationVal.replace(/'/g, "''");
        sql += ` LC_COLLATE '${esc}' LC_CTYPE '${esc}'`;
      }
      return `${sql};`;
    } else {
      const qName = `\`${clean.replace(/`/g, "``")}\``;
      let sql = `CREATE DATABASE ${qName}`;
      if (activeCharsetVal) {
        sql += ` CHARACTER SET ${activeCharsetVal.replace(/[`'"]/g, "")}`;
      }
      if (activeCollationVal) {
        sql += ` COLLATE ${activeCollationVal.replace(/[`'"]/g, "")}`;
      }
      return `${sql};`;
    }
  }, [dbName, isPostgres, activeCharsetVal, activeCollationVal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = dbName.trim();
    if (!cleanName) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      await apiClient.adminCreateDatabase(
        activeProfile.id,
        currentDb || "postgres",
        cleanName,
        activeCharsetVal || undefined,
        activeCollationVal || undefined
      );
      onSuccess(cleanName);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  if (!mounted || typeof document === "undefined") return null;

  const content = (
    <div className="cdb-modal-overlay" onClick={onClose}>
      <div className="cdb-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cdb-modal-header">
          <div className="cdb-title-wrap">
            <Database size={16} className="cdb-header-icon" />
            <div className="cdb-title-text">
              <span className="cdb-title">Create New Database</span>
              <span className="cdb-sub font-mono">
                {activeProfile.name} · {activeProfile.type.toUpperCase()}
              </span>
            </div>
          </div>
          <button className="cdb-close-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="cdb-form">
          <div className="cdb-body">
            <div className="cdb-form-group">
              <label className="cdb-label">
                <span>Database Name</span>
                <span className="cdb-required">*</span>
              </label>
              <input
                type="text"
                className="input font-mono form-control"
                placeholder="e.g. my_project_db"
                value={dbName}
                onChange={(e) => setDbName(e.target.value)}
                autoFocus
                required
              />
              <span className="cdb-hint">Alphanumeric characters and underscores</span>
            </div>

            {/* Charset / Collation Row */}
            <div className="cdb-form-row">
              <div className="cdb-form-group cdb-flex-1">
                <label className="cdb-label">
                  <span>{isPostgres ? "Encoding" : "Character Set"}</span>
                </label>

                {!isCustomCharset ? (
                  <select
                    className="select form-control font-mono"
                    value={charset}
                    onChange={(e) => handleCharsetChange(e.target.value)}
                  >
                    {isPostgres ? (
                      <>
                        {POSTGRES_ENCODINGS.map((enc) => (
                          <option key={enc.encoding} value={enc.encoding}>
                            {enc.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom Encoding...</option>
                      </>
                    ) : (
                      <>
                        {MYSQL_CHARSETS.map((cs) => (
                          <option key={cs.charset} value={cs.charset}>
                            {cs.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom Charset...</option>
                      </>
                    )}
                  </select>
                ) : (
                  <div className="cdb-custom-wrap">
                    <input
                      type="text"
                      className="input font-mono form-control"
                      placeholder="e.g. utf8mb4"
                      value={customCharset}
                      onChange={(e) => setCustomCharset(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setIsCustomCharset(false);
                        setCharset(isPostgres ? "UTF8" : "utf8mb4");
                      }}
                    >
                      Presets
                    </button>
                  </div>
                )}

                {currentCharsetObj?.description && !isCustomCharset && (
                  <span className="cdb-hint">{currentCharsetObj.description}</span>
                )}
              </div>

              <div className="cdb-form-group cdb-flex-1">
                <label className="cdb-label">
                  <span>Collation</span>
                </label>

                {!isCustomCollation ? (
                  <select
                    className="select form-control font-mono"
                    value={collation}
                    onChange={(e) => {
                      if (e.target.value === "__custom__") {
                        setIsCustomCollation(true);
                      } else {
                        setCollation(e.target.value);
                      }
                    }}
                  >
                    {isPostgres ? (
                      <>
                        {POSTGRES_COLLATIONS.map((c) => (
                          <option key={c.collation} value={c.collation}>
                            {c.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom Collation...</option>
                      </>
                    ) : currentCharsetObj ? (
                      <>
                        {currentCharsetObj.collations.map((col) => (
                          <option key={col.collation} value={col.collation}>
                            {col.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom Collation...</option>
                      </>
                    ) : (
                      <option value="">Default Collation</option>
                    )}
                  </select>
                ) : (
                  <div className="cdb-custom-wrap">
                    <input
                      type="text"
                      className="input font-mono form-control"
                      placeholder="e.g. utf8mb4_unicode_ci"
                      value={customCollation}
                      onChange={(e) => setCustomCollation(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setIsCustomCollation(false);
                        setCollation(currentCharsetObj?.defaultCollation || "");
                      }}
                    >
                      Presets
                    </button>
                  </div>
                )}

                <span className="cdb-hint">Sorting & comparison rules</span>
              </div>
            </div>

            {/* SQL Preview Box */}
            <div className="cdb-sql-box">
              <div className="cdb-sql-header">
                <div className="cdb-sql-title">
                  <Code2 size={12} />
                  <span>Generated SQL</span>
                </div>
                <button
                  type="button"
                  className="cdb-copy-btn"
                  onClick={handleCopySql}
                  disabled={!dbName.trim()}
                >
                  {copiedSql ? <Check size={11} className="cdb-check" /> : <Copy size={11} />}
                  <span>{copiedSql ? "Copied" : "Copy SQL"}</span>
                </button>
              </div>
              <pre className="cdb-sql-code font-mono">{generatedSql}</pre>
            </div>

            {errorMsg && (
              <div className="cdb-error-banner">
                <AlertCircle size={14} className="cdb-err-icon" />
                <span className="cdb-err-text">{errorMsg}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="cdb-modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !dbName.trim()}
            >
              <Plus size={13} />
              <span>{loading ? "Creating..." : "Create Database"}</span>
            </button>
          </div>
        </form>
      </div>

      <style jsx>{`
        .cdb-modal-overlay {
          position: fixed;
          inset: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 999999;
          animation: cdbFadeIn 0.15s ease;
        }
        @keyframes cdbFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .cdb-modal-card {
          width: 520px;
          max-width: calc(100vw - 32px);
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-md);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          animation: cdbSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes cdbSlideUp {
          from { transform: translateY(12px) scale(0.98); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }

        .cdb-modal-header {
          padding: 12px 16px;
          background: var(--bg-header);
          border-bottom: 1px solid var(--border-light);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .cdb-title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        :global(.cdb-header-icon) {
          color: var(--accent-blue, #3b82f6);
          flex-shrink: 0;
        }
        .cdb-title-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .cdb-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-main);
        }
        .cdb-sub {
          font-size: 10.5px;
          color: var(--text-muted);
        }

        .cdb-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: inline-flex;
          padding: 4px;
          border-radius: var(--radius-xs);
          transition: all 0.12s ease;
        }
        .cdb-close-btn:hover {
          color: var(--text-main);
          background: var(--bg-hover);
        }

        .cdb-form {
          display: flex;
          flex-direction: column;
          margin: 0;
        }
        .cdb-body {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .cdb-form-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .cdb-form-row {
          display: flex;
          gap: 12px;
        }
        .cdb-flex-1 {
          flex: 1;
          min-width: 0;
        }

        .cdb-label {
          font-size: 11.5px;
          font-weight: 500;
          color: var(--text-sub);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .cdb-required {
          color: var(--accent-red, #ef4444);
          font-weight: bold;
        }
        .cdb-hint {
          font-size: 10.5px;
          color: var(--text-muted);
          line-height: 1.3;
        }

        .cdb-custom-wrap {
          display: flex;
          gap: 6px;
        }

        .cdb-sql-box {
          background: var(--bg-primary, #0f1117);
          border: 1px solid var(--border-light);
          border-radius: 6px;
          padding: 8px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cdb-sql-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .cdb-sql-title {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10.5px;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .cdb-copy-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-muted);
          font-size: 10.5px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
          transition: all 0.12s ease;
        }
        .cdb-copy-btn:hover:not(:disabled) {
          background: var(--bg-tertiary);
          border-color: var(--border-light);
          color: var(--text-main);
        }
        .cdb-copy-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .cdb-check {
          color: var(--accent-green, #10b981);
        }

        .cdb-sql-code {
          margin: 0;
          font-size: 11px;
          color: var(--text-main);
          white-space: pre-wrap;
          word-break: break-all;
          line-height: 1.4;
        }

        .cdb-error-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 6px;
          color: #fca5a5;
          font-size: 11.5px;
        }
        .cdb-err-icon {
          flex-shrink: 0;
          color: var(--accent-red, #ef4444);
        }
        .cdb-err-text {
          word-break: break-word;
        }

        .cdb-modal-footer {
          padding: 10px 16px;
          border-top: 1px solid var(--border-light);
          background: var(--bg-header);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
};
