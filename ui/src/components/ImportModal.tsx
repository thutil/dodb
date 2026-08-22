import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  Info,
  ListX,
  Loader2,
  Play,
  Settings2,
  Table2,
  Upload,
  Wand2,
  X,
  XCircle
} from "lucide-react";
import { ColumnInfo, ConnectionProfile } from "../types";
import { apiClient } from "../utils/apiClient";
import {
  ColumnMapping,
  ConflictStrategy,
  CsvOptions,
  DEFAULT_CSV_OPTIONS,
  ImportFileInfo,
  ImportFormat,
  ImportPreview,
  ImportProgress,
  ImportReport,
  ImportRequest,
  InferredType,
  OnErrorMode,
  SourceEncoding,
  TxMode,
  TYPE_LABELS,
  formatBytes,
  formatDuration,
  importManager,
  suggestColumnName
} from "../utils/importManager";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile: ConnectionProfile | null;
  activeDatabase: string;
  tables: string[];
  /** Preselected by the sidebar's "Import into this Table…". */
  initialTable?: string | null;
  /** Fired once an import actually wrote something, so the shell can refresh. */
  onImported: (report: ImportReport) => void;
}

interface ImportErrorBoundaryState {
  hasError: boolean;
  errorMsg: string;
}

class ImportErrorBoundary extends React.Component<
  { children: React.ReactNode; onClose: () => void },
  ImportErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onClose: () => void }) {
    super(props);
    this.state = { hasError: false, errorMsg: "" };
  }

  static getDerivedStateFromError(error: Error): ImportErrorBoundaryState {
    return { hasError: true, errorMsg: error?.message || String(error) };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ImportModal caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="import-portal-root">
          <div className="import-overlay" onMouseDown={this.props.onClose}>
            <div
              className="import-card"
              style={{ height: "auto", padding: 24, gap: 16, maxWidth: 500 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-main)" }}>
                Import Error
              </div>
              <div style={{ fontSize: 12, color: "var(--accent-red)", fontFamily: "monospace" }}>
                {this.state.errorMsg}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={this.props.onClose}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

type Step = 1 | 2 | 3 | 4;

const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: 1, label: "Source", hint: "File & format" },
  { id: 2, label: "Target", hint: "Table & columns" },
  { id: 3, label: "Options", hint: "Batching & conflicts" },
  { id: 4, label: "Run", hint: "Progress & report" }
];

/** Sentinel for the "create a new table" entry in the target dropdown. */
const CREATE_NEW = "__dodb_create_new_table__";

const FORMAT_META: { id: ImportFormat; label: string; hint: string }[] = [
  { id: "sql", label: "SQL dump", hint: "Replay statements" },
  { id: "csv", label: "CSV / TSV", hint: "Delimited rows" },
  { id: "json", label: "JSON", hint: "Array or JSON Lines" }
];

const DELIMITERS: { value: string; label: string }[] = [
  { value: ",", label: "Comma  ," },
  { value: ";", label: "Semicolon  ;" },
  { value: "\\t", label: "Tab" },
  { value: "|", label: "Pipe  |" }
];

const ENCODINGS: { value: SourceEncoding; label: string }[] = [
  { value: "utf8", label: "UTF-8" },
  { value: "tis620", label: "TIS-620 / CP874 (Thai)" },
  { value: "windows1252", label: "Windows-1252" }
];

const TYPE_OPTIONS: InferredType[] = [
  "text",
  "integer",
  "bigint",
  "double",
  "boolean",
  "date",
  "timestamp",
  "json"
];

const BATCH_SIZES = [100, 500, 1000, 5000];

function FormatIcon({ format, size = 14 }: { format: ImportFormat; size?: number }) {
  if (format === "sql") return <FileCode size={size} />;
  if (format === "json") return <FileJson size={size} />;
  return <FileSpreadsheet size={size} />;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  activeProfile,
  activeDatabase,
  tables,
  initialTable,
  onImported
}) => {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>(1);

  const [file, setFile] = useState<ImportFileInfo | null>(null);
  const [format, setFormat] = useState<ImportFormat>("csv");
  const [csv, setCsv] = useState<CsvOptions>({ ...DEFAULT_CSV_OPTIONS });
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [targetTable, setTargetTable] = useState<string>("");
  const [newTableName, setNewTableName] = useState<string>("");
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [targetColumns, setTargetColumns] = useState<ColumnInfo[]>([]);
  const [loadingTargetColumns, setLoadingTargetColumns] = useState(false);

  const [batchSize, setBatchSize] = useState(500);
  const [conflict, setConflict] = useState<ConflictStrategy>("error");
  const [onErrorMode, setOnErrorMode] = useState<OnErrorMode>("abort");
  const [txMode, setTxMode] = useState<TxMode>("atomicBatch");
  const [truncateFirst, setTruncateFirst] = useState(false);
  const [truncateTyped, setTruncateTyped] = useState("");
  const [dryRun, setDryRun] = useState(false);

  const [progress, setProgress] = useState<ImportProgress>(importManager.getProgress());
  const [report, setReport] = useState<ImportReport | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [copiedReport, setCopiedReport] = useState(false);

  // Guards the preview against a stale response landing after the options
  // changed again, the same way `fetchSeqRef` does in pages/index.tsx.
  const previewSeq = useRef(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => importManager.subscribe(setProgress), []);

  const running = progress.status === "running";

  // ---- Reset whenever the wizard is opened ----
  useEffect(() => {
    if (!isOpen) return;
    previewSeq.current += 1;
    setStep(1);
    setFile(null);
    setFormat("csv");
    setCsv({ ...DEFAULT_CSV_OPTIONS });
    setFileError(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewing(false);
    setTargetTable(initialTable || "");
    setNewTableName("");
    setMappings([]);
    setTargetColumns([]);
    setBatchSize(500);
    setConflict("error");
    setOnErrorMode("abort");
    setTxMode("atomicBatch");
    setTruncateFirst(false);
    setTruncateTyped("");
    setDryRun(false);
    setReport(null);
    setStartError(null);
    setCopiedReport(false);
    if (!importManager.isRunning()) importManager.reset();
  }, [isOpen, initialTable]);

  const handleClose = useCallback(() => {
    if (running) return;
    onClose();
  }, [running, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, handleClose]);

  // ---- File selection ----
  const adoptFile = useCallback((info: ImportFileInfo) => {
    setFile(info);
    setFormat(info.format);
    setPreview(null);
    setPreviewError(null);
    setFileError(null);
    setMappings([]);
    setCsv((prev) => ({
      ...prev,
      delimiter: info.delimiter || prev.delimiter,
      // A Thai CSV out of Excel is CP874; defaulting it to UTF-8 would turn
      // every Thai column into replacement characters.
      encoding: info.looksUtf8 ? "utf8" : "tis620"
    }));
  }, []);

  const asMessage = (err: unknown) =>
    typeof err === "string" ? err : (err as Error)?.message || String(err);

  const handleBrowse = async () => {
    setPicking(true);
    try {
      const info = await apiClient.pickImportFile();
      if (info) adoptFile(info);
    } catch (err: unknown) {
      setFileError(asMessage(err));
    } finally {
      setPicking(false);
    }
  };

  // Tauri's webview reports a real path on drop, so the backend can stream it.
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined;
    const path = dropped?.path;
    if (!path) {
      setFileError("Could not read the dropped file's path. Use Browse to pick the file instead.");
      return;
    }
    try {
      adoptFile(await apiClient.describeImportFile(path));
    } catch (err: unknown) {
      setFileError(asMessage(err));
    }
  };

  // ---- Preview ----
  const loadPreview = useCallback(async () => {
    if (!file) return;
    const seq = ++previewSeq.current;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const result = await apiClient.previewImportFile(file.path, format, csv);
      if (previewSeq.current !== seq) return;
      setPreview(result);
    } catch (err: unknown) {
      if (previewSeq.current !== seq) return;
      setPreview(null);
      setPreviewError(asMessage(err));
    } finally {
      if (previewSeq.current === seq) setPreviewing(false);
    }
  }, [file, format, csv]);

  useEffect(() => {
    if (!file) return;
    if (format === "sql" || step === 2) {
      loadPreview();
    }
  }, [step, file, format, loadPreview]);

  const isTabular = format !== "sql";
  const creatingTable = targetTable === CREATE_NEW;
  const effectiveTable = creatingTable ? newTableName.trim() : targetTable;

  // ---- Load the real columns of an existing target ----
  useEffect(() => {
    if (!isTabular || creatingTable || !targetTable || !activeProfile || !activeDatabase) {
      setTargetColumns([]);
      return;
    }
    let alive = true;
    setLoadingTargetColumns(true);
    apiClient
      .getColumns(activeProfile.id, activeDatabase, targetTable)
      .then((res) => {
        if (!alive) return;
        const cols = Array.isArray(res) ? res : (res as { columns?: ColumnInfo[] })?.columns ?? [];
        setTargetColumns(Array.isArray(cols) ? cols : []);
      })
      .catch(() => {
        if (alive) setTargetColumns([]);
      })
      .finally(() => {
        if (alive) setLoadingTargetColumns(false);
      });
    return () => {
      alive = false;
    };
  }, [isTabular, creatingTable, targetTable, activeProfile, activeDatabase]);

  const previewColumns = useMemo(
    () => (preview?.kind === "tabular" && Array.isArray(preview.columns) ? preview.columns : []),
    [preview]
  );

  const buildMappings = useCallback(
    (): ColumnMapping[] =>
      previewColumns.map((col) => {
        if (creatingTable) {
          return {
            source: col.name,
            target: suggestColumnName(col.name),
            sqlType: null,
            valueType: col.inferredType
          };
        }
        const suggested = suggestColumnName(col.name).toLowerCase();
        const match = targetColumns.find(
          (t) => t.name.toLowerCase() === col.name.toLowerCase() || t.name.toLowerCase() === suggested
        );
        return {
          source: col.name,
          target: match ? match.name : null,
          sqlType: null,
          valueType: col.inferredType
        };
      }),
    [previewColumns, creatingTable, targetColumns]
  );

  // Re-seed the mapping whenever the source columns or the target change.
  useEffect(() => {
    if (!isTabular || previewColumns.length === 0) return;
    setMappings(buildMappings());
  }, [isTabular, previewColumns, buildMappings]);

  const mappedCount = mappings.filter((m) => !!m.target).length;

  const targetPk = useMemo(
    () => targetColumns.filter((c) => c.primaryKey).map((c) => c.name),
    [targetColumns]
  );
  // Postgres needs a key to express "update the row that conflicts".
  const canUpdateOnConflict =
    creatingTable || activeProfile?.type !== "postgres" || targetPk.length > 0;

  useEffect(() => {
    if (conflict === "update" && !canUpdateOnConflict) setConflict("error");
  }, [conflict, canUpdateOnConflict]);

  const dialectMismatch = useMemo(() => {
    if (preview?.kind !== "sql" || !activeProfile) return null;
    const hints = Array.isArray(preview.dialectHints) ? preview.dialectHints : [];
    if (hints.length === 0 || hints.includes(activeProfile.type)) return null;
    return hints.join(", ");
  }, [preview, activeProfile]);

  const updateMapping = (index: number, patch: Partial<ColumnMapping>) => {
    setMappings((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  // ---- Step gating ----
  const stepBlocker = (target: Step): string | null => {
    if (target >= 2 && !file) return "Choose a file first.";
    if (target >= 3 && isTabular) {
      if (!effectiveTable) return "Choose or name a target table.";
      if (mappedCount === 0) return "Map at least one column.";
    }
    if (target >= 4) {
      if (!activeProfile) return "Connect to a database first.";
      if (truncateFirst && truncateTyped.trim() !== effectiveTable) {
        return "Type the table name to confirm emptying it.";
      }
    }
    return null;
  };

  const nextBlocker = step < 4 ? stepBlocker((step + 1) as Step) : null;

  const request: ImportRequest = useMemo(
    () => ({
      filePath: file?.path ?? "",
      format,
      targetTable: isTabular ? effectiveTable : null,
      createTable: isTabular && creatingTable,
      truncateFirst: isTabular && truncateFirst,
      columns: isTabular ? mappings : [],
      csv,
      batchSize,
      conflict,
      onError: onErrorMode,
      txMode,
      dryRun,
      maxErrors: 200
    }),
    [
      file,
      format,
      isTabular,
      effectiveTable,
      creatingTable,
      truncateFirst,
      mappings,
      csv,
      batchSize,
      conflict,
      onErrorMode,
      txMode,
      dryRun
    ]
  );

  const stepsToDisplay = useMemo(() => {
    if (format === "sql") {
      return [
        { id: 1 as Step, label: "SQL Import", hint: "File, preview & options" },
        { id: 4 as Step, label: "Run", hint: "Progress & report" }
      ];
    }
    return STEPS;
  }, [format]);

  const handleStart = async () => {
    if (!activeProfile || !file) return;
    setStartError(null);
    setReport(null);
    setStep(4);
    try {
      const result = await importManager.start({
        profileId: activeProfile.id,
        database: activeDatabase,
        fileName: file.name,
        request
      });
      setReport(result);
      if (!result.dryRun && result.rowsImported + result.statementsRun > 0) {
        onImported(result);
      }
    } catch (err: unknown) {
      setStartError(asMessage(err));
    }
  };

  const handleCopyReport = () => {
    if (!report) return;
    const lines = [
      `Import ${report.success ? "succeeded" : report.cancelled ? "was cancelled" : "failed"}`,
      `File: ${file?.name ?? ""}`,
      `Rows: ${report.rowsImported}  Statements: ${report.statementsRun}  Elapsed: ${report.elapsedMs} ms`,
      ...report.failures.map(
        (f) => `#${f.index}${f.line != null ? ` (line ${f.line})` : ""}: ${f.message}\n  ${f.excerpt}`
      )
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  if (!isOpen || !mounted || typeof document === "undefined") return null;

  const content = (
    <div className="import-portal-root">
      <div className="import-overlay" onMouseDown={handleClose}>
        <div className="import-card" onMouseDown={(e) => e.stopPropagation()}>
          {/* ---------- Header ---------- */}
          <div className="import-header">
            <div className="header-left">
              <span className="header-chip">
                <Upload size={15} />
              </span>
              <div className="header-titles">
                <span className="header-title">Import Data</span>
                <span className="header-sub font-mono">
                  {activeDatabase || "no database"}
                  {file ? ` · ${file.name}` : ""}
                </span>
              </div>
            </div>
            <button
              className="icon-close-btn"
              onClick={handleClose}
              disabled={running}
              title={running ? "An import is running" : "Close"}
            >
              <X size={14} />
            </button>
          </div>

          {/* ---------- Body ---------- */}
          <div className="import-body">
            <nav className="step-rail">
              {stepsToDisplay.map((s) => {
                const state = s.id === step ? "is-current" : s.id < step ? "is-done" : "";
                const blocked = stepBlocker(s.id);
                return (
                  <button
                    key={s.id}
                    className={`step-item ${state}`}
                    disabled={running || (s.id > step && !!blocked)}
                    onClick={() => setStep(s.id)}
                    title={blocked ?? s.hint}
                  >
                    <span className="step-index">{s.id < step ? <Check size={11} /> : s.id}</span>
                    <span className="step-text">
                      <span className="step-label">{s.label}</span>
                      <span className="step-hint">{s.hint}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="step-panel">
              {step === 1 && (
                <SourceStep
                  file={file}
                  format={format}
                  csv={csv}
                  picking={picking}
                  dragging={dragging}
                  error={fileError}
                  preview={preview}
                  previewing={previewing}
                  previewError={previewError}
                  activeDatabase={activeDatabase}
                  txMode={txMode}
                  onErrorMode={onErrorMode}
                  dryRun={dryRun}
                  dialectMismatch={dialectMismatch}
                  connectionType={activeProfile?.type}
                  onBrowse={handleBrowse}
                  onDrop={handleDrop}
                  onDragState={setDragging}
                  onFormat={(f) => {
                    setFormat(f);
                    setPreview(null);
                    setMappings([]);
                  }}
                  onCsv={(patch) => {
                    setCsv((prev) => ({ ...prev, ...patch }));
                    setPreview(null);
                  }}
                  onTxMode={setTxMode}
                  onErrorModeChange={setOnErrorMode}
                  onDryRun={setDryRun}
                  onRetryPreview={loadPreview}
                />
              )}

              {step === 2 && (
                <TargetStep
                  previewing={previewing}
                  error={previewError}
                  preview={preview}
                  tables={tables}
                  targetTable={targetTable}
                  creatingTable={creatingTable}
                  newTableName={newTableName}
                  targetColumns={targetColumns}
                  loadingTargetColumns={loadingTargetColumns}
                  mappings={mappings}
                  mappedCount={mappedCount}
                  dialectMismatch={dialectMismatch}
                  connectionType={activeProfile?.type}
                  onTargetTable={(v) => {
                    setTargetTable(v);
                    setTruncateTyped("");
                  }}
                  onNewTableName={(v) => {
                    setNewTableName(v);
                    setTruncateTyped("");
                  }}
                  onMapping={updateMapping}
                  onAutoMap={() => setMappings(buildMappings())}
                  onSkipAll={() => setMappings((prev) => prev.map((m) => ({ ...m, target: null })))}
                  onRetry={loadPreview}
                />
              )}

              {step === 3 && (
                <OptionsStep
                  isTabular={isTabular}
                  tableLabel={effectiveTable}
                  creatingTable={creatingTable}
                  batchSize={batchSize}
                  conflict={conflict}
                  canUpdateOnConflict={canUpdateOnConflict}
                  onErrorMode={onErrorMode}
                  txMode={txMode}
                  truncateFirst={truncateFirst}
                  truncateTyped={truncateTyped}
                  dryRun={dryRun}
                  onBatchSize={setBatchSize}
                  onConflict={setConflict}
                  onErrorModeChange={setOnErrorMode}
                  onTxMode={setTxMode}
                  onTruncateFirst={(v) => {
                    setTruncateFirst(v);
                    setTruncateTyped("");
                  }}
                  onTruncateTyped={setTruncateTyped}
                  onDryRun={setDryRun}
                />
              )}

              {step === 4 && (
                <RunStep
                  progress={progress}
                  report={report}
                  startError={startError}
                  copied={copiedReport}
                  onCopy={handleCopyReport}
                  onCancel={() => importManager.cancel()}
                />
              )}
            </div>
          </div>

          {/* ---------- Footer ---------- */}
          <div className="import-footer">
            <div className="footer-side">
              {step > 1 && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setStep((s) => (s - 1) as Step)}
                  disabled={running}
                >
                  <ArrowLeft size={12} />
                  <span>Back</span>
                </button>
              )}
            </div>
            <div className="footer-side">
              {nextBlocker && step < 4 && <span className="footer-hint">{nextBlocker}</span>}
              <button className="btn btn-secondary" onClick={handleClose} disabled={running}>
                {step === 4 && !running ? "Close" : "Cancel"}
              </button>
              {step === 1 && format === "sql" && (
                <button
                  className="btn btn-primary"
                  onClick={handleStart}
                  disabled={!file || previewing || !activeProfile}
                >
                  <Play size={12} />
                  <span>{dryRun ? "Run Dry Run" : "Start SQL Import"}</span>
                </button>
              )}
              {step < 3 && format !== "sql" && (
                <button
                  className="btn btn-primary"
                  onClick={() => setStep((s) => (s + 1) as Step)}
                  disabled={!!nextBlocker}
                >
                  <span>Next</span>
                  <ArrowRight size={12} />
                </button>
              )}
              {step === 3 && (
                <button
                  className={`btn ${truncateFirst ? "btn-danger" : "btn-primary"}`}
                  onClick={handleStart}
                  disabled={!!stepBlocker(4)}
                >
                  <Play size={12} />
                  <span>{dryRun ? "Run Dry Run" : "Start Import"}</span>
                </button>
              )}
              {step === 4 && !running && (
                <button className="btn btn-secondary" onClick={() => setStep(format === "sql" ? 1 : 3)}>
                  <Settings2 size={12} />
                  <span>Options</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .import-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.72);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          z-index: 999999;
          animation: fadeIn 0.14s ease;
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .import-card {
          width: 1040px;
          max-width: 95vw;
          height: 85vh;
          max-height: 760px;
          background: var(--bg-card);
          border: 1px solid var(--border-medium);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-popup);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp {
          from { transform: translateY(8px) scale(0.985); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }

        .import-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 11px 16px;
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-header);
          flex-shrink: 0;
        }
        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .header-chip {
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          border-radius: var(--radius-sm);
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .header-titles {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .header-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-main);
        }
        .header-sub {
          font-size: 11px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .icon-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          width: 28px;
          height: 28px;
          border-radius: var(--radius-xs);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.12s ease;
        }
        .icon-close-btn:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .icon-close-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .import-body {
          flex: 1;
          display: flex;
          min-height: 0;
        }
        .step-rail {
          width: 180px;
          flex-shrink: 0;
          border-right: 1px solid var(--border-light);
          background: var(--bg-sidebar);
          padding: 10px 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .step-item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 9px;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          text-align: left;
          width: 100%;
          color: var(--text-sub);
          transition: all 0.12s ease;
        }
        .step-item:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-main);
        }
        .step-item:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .step-item.is-current {
          background: var(--bg-active);
          color: var(--text-main);
        }
        .step-index {
          width: 19px;
          height: 19px;
          flex-shrink: 0;
          border-radius: 50%;
          border: 1px solid var(--border-medium);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          font-family: var(--font-mono);
        }
        .step-item.is-current .step-index {
          border-color: var(--accent-blue);
          background: var(--accent-blue);
          color: #ffffff;
        }
        .step-item.is-done .step-index {
          border-color: var(--accent-green);
          color: var(--accent-green);
        }
        .step-text {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .step-label {
          font-size: 11.5px;
          font-weight: 600;
        }
        .step-hint {
          font-size: 10px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .step-panel {
          flex: 1;
          min-width: 0;
          overflow-y: auto;
          padding: 16px 18px;
        }

        .import-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 16px;
          border-top: 1px solid var(--border-light);
          background: var(--bg-header);
          flex-shrink: 0;
        }
        .footer-side {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .footer-hint {
          font-size: 10.5px;
          color: var(--text-muted);
          margin-right: 2px;
        }

        @media (max-width: 820px) {
          .step-rail {
            width: 52px;
            padding: 10px 6px;
          }
          .import-portal-root :global(.step-text) {
            display: none;
          }
        }
      `}</style>
    </div>
  );

  return createPortal(
    <ImportErrorBoundary onClose={handleClose}>
      {content}
    </ImportErrorBoundary>,
    document.body
  );
};

// ==========================================
// Step 1 — Source
// ==========================================

interface SourceStepProps {
  file: ImportFileInfo | null;
  format: ImportFormat;
  csv: CsvOptions;
  picking: boolean;
  dragging: boolean;
  error: string | null;
  preview: ImportPreview | null;
  previewing: boolean;
  previewError: string | null;
  activeDatabase: string;
  txMode: TxMode;
  onErrorMode: OnErrorMode;
  dryRun: boolean;
  dialectMismatch: string | null;
  connectionType?: string;
  onBrowse: () => void;
  onDrop: (e: React.DragEvent) => void;
  onDragState: (dragging: boolean) => void;
  onFormat: (format: ImportFormat) => void;
  onCsv: (patch: Partial<CsvOptions>) => void;
  onTxMode: (tx: TxMode) => void;
  onErrorModeChange: (m: OnErrorMode) => void;
  onDryRun: (d: boolean) => void;
  onRetryPreview: () => void;
}

const SourceStep: React.FC<SourceStepProps> = ({
  file,
  format,
  csv,
  picking,
  dragging,
  error,
  preview,
  previewing,
  previewError,
  activeDatabase,
  txMode,
  onErrorMode,
  dryRun,
  dialectMismatch,
  connectionType,
  onBrowse,
  onDrop,
  onDragState,
  onFormat,
  onCsv,
  onTxMode,
  onErrorModeChange,
  onDryRun,
  onRetryPreview
}) => (
  <div className="pane">
    <SectionHeader
      icon={<Upload size={14} />}
      title="Source File"
      sub="Select a file to import into your database."
    />

    {file ? (
      <div className="file-card">
        <span className="file-chip">
          <FormatIcon format={format} size={15} />
        </span>
        <div className="file-meta">
          <span className="file-name font-mono">{file.name}</span>
          <span className="file-sub">
            {formatBytes(file.sizeBytes)}
            {!file.looksUtf8 && " · not UTF-8"}
          </span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onBrowse} disabled={picking}>
          {picking ? <Loader2 size={11} className="spin" /> : <FolderOpen size={11} />}
          <span>Change File</span>
        </button>
      </div>
    ) : (
      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          onDragState(true);
        }}
        onDragLeave={() => onDragState(false)}
        onDrop={onDrop}
      >
        <Upload size={26} className="dropzone-icon" />
        <span className="dropzone-title">Drop a file here</span>
        <span className="dropzone-sub font-mono">.sql · .csv · .tsv · .json · .jsonl</span>
        <button className="btn btn-primary btn-sm" onClick={onBrowse} disabled={picking}>
          {picking ? <Loader2 size={11} className="spin" /> : <FolderOpen size={11} />}
          <span>Browse…</span>
        </button>
      </div>
    )}

    {error && <Banner tone="error" text={error} />}

    <div className="field-group">
      <span className="micro-label">Format</span>
      <div className="pill-row">
        {FORMAT_META.map((f) => (
          <button
            key={f.id}
            className={`pill ${format === f.id ? "is-active" : ""}`}
            onClick={() => onFormat(f.id)}
          >
            <FormatIcon format={f.id} size={13} />
            <span className="pill-label">{f.label}</span>
            <span className="pill-hint">{f.hint}</span>
          </button>
        ))}
      </div>
    </div>

    {/* SQL Dump Direct Single-View Panel */}
    {format === "sql" && (
      <div className="sql-direct-panel">
        <div className="sql-info-row">
          <div className="target-badge">
            <Database size={13} className="target-badge-icon" />
            <span>Target Database: <strong className="font-mono">{activeDatabase || "None"}</strong></span>
          </div>
          {preview?.kind === "sql" && preview.estimatedStatements != null && (
            <span className="sql-stmt-badge font-mono">
              ~{Number(preview.estimatedStatements || 0).toLocaleString()} statements
            </span>
          )}
        </div>

        {dialectMismatch && (
          <Banner
            tone="warn"
            text={`This dump looks like ${dialectMismatch}, but you are connected to ${connectionType || "current database"}. Dialect-specific statements may fail.`}
          />
        )}
        {preview?.kind === "sql" && typeof preview.copyBlocks === "number" && preview.copyBlocks > 0 && (
          <Banner
            tone="info"
            text={`${preview.copyBlocks} COPY … FROM stdin block(s) found and will be converted to INSERTs automatically.`}
          />
        )}
        {previewError && (
          <Banner
            tone="error"
            text={`Failed to read preview: ${previewError}`}
          />
        )}

        {/* SQL Statements Preview */}
        {file && (
          <div className="sql-preview-card">
            <div className="sql-card-header">
              <span className="sql-card-title font-mono">SQL Statement Preview</span>
              {previewing && <Loader2 size={12} className="spin" />}
            </div>
            <div className="sql-list-view font-mono">
              {preview?.kind === "sql" && Array.isArray(preview.statements) && preview.statements.length > 0 ? (
                preview.statements.slice(0, 50).map((s, i) => (
                  <div key={i} className="sql-preview-row">
                    <span className="sql-line-num">{s.line}</span>
                    <span className="sql-code-snippet">{s.sql}</span>
                  </div>
                ))
              ) : previewing ? (
                <div className="sql-empty-hint">Scanning SQL statements...</div>
              ) : (
                <div className="sql-empty-hint">No SQL statements found in preview.</div>
              )}
            </div>
          </div>
        )}

        {/* Options Row */}
        <div className="sql-options-card">
          <span className="micro-label">Execution Options</span>
          <div className="sql-options-grid">
            <label className="field">
              <span className="field-label">Transaction Mode</span>
              <select
                className="input select"
                value={txMode}
                onChange={(e) => onTxMode(e.target.value as TxMode)}
              >
                <option value="singleTransaction">Single Transaction (All or nothing)</option>
                <option value="perStatement">Statement by Statement (No Transaction)</option>
                <option value="atomicBatch">Per Batch</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">On Statement Error</span>
              <select
                className="input select"
                value={onErrorMode}
                onChange={(e) => onErrorModeChange(e.target.value as OnErrorMode)}
              >
                <option value="abort">Stop immediately</option>
                <option value="skipRow">Continue on errors</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(e) => onDryRun(e.target.checked)}
            />
            <span>Dry run (validate SQL syntax without committing changes)</span>
          </label>
        </div>
      </div>
    )}

    {format === "csv" && (
      <div className="field-group">
        <span className="micro-label">Parsing</span>
        <div className="field-grid">
          <label className="field">
            <span className="field-label">Delimiter</span>
            <select
              className="input select font-mono"
              value={csv.delimiter}
              onChange={(e) => onCsv({ delimiter: e.target.value })}
            >
              {DELIMITERS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Quote character</span>
            <input
              className="input font-mono"
              value={csv.quote}
              maxLength={1}
              onChange={(e) => onCsv({ quote: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Encoding</span>
            <select
              className="input select"
              value={csv.encoding}
              onChange={(e) => onCsv({ encoding: e.target.value as SourceEncoding })}
            >
              {ENCODINGS.map((e2) => (
                <option key={e2.value} value={e2.value}>
                  {e2.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Treat as NULL</span>
            <input
              className="input font-mono"
              placeholder="(none)"
              value={csv.nullLiteral ?? ""}
              onChange={(e) => onCsv({ nullLiteral: e.target.value || null })}
            />
          </label>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={csv.hasHeader}
            onChange={(e) => onCsv({ hasHeader: e.target.checked })}
          />
          <span>First row is a header</span>
        </label>
        {file && !file.looksUtf8 && csv.encoding === "utf8" && (
          <Banner
            tone="warn"
            text="This file is not valid UTF-8. Pick TIS-620 / CP874 if it came out of Excel on a Thai system."
          />
        )}
        <p className="note">
          <code className="font-mono">\N</code> always counts as NULL. An empty cell is NULL for
          numeric and boolean columns, and an empty string for text.
        </p>
      </div>
    )}

    {format === "json" && (
      <p className="note">
        A file of one JSON object per line (<code className="font-mono">.jsonl</code>) is streamed.
        A single top-level array has to be parsed whole, so very large arrays are rejected with a
        pointer to JSON Lines.
      </p>
    )}

    {format === "sql" && (
      <p className="note">
        Statements run exactly as written — no dialect translation. Comments and{" "}
        <code className="font-mono">DELIMITER</code> blocks are handled, and mysqldump&apos;s{" "}
        <code className="font-mono">{"/*!…*/"}</code> version blocks are skipped rather than
        executed.
      </p>
    )}

    <style jsx>{`
      .pane {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .dropzone {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 30px 16px;
        border: 1px dashed var(--border-medium);
        border-radius: var(--radius-md);
        background: var(--bg-tertiary);
        transition: all 0.12s ease;
      }
      .dropzone.is-dragging {
        border-color: var(--accent-blue);
        background: rgba(59, 130, 246, 0.06);
      }
      .dropzone-title {
        font-size: 12.5px;
        font-weight: 600;
        color: var(--text-main);
      }
      .dropzone-sub {
        font-size: 10.5px;
        color: var(--text-muted);
        margin-bottom: 4px;
      }
      .file-card {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 11px 13px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-md);
      }
      .file-chip {
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        border-radius: var(--radius-sm);
        background: rgba(59, 130, 246, 0.15);
        color: var(--accent-blue);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .file-meta {
        display: flex;
        flex-direction: column;
        gap: 1px;
        flex: 1;
        min-width: 0;
      }
      .file-name {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-main);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .file-sub {
        font-size: 10.5px;
        color: var(--text-muted);
      }
      .field-group {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .pill-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 7px;
      }
      .pill {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 9px 11px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-sm);
        color: var(--text-sub);
        cursor: pointer;
        transition: all 0.12s ease;
      }
      .pill:hover:not(:disabled) {
        border-color: var(--border-medium);
        color: var(--text-main);
      }
      .pill:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .pill.is-active {
        border-color: var(--accent-blue);
        box-shadow: 0 0 0 1px var(--accent-blue);
        color: var(--text-main);
      }
      .pill-label {
        font-size: 11.5px;
        font-weight: 600;
      }
      .pill-hint {
        font-size: 10px;
        color: var(--text-muted);
      }
      .field-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 9px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .field-label {
        font-size: 10.5px;
        color: var(--text-sub);
      }
      .check-row {
        display: flex;
        align-items: center;
        gap: 7px;
        font-size: 11.5px;
        color: var(--text-main);
        cursor: pointer;
      }
      .sql-direct-panel {
        display: flex;
        flex-direction: column;
        gap: 10px;
        animation: fadeIn 0.12s ease;
      }
      .sql-info-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .target-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 11.5px;
        color: var(--text-main);
        background: var(--bg-tertiary);
        padding: 5px 10px;
        border: 1px solid var(--border-light);
        border-radius: var(--radius-xs);
      }
      :global(.target-badge-icon) {
        color: var(--accent-blue);
      }
      .sql-stmt-badge {
        font-size: 10.5px;
        font-weight: 600;
        color: var(--text-sub);
        background: var(--bg-tertiary);
        padding: 4px 8px;
        border: 1px solid var(--border-light);
        border-radius: var(--radius-xs);
      }
      .sql-preview-card {
        display: flex;
        flex-direction: column;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-sm);
        overflow: hidden;
      }
      .sql-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        background: var(--bg-card);
        border-bottom: 1px solid var(--border-light);
      }
      .sql-card-title {
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 700;
        color: var(--text-muted);
      }
      .sql-list-view {
        max-height: 180px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        font-size: 11px;
        background: var(--bg-tertiary);
      }
      .sql-preview-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
        padding: 4px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      }
      .sql-preview-row:last-child {
        border-bottom: none;
      }
      .sql-line-num {
        color: var(--text-muted);
        font-size: 10px;
        user-select: none;
        min-width: 24px;
      }
      .sql-code-snippet {
        color: var(--text-main);
        word-break: break-all;
        line-height: 1.4;
      }
      .sql-empty-hint {
        padding: 18px;
        font-size: 11px;
        color: var(--text-muted);
        text-align: center;
      }
      .sql-options-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px 12px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-sm);
      }
      .sql-options-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      @media (max-width: 600px) {
        .sql-options-grid {
          grid-template-columns: 1fr;
        }
      }
      .note {
        font-size: 10.5px;
        color: var(--text-muted);
        line-height: 1.55;
        margin: 0;
      }
      .note code {
        color: var(--text-sub);
      }
      :global(.dropzone-icon) {
        color: var(--text-muted);
      }
      :global(.spin) {
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

// ==========================================
// Step 2 — Target & mapping
// ==========================================

interface TargetStepProps {
  previewing: boolean;
  error: string | null;
  preview: ImportPreview | null;
  tables: string[];
  targetTable: string;
  creatingTable: boolean;
  newTableName: string;
  targetColumns: ColumnInfo[];
  loadingTargetColumns: boolean;
  mappings: ColumnMapping[];
  mappedCount: number;
  dialectMismatch: string | null;
  connectionType?: string;
  onTargetTable: (value: string) => void;
  onNewTableName: (value: string) => void;
  onMapping: (index: number, patch: Partial<ColumnMapping>) => void;
  onAutoMap: () => void;
  onSkipAll: () => void;
  onRetry: () => void;
}

const TargetStep: React.FC<TargetStepProps> = ({
  previewing,
  error,
  preview,
  tables,
  targetTable,
  creatingTable,
  newTableName,
  targetColumns,
  loadingTargetColumns,
  mappings,
  mappedCount,
  dialectMismatch,
  connectionType,
  onTargetTable,
  onNewTableName,
  onMapping,
  onAutoMap,
  onSkipAll,
  onRetry
}) => {
  if (previewing) {
    return (
      <div className="centered">
        <Loader2 size={16} className="spin" />
        <span>Reading the head of the file…</span>
        <style jsx>{`
          .centered {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 9px;
            height: 100%;
            font-size: 11.5px;
            color: var(--text-muted);
          }
          :global(.spin) {
            animation: spin 0.8s linear infinite;
            color: var(--accent-blue);
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="pane">
        <Banner tone="error" text={error} />
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>
          <span>Try again</span>
        </button>
        <style jsx>{`
          .pane {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }
        `}</style>
      </div>
    );
  }

  if (!preview) return null;

  if (preview.kind === "sql") {
    return (
      <div className="pane">
        <SectionHeader
          icon={<FileCode size={14} />}
          title="Statements to replay"
          sub={
            preview.exact
              ? `${preview.estimatedStatements.toLocaleString()} statements in this file.`
              : `About ${preview.estimatedStatements.toLocaleString()} statements, extrapolated from the first few megabytes.`
          }
        />

        {dialectMismatch && (
          <Banner
            tone="warn"
            text={`This dump looks like ${dialectMismatch}, but you are connected to ${connectionType}. Statements run unchanged, so anything dialect-specific will fail and be listed in the report.`}
          />
        )}
        {preview.copyBlocks > 0 && (
          <Banner
            tone="info"
            text={`${preview.copyBlocks} COPY … FROM stdin block(s) found. This is how a default pg_dump stores its rows; they will be read and converted to INSERTs.`}
          />
        )}
        {preview.skippedVersionComments > 0 && (
          <Banner
            tone="info"
            text={`${preview.skippedVersionComments} version-gated /*!…*/ block(s) will be skipped rather than executed.`}
          />
        )}
        {preview.skippedMetaCommands > 0 && (
          <Banner
            tone="info"
            text={`${preview.skippedMetaCommands} psql directive(s) such as \\restrict will be dropped — they are client-side commands, not SQL.`}
          />
        )}

        <div className="sql-list">
          {preview.statements.map((s, i) => (
            <div key={i} className="sql-row">
              <span className="sql-line font-mono">{s.line}</span>
              <span className="sql-text font-mono">{s.sql}</span>
            </div>
          ))}
          {preview.statements.length === 0 && (
            <span className="empty">No statements found in this file.</span>
          )}
        </div>

        <style jsx>{`
          .pane {
            display: flex;
            flex-direction: column;
            gap: 14px;
          }
          .sql-list {
            display: flex;
            flex-direction: column;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-sm);
            background: var(--bg-tertiary);
            overflow: hidden;
          }
          .sql-row {
            display: flex;
            gap: 10px;
            padding: 6px 10px;
            border-bottom: 1px solid var(--border-light);
          }
          .sql-row:last-child {
            border-bottom: none;
          }
          .sql-line {
            width: 46px;
            flex-shrink: 0;
            text-align: right;
            font-size: 10px;
            color: var(--text-muted);
            padding-top: 1px;
          }
          .sql-text {
            font-size: 11px;
            line-height: 1.55;
            color: var(--text-main);
            white-space: pre-wrap;
            word-break: break-word;
            user-select: text;
          }
          .empty {
            padding: 18px;
            text-align: center;
            font-size: 11px;
            color: var(--text-muted);
          }
        `}</style>
      </div>
    );
  }

  const sampleRows = preview.rows.slice(0, 5);

  return (
    <div className="pane">
      <SectionHeader
        icon={<Table2 size={14} />}
        title="Target table"
        sub="Import into a table that already exists, or let dodb create one from the inferred types."
      />

      <div className="target-row">
        <label className="field grow">
          <span className="field-label">Table</span>
          <select
            className="input select font-mono"
            value={targetTable}
            onChange={(e) => onTargetTable(e.target.value)}
          >
            <option value="">Choose a table…</option>
            <option value={CREATE_NEW}>+ Create a new table</option>
            {tables.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {creatingTable && (
          <label className="field grow">
            <span className="field-label">New table name</span>
            <input
              className="input font-mono"
              placeholder="imported_table"
              value={newTableName}
              onChange={(e) => onNewTableName(e.target.value)}
              autoFocus
            />
          </label>
        )}
      </div>

      <div className="map-head">
        <span className="micro-label">
          Column mapping · {mappedCount}/{mappings.length} mapped
        </span>
        <div className="map-actions">
          <button className="btn-link" onClick={onAutoMap} type="button">
            <Wand2 size={11} />
            <span>Auto-map</span>
          </button>
          <button className="btn-link" onClick={onSkipAll} type="button">
            <ListX size={11} />
            <span>Skip all</span>
          </button>
        </div>
      </div>

      {loadingTargetColumns && <span className="loading-note">Reading the table&apos;s columns…</span>}

      <div className="table-wrap">
        <table className="map-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Sample</th>
              <th className="narrow">Reads as</th>
              <th className="narrow">Target column</th>
              {creatingTable && <th className="narrow">SQL type</th>}
            </tr>
          </thead>
          <tbody>
            {mappings.map((m, i) => {
              const col = preview.columns[i];
              return (
                <tr key={m.source} className={m.target ? "" : "is-skipped"}>
                  <td className="font-mono strong">{m.source}</td>
                  <td className="font-mono muted">
                    {col?.samples.slice(0, 2).join(" · ") || <em>empty</em>}
                  </td>
                  <td>
                    <select
                      className="input select cell-select"
                      value={m.valueType}
                      onChange={(e) => onMapping(i, { valueType: e.target.value as InferredType })}
                    >
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {creatingTable ? (
                      <input
                        className="input font-mono cell-select"
                        value={m.target ?? ""}
                        placeholder="— skip —"
                        onChange={(e) => onMapping(i, { target: e.target.value || null })}
                      />
                    ) : (
                      <select
                        className="input select font-mono cell-select"
                        value={m.target ?? ""}
                        onChange={(e) => onMapping(i, { target: e.target.value || null })}
                      >
                        <option value="">— skip —</option>
                        {targetColumns.map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                            {t.primaryKey ? "  (pk)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {creatingTable && (
                    <td>
                      <input
                        className="input font-mono cell-select"
                        placeholder="(auto)"
                        value={m.sqlType ?? ""}
                        onChange={(e) => onMapping(i, { sqlType: e.target.value || null })}
                      />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <span className="micro-label">
        Sample rows · {preview.sampledRows} read from the head of the file
      </span>
      <div className="table-wrap">
        <table className="map-table sample-table">
          <thead>
            <tr>
              {preview.columns.map((c) => (
                <th key={c.name} className="font-mono">
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sampleRows.map((row, r) => (
              <tr key={r}>
                {preview.columns.map((c, ci) => (
                  <td key={c.name} className="font-mono">
                    {row[ci] === null || row[ci] === undefined ? (
                      <span className="null-cell">NULL</span>
                    ) : (
                      row[ci]
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        .pane {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .target-row {
          display: flex;
          gap: 10px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .field.grow {
          flex: 1;
          min-width: 0;
        }
        .field-label {
          font-size: 10.5px;
          color: var(--text-sub);
        }
        .map-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .map-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .btn-link {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: transparent;
          border: none;
          color: var(--accent-blue);
          font-size: 10.5px;
          cursor: pointer;
          padding: 0;
        }
        .btn-link:hover {
          text-decoration: underline;
        }
        .loading-note {
          font-size: 10.5px;
          color: var(--text-muted);
        }
        .table-wrap {
          border: 1px solid var(--border-light);
          border-radius: var(--radius-sm);
          overflow-x: auto;
          background: var(--bg-tertiary);
        }
        .map-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11.5px;
        }
        .map-table th {
          text-align: left;
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-muted);
          background: var(--bg-header);
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-light);
          white-space: nowrap;
        }
        .map-table th.narrow {
          width: 150px;
        }
        .map-table td {
          padding: 5px 10px;
          border-bottom: 1px solid var(--border-light);
          color: var(--text-main);
          vertical-align: middle;
          max-width: 260px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .map-table tbody tr:last-child td {
          border-bottom: none;
        }
        .map-table tbody tr:hover td {
          background: var(--bg-hover);
        }
        .map-table tr.is-skipped td {
          opacity: 0.5;
        }
        .strong {
          font-weight: 600;
        }
        .muted {
          color: var(--text-muted);
          font-size: 11px;
        }
        .null-cell {
          color: var(--text-muted);
          font-style: italic;
        }
        .sample-table td {
          user-select: text;
        }
        .import-portal-root :global(.cell-select) {
          width: 100%;
          height: 24px;
          font-size: 11px;
          padding: 2px 6px;
        }
      `}</style>
    </div>
  );
};

// ==========================================
// Step 3 — Options
// ==========================================

interface OptionsStepProps {
  isTabular: boolean;
  tableLabel: string;
  creatingTable: boolean;
  batchSize: number;
  conflict: ConflictStrategy;
  canUpdateOnConflict: boolean;
  onErrorMode: OnErrorMode;
  txMode: TxMode;
  truncateFirst: boolean;
  truncateTyped: string;
  dryRun: boolean;
  onBatchSize: (n: number) => void;
  onConflict: (c: ConflictStrategy) => void;
  onErrorModeChange: (m: OnErrorMode) => void;
  onTxMode: (m: TxMode) => void;
  onTruncateFirst: (v: boolean) => void;
  onTruncateTyped: (v: string) => void;
  onDryRun: (v: boolean) => void;
}

const OptionsStep: React.FC<OptionsStepProps> = ({
  isTabular,
  tableLabel,
  creatingTable,
  batchSize,
  conflict,
  canUpdateOnConflict,
  onErrorMode,
  txMode,
  truncateFirst,
  truncateTyped,
  dryRun,
  onBatchSize,
  onConflict,
  onErrorModeChange,
  onTxMode,
  onTruncateFirst,
  onTruncateTyped,
  onDryRun
}) => (
  <div className="pane">
    <SectionHeader
      icon={<Settings2 size={14} />}
      title="How to run it"
      sub="Batching, what to do about duplicates, and how much to roll back when something fails."
    />

    <div className="opt-row">
      <label className="field">
        <span className="field-label">Rows per batch</span>
        <select
          className="input select font-mono"
          value={batchSize}
          onChange={(e) => onBatchSize(Number(e.target.value))}
        >
          {BATCH_SIZES.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <p className="opt-note">
        {isTabular
          ? "Each batch becomes one multi-row INSERT."
          : "Statements from the dump are applied this many at a time."}
      </p>
    </div>

    {isTabular && (
      <Choice
        label="On a duplicate key"
        options={[
          { value: "error", label: "Fail", hint: "Report the duplicate" },
          { value: "skip", label: "Skip", hint: "Keep the existing row" },
          {
            value: "update",
            label: "Update",
            hint: canUpdateOnConflict ? "Overwrite the existing row" : "Needs a primary key",
            disabled: !canUpdateOnConflict
          }
        ]}
        value={conflict}
        onChange={(v) => onConflict(v as ConflictStrategy)}
      />
    )}

    <Choice
      label="When a statement fails"
      options={[
        { value: "abort", label: "Stop", hint: "Leave the rest untouched" },
        { value: "skipRow", label: "Keep going", hint: "Collect every failure" }
      ]}
      value={onErrorMode}
      onChange={(v) => onErrorModeChange(v as OnErrorMode)}
    />

    <Choice
      label="Transaction"
      options={[
        { value: "atomicBatch", label: "Per batch", hint: "A failed batch rolls back alone" },
        { value: "singleTransaction", label: "Whole file", hint: "All or nothing" },
        { value: "perStatement", label: "None", hint: "Required for MySQL DDL" }
      ]}
      value={txMode}
      onChange={(v) => onTxMode(v as TxMode)}
    />

    <div className="danger-zone">
      <label className="check-row">
        <input type="checkbox" checked={dryRun} onChange={(e) => onDryRun(e.target.checked)} />
        <span className="check-text">
          <span className="check-label">Dry run</span>
          <span className="check-hint">
            Walk the whole file and report every value that will not convert, without writing
            anything.
          </span>
        </span>
      </label>

      {isTabular && !creatingTable && (
        <>
          <label className="check-row">
            <input
              type="checkbox"
              checked={truncateFirst}
              onChange={(e) => onTruncateFirst(e.target.checked)}
            />
            <span className="check-text">
              <span className="check-label danger">Empty the table first</span>
              <span className="check-hint">
                Deletes every existing row in{" "}
                <code className="font-mono">{tableLabel || "the table"}</code> before importing.
                This cannot be undone.
              </span>
            </span>
          </label>
          {truncateFirst && (
            <div className="type-field">
              <label className="type-label">
                Type <span className="font-mono type-target">{tableLabel}</span> to confirm
              </label>
              <input
                className="input font-mono confirm-input"
                value={truncateTyped}
                placeholder={tableLabel}
                autoFocus
                onChange={(e) => onTruncateTyped(e.target.value)}
              />
            </div>
          )}
        </>
      )}
    </div>

    <style jsx>{`
      .pane {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .opt-row {
        display: flex;
        align-items: flex-end;
        gap: 12px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        width: 170px;
      }
      .field-label {
        font-size: 10.5px;
        color: var(--text-sub);
      }
      .opt-note {
        font-size: 10.5px;
        color: var(--text-muted);
        margin: 0 0 6px 0;
      }
      .danger-zone {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 13px 14px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-md);
      }
      .check-row {
        display: flex;
        align-items: flex-start;
        gap: 9px;
        cursor: pointer;
      }
      .check-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .check-label {
        font-size: 11.5px;
        font-weight: 600;
        color: var(--text-main);
      }
      .check-label.danger {
        color: var(--accent-red);
      }
      .check-hint {
        font-size: 10.5px;
        color: var(--text-muted);
        line-height: 1.5;
      }
      .check-hint code {
        color: var(--text-sub);
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
      .import-portal-root :global(.confirm-input) {
        max-width: 280px;
      }
    `}</style>
  </div>
);

// ==========================================
// Step 4 — Run
// ==========================================

interface RunStepProps {
  progress: ImportProgress;
  report: ImportReport | null;
  startError: string | null;
  copied: boolean;
  onCopy: () => void;
  onCancel: () => void;
}

const STATUS_META: Record<ImportProgress["status"], { label: string; tone: string }> = {
  idle: { label: "Ready", tone: "idle" },
  running: { label: "Running", tone: "running" },
  completed: { label: "Completed", tone: "completed" },
  cancelled: { label: "Cancelled", tone: "cancelled" },
  error: { label: "Failed", tone: "error" }
};

const RunStep: React.FC<RunStepProps> = ({
  progress,
  report,
  startError,
  copied,
  onCopy,
  onCancel
}) => {
  const running = progress.status === "running";
  const status = STATUS_META[progress.status];
  const label = running && progress.phase === "preparing" ? "Preparing" : status.label;

  return (
    <div className="pane">
      <div className="status-box">
        <div className="status-top">
          <span className={`status-pill is-${status.tone}`}>
            {running && <Loader2 size={10} className="spin" />}
            {progress.status === "completed" && <CheckCircle2 size={10} />}
            {progress.status === "error" && <XCircle size={10} />}
            {progress.status === "cancelled" && <Ban size={10} />}
            <span>{report?.dryRun && !running ? `${label} (dry run)` : label}</span>
          </span>
          <span className="elapsed">
            <Clock size={11} />
            <span className="font-mono">{formatDuration(progress.elapsedSeconds)}</span>
          </span>
        </div>

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress.percentage}%` }} />
        </div>

        <div className="metrics">
          <Metric
            label="Read"
            value={`${formatBytes(progress.bytesRead)} / ${formatBytes(progress.totalBytes)}`}
          />
          <Metric label="Rows" value={progress.rowsImported.toLocaleString()} />
          <Metric label="Statements" value={progress.statementsRun.toLocaleString()} />
          <Metric label="Errors" value={progress.errors.toLocaleString()} tone={progress.errors > 0 ? "bad" : undefined} />
        </div>

        {running && (
          <button className="btn btn-danger btn-sm cancel-btn" onClick={onCancel}>
            <Ban size={11} />
            <span>Cancel import</span>
          </button>
        )}
      </div>

      {startError && <Banner tone="error" text={startError} />}

      {report && (
        <>
          <div className="report-head">
            <span className="micro-label">
              {report.dryRun ? "Dry run report" : "Import report"}
              {report.tablesTouched.length > 0 && ` · ${report.tablesTouched.join(", ")}`}
            </span>
            <button className="btn-copy" onClick={onCopy} type="button" title="Copy the report">
              {copied ? <Check size={11} /> : <Copy size={11} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {report.dryRun && report.failures.length === 0 && (
            <Banner
              tone="ok"
              text={`Every value converted cleanly across ${report.rowsImported.toLocaleString()} rows. Turn off Dry run to write them.`}
            />
          )}
          {report.cancelled && (
            <Banner
              tone="warn"
              text="Cancelled part-way. Batches that had already committed are still in the table."
            />
          )}
          {report.copyRows > 0 && (
            <Banner
              tone="info"
              text={`${report.copyRows.toLocaleString()} of those rows came from pg_dump COPY blocks.`}
            />
          )}
          {report.skippedVersionComments > 0 && (
            <Banner
              tone="info"
              text={`${report.skippedVersionComments} version-gated /*!…*/ block(s) were skipped.`}
            />
          )}
          {report.skippedMetaCommands > 0 && (
            <Banner
              tone="info"
              text={`${report.skippedMetaCommands} psql directive(s) were dropped.`}
            />
          )}

          {report.failures.length > 0 && (
            <div className="failures">
              {report.failures.map((f, i) => (
                <div key={i} className="failure">
                  <div className="failure-head">
                    <span className="failure-index font-mono">
                      #{f.index}
                      {f.line != null ? ` · line ${f.line}` : ""}
                    </span>
                    <span className="failure-msg">{f.message}</span>
                  </div>
                  <div className="failure-excerpt font-mono">{f.excerpt}</div>
                </div>
              ))}
              {report.failuresTruncated && (
                <span className="truncated">
                  Stopped after the error limit — there may be more further into the file.
                </span>
              )}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .pane {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .status-box {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px 16px;
          background: var(--bg-tertiary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-md);
        }
        .status-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 9px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .status-pill.is-idle {
          background: var(--bg-card);
          color: var(--text-muted);
        }
        .status-pill.is-running {
          background: rgba(59, 130, 246, 0.15);
          color: var(--accent-blue);
        }
        .status-pill.is-completed {
          background: rgba(16, 185, 129, 0.15);
          color: var(--accent-green);
        }
        .status-pill.is-cancelled {
          background: rgba(245, 158, 11, 0.15);
          color: var(--accent-amber);
        }
        .status-pill.is-error {
          background: rgba(239, 68, 68, 0.15);
          color: var(--accent-red);
        }
        .elapsed {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10.5px;
          color: var(--text-muted);
        }
        .progress-track {
          width: 100%;
          height: 8px;
          background: var(--bg-card);
          border: 1px solid var(--border-light);
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--accent-blue), #10b981);
          border-radius: 4px;
          transition: width 0.2s ease;
        }
        .metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 9px;
        }
        .import-portal-root :global(.cancel-btn) {
          align-self: flex-start;
        }
        .report-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .btn-copy {
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
        .btn-copy:hover {
          background: var(--bg-hover);
          border-color: var(--text-muted);
        }
        .failures {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .failure {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 10px;
          background: var(--bg-tertiary);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: var(--radius-xs);
        }
        .failure-head {
          display: flex;
          gap: 8px;
          align-items: baseline;
        }
        .failure-index {
          font-size: 10px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .failure-msg {
          font-size: 11px;
          color: var(--accent-red);
          line-height: 1.45;
          user-select: text;
          white-space: pre-wrap;
        }
        .failure-excerpt {
          font-size: 10.5px;
          color: var(--text-sub);
          background: var(--bg-card);
          border-radius: var(--radius-xs);
          padding: 5px 8px;
          user-select: text;
          word-break: break-word;
          max-height: 90px;
          overflow-y: auto;
        }
        .truncated {
          font-size: 10.5px;
          color: var(--accent-amber);
        }
        :global(.spin) {
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

// ==========================================
// Shared bits
// ==========================================

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string; sub: string }> = ({
  icon,
  title,
  sub
}) => (
  <div className="sh">
    <span className="sh-title">
      {icon}
      <span>{title}</span>
    </span>
    <span className="sh-sub">{sub}</span>
    <style jsx>{`
      .sh {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .sh-title {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-main);
      }
      .sh-sub {
        font-size: 10.5px;
        color: var(--text-muted);
        line-height: 1.5;
      }
    `}</style>
  </div>
);

const Metric: React.FC<{ label: string; value: string; tone?: "bad" }> = ({
  label,
  value,
  tone
}) => (
  <div className="metric">
    <span className="metric-label">{label}</span>
    <span className={`metric-value font-mono ${tone === "bad" ? "is-bad" : ""}`}>{value}</span>
    <style jsx>{`
      .metric {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 7px 10px;
        background: var(--bg-card);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-xs);
        min-width: 0;
      }
      .metric-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-muted);
      }
      .metric-value {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-main);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .metric-value.is-bad {
        color: var(--accent-red);
      }
    `}</style>
  </div>
);

const BANNER_ICON = {
  error: <XCircle size={12} />,
  warn: <AlertTriangle size={12} />,
  info: <Info size={12} />,
  ok: <CheckCircle2 size={12} />
};

const Banner: React.FC<{ tone: "error" | "warn" | "info" | "ok"; text: string }> = ({
  tone,
  text
}) => (
  <div className={`banner is-${tone}`}>
    {BANNER_ICON[tone]}
    <span>{text}</span>
    <style jsx>{`
      .banner {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 11px;
        border-radius: var(--radius-sm);
        font-size: 11px;
        line-height: 1.5;
        user-select: text;
      }
      .banner.is-error {
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.28);
        color: var(--accent-red);
      }
      .banner.is-warn {
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.28);
        color: var(--accent-amber);
      }
      .banner.is-info {
        background: rgba(59, 130, 246, 0.1);
        border: 1px solid rgba(59, 130, 246, 0.28);
        color: var(--accent-blue);
      }
      .banner.is-ok {
        background: rgba(16, 185, 129, 0.1);
        border: 1px solid rgba(16, 185, 129, 0.28);
        color: var(--accent-green);
      }
    `}</style>
  </div>
);

interface ChoiceOption {
  value: string;
  label: string;
  hint: string;
  disabled?: boolean;
}

const Choice: React.FC<{
  label: string;
  options: ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
}> = ({ label, options, value, onChange }) => (
  <div className="choice">
    <span className="micro-label">{label}</span>
    <div className="choice-row" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`choice-btn ${value === o.value ? "is-active" : ""}`}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          title={o.hint}
        >
          <span className="choice-label">{o.label}</span>
          <span className="choice-hint">{o.hint}</span>
        </button>
      ))}
    </div>
    <style jsx>{`
      .choice {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .choice-row {
        display: grid;
        gap: 7px;
      }
      .choice-btn {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        padding: 8px 11px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-sm);
        color: var(--text-sub);
        cursor: pointer;
        text-align: left;
        transition: all 0.12s ease;
      }
      .choice-btn:hover:not(:disabled) {
        border-color: var(--border-medium);
        color: var(--text-main);
      }
      .choice-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .choice-btn.is-active {
        border-color: var(--accent-blue);
        box-shadow: 0 0 0 1px var(--accent-blue);
        color: var(--text-main);
      }
      .choice-label {
        font-size: 11.5px;
        font-weight: 600;
      }
      .choice-hint {
        font-size: 10px;
        color: var(--text-muted);
      }
    `}</style>
  </div>
);
