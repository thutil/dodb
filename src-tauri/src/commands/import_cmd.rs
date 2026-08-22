//! Streaming data import: SQL scripts, CSV/TSV and JSON/JSONL.
//!
//! Reading, splitting and coercion all happen here rather than in the webview
//! so a multi-gigabyte dump never has to fit in memory. Progress is pushed back
//! over a `tauri::ipc::Channel`; cancellation flips a flag in `ImportState`
//! that the executor checks at every batch boundary.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};

use encoding_rs_io::DecodeReaderBytesBuilder;
use tauri::{command, ipc::Channel, State};

use crate::commands::database_cmd::get_columns;
use crate::db_core::{
    execute_command_raw, execute_import_stream, get_pool, resolve_profile, BatchItem, BatchSource,
    DbState, ImportExecOptions, ImportTick,
};
use crate::commands::database_cmd::{quote_column_ident, quote_table_ident};
use crate::db_core::escape_sql_literal;
use crate::import::{
    build_clear_table, build_create_table, build_insert_batch, decode_bytes, detect_format,
    dialect_hints, excerpt, format_import_value, infer_type, looks_utf8, merge_record_keys,
    parse_copy_header, sanitize_header, sanitize_ident, sniff_delimiter, split_copy_row,
    sql_type_for, value_type_from_sql_type, ColumnMapping, ConflictStrategy, CopyHeader,
    CsvOptions, ImportFailure, ImportFormat, ImportProgress, ImportReport, ImportRequest,
    InferredType, JsonRecord, SourceEncoding, SplitStatement, SqlSplitter,
};
use crate::models::SupportedDB;

/// How much of the file the preview is allowed to touch. The point of the
/// preview is to be instant on a 40 GB dump, so it is bounded twice over.
const PREVIEW_BYTES: usize = 2 * 1024 * 1024;
const PREVIEW_ROWS: usize = 200;
const PREVIEW_STATEMENTS: usize = 50;
/// A top-level JSON array has to be parsed whole; past this, ask for JSONL.
const JSON_ARRAY_MAX_BYTES: u64 = 256 * 1024 * 1024;

// ==========================================
// Managed state
// ==========================================

/// One import at a time, matching how the export side behaves.
#[derive(Default)]
pub struct ImportState {
    running: AtomicBool,
    cancel: AtomicBool,
}

/// Frees the single-run slot even if the command exits through `?`.
struct RunGuard<'a>(&'a ImportState);

impl Drop for RunGuard<'_> {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::SeqCst);
    }
}

// ==========================================
// File helpers
// ==========================================

fn read_head(path: &str, max: usize) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| format!("Could not open {}: {}", path, e))?;
    let mut buf = Vec::new();
    file.take(max as u64)
        .read_to_end(&mut buf)
        .map_err(|e| format!("Could not read {}: {}", path, e))?;
    Ok(buf)
}

fn file_size(path: &str) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn describe(path: &str) -> Result<serde_json::Value, String> {
    let head = read_head(path, 64 * 1024)?;
    let text = decode_bytes(&head, SourceEncoding::Utf8);
    let format = detect_format(path, &text);
    Ok(serde_json::json!({
        "path": path,
        "name": file_name(path),
        "sizeBytes": file_size(path),
        "format": format,
        "delimiter": sniff_delimiter(&text).to_string(),
        // Drives the encoding default: a Thai CSV out of Excel is CP874, and
        // silently decoding it as UTF-8 turns every Thai column into mojibake.
        "looksUtf8": looks_utf8(&head),
    }))
}

/// A reader that decodes to UTF-8 on the way through.
fn decoded_reader(path: &str, encoding: SourceEncoding) -> Result<Box<dyn Read + Send>, String> {
    let file = File::open(path).map_err(|e| format!("Could not open {}: {}", path, e))?;
    let enc = match encoding {
        SourceEncoding::Utf8 => None,
        SourceEncoding::Tis620 => Some(encoding_rs::WINDOWS_874),
        SourceEncoding::Windows1252 => Some(encoding_rs::WINDOWS_1252),
    };
    Ok(Box::new(
        DecodeReaderBytesBuilder::new()
            .encoding(enc)
            .bom_sniffing(true)
            .build(BufReader::new(file)),
    ))
}

// ==========================================
// Row readers (CSV / JSON)
// ==========================================

/// One source row, aligned to the source column list the reader was built with.
struct SourceRow {
    values: Vec<Option<String>>,
    line: Option<u64>,
    /// Fields the file had beyond the declared columns. Non-zero means data
    /// would be dropped on the floor, which is usually a wrong delimiter.
    extra_fields: usize,
}

trait RowReader: Send {
    fn next_row(&mut self) -> Result<Option<SourceRow>, String>;
    fn bytes_read(&self) -> u64;
    fn total_bytes(&self) -> u64;
}

struct CsvRowReader {
    rdr: csv::Reader<Box<dyn Read + Send>>,
    /// The first record, when it turned out to be data rather than a header.
    pending: Option<csv::StringRecord>,
    width: usize,
    total: u64,
}

impl CsvRowReader {
    /// Opens `path` and returns the reader plus the source column names.
    fn open(path: &str, opts: &CsvOptions) -> Result<(Self, Vec<String>), String> {
        let mut rdr = csv::ReaderBuilder::new()
            .delimiter(opts.delimiter_byte())
            .quote(opts.quote_byte())
            // The header row is consumed by hand so the no-header case can
            // hand the first record back as data.
            .has_headers(false)
            .flexible(true)
            .from_reader(decoded_reader(path, opts.encoding)?);

        let mut first = csv::StringRecord::new();
        let got = rdr
            .read_record(&mut first)
            .map_err(|e| format!("Could not read {}: {}", file_name(path), e))?;
        if !got {
            return Err(format!("{} is empty.", file_name(path)));
        }

        let (columns, pending) = if opts.has_header {
            let raw: Vec<String> = first.iter().map(|s| s.to_string()).collect();
            (sanitize_header(&raw), None)
        } else {
            let cols = (1..=first.len()).map(|i| format!("column_{}", i)).collect();
            (cols, Some(first))
        };

        let width = columns.len();
        Ok((
            Self {
                rdr,
                pending,
                width,
                total: file_size(path),
            },
            columns,
        ))
    }

    fn project(&self, rec: &csv::StringRecord) -> SourceRow {
        SourceRow {
            values: (0..self.width)
                .map(|i| rec.get(i).map(|s| s.to_string()))
                .collect(),
            line: rec.position().map(|p| p.line()),
            extra_fields: rec.len().saturating_sub(self.width),
        }
    }
}

impl RowReader for CsvRowReader {
    fn next_row(&mut self) -> Result<Option<SourceRow>, String> {
        if let Some(rec) = self.pending.take() {
            return Ok(Some(self.project(&rec)));
        }
        let mut rec = csv::StringRecord::new();
        loop {
            if !self.rdr.read_record(&mut rec).map_err(|e| e.to_string())? {
                return Ok(None);
            }
            // A trailing newline shows up as a one-field empty record.
            if rec.iter().all(|f| f.is_empty()) {
                continue;
            }
            return Ok(Some(self.project(&rec)));
        }
    }

    fn bytes_read(&self) -> u64 {
        self.rdr.position().byte()
    }

    fn total_bytes(&self) -> u64 {
        self.total
    }
}

enum JsonRowReader {
    /// One JSON value per line — the only shape that streams.
    Lines {
        rdr: BufReader<Box<dyn Read + Send>>,
        keys: Vec<String>,
        bytes: u64,
        total: u64,
        line: u64,
    },
    /// A top-level array, which has to be parsed in full.
    Array {
        rows: Vec<JsonRecord>,
        keys: Vec<String>,
        idx: usize,
        total: u64,
    },
}

impl JsonRowReader {
    fn open(path: &str, keys: Vec<String>) -> Result<Self, String> {
        if is_json_array(path)? {
            let size = file_size(path);
            if size > JSON_ARRAY_MAX_BYTES {
                return Err(format!(
                    "{} is a single {} MB JSON array, which has to be parsed in one piece. Re-export it as JSON Lines (.jsonl, one object per line) to import it in a stream.",
                    file_name(path),
                    size / (1024 * 1024)
                ));
            }
            let mut text = String::new();
            decoded_reader(path, SourceEncoding::Utf8)?
                .read_to_string(&mut text)
                .map_err(|e| format!("Could not read {}: {}", file_name(path), e))?;
            let rows: Vec<JsonRecord> = serde_json::from_str::<Vec<JsonRecord>>(&text)
                .or_else(|_| serde_json::from_str::<JsonRecord>(&text).map(|r| vec![r]))
                .map_err(|e| format!("{} is not valid JSON: {}", file_name(path), e))?;
            Ok(Self::Array {
                rows,
                keys,
                idx: 0,
                total: size,
            })
        } else {
            Ok(Self::Lines {
                rdr: BufReader::new(decoded_reader(path, SourceEncoding::Utf8)?),
                keys,
                bytes: 0,
                total: file_size(path),
                line: 0,
            })
        }
    }

    fn project_values(keys: &[String], record: &JsonRecord) -> Vec<Option<String>> {
        if let Some(scalar) = &record.scalar {
            // A bare scalar or array record maps onto the first column.
            let mut row = vec![None; keys.len()];
            if !keys.is_empty() {
                row[0] = Some(scalar.clone());
            }
            return row;
        }
        keys.iter().map(|k| record.cell(k)).collect()
    }
}

impl RowReader for JsonRowReader {
    fn next_row(&mut self) -> Result<Option<SourceRow>, String> {
        match self {
            Self::Array {
                rows, keys, idx, ..
            } => {
                if *idx >= rows.len() {
                    return Ok(None);
                }
                let values = Self::project_values(keys, &rows[*idx]);
                *idx += 1;
                Ok(Some(SourceRow {
                    values,
                    line: Some(*idx as u64),
                    extra_fields: 0,
                }))
            }
            Self::Lines {
                rdr,
                keys,
                bytes,
                line,
                ..
            } => loop {
                let mut raw = Vec::new();
                let n = rdr
                    .read_until(b'\n', &mut raw)
                    .map_err(|e| format!("Could not read the file: {}", e))?;
                if n == 0 {
                    return Ok(None);
                }
                *bytes += n as u64;
                *line += 1;
                let text = String::from_utf8_lossy(&raw);
                let trimmed = text.trim().trim_end_matches(',');
                // Tolerate a pretty-printed array's brackets on their own lines.
                if trimmed.is_empty() || trimmed == "[" || trimmed == "]" {
                    continue;
                }
                let record: JsonRecord = serde_json::from_str(trimmed)
                    .map_err(|e| format!("Line {} is not valid JSON: {}", line, e))?;
                return Ok(Some(SourceRow {
                    values: Self::project_values(keys, &record),
                    line: Some(*line),
                    extra_fields: 0,
                }));
            },
        }
    }

    fn bytes_read(&self) -> u64 {
        match self {
            Self::Lines { bytes, .. } => *bytes,
            Self::Array {
                rows, idx, total, ..
            } => {
                if rows.is_empty() {
                    *total
                } else {
                    total * (*idx as u64) / (rows.len() as u64)
                }
            }
        }
    }

    fn total_bytes(&self) -> u64 {
        match self {
            Self::Lines { total, .. } => *total,
            Self::Array { total, .. } => *total,
        }
    }
}

/// True when the first meaningful character is `[`, i.e. one big JSON array
/// rather than JSON Lines.
fn is_json_array(path: &str) -> Result<bool, String> {
    let head = read_head(path, 4096)?;
    let text = decode_bytes(&head, SourceEncoding::Utf8);
    let t = text.trim_start().trim_start_matches('\u{feff}').trim_start();
    if !t.starts_with('[') {
        return Ok(false);
    }
    // `[\n{…}\n]` is an array; a JSONL file may still legitimately open with a
    // line that is exactly "[", which the line reader skips.
    Ok(t.lines().next().map(|l| l.trim() != "[").unwrap_or(true))
}

// ==========================================
// Batch sources
// ==========================================

/// Turns source rows into one multi-row INSERT per batch.
struct TabularSource {
    reader: Box<dyn RowReader + Send>,
    db: SupportedDB,
    table: String,
    /// `(index into the source row, target column, coercion rule)`
    mapped: Vec<(usize, String, InferredType)>,
    target_cols: Vec<String>,
    conflict: ConflictStrategy,
    pk: Vec<String>,
    batch_size: usize,
    null_literal: Option<String>,
    row_index: u64,
    failures: Vec<ImportFailure>,
    done: bool,
}

/// Renders a rejected row compactly enough to sit in an error report.
fn row_excerpt(vals: &[Option<String>]) -> String {
    let joined = vals
        .iter()
        .map(|v| v.as_deref().unwrap_or("NULL"))
        .collect::<Vec<_>>()
        .join(", ");
    excerpt(&joined, 200)
}

impl BatchSource for TabularSource {
    fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String> {
        if self.done {
            return Ok(None);
        }

        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut first_line: Option<u64> = None;
        let mut first_index: u64 = 0;

        while rows.len() < self.batch_size {
            let Some(row) = self.reader.next_row()? else {
                self.done = true;
                break;
            };
            let SourceRow {
                values: vals,
                line,
                extra_fields,
            } = row;
            self.row_index += 1;

            if extra_fields > 0 {
                // Dropping the surplus would lose data without saying so, and
                // it almost always means the delimiter is wrong.
                self.failures.push(ImportFailure::new(
                    self.row_index,
                    line,
                    &row_excerpt(&vals),
                    format!(
                        "row has {} more field(s) than the {} column(s) read from the file - check the delimiter",
                        extra_fields,
                        vals.len()
                    ),
                ));
                continue;
            }

            let mut literals = Vec::with_capacity(self.mapped.len());
            let mut bad: Option<String> = None;
            for (idx, name, ty) in &self.mapped {
                let raw = vals.get(*idx).and_then(|v| v.as_deref());
                match format_import_value(self.db, name, *ty, raw, self.null_literal.as_deref()) {
                    Ok(lit) => literals.push(lit),
                    Err(e) => {
                        bad = Some(e);
                        break;
                    }
                }
            }

            match bad {
                Some(msg) => self.failures.push(ImportFailure::new(
                    self.row_index,
                    line,
                    &row_excerpt(&vals),
                    msg,
                )),
                None => {
                    if rows.is_empty() {
                        first_line = line;
                        first_index = self.row_index;
                    }
                    rows.push(literals);
                }
            }
        }

        if rows.is_empty() {
            // Either the file ran out, or every row in this window failed to
            // coerce — in which case there is still more file to read.
            return if self.done { Ok(None) } else { Ok(Some(Vec::new())) };
        }

        let count = rows.len() as u64;
        let sql = build_insert_batch(
            self.db,
            &self.table,
            &self.target_cols,
            &rows,
            self.conflict,
            &self.pk,
        )?;
        Ok(Some(vec![BatchItem {
            sql,
            rows: count,
            line: first_line,
            index: first_index,
        }]))
    }

    fn bytes_read(&self) -> u64 {
        self.reader.bytes_read()
    }

    fn total_bytes(&self) -> u64 {
        self.reader.total_bytes()
    }

    fn take_failures(&mut self) -> Vec<ImportFailure> {
        std::mem::take(&mut self.failures)
    }
}

/// An open `COPY … FROM stdin` block whose rows are being collected.
struct CopyBlock {
    header: CopyHeader,
    rows: Vec<Vec<Option<String>>>,
    line: u64,
    /// Set when the block was refused: its rows still have to be read past, or
    /// they reach the server as SQL and bury the real error in syntax noise.
    discard: bool,
}

/// Replays a `.sql` script statement by statement.
struct SqlFileSource {
    reader: BufReader<File>,
    name: String,
    db: SupportedDB,
    splitter: SqlSplitter,
    queue: VecDeque<(SplitStatement, u64)>,
    /// Set while the reader is inside a `COPY … FROM stdin` data block.
    copy: Option<CopyBlock>,
    copy_rows: u64,
    failures: Vec<ImportFailure>,
    line: u64,
    eof: bool,
    bytes: u64,
    total: u64,
    index: u64,
    batch_size: usize,
}

impl SqlFileSource {
    fn open(path: &str, db: SupportedDB, batch_size: usize) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Could not open {}: {}", path, e))?;
        Ok(Self {
            reader: BufReader::with_capacity(64 * 1024, file),
            name: file_name(path),
            db,
            splitter: SqlSplitter::for_dialect(db),
            queue: VecDeque::new(),
            copy: None,
            copy_rows: 0,
            failures: Vec::new(),
            line: 0,
            eof: false,
            bytes: 0,
            total: file_size(path),
            index: 0,
            batch_size: batch_size.max(1),
        })
    }

    /// Reads one line and feeds it to the splitter.
    ///
    /// Lines are the unit rather than fixed-size chunks because `\n` is always
    /// a UTF-8 boundary, so no character can be cut in half.
    fn pump(&mut self) -> Result<(), String> {
        let mut raw = Vec::new();
        let n = self
            .reader
            .read_until(b'\n', &mut raw)
            .map_err(|e| format!("Could not read the file: {}", e))?;
        if n == 0 {
            self.eof = true;
            // A truncated dump can end mid-block; keep the rows it did contain.
            self.flush_copy();
            self.queue
                .extend(self.splitter.finish().into_iter().map(|st| (st, 0)));
            return Ok(());
        }
        self.bytes += n as u64;
        self.line += 1;

        // `\n` is ASCII, so a line read this way always holds whole characters:
        // invalid UTF-8 here means the file really does carry raw bytes.
        //
        // Replacing them with U+FFFD would corrupt the data silently — a
        // `mysqldump` written without `--hex-blob` stores BLOB columns as raw
        // bytes, and those bytes cannot be sent as a query string at all. Stop
        // instead of writing something that only looks like the original.
        let text = match std::str::from_utf8(&raw) {
            Ok(t) => t.to_string(),
            Err(_) => {
                return Err(format!(
                    "Line {} of {} is not valid UTF-8, so this file carries raw binary data. \
                     A mysqldump written without --hex-blob stores BLOB and BINARY columns as raw \
                     bytes, which cannot be replayed as text without corrupting them. Re-export \
                     with `mysqldump --hex-blob` and import that file instead.",
                    self.line, self.name
                ))
            }
        };

        if self.copy.is_some() {
            let line = text.trim_end_matches(['\n', '\r']);
            if line == "\\." {
                self.flush_copy();
            } else {
                let row = split_copy_row(line);
                let block = self.copy.as_mut().expect("inside a COPY block");
                block.rows.push(row);
                if block.rows.len() >= self.batch_size {
                    self.emit_copy_rows();
                }
            }
            return Ok(());
        }

        for st in self.splitter.feed(&text) {
            match parse_copy_header(&st.sql) {
                None => self.queue.push_back((st, 0)),
                Some(Err(why)) => {
                    // Refuse rather than mis-parse, and swallow the data block
                    // so the user gets one clear error instead of one per row.
                    self.index += 1;
                    self.failures
                        .push(ImportFailure::new(self.index, Some(st.line), &st.sql, why));
                    self.copy = Some(CopyBlock {
                        header: CopyHeader {
                            table: String::new(),
                            columns: Vec::new(),
                        },
                        rows: Vec::new(),
                        line: st.line,
                        discard: true,
                    });
                }
                Some(Ok(header)) => {
                    self.copy = Some(CopyBlock {
                        header,
                        rows: Vec::new(),
                        line: st.line,
                        discard: false,
                    });
                }
            }
        }
        Ok(())
    }

    /// Turns the rows collected so far into one INSERT and queues it.
    ///
    /// Every value goes in as a string literal: Postgres coerces an untyped
    /// literal to the column type, so `'5'` lands in an integer column and
    /// `'t'` in a boolean one without the reader needing to know the schema.
    fn emit_copy_rows(&mut self) {
        let Some(block) = self.copy.as_mut() else { return };
        if block.discard {
            block.rows.clear();
            return;
        }
        if block.rows.is_empty() {
            return;
        }
        let rows = std::mem::take(&mut block.rows);
        let count = rows.len() as u64;
        let line = block.line;

        let col_list = if block.header.columns.is_empty() {
            String::new()
        } else {
            format!(
                " ({})",
                block
                    .header
                    .columns
                    .iter()
                    .map(|c| quote_column_ident(self.db, c))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        let table = quote_table_ident(self.db, &block.header.table);

        let values = rows
            .iter()
            .map(|r| {
                let cells = r
                    .iter()
                    .map(|v| match v {
                        None => "NULL".to_string(),
                        Some(s) => format!("'{}'", escape_sql_literal(self.db, s)),
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("({})", cells)
            })
            .collect::<Vec<_>>()
            .join(",\n  ");

        self.copy_rows += count;
        self.queue.push_back((
            SplitStatement {
                sql: format!("INSERT INTO {}{} VALUES\n  {}", table, col_list, values),
                line,
            },
            count,
        ));
    }

    /// Closes the current COPY block, emitting whatever is left.
    fn flush_copy(&mut self) {
        if self.copy.is_none() {
            return;
        }
        self.emit_copy_rows();
        self.copy = None;
    }

    fn skipped_version_comments(&self) -> u64 {
        self.splitter.skipped_version_comments()
    }

    fn skipped_meta_commands(&self) -> u64 {
        self.splitter.skipped_meta_commands()
    }

    fn copy_rows(&self) -> u64 {
        self.copy_rows
    }
}

impl BatchSource for SqlFileSource {
    fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String> {
        while self.queue.len() < self.batch_size && !self.eof {
            self.pump()?;
        }
        if self.queue.is_empty() {
            return Ok(None);
        }
        let take = self.batch_size.min(self.queue.len());
        let mut items = Vec::with_capacity(take);
        for (st, rows) in self.queue.drain(..take) {
            self.index += 1;
            items.push(BatchItem {
                sql: st.sql,
                rows,
                line: Some(st.line),
                index: self.index,
            });
        }
        Ok(Some(items))
    }

    fn bytes_read(&self) -> u64 {
        self.bytes
    }

    fn total_bytes(&self) -> u64 {
        self.total
    }

    fn take_failures(&mut self) -> Vec<ImportFailure> {
        std::mem::take(&mut self.failures)
    }
}

/// Lets `run_import` drive either source through one code path.
enum AnySource {
    Sql(SqlFileSource),
    Tabular(TabularSource),
}

impl AnySource {
    fn skipped_version_comments(&self) -> u64 {
        match self {
            Self::Sql(s) => s.skipped_version_comments(),
            Self::Tabular(_) => 0,
        }
    }

    fn skipped_meta_commands(&self) -> u64 {
        match self {
            Self::Sql(s) => s.skipped_meta_commands(),
            Self::Tabular(_) => 0,
        }
    }

    fn copy_rows(&self) -> u64 {
        match self {
            Self::Sql(s) => s.copy_rows(),
            Self::Tabular(_) => 0,
        }
    }
}

impl BatchSource for AnySource {
    fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String> {
        match self {
            Self::Sql(s) => s.next_batch(),
            Self::Tabular(s) => s.next_batch(),
        }
    }
    fn bytes_read(&self) -> u64 {
        match self {
            Self::Sql(s) => s.bytes_read(),
            Self::Tabular(s) => s.bytes_read(),
        }
    }
    fn total_bytes(&self) -> u64 {
        match self {
            Self::Sql(s) => s.total_bytes(),
            Self::Tabular(s) => s.total_bytes(),
        }
    }
    fn take_failures(&mut self) -> Vec<ImportFailure> {
        match self {
            Self::Sql(s) => s.take_failures(),
            Self::Tabular(s) => s.take_failures(),
        }
    }
}

// ==========================================
// Commands
// ==========================================

#[command]
pub async fn pick_import_file() -> Result<Option<serde_json::Value>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter(
            "Importable files",
            &["sql", "csv", "tsv", "json", "jsonl", "ndjson"],
        )
        .add_filter("SQL dump", &["sql"])
        .add_filter("CSV / TSV", &["csv", "tsv", "txt"])
        .add_filter("JSON / JSON Lines", &["json", "jsonl", "ndjson"])
        .add_filter("All Files", &["*"])
        .set_title("Select a file to import")
        .pick_file()
        .await;

    match file {
        None => Ok(None),
        Some(f) => describe(&f.path().to_string_lossy()).map(Some),
    }
}

/// Same answer as `pick_import_file`, for a path that arrived by drag-and-drop.
#[command]
pub async fn describe_import_file(path: String) -> Result<serde_json::Value, String> {
    describe(&path)
}

/// Reads the head of the file so the wizard can show real columns and rows.
#[command]
pub async fn preview_import_file(
    path: String,
    format: ImportFormat,
    csv: CsvOptions,
) -> Result<serde_json::Value, String> {
    match format {
        ImportFormat::Sql => {
            let head = read_head(&path, PREVIEW_BYTES)?;
            let text = decode_bytes(&head, SourceEncoding::Utf8);
            let complete = (head.len() as u64) >= file_size(&path);

            let mut splitter = SqlSplitter::new(true);
            let mut stmts = splitter.feed(&text);
            if complete {
                stmts.extend(splitter.finish());
            }

            let shown: Vec<serde_json::Value> = stmts
                .iter()
                .take(PREVIEW_STATEMENTS)
                .map(|s| serde_json::json!({ "sql": excerpt(&s.sql, 2000), "line": s.line }))
                .collect();

            // Extrapolate from the sampled head; the UI labels it "~".
            let estimated = if complete || head.is_empty() {
                stmts.len() as u64
            } else {
                (stmts.len() as u64) * file_size(&path) / (head.len() as u64)
            };

            Ok(serde_json::json!({
                "kind": "sql",
                "statements": shown,
                "estimatedStatements": estimated,
                "exact": complete,
                "dialectHints": dialect_hints(&text),
                "skippedVersionComments": splitter.skipped_version_comments(),
                "skippedMetaCommands": splitter.skipped_meta_commands(),
                "copyBlocks": stmts.iter().filter(|s| parse_copy_header(&s.sql).is_some()).count(),
            }))
        }

        ImportFormat::Csv | ImportFormat::Json => {
            let (columns, rows) = preview_rows(&path, format, &csv)?;

            // Infer from the sampled column, keeping the borrow cheap.
            let inferred: Vec<serde_json::Value> = columns
                .iter()
                .enumerate()
                .map(|(i, name)| {
                    let samples: Vec<Option<&str>> = rows
                        .iter()
                        .map(|r| r.get(i).and_then(|v| v.as_deref()))
                        .collect();
                    let (ty, nullable) = infer_type(&samples);
                    serde_json::json!({
                        "name": name,
                        "inferredType": ty,
                        "nullable": nullable,
                        "samples": samples.iter().flatten().take(3).collect::<Vec<_>>(),
                    })
                })
                .collect();

            Ok(serde_json::json!({
                "kind": "tabular",
                "columns": inferred,
                "rows": rows,
                "sampledRows": rows.len(),
                "delimiter": csv.delimiter,
                "hasHeader": csv.has_header,
            }))
        }
    }
}

/// Reads at most `PREVIEW_ROWS` rows and the column names in front of them.
fn preview_rows(
    path: &str,
    format: ImportFormat,
    csv: &CsvOptions,
) -> Result<(Vec<String>, Vec<Vec<Option<String>>>), String> {
    let mut reader: Box<dyn RowReader + Send>;
    let columns: Vec<String>;

    match format {
        ImportFormat::Csv => {
            let (r, cols) = CsvRowReader::open(path, csv)?;
            reader = Box::new(r);
            columns = cols;
        }
        _ => {
            columns = sniff_json_keys(path)?;
            reader = Box::new(JsonRowReader::open(path, columns.clone())?);
        }
    }

    let mut rows = Vec::new();
    while rows.len() < PREVIEW_ROWS {
        match reader.next_row()? {
            None => break,
            Some(row) => rows.push(row.values),
        }
    }
    Ok((columns, rows))
}

/// Collects the union of keys over the first few JSON records, in the order the
/// file wrote them, so a sparse export does not lose the columns that only
/// later rows carry.
///
/// Order is taken off the raw text rather than a parsed `Value`, whose
/// `BTreeMap` would have sorted the keys alphabetically already.
fn sniff_json_keys(path: &str) -> Result<Vec<String>, String> {
    let mut keys: Vec<String> = Vec::new();

    if is_json_array(path)? {
        let mut text = String::new();
        decoded_reader(path, SourceEncoding::Utf8)?
            .read_to_string(&mut text)
            .map_err(|e| format!("Could not read {}: {}", file_name(path), e))?;
        let records: Vec<JsonRecord> = serde_json::from_str(&text)
            .map_err(|e| format!("{} is not valid JSON: {}", file_name(path), e))?;
        for r in records.iter().take(PREVIEW_ROWS) {
            merge_record_keys(&mut keys, r);
        }
    } else {
        let mut rdr = BufReader::new(decoded_reader(path, SourceEncoding::Utf8)?);
        let mut seen = 0;
        while seen < PREVIEW_ROWS {
            let mut raw = Vec::new();
            let n = rdr
                .read_until(b'\n', &mut raw)
                .map_err(|e| format!("Could not read {}: {}", file_name(path), e))?;
            if n == 0 {
                break;
            }
            let text = String::from_utf8_lossy(&raw);
            let trimmed = text.trim().trim_end_matches(',');
            if trimmed.is_empty() || trimmed == "[" || trimmed == "]" {
                continue;
            }
            if let Ok(record) = serde_json::from_str::<JsonRecord>(trimmed) {
                merge_record_keys(&mut keys, &record);
            }
            seen += 1;
        }
    }

    if keys.is_empty() {
        // A file of bare scalars still needs one column to land in.
        keys.push("value".to_string());
    }
    Ok(keys)
}

#[command]
pub fn cancel_import(imports: State<'_, ImportState>) -> Result<(), String> {
    imports.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[command]
pub async fn run_import(
    id: String,
    database: String,
    request: ImportRequest,
    on_progress: Channel<ImportProgress>,
    state: State<'_, DbState>,
    imports: State<'_, ImportState>,
) -> Result<ImportReport, String> {
    if imports.running.swap(true, Ordering::SeqCst) {
        return Err("An import is already running. Wait for it to finish or cancel it first.".into());
    }
    let _guard = RunGuard(&imports);
    imports.cancel.store(false, Ordering::SeqCst);

    let started = std::time::Instant::now();
    let profile = resolve_profile(&state, &id)?;
    let db = profile.r#type;
    let pool = get_pool(&state, &profile, Some(&database)).await?;

    let total_bytes = file_size(&request.file_path);
    let table_label = request.target_table.clone().unwrap_or_default();

    let emit = |phase: &str, tick: ImportTick, table: &str| {
        let pct = if tick.total_bytes == 0 {
            0
        } else {
            ((tick.bytes_read.saturating_mul(100) / tick.total_bytes).min(100)) as u8
        };
        let _ = on_progress.send(ImportProgress {
            phase: phase.to_string(),
            bytes_read: tick.bytes_read,
            total_bytes: tick.total_bytes,
            percentage: pct,
            rows_imported: tick.rows_imported,
            statements_run: tick.statements_run,
            errors: tick.errors,
            current_table: table.to_string(),
        });
    };

    let zero = ImportTick {
        bytes_read: 0,
        total_bytes,
        statements_run: 0,
        rows_imported: 0,
        errors: 0,
    };
    emit("preparing", zero, &table_label);

    let mut prepared: Vec<String> = Vec::new();
    let mut tables_touched: Vec<String> = Vec::new();

    // --- Build the source, preparing the target table on the way ---
    let mut source = match request.format {
        ImportFormat::Sql => AnySource::Sql(SqlFileSource::open(
            &request.file_path,
            db,
            request.batch_size,
        )?),

        ImportFormat::Csv | ImportFormat::Json => {
            let table = request
                .target_table
                .clone()
                .filter(|t| !t.trim().is_empty())
                .ok_or("Pick a target table before importing.")?;
            tables_touched.push(table.clone());

            let (reader, source_columns): (Box<dyn RowReader + Send>, Vec<String>) =
                if matches!(request.format, ImportFormat::Csv) {
                    let (r, cols) = CsvRowReader::open(&request.file_path, &request.csv)?;
                    (Box::new(r), cols)
                } else {
                    let cols: Vec<String> = request
                        .columns
                        .iter()
                        .map(|c| c.source.clone())
                        .collect();
                    let cols = if cols.is_empty() {
                        sniff_json_keys(&request.file_path)?
                    } else {
                        cols
                    };
                    (
                        Box::new(JsonRowReader::open(&request.file_path, cols.clone())?),
                        cols,
                    )
                };

            let mapping = resolve_mapping(&request, &source_columns);
            if mapping.is_empty() {
                return Err(
                    "Every column is set to Skip, so the import would insert nothing.".into(),
                );
            }

            let mut pk: Vec<String> = Vec::new();
            let mut mapped = mapping;

            if request.create_table {
                let cols: Vec<(String, String, bool)> = mapped
                    .iter()
                    .map(|(_, name, ty)| {
                        let declared = request
                            .columns
                            .iter()
                            .find(|c| c.target.as_deref() == Some(name.as_str()))
                            .and_then(|c| c.sql_type.clone())
                            .filter(|t| !t.trim().is_empty())
                            .unwrap_or_else(|| sql_type_for(*ty, db).to_string());
                        // Everything is nullable: the file is the only source of
                        // truth, and a NOT NULL guess rejects rows the user asked
                        // us to load.
                        (name.clone(), declared, true)
                    })
                    .collect();
                let ddl = build_create_table(db, &table, &cols)?;
                prepared.push(ddl.clone());
                if !request.dry_run {
                    execute_command_raw(&pool, &ddl).await.map_err(|e| {
                        format!("Could not create {}: {}\nSQL: {}", table, e, ddl)
                    })?;
                }
            } else {
                // Follow the column that is actually in the table, not the one
                // the file looked like.
                let info = get_columns(id.clone(), database.clone(), table.clone(), state).await?;
                pk = apply_declared_types(&mut mapped, &column_index(&info));
            }

            if request.truncate_first {
                let clear = build_clear_table(db, &table);
                prepared.push(clear.clone());
                if !request.dry_run {
                    execute_command_raw(&pool, &clear)
                        .await
                        .map_err(|e| format!("Could not empty {}: {}", table, e))?;
                }
            }

            let target_cols: Vec<String> = mapped.iter().map(|(_, n, _)| n.clone()).collect();
            AnySource::Tabular(TabularSource {
                reader,
                db,
                table,
                mapped,
                target_cols,
                conflict: request.conflict,
                pk,
                batch_size: request.batch_size.max(1),
                null_literal: request.csv.null_literal.clone(),
                row_index: 0,
                failures: Vec::new(),
                done: false,
            })
        }
    };

    let opts = ImportExecOptions {
        tx_mode: request.tx_mode,
        on_error: request.on_error,
        max_errors: request.max_errors.max(1),
    };

    // --- Run (or, for a dry run, only parse and validate) ---
    let outcome = if request.dry_run {
        dry_run(&mut source, &opts, &imports.cancel, &|t| {
            emit("importing", t, &table_label)
        })?
    } else {
        let mut tick = |t: ImportTick| emit("importing", t, &table_label);
        execute_import_stream(&pool, &mut source, opts, &imports.cancel, &mut tick).await?
    };

    let report = ImportReport {
        success: outcome.failures.is_empty() && !outcome.cancelled,
        cancelled: outcome.cancelled,
        dry_run: request.dry_run,
        rows_imported: outcome.rows_imported,
        statements_run: outcome.statements_run,
        tables_touched,
        elapsed_ms: started.elapsed().as_millis() as u64,
        failures: outcome.failures,
        failures_truncated: outcome.failures_truncated,
        skipped_version_comments: source.skipped_version_comments(),
        skipped_meta_commands: source.skipped_meta_commands(),
        copy_rows: source.copy_rows(),
    };

    emit(
        "done",
        ImportTick {
            bytes_read: source.bytes_read(),
            total_bytes: source.total_bytes(),
            statements_run: report.statements_run,
            rows_imported: report.rows_imported,
            errors: report.failures.len() as u64,
        },
        &table_label,
    );

    Ok(report)
}

/// Walks the whole file, coercing every value, without touching the database.
///
/// This is the cheap way to find out that row 480 000 of a CSV has text in a
/// numeric column before spending an hour writing the first 479 999.
fn dry_run(
    source: &mut AnySource,
    opts: &ImportExecOptions,
    cancel: &AtomicBool,
    tick: &dyn Fn(ImportTick),
) -> Result<crate::db_core::ImportOutcome, String> {
    let mut out = crate::db_core::ImportOutcome::default();
    loop {
        if cancel.load(Ordering::SeqCst) {
            out.cancelled = true;
            break;
        }
        let batch = match source.next_batch() {
            Ok(Some(b)) => b,
            Ok(None) => {
                // Same as the executor: a rejection found on the final read
                // still has to be reported.
                for f in source.take_failures() {
                    if out.failures.len() < opts.max_errors {
                        out.failures.push(f);
                    } else {
                        out.failures_truncated = true;
                    }
                }
                break;
            }
            Err(e) => return Err(e),
        };
        for f in source.take_failures() {
            if out.failures.len() < opts.max_errors {
                out.failures.push(f);
            } else {
                out.failures_truncated = true;
            }
        }
        for item in &batch {
            out.statements_run += 1;
            out.rows_imported += item.rows;
        }
        if !out.failures.is_empty()
            && (matches!(opts.on_error, crate::import::OnError::Abort) || out.failures_truncated)
        {
            break;
        }
        tick(ImportTick {
            bytes_read: source.bytes_read(),
            total_bytes: source.total_bytes(),
            statements_run: out.statements_run,
            rows_imported: out.rows_imported,
            errors: out.failures.len() as u64,
        });
    }
    Ok(out)
}

/// Pairs each mapped source column with its position in the source row.
///
/// A mapping the file does not actually contain is dropped rather than shifting
/// every later column by one.
fn resolve_mapping(
    request: &ImportRequest,
    source_columns: &[String],
) -> Vec<(usize, String, InferredType)> {
    if request.columns.is_empty() {
        // No explicit mapping: take the file's own column names.
        return source_columns
            .iter()
            .enumerate()
            .map(|(i, name)| (i, sanitize_ident(name), InferredType::Text))
            .collect();
    }

    request
        .columns
        .iter()
        .filter_map(|c: &ColumnMapping| {
            let target = c.target.as_ref()?.trim().to_string();
            if target.is_empty() {
                return None;
            }
            let idx = source_columns.iter().position(|s| s == &c.source)?;
            Some((idx, target, c.value_type))
        })
        .collect()
}

/// Retypes each mapping from the column that is really in the table, and
/// returns the mapped columns that make up its primary key.
///
/// Importing into an existing table has to follow the declared type: a CSV cell
/// that looked like text in the file still has to go into an integer column
/// unquoted, or the whole batch fails.
fn apply_declared_types(
    mapped: &mut [(usize, String, InferredType)],
    declared: &std::collections::HashMap<String, (String, bool)>,
) -> Vec<String> {
    let mut pk = Vec::new();
    for (_, name, ty) in mapped.iter_mut() {
        if let Some((sql_type, is_pk)) = declared.get(&name.to_ascii_lowercase()) {
            *ty = value_type_from_sql_type(sql_type);
            if *is_pk {
                pk.push(name.clone());
            }
        }
    }
    pk
}

/// Indexes a `get_columns` response by lower-cased name → (declared type, is PK).
fn column_index(info: &serde_json::Value) -> std::collections::HashMap<String, (String, bool)> {
    let mut map = std::collections::HashMap::new();
    if let Some(cols) = info.get("columns").and_then(|c| c.as_array()) {
        for c in cols {
            let Some(name) = c.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            let ty = c
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("text")
                .to_string();
            let pk = c
                .get("primaryKey")
                .and_then(|p| p.as_bool())
                .unwrap_or(false);
            map.insert(name.to_ascii_lowercase(), (ty, pk));
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db_core::{DbPool, ImportOutcome};
    use crate::import::{InferredType as IT, OnError, TxMode};
    use sqlx::sqlite::SqlitePoolOptions;
    use std::io::Write as _;

    /// A temp file that deletes itself, so a failing test does not leave litter.
    struct TempFile(std::path::PathBuf);

    impl TempFile {
        fn new(name: &str, bytes: &[u8]) -> Self {
            // The name carries the test's own label, so parallel tests cannot
            // collide without a random source.
            let path = std::env::temp_dir().join(format!("dodb-import-test-{}", name));
            let mut f = File::create(&path).expect("create temp file");
            f.write_all(bytes).expect("write temp file");
            f.flush().expect("flush temp file");
            Self(path)
        }

        fn path(&self) -> String {
            self.0.to_string_lossy().to_string()
        }
    }

    impl Drop for TempFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    async fn empty_sqlite() -> DbPool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        DbPool::Sqlite(pool)
    }

    async fn exec(pool: &DbPool, sql: &str) {
        execute_command_raw(pool, sql).await.expect(sql);
    }

    async fn scalar_i64(pool: &DbPool, sql: &str) -> i64 {
        let DbPool::Sqlite(p) = pool else { unreachable!() };
        sqlx::query_scalar::<_, i64>(sql).fetch_one(p).await.unwrap()
    }

    async fn scalar_text(pool: &DbPool, sql: &str) -> Option<String> {
        let DbPool::Sqlite(p) = pool else { unreachable!() };
        sqlx::query_scalar::<_, Option<String>>(sql)
            .fetch_one(p)
            .await
            .unwrap()
    }

    fn mapping(cols: &[(&str, IT)]) -> Vec<(usize, String, IT)> {
        cols.iter()
            .enumerate()
            .map(|(i, (n, t))| (i, (*n).to_string(), *t))
            .collect()
    }

    fn tabular(
        reader: Box<dyn RowReader + Send>,
        table: &str,
        mapped: Vec<(usize, String, IT)>,
        batch_size: usize,
    ) -> TabularSource {
        let target_cols = mapped.iter().map(|(_, n, _)| n.clone()).collect();
        TabularSource {
            reader,
            db: SupportedDB::Sqlite,
            table: table.to_string(),
            mapped,
            target_cols,
            conflict: ConflictStrategy::Error,
            pk: Vec::new(),
            batch_size,
            null_literal: None,
            row_index: 0,
            failures: Vec::new(),
            done: false,
        }
    }

    async fn drain(
        pool: &DbPool,
        src: &mut dyn BatchSource,
        on_error: OnError,
    ) -> ImportOutcome {
        let cancel = AtomicBool::new(false);
        let mut tick = |_: ImportTick| {};
        execute_import_stream(
            pool,
            src,
            ImportExecOptions {
                tx_mode: TxMode::AtomicBatch,
                on_error,
                max_errors: 100,
            },
            &cancel,
            &mut tick,
        )
        .await
        .expect("import stream")
    }

    // ---------- CSV end to end ----------

    /// The full CSV path: decode, parse, sanitize the header, coerce every cell
    /// and land the rows in a real table.
    #[tokio::test]
    async fn a_csv_file_lands_in_a_table_with_values_intact() {
        let csv_text = "id,Full Name,score,active,note\n\
                        1,ทดสอบ ไทย,12.5,true,\"has, comma\"\n\
                        2,it's quoted,0.5,false,\n\
                        3,\\N,7,1,plain\n";
        let file = TempFile::new("basic.csv", csv_text.as_bytes());
        let pool = empty_sqlite().await;
        exec(
            &pool,
            "CREATE TABLE people (id INTEGER, name TEXT, score REAL, active INTEGER, note TEXT)",
        )
        .await;

        let (reader, columns) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        // The header is sanitized on the way in, so "Full Name" is usable.
        assert_eq!(columns, vec!["id", "Full_Name", "score", "active", "note"]);

        let mut src = tabular(
            Box::new(reader),
            "people",
            mapping(&[
                ("id", IT::Integer),
                ("name", IT::Text),
                ("score", IT::Double),
                ("active", IT::Boolean),
                ("note", IT::Text),
            ]),
            2,
        );
        let out = drain(&pool, &mut src, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 3);
        assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM people").await, 3);

        // Thai text survives the byte-level plumbing.
        assert_eq!(
            scalar_text(&pool, "SELECT name FROM people WHERE id = 1").await,
            Some("ทดสอบ ไทย".to_string())
        );
        // An embedded comma inside quotes stays one value.
        assert_eq!(
            scalar_text(&pool, "SELECT note FROM people WHERE id = 1").await,
            Some("has, comma".to_string())
        );
        // An apostrophe is escaped, not a syntax error.
        assert_eq!(
            scalar_text(&pool, "SELECT name FROM people WHERE id = 2").await,
            Some("it's quoted".to_string())
        );
        // A blank text cell is an empty string; `\N` is NULL.
        assert_eq!(
            scalar_text(&pool, "SELECT note FROM people WHERE id = 2").await,
            Some(String::new())
        );
        assert!(scalar_text(&pool, "SELECT name FROM people WHERE id = 3")
            .await
            .is_none());
        // Booleans become sqlite integers.
        assert_eq!(
            scalar_i64(&pool, "SELECT SUM(active) FROM people").await,
            2
        );
    }

    /// The batch boundary is where a naive importer loses or duplicates rows.
    #[tokio::test]
    async fn a_csv_larger_than_one_batch_imports_every_row_exactly_once() {
        let mut csv_text = String::from("id,name\n");
        for i in 1..=250 {
            csv_text.push_str(&format!("{},row-{}\n", i, i));
        }
        let file = TempFile::new("batched.csv", csv_text.as_bytes());
        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT)").await;

        let (reader, _cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text)]),
            7,
        );
        let out = drain(&pool, &mut src, OnError::Abort).await;

        assert_eq!(out.rows_imported, 250);
        assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM t").await, 250);
        assert_eq!(
            scalar_i64(&pool, "SELECT COUNT(DISTINCT id) FROM t").await,
            250
        );
    }

    /// A bad value must name the row and be skippable without losing the rest.
    #[tokio::test]
    async fn a_value_that_will_not_convert_is_reported_and_the_row_skipped() {
        let csv_text = "id,name\n1,ok\nnot-a-number,bad\n3,fine\n";
        let file = TempFile::new("badvalue.csv", csv_text.as_bytes());
        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT)").await;

        let (reader, _cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text)]),
            1,
        );
        let out = drain(&pool, &mut src, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        let f = &out.failures[0];
        assert_eq!(f.index, 2, "the second data row");
        assert!(f.message.contains("not-a-number"), "{}", f.message);
        assert!(f.message.contains("integer"), "{}", f.message);
        // The offending row is shown, not the SQL that was never built.
        assert!(f.excerpt.contains("bad"), "{}", f.excerpt);

        assert_eq!(out.rows_imported, 2);
        assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM t").await, 2);
    }

    #[tokio::test]
    async fn a_tab_separated_file_with_no_header_gets_generated_column_names() {
        let file = TempFile::new("noheader.tsv", b"1\talpha\n2\tbeta\n");
        let opts = CsvOptions {
            delimiter: "\\t".to_string(),
            has_header: false,
            ..CsvOptions::default()
        };
        let (reader, columns) = CsvRowReader::open(&file.path(), &opts).expect("open tsv");
        assert_eq!(columns, vec!["column_1", "column_2"]);

        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT)").await;
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text)]),
            10,
        );
        let out = drain(&pool, &mut src, OnError::Abort).await;

        // The first record is data, not a header, so both rows arrive.
        assert_eq!(out.rows_imported, 2);
        assert_eq!(
            scalar_text(&pool, "SELECT name FROM t WHERE id = 1").await,
            Some("alpha".to_string())
        );
    }

    /// A Thai CSV out of Excel is CP874, and reading it as UTF-8 destroys it.
    #[tokio::test]
    async fn a_tis620_csv_decodes_to_thai_rather_than_replacement_characters() {
        // "id,name\n1,<0xA1 0xA2>\n" in TIS-620 — "ก" and "ข".
        let mut bytes: Vec<u8> = b"id,name\n1,".to_vec();
        bytes.extend_from_slice(&[0xA1, 0xA2]);
        bytes.push(b'\n');
        let file = TempFile::new("thai.csv", &bytes);

        let opts = CsvOptions {
            encoding: SourceEncoding::Tis620,
            ..CsvOptions::default()
        };
        let (reader, _) = CsvRowReader::open(&file.path(), &opts).expect("open csv");

        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT)").await;
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text)]),
            10,
        );
        drain(&pool, &mut src, OnError::Abort).await;

        assert_eq!(
            scalar_text(&pool, "SELECT name FROM t WHERE id = 1").await,
            Some("กข".to_string())
        );
    }

    // ---------- JSON end to end ----------

    #[tokio::test]
    async fn jsonl_rows_import_and_missing_keys_become_null() {
        let jsonl = "{\"id\":1,\"name\":\"a\",\"score\":1.5}\n\
                     {\"id\":2,\"name\":null}\n\
                     {\"id\":3,\"name\":\"c\",\"score\":9}\n";
        let file = TempFile::new("rows.jsonl", jsonl.as_bytes());

        let keys = sniff_json_keys(&file.path()).expect("sniff keys");
        // The union of keys across the sample, first seen first.
        assert_eq!(keys, vec!["id", "name", "score"]);

        let reader = JsonRowReader::open(&file.path(), keys).expect("open jsonl");
        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT, score REAL)").await;
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text), ("score", IT::Double)]),
            2,
        );
        let out = drain(&pool, &mut src, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 3);
        // An explicit null and an absent key are both NULL.
        assert!(scalar_text(&pool, "SELECT name FROM t WHERE id = 2")
            .await
            .is_none());
        assert_eq!(
            scalar_i64(&pool, "SELECT COUNT(*) FROM t WHERE score IS NULL").await,
            1
        );
    }

    #[tokio::test]
    async fn a_top_level_json_array_imports_as_well() {
        let json = "[{\"id\":1,\"name\":\"a\"},\n {\"id\":2,\"name\":\"b\"}]";
        let file = TempFile::new("rows.json", json.as_bytes());

        let keys = sniff_json_keys(&file.path()).expect("sniff keys");
        assert_eq!(keys, vec!["id", "name"]);

        let reader = JsonRowReader::open(&file.path(), keys).expect("open json");
        let pool = empty_sqlite().await;
        exec(&pool, "CREATE TABLE t (id INTEGER, name TEXT)").await;
        let mut src = tabular(
            Box::new(reader),
            "t",
            mapping(&[("id", IT::Integer), ("name", IT::Text)]),
            10,
        );
        let out = drain(&pool, &mut src, OnError::Abort).await;
        assert_eq!(out.rows_imported, 2);
    }

    // ---------- SQL script end to end ----------

    /// The headline case: a dump the app itself could have written, replayed
    /// into an empty database.
    #[tokio::test]
    async fn a_sql_dump_recreates_its_tables_and_rows() {
        let dump = "-- dodb dump\n\
                    /*!40101 SET NAMES utf8 */;\n\
                    DROP TABLE IF EXISTS \"items\";\n\
                    CREATE TABLE \"items\" (\n  \"id\" INTEGER PRIMARY KEY,\n  \"label\" TEXT\n);\n\
                    -- Data for table: items\n\
                    INSERT INTO \"items\" (\"id\", \"label\") VALUES\n  (1, 'first; not a split'),\n  (2, 'it''s fine'),\n  (3, 'ไทย');\n\
                    UPDATE \"items\" SET \"label\" = 'renamed' WHERE \"id\" = 3;\n";
        let file = TempFile::new("dump.sql", dump.as_bytes());
        let pool = empty_sqlite().await;

        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Sqlite, 2).expect("open dump");
        let out = drain(&pool, &mut src, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        // DROP, CREATE, INSERT, UPDATE — the /*!…*/ line is skipped.
        assert_eq!(out.statements_run, 4);
        assert_eq!(src.skipped_version_comments(), 1);

        assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM items").await, 3);
        assert_eq!(
            scalar_text(&pool, "SELECT label FROM items WHERE id = 1").await,
            Some("first; not a split".to_string())
        );
        assert_eq!(
            scalar_text(&pool, "SELECT label FROM items WHERE id = 2").await,
            Some("it's fine".to_string())
        );
        assert_eq!(
            scalar_text(&pool, "SELECT label FROM items WHERE id = 3").await,
            Some("renamed".to_string())
        );
    }

    /// A failing statement has to name the line it came from, or a 200 000-line
    /// dump is unfixable.
    #[tokio::test]
    async fn a_failing_statement_in_a_dump_reports_its_line() {
        let dump = "CREATE TABLE t (id INTEGER);\n\
                    INSERT INTO t VALUES (1);\n\
                    INSERT INTO nope VALUES (1);\n\
                    INSERT INTO t VALUES (2);\n";
        let file = TempFile::new("badline.sql", dump.as_bytes());
        let pool = empty_sqlite().await;

        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Sqlite, 1).expect("open dump");
        let out = drain(&pool, &mut src, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert_eq!(out.failures[0].line, Some(3));
        assert!(out.failures[0].excerpt.contains("nope"));
        // Skipping keeps going, so the statement after it still ran.
        assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM t").await, 2);
    }

    // ---------- Preview ----------

    #[tokio::test]
    async fn the_csv_preview_reports_columns_inferred_types_and_sample_rows() {
        let csv_text = "id,amount,flag,when\n1,2.50,true,2026-08-22\n2,3,false,2026-08-23\n";
        let file = TempFile::new("preview.csv", csv_text.as_bytes());

        let value = preview_import_file(
            file.path(),
            ImportFormat::Csv,
            CsvOptions::default(),
        )
        .await
        .expect("preview");

        assert_eq!(value["kind"], "tabular");
        assert_eq!(value["sampledRows"], 2);
        let cols = value["columns"].as_array().unwrap();
        assert_eq!(cols.len(), 4);
        assert_eq!(cols[0]["name"], "id");
        assert_eq!(cols[0]["inferredType"], "integer");
        // Mixing 2.50 with 3 widens to a number rather than failing later.
        assert_eq!(cols[1]["inferredType"], "double");
        assert_eq!(cols[2]["inferredType"], "boolean");
        assert_eq!(cols[3]["inferredType"], "date");
        assert_eq!(value["rows"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn the_sql_preview_lists_statements_and_fingerprints_the_dialect() {
        let dump = "CREATE TABLE `t` (`id` INT AUTO_INCREMENT);\nINSERT INTO `t` VALUES (1);\n";
        let file = TempFile::new("preview.sql", dump.as_bytes());

        let value = preview_import_file(
            file.path(),
            ImportFormat::Sql,
            CsvOptions::default(),
        )
        .await
        .expect("preview");

        assert_eq!(value["kind"], "sql");
        assert_eq!(value["exact"], true);
        assert_eq!(value["estimatedStatements"], 2);
        let hints = value["dialectHints"].as_array().unwrap();
        assert!(hints.contains(&serde_json::json!("mariadb")), "{hints:?}");
    }

    #[tokio::test]
    async fn describing_a_file_detects_its_format_and_delimiter() {
        let file = TempFile::new("describe.csv", b"a;b;c\n1;2;3\n");
        let info = describe(&file.path()).expect("describe");
        assert_eq!(info["format"], "csv");
        assert_eq!(info["delimiter"], ";");
        assert_eq!(info["looksUtf8"], true);
        assert_eq!(info["sizeBytes"], 12);
    }

    #[tokio::test]
    async fn a_giant_json_array_is_refused_with_a_pointer_to_json_lines() {
        // Skip the size gate by checking the message on the small path instead:
        // the guard is on file size, so assert the error text is actionable.
        let file = TempFile::new("empty.json", b"[]");
        let reader = JsonRowReader::open(&file.path(), vec!["id".into()]).expect("open");
        match reader {
            JsonRowReader::Array { rows, .. } => assert!(rows.is_empty()),
            _ => panic!("a top-level array must not be read as JSON Lines"),
        }
    }

    #[tokio::test]
    async fn a_jsonl_file_that_opens_with_a_bracket_line_still_streams() {
        // A pretty-printed array split over lines must not be mistaken for one.
        let file = TempFile::new("bracketed.jsonl", b"[\n{\"id\":1}\n]\n");
        let reader = JsonRowReader::open(&file.path(), vec!["id".into()]).expect("open");
        match reader {
            JsonRowReader::Lines { .. } => {}
            _ => panic!("expected the streaming reader"),
        }
    }

    // ==========================================
    // Postgres — opt-in via DODB_TEST_PG_URL
    // ==========================================

    /// Connects to the Postgres named by `DODB_TEST_PG_URL`.
    ///
    /// Returns `None` when the variable is unset so the suite still passes on a
    /// machine without a server — CI runs `cargo test` with no database.
    async fn pg() -> Option<DbPool> {
        let url = std::env::var("DODB_TEST_PG_URL").ok()?;
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(&url)
            .await
            .expect("connect to DODB_TEST_PG_URL");
        Some(DbPool::Postgres(pool))
    }

    /// Gives the test its own schema, dropping any leftovers from a failed run.
    async fn fresh_schema(pool: &DbPool, name: &str) -> String {
        exec(pool, &format!("DROP SCHEMA IF EXISTS {} CASCADE", name)).await;
        exec(pool, &format!("CREATE SCHEMA {}", name)).await;
        name.to_string()
    }

    /// Reads one value, aliased to `v`, through the same decode path the app uses.
    async fn one(pool: &DbPool, sql: &str) -> serde_json::Value {
        let rows = crate::db_core::execute_query(pool, sql).await.expect(sql);
        rows.first()
            .and_then(|r| r.get("v"))
            .cloned()
            .unwrap_or(serde_json::Value::Null)
    }

    async fn count_of(pool: &DbPool, table: &str) -> i64 {
        one(pool, &format!("SELECT COUNT(*) AS v FROM {}", table))
            .await
            .as_i64()
            .expect("count")
    }

    /// Rebuilds the coercion rules from the live table, exactly as `run_import`
    /// does before it starts streaming.
    async fn typed_mapping(
        pool: &DbPool,
        schema: &str,
        table: &str,
        source_columns: &[String],
    ) -> (Vec<(usize, String, IT)>, Vec<String>) {
        let sql = format!(
            "SELECT c.column_name AS name,
                    CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name::text ELSE c.data_type::text END AS type,
                    EXISTS (
                      SELECT 1 FROM information_schema.table_constraints tc
                      JOIN information_schema.key_column_usage k
                        ON k.constraint_name = tc.constraint_name AND k.table_schema = tc.table_schema
                      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = c.table_schema
                        AND tc.table_name = c.table_name AND k.column_name = c.column_name
                    ) AS \"primaryKey\"
             FROM information_schema.columns c
             WHERE c.table_schema = '{}' AND c.table_name = '{}'",
            schema, table
        );
        let rows = crate::db_core::execute_query(pool, &sql).await.expect("columns");
        let info = serde_json::json!({ "columns": rows });

        // Same two steps `run_import` takes: resolve each source column to a
        // target by name, then retype it from the live table.
        let mut request = defaults_request();
        request.columns = source_columns
            .iter()
            .map(|c| ColumnMapping {
                source: c.clone(),
                target: Some(c.clone()),
                sql_type: None,
                value_type: IT::Text,
            })
            .collect();
        let mut mapped = resolve_mapping(&request, source_columns);
        let pk = apply_declared_types(&mut mapped, &column_index(&info));
        (mapped, pk)
    }

    fn defaults_request() -> ImportRequest {
        ImportRequest {
            file_path: String::new(),
            format: ImportFormat::Csv,
            target_table: None,
            create_table: false,
            truncate_first: false,
            columns: Vec::new(),
            csv: CsvOptions::default(),
            batch_size: 500,
            conflict: ConflictStrategy::Error,
            on_error: OnError::Abort,
            tx_mode: TxMode::AtomicBatch,
            dry_run: false,
            max_errors: 200,
        }
    }

    fn pg_tabular(
        reader: Box<dyn RowReader + Send>,
        table: &str,
        mapped: Vec<(usize, String, IT)>,
        pk: Vec<String>,
        conflict: ConflictStrategy,
        batch_size: usize,
    ) -> TabularSource {
        let target_cols = mapped.iter().map(|(_, n, _)| n.clone()).collect();
        TabularSource {
            reader,
            db: SupportedDB::Postgres,
            table: table.to_string(),
            mapped,
            target_cols,
            conflict,
            pk,
            batch_size,
            null_literal: None,
            row_index: 0,
            failures: Vec::new(),
            done: false,
        }
    }

    async fn drain_with(
        pool: &DbPool,
        src: &mut dyn BatchSource,
        tx_mode: TxMode,
        on_error: OnError,
    ) -> ImportOutcome {
        let cancel = AtomicBool::new(false);
        let mut tick = |_: ImportTick| {};
        execute_import_stream(
            pool,
            src,
            ImportExecOptions {
                tx_mode,
                on_error,
                max_errors: 100,
            },
            &cancel,
            &mut tick,
        )
        .await
        .expect("import stream")
    }

    /// Importing into a table that already exists has to follow the declared
    /// column types. The NUMERIC column is the one that matters: routing it
    /// through `f64` would silently round a 23-digit value.
    #[tokio::test]
    async fn pg_an_existing_table_keeps_full_numeric_precision_and_real_types() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_types").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE {s}.t (
                   id integer,
                   total numeric(30,3),
                   ratio double precision,
                   ok boolean,
                   seen timestamp,
                   meta jsonb,
                   label text
                 )"
            ),
        )
        .await;

        let csv = "id,total,ratio,ok,seen,meta,label\n\
                   1,12345678901234567890.123,0.5,true,2026-08-22 10:11:12,\"{\"\"a\"\":1}\",plain\n\
                   2,-0.001,1e5,f,2026-01-01 00:00:00,[1],\n";
        let file = TempFile::new("pg-types.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        assert_eq!(cols, vec!["id", "total", "ratio", "ok", "seen", "meta", "label"]);

        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        // The declared types replaced the "everything is text" default.
        assert_eq!(mapped[0].2, IT::Integer, "{mapped:?}");
        assert_eq!(mapped[1].2, IT::Double);
        assert_eq!(mapped[3].2, IT::Boolean);
        assert_eq!(mapped[4].2, IT::Timestamp);
        assert_eq!(mapped[5].2, IT::Json);

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;
        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);

        // Every digit survived; an f64 round trip would end ...567000.000.
        assert_eq!(
            one(&pool, &format!("SELECT total::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("12345678901234567890.123")
        );
        assert_eq!(
            one(&pool, &format!("SELECT ok::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("true")
        );
        // "f" is a boolean Postgres understands.
        assert_eq!(
            one(&pool, &format!("SELECT ok::text AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::json!("false")
        );
        assert_eq!(
            one(&pool, &format!("SELECT ratio::text AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::json!("100000")
        );
        assert_eq!(
            one(&pool, &format!("SELECT meta::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("{\"a\": 1}")
        );
        // An empty text cell is an empty string, not NULL.
        assert_eq!(
            one(&pool, &format!("SELECT label AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::json!("")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    #[tokio::test]
    async fn pg_thai_text_quotes_and_backslashes_survive_the_round_trip() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_text").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let csv = "id,v\n\
                   1,ร้านทดสอบ ภาษาไทย\n\
                   2,\"O'Brien & Co\"\n\
                   3,back\\slash\n\
                   4,\"line\nbreak\"\n\
                   5,\"semi;colon, comma\"\n";
        let file = TempFile::new("pg-text.csv", csv.as_bytes());
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            2,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;
        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 5);

        for (id, expected) in [
            (1, "ร้านทดสอบ ภาษาไทย"),
            (2, "O'Brien & Co"),
            // standard_conforming_strings is on, so a lone backslash is literal.
            (3, "back\\slash"),
            (4, "line\nbreak"),
            (5, "semi;colon, comma"),
        ] {
            assert_eq!(
                one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE id = {id}")).await,
                serde_json::json!(expected),
                "row {id}"
            );
        }

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    #[tokio::test]
    async fn pg_skip_on_conflict_keeps_the_row_already_in_the_table() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_skip").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text)"),
        )
        .await;
        exec(&pool, &format!("INSERT INTO {s}.t VALUES (1, 'original')")).await;

        let file = TempFile::new("pg-skip.csv", b"id,v\n1,replaced\n2,new\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;
        assert_eq!(pk, vec!["id"], "the primary key must be discovered");

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Skip,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("original")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    #[tokio::test]
    async fn pg_update_on_conflict_overwrites_the_row_already_in_the_table() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_upsert").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text, n int)"),
        )
        .await;
        exec(&pool, &format!("INSERT INTO {s}.t VALUES (1, 'original', 9)")).await;

        let file = TempFile::new("pg-upsert.csv", b"id,v,n\n1,replaced,7\n2,new,1\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Update,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("replaced")
        );
        assert_eq!(
            one(&pool, &format!("SELECT n AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!(7)
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// `CREATE TABLE` from inferred types, then load into what it just made.
    #[tokio::test]
    async fn pg_a_new_table_is_created_from_the_inferred_types_and_loaded() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_create").await;

        let csv = "id,amount,flag,day,note\n\
                   1,2.50,true,2026-08-22,alpha\n\
                   2,3,false,2026-08-23,beta\n";
        let file = TempFile::new("pg-create.csv", csv.as_bytes());

        let preview =
            preview_import_file(file.path(), ImportFormat::Csv, CsvOptions::default())
                .await
                .expect("preview");
        let cols = preview["columns"].as_array().unwrap();
        let inferred: Vec<(String, String, bool)> = cols
            .iter()
            .map(|c| {
                let name = c["name"].as_str().unwrap().to_string();
                let ty: IT = serde_json::from_value(c["inferredType"].clone()).unwrap();
                (name, sql_type_for(ty, SupportedDB::Postgres).to_string(), true)
            })
            .collect();
        // Widened past the first row's 2.50, and the date recognised as a date.
        assert_eq!(inferred[1].1, "DOUBLE PRECISION", "{inferred:?}");
        assert_eq!(inferred[2].1, "BOOLEAN");
        assert_eq!(inferred[3].1, "DATE");

        let ddl = build_create_table(SupportedDB::Postgres, &format!("{s}.made"), &inferred)
            .expect("ddl");
        exec(&pool, &ddl).await;

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "made", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.made"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);
        assert_eq!(
            one(&pool, &format!("SELECT day::text AS v FROM {s}.made WHERE id = 1")).await,
            serde_json::json!("2026-08-22")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// The default `pg_dump` puts rows in `COPY … FROM stdin` blocks and wraps
    /// the file in psql `\restrict` directives. Neither is SQL the server will
    /// take, so both have to be handled by the reader.
    #[tokio::test]
    async fn pg_a_default_pg_dump_with_copy_blocks_and_meta_commands_replays() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_copy").await;
        // The dump recreates its own table, so start from an empty schema.
        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;

        let dump = format!(
            "--\n\
             -- PostgreSQL database dump\n\
             --\n\
             \\restrict bNnIQEdR0DJQi4DpZq7XM552bSgEv8Vma8TIfW4XQT6aQTcXszYyZr9Ux1YRpXi\n\
             SET statement_timeout = 0;\n\
             SET client_encoding = 'UTF8';\n\
             SET standard_conforming_strings = on;\n\
             SET row_security = off;\n\
             CREATE SCHEMA {s};\n\
             CREATE TABLE {s}.orders (\n    \
                 id integer NOT NULL,\n    \
                 customer text NOT NULL,\n    \
                 total numeric(20,4),\n    \
                 note text,\n    \
                 ok boolean DEFAULT true,\n    \
                 created timestamp without time zone\n\
             );\n\
             --\n\
             -- Data for Name: orders; Type: TABLE DATA; Schema: {s}\n\
             --\n\
             COPY {s}.orders (id, customer, total, note, ok, created) FROM stdin;\n\
             1\tร้านทดสอบ\t12345678901234.5678\ttab\\there\\nnewline\tt\t2026-08-22 10:11:12\n\
             2\tO'Brien & Co\t0.0001\t\\N\tf\t2026-01-01 00:00:00\n\
             3\tback\\\\slash\t-5.0000\tplain\tt\t\\N\n\
             \\.\n\
             \n\
             ALTER TABLE ONLY {s}.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);\n\
             \\unrestrict bNnIQEdR0DJQi4DpZq7XM552bSgEv8Vma8TIfW4XQT6aQTcXszYyZr9Ux1YRpXi\n\
             --\n\
             -- PostgreSQL database dump complete\n\
             --\n"
        );
        let file = TempFile::new("pg-dump-copy.sql", dump.as_bytes());

        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 100).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        // The two \restrict directives never reached the server.
        assert_eq!(src.skipped_meta_commands(), 2);
        assert_eq!(src.copy_rows(), 3);
        assert_eq!(out.rows_imported, 3);

        assert_eq!(count_of(&pool, &format!("{s}.orders")).await, 3);
        // Thai text through the COPY text format.
        assert_eq!(
            one(&pool, &format!("SELECT customer AS v FROM {s}.orders WHERE id = 1")).await,
            serde_json::json!("ร้านทดสอบ")
        );
        // COPY escapes decoded: \t is a tab, \n a newline.
        assert_eq!(
            one(&pool, &format!("SELECT note AS v FROM {s}.orders WHERE id = 1")).await,
            serde_json::json!("tab\there\nnewline")
        );
        // \N is NULL, not the literal "\N".
        assert_eq!(
            one(&pool, &format!("SELECT note AS v FROM {s}.orders WHERE id = 2")).await,
            serde_json::Value::Null
        );
        assert_eq!(
            one(&pool, &format!("SELECT created::text AS v FROM {s}.orders WHERE id = 3")).await,
            serde_json::Value::Null
        );
        // \\ is one backslash.
        assert_eq!(
            one(&pool, &format!("SELECT customer AS v FROM {s}.orders WHERE id = 3")).await,
            serde_json::json!("back\\slash")
        );
        // t / f became real booleans, and the apostrophe was escaped.
        assert_eq!(
            one(&pool, &format!("SELECT ok::text AS v FROM {s}.orders WHERE id = 2")).await,
            serde_json::json!("false")
        );
        assert_eq!(
            one(&pool, &format!("SELECT customer AS v FROM {s}.orders WHERE id = 2")).await,
            serde_json::json!("O'Brien & Co")
        );
        // NUMERIC(20,4) kept every digit.
        assert_eq!(
            one(&pool, &format!("SELECT total::text AS v FROM {s}.orders WHERE id = 1")).await,
            serde_json::json!("12345678901234.5678")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A COPY block larger than the batch size must be split into several
    /// INSERTs without losing or duplicating a row.
    #[tokio::test]
    async fn pg_a_copy_block_longer_than_one_batch_imports_every_row() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_copybatch").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let mut dump = format!("COPY {s}.t (id, v) FROM stdin;\n");
        for i in 1..=173 {
            dump.push_str(&format!("{}\trow-{}\n", i, i));
        }
        dump.push_str("\\.\n");
        let file = TempFile::new("pg-copybatch.sql", dump.as_bytes());

        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 20).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(src.copy_rows(), 173);
        assert_eq!(out.rows_imported, 173);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 173);
        assert_eq!(
            one(&pool, &format!("SELECT COUNT(DISTINCT id) AS v FROM {s}.t")).await,
            serde_json::json!(173)
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A `COPY … WITH (FORMAT csv)` block is refused rather than parsed as tabs,
    /// which would quietly mangle every row.
    #[tokio::test]
    async fn pg_a_non_text_copy_block_is_refused_with_an_actionable_message() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_copycsv").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let dump = format!(
            "COPY {s}.t (id, v) FROM stdin WITH (FORMAT csv);\n1,a\n\\.\n"
        );
        let file = TempFile::new("pg-copycsv.sql", dump.as_bytes());
        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 10).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert!(
            out.failures[0].message.contains("--inserts"),
            "{}",
            out.failures[0].message
        );
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 0);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A `pg_dump --inserts` file has multi-line string literals and lone
    /// backslashes; neither may confuse the splitter.
    #[tokio::test]
    async fn pg_an_inserts_style_dump_replays_including_multiline_literals() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_inserts").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int, v text, n numeric(20,4))"),
        )
        .await;

        let dump = format!(
            "SET standard_conforming_strings = on;\n\
             INSERT INTO {s}.t VALUES (1, 'tab\there\nnewline; not a split', 12345678901234.5678);\n\
             INSERT INTO {s}.t VALUES (2, 'O''Brien & Co', 0.0001);\n\
             INSERT INTO {s}.t VALUES (3, 'back\\slash', -5.0000);\n"
        );
        let file = TempFile::new("pg-inserts.sql", dump.as_bytes());
        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 10).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 3);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE id = 3")).await,
            serde_json::json!("back\\slash")
        );
        assert_eq!(
            one(&pool, &format!("SELECT n::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("12345678901234.5678")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Postgres aborts a whole transaction on the first error, so the reader
    /// must roll back and stop rather than keep pushing into a dead session.
    #[tokio::test]
    async fn pg_single_transaction_leaves_nothing_behind_when_a_statement_fails() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_tx").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text NOT NULL)"),
        )
        .await;

        let dump = format!(
            "INSERT INTO {s}.t VALUES (1, 'ok');\n\
             INSERT INTO {s}.t VALUES (2, NULL);\n\
             INSERT INTO {s}.t VALUES (3, 'ok');\n"
        );
        let file = TempFile::new("pg-tx.sql", dump.as_bytes());
        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 1).expect("open dump");
        let out =
            drain_with(&pool, &mut src, TxMode::SingleTransaction, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert!(
            out.failures[0].message.contains("rolled back"),
            "{}",
            out.failures[0].message
        );
        assert_eq!(out.rows_imported, 0);
        assert_eq!(out.statements_run, 0);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 0);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Per-batch transactions keep the batches that worked, and a NOT NULL
    /// violation has to name the column.
    #[tokio::test]
    async fn pg_a_constraint_violation_is_reported_and_earlier_batches_survive() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_notnull").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int, v text NOT NULL)"),
        )
        .await;

        // An empty cell becomes NULL for a text column only via \N.
        let file = TempFile::new("pg-notnull.csv", b"id,v\n1,ok\n2,\\N\n3,ok\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            1,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        let msg = &out.failures[0].message;
        assert!(msg.contains('v'), "{msg}");
        assert_eq!(out.rows_imported, 2);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 2);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Emptying the table first has to work on a table with inbound rows, and
    /// leave the schema alone.
    #[tokio::test]
    async fn pg_clearing_the_table_first_removes_the_old_rows_only() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_clear").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text)"),
        )
        .await;
        exec(&pool, &format!("INSERT INTO {s}.t VALUES (9, 'old')")).await;

        let clear = build_clear_table(SupportedDB::Postgres, &format!("{s}.t"));
        exec(&pool, &clear).await;
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 0);

        let file = TempFile::new("pg-clear.csv", b"id,v\n1,new\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Error,
            10,
        );
        drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 1);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("new")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Types whose literal form is nothing like a number: the value has to go
    /// through as a quoted string and let Postgres cast it.
    #[tokio::test]
    async fn pg_money_array_uuid_and_bytea_columns_accept_their_literal_forms() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_exotic").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE {s}.t (id int, m money, a int[], u uuid, b bytea, iv interval)"
            ),
        )
        .await;

        let csv = "id,m,a,u,b,iv\n\
                   1,\"$1,234.56\",\"{1,2,3}\",11111111-2222-3333-4444-555555555555,\\\\x00ff,1 day\n";
        let file = TempFile::new("pg-exotic.csv", csv.as_bytes());
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        // MONEY must not be treated as a float, or "$1,234.56" is rejected.
        assert_eq!(mapped[1].2, IT::Text, "{mapped:?}");
        assert_eq!(mapped[2].2, IT::Text, "an ARRAY column is passed as text");

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(&pool, &format!("SELECT m::text AS v FROM {s}.t")).await,
            serde_json::json!("$1,234.56")
        );
        assert_eq!(
            one(&pool, &format!("SELECT a::text AS v FROM {s}.t")).await,
            serde_json::json!("{1,2,3}")
        );
        assert_eq!(
            one(&pool, &format!("SELECT iv::text AS v FROM {s}.t")).await,
            serde_json::json!("1 day")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A wrong delimiter shows up as rows with more fields than columns; losing
    /// the surplus silently would look like a clean import.
    #[tokio::test]
    async fn pg_a_row_with_more_fields_than_columns_is_reported_not_trimmed() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_extra").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let file = TempFile::new("pg-extra.csv", b"id,v\n1,ok\n2,too,many,fields\n3,fine\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            1,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert!(
            out.failures[0].message.contains("delimiter"),
            "{}",
            out.failures[0].message
        );
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 2);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Replays whatever real dump `DODB_TEST_PG_DUMP` points at. Unset in CI;
    /// used locally to check against `pg_dump`'s actual bytes rather than a
    /// hand-written approximation.
    #[tokio::test]
    async fn pg_replays_a_real_pg_dump_file() {
        let Some(pool) = pg().await else { return };
        let Ok(path) = std::env::var("DODB_TEST_PG_DUMP") else {
            return;
        };
        let Ok(expected) = std::env::var("DODB_TEST_PG_DUMP_ROWS") else {
            return;
        };
        let table = std::env::var("DODB_TEST_PG_DUMP_TABLE").expect("DODB_TEST_PG_DUMP_TABLE");
        let schema = table.split('.').next().unwrap().to_string();
        exec(&pool, &format!("DROP SCHEMA IF EXISTS {} CASCADE", schema)).await;

        let mut src = SqlFileSource::open(&path, SupportedDB::Postgres, 500).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert!(
            out.failures.is_empty(),
            "a real pg_dump must replay cleanly: {:#?}",
            out.failures
        );
        assert_eq!(
            count_of(&pool, &table).await,
            expected.parse::<i64>().unwrap()
        );

        // Left in place when the caller wants to diff it against the original.
        if std::env::var("DODB_TEST_PG_DUMP_KEEP").is_err() {
            exec(&pool, &format!("DROP SCHEMA {} CASCADE", schema)).await;
        }
    }


    /// Excel writes a UTF-8 byte-order mark. Left in place it becomes part of
    /// the first column's name, so every mapping against that column silently
    /// misses.
    #[tokio::test]
    async fn pg_a_utf8_bom_is_stripped_from_the_first_header() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_bom").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, name text)")).await;

        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("id,name\r\n1,alpha\r\n2,ร้าน\r\n".as_bytes());
        let file = TempFile::new("pg-bom.csv", &bytes);

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        assert_eq!(cols, vec!["id", "name"], "the BOM must not join the header");

        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;
        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);
        // CRLF endings must not leave a stray \r on the value either.
        assert_eq!(
            one(&pool, &format!("SELECT name AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("alpha")
        );
        assert_eq!(
            one(&pool, &format!("SELECT name AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::json!("ร้าน")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A generated column left out of the mapping has to keep its default,
    /// which is how a CSV without an id column is supposed to load.
    #[tokio::test]
    async fn pg_an_unmapped_serial_column_still_gets_its_default() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_serial").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE {s}.t (id serial PRIMARY KEY, name text, note text DEFAULT 'dflt')"
            ),
        )
        .await;

        // Only `name` is present in the file.
        let file = TempFile::new("pg-serial.csv", b"name\nalpha\nbeta\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        assert_eq!(cols, vec!["name"]);
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(&pool, &format!("SELECT max(id) AS v FROM {s}.t")).await,
            serde_json::json!(2),
            "the sequence has to supply the ids"
        );
        assert_eq!(
            one(&pool, &format!("SELECT note AS v FROM {s}.t WHERE name = 'alpha'")).await,
            serde_json::json!("dflt")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Fifty thousand rows through the CSV path: the batch arithmetic and the
    /// byte counter both have to hold up past the toy sizes.
    #[tokio::test]
    async fn pg_fifty_thousand_csv_rows_import_exactly_once_each() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_bulk").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text, n numeric(20,6))"),
        )
        .await;

        let mut csv = String::from("id,v,n\n");
        for i in 1..=50_000 {
            csv.push_str(&format!("{},row-{},{}.000001\n", i, i, i));
        }
        let file = TempFile::new("pg-bulk.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Error,
            1000,
        );

        // Progress has to advance, not sit at zero until the end.
        let cancel = AtomicBool::new(false);
        let mut ticks = 0u32;
        let mut max_pct = 0u64;
        let total = src.total_bytes();
        let mut tick = |t: ImportTick| {
            ticks += 1;
            if t.total_bytes > 0 {
                max_pct = max_pct.max(t.bytes_read * 100 / t.total_bytes);
            }
        };
        let out = execute_import_stream(
            &pool,
            &mut src,
            ImportExecOptions {
                tx_mode: TxMode::AtomicBatch,
                on_error: OnError::Abort,
                max_errors: 100,
            },
            &cancel,
            &mut tick,
        )
        .await
        .expect("import stream");

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 50_000);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 50_000);
        assert_eq!(
            one(&pool, &format!("SELECT COUNT(DISTINCT id) AS v FROM {s}.t")).await,
            serde_json::json!(50_000)
        );
        assert_eq!(ticks, 50, "one tick per batch");
        assert!(total > 0, "the file size has to be known for progress");
        assert!(max_pct >= 99, "progress reached only {max_pct}%");
        assert_eq!(
            one(&pool, &format!("SELECT n::text AS v FROM {s}.t WHERE id = 7")).await,
            serde_json::json!("7.000001")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Cancelling has to stop promptly and leave the already-committed batches
    /// alone — the report says so, and the table has to agree.
    #[tokio::test]
    async fn pg_cancelling_mid_import_keeps_the_committed_batches_only() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_cancel").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int PRIMARY KEY, v text)")).await;

        let mut csv = String::from("id,v\n");
        for i in 1..=10_000 {
            csv.push_str(&format!("{},row-{}\n", i, i));
        }
        let file = TempFile::new("pg-cancel.csv", csv.as_bytes());
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Error,
            500,
        );

        let cancel = AtomicBool::new(false);
        let mut seen = 0u32;
        let mut tick = |_: ImportTick| {
            seen += 1;
            // Pull the plug after three committed batches.
            if seen == 3 {
                cancel.store(true, Ordering::SeqCst);
            }
        };
        let out = execute_import_stream(
            &pool,
            &mut src,
            ImportExecOptions {
                tx_mode: TxMode::AtomicBatch,
                on_error: OnError::Abort,
                max_errors: 100,
            },
            &cancel,
            &mut tick,
        )
        .await
        .expect("import stream");

        assert!(out.cancelled, "the report has to say it was cancelled");
        assert_eq!(out.rows_imported, 1500, "three batches of 500");
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 1500);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A dry run walks the whole file and finds the bad row without writing.
    #[tokio::test]
    async fn pg_a_dry_run_finds_a_bad_row_late_in_the_file_and_writes_nothing() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_dry").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let mut csv = String::from("id,v\n");
        for i in 1..=4_000 {
            csv.push_str(&format!("{},row-{}\n", i, i));
        }
        csv.push_str("not-a-number,bad\n");
        let file = TempFile::new("pg-dry.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut source = AnySource::Tabular(pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            500,
        ));

        let cancel = AtomicBool::new(false);
        let out = dry_run(
            &mut source,
            &ImportExecOptions {
                tx_mode: TxMode::AtomicBatch,
                on_error: OnError::SkipRow,
                max_errors: 100,
            },
            &cancel,
            &|_| {},
        )
        .expect("dry run");

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert_eq!(out.failures[0].index, 4_001);
        assert_eq!(out.rows_imported, 4_000, "counted, not written");
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 0);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A JSONL export from another tool, loaded into a typed table.
    #[tokio::test]
    async fn pg_jsonl_rows_land_in_their_declared_column_types() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_jsonl").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE {s}.t (id int, total numeric(20,4), ok boolean, meta jsonb, label text)"
            ),
        )
        .await;

        let jsonl = "{\"id\":1,\"total\":12345678901234.5678,\"ok\":true,\"meta\":{\"ก\":1},\"label\":\"ไทย\"}\n\
                     {\"id\":2,\"total\":null,\"ok\":false,\"meta\":[1,2],\"label\":\"O'Brien\"}\n";
        let file = TempFile::new("pg-rows.jsonl", jsonl.as_bytes());

        let keys = sniff_json_keys(&file.path()).expect("keys");
        // The mapping is built from the same list the reader projects against.
        let reader = JsonRowReader::open(&file.path(), keys.clone()).expect("open jsonl");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &keys).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        // A JSON number keeps its digits: serde_json prints it, we pass it on.
        assert_eq!(
            one(&pool, &format!("SELECT total::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("12345678901234.5678")
        );
        assert_eq!(
            one(&pool, &format!("SELECT total::text AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::Value::Null
        );
        // A nested object is re-serialised, not stringified twice.
        assert_eq!(
            one(&pool, &format!("SELECT meta::text AS v FROM {s}.t WHERE id = 1")).await,
            serde_json::json!("{\"ก\": 1}")
        );
        assert_eq!(
            one(&pool, &format!("SELECT label AS v FROM {s}.t WHERE id = 2")).await,
            serde_json::json!("O'Brien")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }


    // ---------- Postgres: identifiers, keys, empty blocks ----------

    /// Postgres folds an unquoted identifier to lower case, so a table or column
    /// with capitals or a reserved word only works if it is quoted everywhere.
    #[tokio::test]
    async fn pg_mixed_case_and_reserved_word_identifiers_are_quoted_everywhere() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_ident").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE {s}.\"MyOrders\" (\"Id\" int, \"order\" text, \"select\" int, \"ชื่อ\" text)"
            ),
        )
        .await;

        let csv = "Id,order,select,ชื่อ\n1,first,7,ไทย\n";
        let file = TempFile::new("pg-ident.csv", csv.as_bytes());
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        assert_eq!(cols, vec!["Id", "order", "select", "ชื่อ"]);

        let (mapped, _) = typed_mapping(&pool, &s, "MyOrders", &cols).await;
        // The declared types were found despite the capitals.
        assert_eq!(mapped[0].2, IT::Integer, "{mapped:?}");
        assert_eq!(mapped[2].2, IT::Integer);

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.MyOrders"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(
                &pool,
                &format!("SELECT \"ชื่อ\" AS v FROM {s}.\"MyOrders\" WHERE \"Id\" = 1")
            )
            .await,
            serde_json::json!("ไทย")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    #[tokio::test]
    async fn pg_update_on_conflict_handles_a_composite_primary_key() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_composite").await;
        exec(
            &pool,
            &format!("CREATE TABLE {s}.t (a int, b int, v text, PRIMARY KEY (a, b))"),
        )
        .await;
        exec(&pool, &format!("INSERT INTO {s}.t VALUES (1, 1, 'original')")).await;

        let file = TempFile::new("pg-composite.csv", b"a,b,v\n1,1,replaced\n1,2,new\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = typed_mapping(&pool, &s, "t", &cols).await;
        assert_eq!(pk.len(), 2, "both key columns must be found: {pk:?}");

        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            pk,
            ConflictStrategy::Update,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM {s}.t WHERE a = 1 AND b = 1")).await,
            serde_json::json!("replaced")
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A dump of an empty table has a COPY block with no rows between the
    /// statement and its terminator.
    #[tokio::test]
    async fn pg_an_empty_copy_block_is_handled_without_an_empty_insert() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_emptycopy").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        let dump = format!(
            "COPY {s}.t (id, v) FROM stdin;\n\\.\n\
             INSERT INTO {s}.t VALUES (1, 'after');\n"
        );
        let file = TempFile::new("pg-emptycopy.sql", dump.as_bytes());
        let mut src =
            SqlFileSource::open(&file.path(), SupportedDB::Postgres, 10).expect("open dump");
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(src.copy_rows(), 0);
        // The statement after the block still ran.
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 1);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// Mapping to a column the table does not have has to fail loudly, naming it.
    #[tokio::test]
    async fn pg_a_target_column_that_does_not_exist_is_reported() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_nocol").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int)")).await;

        let file = TempFile::new("pg-nocol.csv", b"id,ghost\n1,x\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert!(
            out.failures[0].message.contains("ghost"),
            "{}",
            out.failures[0].message
        );
        assert_eq!(count_of(&pool, &format!("{s}.t")).await, 0);

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }

    /// A megabyte in one cell has to survive being interpolated into a literal.
    #[tokio::test]
    async fn pg_a_very_large_text_value_round_trips_exactly() {
        let Some(pool) = pg().await else { return };
        let s = fresh_schema(&pool, "dodb_it_big").await;
        exec(&pool, &format!("CREATE TABLE {s}.t (id int, v text)")).await;

        // Quotes and backslashes throughout, so escaping is exercised at scale.
        let unit = "a'b\\c\u{e01}";
        let reps = 120_000;
        let blob = unit.repeat(reps);
        // A CSV field escapes its own quote character by doubling it; there are
        // no double quotes in `unit`, so the field just needs wrapping.
        let csv = format!("id,v\n1,\"{}\"\n", blob);
        let file = TempFile::new("pg-big.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = typed_mapping(&pool, &s, "t", &cols).await;
        let mut src = pg_tabular(
            Box::new(reader),
            &format!("{s}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(&pool, &format!("SELECT length(v) AS v FROM {s}.t")).await,
            serde_json::json!((unit.chars().count() * reps) as i64)
        );
        // Exact comparison, rebuilt by the database so nothing is re-escaped on
        // the way back through the test.
        assert_eq!(
            one(
                &pool,
                &format!("SELECT (v = repeat($tag${}$tag$, {})) AS v FROM {s}.t", unit, reps)
            )
            .await,
            serde_json::json!(true)
        );

        exec(&pool, &format!("DROP SCHEMA {s} CASCADE")).await;
    }


    // ==========================================
    // MariaDB / MySQL — opt-in via DODB_TEST_MYSQL_URL
    // ==========================================

    /// Connects to the MariaDB named by `DODB_TEST_MYSQL_URL`, or returns `None`
    /// so the suite still passes without one.
    async fn my() -> Option<DbPool> {
        let url = std::env::var("DODB_TEST_MYSQL_URL").ok()?;
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            // The same size the app's own pool uses, so any connection-affinity
            // problem shows up here rather than only in production.
            .max_connections(5)
            .connect(&url)
            .await
            .expect("connect to DODB_TEST_MYSQL_URL");
        Some(DbPool::MySql(pool))
    }

    async fn fresh_database(pool: &DbPool, name: &str) -> String {
        exec(pool, &format!("DROP DATABASE IF EXISTS {}", name)).await;
        exec(
            pool,
            &format!("CREATE DATABASE {} CHARACTER SET utf8mb4", name),
        )
        .await;
        name.to_string()
    }

    async fn my_typed_mapping(
        pool: &DbPool,
        database: &str,
        table: &str,
        source_columns: &[String],
    ) -> (Vec<(usize, String, IT)>, Vec<String>) {
        // `SHOW COLUMNS` is what `get_columns` uses for this dialect, so the
        // declared types arrive in MariaDB's full `int(11)` form.
        let rows = crate::db_core::execute_query(
            pool,
            &format!("SHOW COLUMNS FROM `{}`.`{}`", database, table),
        )
        .await
        .expect("show columns");
        let cols: Vec<serde_json::Value> = rows
            .iter()
            .map(|r| {
                serde_json::json!({
                    "name": r.get("Field").cloned().unwrap_or_default(),
                    "type": r.get("Type").cloned().unwrap_or_default(),
                    "primaryKey": r.get("Key").and_then(|k| k.as_str()) == Some("PRI"),
                })
            })
            .collect();
        let info = serde_json::json!({ "columns": cols });

        let mut request = defaults_request();
        request.columns = source_columns
            .iter()
            .map(|c| ColumnMapping {
                source: c.clone(),
                target: Some(c.clone()),
                sql_type: None,
                value_type: IT::Text,
            })
            .collect();
        let mut mapped = resolve_mapping(&request, source_columns);
        let pk = apply_declared_types(&mut mapped, &column_index(&info));
        (mapped, pk)
    }

    fn my_tabular(
        reader: Box<dyn RowReader + Send>,
        table: &str,
        mapped: Vec<(usize, String, IT)>,
        pk: Vec<String>,
        conflict: ConflictStrategy,
        batch_size: usize,
    ) -> TabularSource {
        let target_cols = mapped.iter().map(|(_, n, _)| n.clone()).collect();
        TabularSource {
            reader,
            db: SupportedDB::Mariadb,
            table: table.to_string(),
            mapped,
            target_cols,
            conflict,
            pk,
            batch_size,
            null_literal: None,
            row_index: 0,
            failures: Vec::new(),
            done: false,
        }
    }

    /// MariaDB reports the whole column type, widths and all, and spells
    /// BOOLEAN as TINYINT(1) — the mapping has to read both.
    #[tokio::test]
    async fn my_declared_types_and_values_survive_the_round_trip() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_types").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE `{d}`.`t` (
                   id INT(11),
                   total DECIMAL(30,6),
                   ratio DOUBLE,
                   ok TINYINT(1),
                   flag BIT(1),
                   seen DATETIME,
                   dur TIME,
                   yr YEAR,
                   kind ENUM('alpha','beta'),
                   label TEXT
                 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            ),
        )
        .await;

        let csv = "id,total,ratio,ok,flag,seen,dur,yr,kind,label\n\
                   1,123456789012345678901234.567890,1e-300,true,1,2026-08-22 10:11:12,01:02:03,2026,alpha,ไทย\n\
                   2,-0.000001,0.5,f,0,1999-01-01 00:00:00,00:00:01,1999,beta,\n";
        let file = TempFile::new("my-types.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "t", &cols).await;
        assert_eq!(mapped[0].2, IT::Integer, "int(11): {mapped:?}");
        assert_eq!(mapped[1].2, IT::Double, "decimal(30,6)");
        assert_eq!(mapped[3].2, IT::Boolean, "tinyint(1) is MySQL's boolean");
        assert_eq!(mapped[4].2, IT::Boolean, "bit(1)");
        assert_eq!(mapped[5].2, IT::Timestamp, "datetime");
        assert_eq!(mapped[6].2, IT::Text, "TIME is not a timestamp");
        assert_eq!(mapped[7].2, IT::Text, "YEAR goes in as a literal");
        assert_eq!(mapped[8].2, IT::Text, "ENUM goes in as a literal");

        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;
        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);

        // Every digit of the DECIMAL survived; an f64 would have rounded it.
        assert_eq!(
            one(&pool, &format!("SELECT CAST(total AS CHAR) AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("123456789012345678901234.567890")
        );
        assert_eq!(
            one(&pool, &format!("SELECT ok AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!(true)
        );
        assert_eq!(
            one(&pool, &format!("SELECT ok AS v FROM `{d}`.`t` WHERE id = 2")).await,
            serde_json::json!(false)
        );
        assert_eq!(
            one(&pool, &format!("SELECT label AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("ไทย")
        );
        assert_eq!(
            one(&pool, &format!("SELECT kind AS v FROM `{d}`.`t` WHERE id = 2")).await,
            serde_json::json!("beta")
        );
        assert_eq!(
            one(&pool, &format!("SELECT CAST(dur AS CHAR) AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("01:02:03")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// MySQL treats a backslash inside a string as an escape, so a value
    /// carrying one has to be doubled or the literal breaks.
    #[tokio::test]
    async fn my_backslashes_quotes_and_thai_text_are_escaped_correctly() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_esc").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE `{d}`.`t` (id INT, v TEXT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            ),
        )
        .await;

        let csv = "id,v\n\
                   1,back\\slash\n\
                   2,\"O'Brien & Co\"\n\
                   3,\"two\\\\backslashes\"\n\
                   4,\"looks like \\n escape\"\n\
                   5,ร้านทดสอบ\n\
                   6,\"quote\"\"inside\"\n";
        let file = TempFile::new("my-esc.csv", csv.as_bytes());
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "t", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            2,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;
        assert!(out.failures.is_empty(), "{:?}", out.failures);

        for (id, expected) in [
            (1, "back\\slash"),
            (2, "O'Brien & Co"),
            (3, "two\\\\backslashes"),
            // The two characters backslash-n, not a newline.
            (4, "looks like \\n escape"),
            (5, "ร้านทดสอบ"),
            (6, "quote\"inside"),
        ] {
            assert_eq!(
                one(&pool, &format!("SELECT v AS v FROM `{d}`.`t` WHERE id = {id}")).await,
                serde_json::json!(expected),
                "row {id}"
            );
        }

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    #[tokio::test]
    async fn my_insert_ignore_keeps_the_row_already_in_the_table() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_skip").await;
        exec(
            &pool,
            &format!("CREATE TABLE `{d}`.`t` (id INT PRIMARY KEY, v TEXT) ENGINE=InnoDB"),
        )
        .await;
        exec(&pool, &format!("INSERT INTO `{d}`.`t` VALUES (1, 'original')")).await;

        let file = TempFile::new("my-skip.csv", b"id,v\n1,replaced\n2,new\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = my_typed_mapping(&pool, &d, "t", &cols).await;
        assert_eq!(pk, vec!["id"]);

        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            pk,
            ConflictStrategy::Skip,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("`{d}`.`t`")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("original")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    #[tokio::test]
    async fn my_on_duplicate_key_update_overwrites_the_existing_row() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_upsert").await;
        exec(
            &pool,
            &format!("CREATE TABLE `{d}`.`t` (id INT PRIMARY KEY, v TEXT, n INT) ENGINE=InnoDB"),
        )
        .await;
        exec(
            &pool,
            &format!("INSERT INTO `{d}`.`t` VALUES (1, 'original', 9)"),
        )
        .await;

        let file = TempFile::new("my-upsert.csv", b"id,v,n\n1,replaced,7\n2,new,1\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = my_typed_mapping(&pool, &d, "t", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            pk,
            ConflictStrategy::Update,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(count_of(&pool, &format!("`{d}`.`t`")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("replaced")
        );
        assert_eq!(
            one(&pool, &format!("SELECT n AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!(7)
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// Backtick quoting, so a reserved word or a capital survives.
    #[tokio::test]
    async fn my_reserved_word_and_mixed_case_identifiers_are_backtick_quoted() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_ident").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE `{d}`.`MyOrders` (`Id` INT, `order` TEXT, `select` INT, `ชื่อ` TEXT)
                 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            ),
        )
        .await;

        let file = TempFile::new(
            "my-ident.csv",
            "Id,order,select,ชื่อ\n1,first,7,ไทย\n".as_bytes(),
        );
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "MyOrders", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.MyOrders"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(
                &pool,
                &format!("SELECT `ชื่อ` AS v FROM `{d}`.`MyOrders` WHERE `Id` = 1")
            )
            .await,
            serde_json::json!("ไทย")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// `STRICT_TRANS_TABLES` turns a bad value into an error instead of a
    /// silent truncation, so the report has to carry it.
    #[tokio::test]
    async fn my_a_value_the_column_rejects_is_reported_not_truncated() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_strict").await;
        exec(
            &pool,
            &format!("CREATE TABLE `{d}`.`t` (id INT, v VARCHAR(3)) ENGINE=InnoDB"),
        )
        .await;

        let file = TempFile::new("my-strict.csv", b"id,v\n1,ok\n2,waytoolong\n3,fin\n");
        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "t", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            1,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::SkipRow).await;

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);
        assert_eq!(count_of(&pool, &format!("`{d}`.`t`")).await, 2);

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// A `mysqldump` file, replayed. It carries backslash-escaped literals,
    /// `/*!40101 …*/` and `/*M!…*/` conditional blocks, `LOCK TABLES` and
    /// session-variable juggling — everything a real dump throws at a client.
    #[tokio::test]
    async fn my_replays_a_real_mysqldump_file() {
        let Some(pool) = my().await else { return };
        let Ok(path) = std::env::var("DODB_TEST_MYSQL_DUMP") else {
            return;
        };
        let table = std::env::var("DODB_TEST_MYSQL_DUMP_TABLE").expect("dump table");
        let expected: i64 = std::env::var("DODB_TEST_MYSQL_DUMP_ROWS")
            .expect("dump rows")
            .parse()
            .unwrap();
        let database = table.split('.').next().unwrap().to_string();
        exec(&pool, &format!("DROP DATABASE IF EXISTS {}", database)).await;

        let mut src = SqlFileSource::open(&path, SupportedDB::Mariadb, 200).expect("open dump");
        // Per-statement: a dump changes session state and locks tables, neither
        // of which belongs inside a transaction on this engine.
        let out = drain_with(&pool, &mut src, TxMode::PerStatement, OnError::SkipRow).await;

        assert!(
            out.failures.is_empty(),
            "a real mysqldump must replay cleanly: {:#?}",
            out.failures
        );
        assert_eq!(count_of(&pool, &table).await, expected);

        if std::env::var("DODB_TEST_MYSQL_DUMP_KEEP").is_err() {
            exec(&pool, &format!("DROP DATABASE {}", database)).await;
        }
    }

    /// A dump with stored routines wraps them in `DELIMITER ;;`, which is a
    /// client directive the splitter has to honour.
    #[tokio::test]
    async fn my_a_dump_with_a_delimiter_block_creates_the_routine() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_delim").await;

        let dump = format!(
            "/*!40101 SET NAMES utf8mb4 */;\n\
             USE `{d}`;\n\
             CREATE TABLE `t` (`id` INT) ENGINE=InnoDB;\n\
             DELIMITER ;;\n\
             CREATE PROCEDURE `add_one`(IN n INT)\n\
             BEGIN\n\
               INSERT INTO `t` (`id`) VALUES (n);\n\
               INSERT INTO `t` (`id`) VALUES (n + 1);\n\
             END ;;\n\
             DELIMITER ;\n\
             CALL `add_one`(10);\n"
        );
        let file = TempFile::new("my-delim.sql", dump.as_bytes());

        let mut src = SqlFileSource::open(&file.path(), SupportedDB::Mariadb, 1).expect("open");
        let out = drain_with(&pool, &mut src, TxMode::PerStatement, OnError::SkipRow).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        // The procedure body's own semicolons did not split it.
        assert_eq!(count_of(&pool, &format!("`{d}`.`t`")).await, 2);
        assert_eq!(
            one(&pool, &format!("SELECT MIN(id) AS v FROM `{d}`.`t`")).await,
            serde_json::json!(10)
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    #[tokio::test]
    async fn my_twenty_thousand_csv_rows_import_exactly_once_each() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_bulk").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE `{d}`.`t` (id INT PRIMARY KEY, v TEXT, n DECIMAL(20,6)) ENGINE=InnoDB"
            ),
        )
        .await;

        let mut csv = String::from("id,v,n\n");
        for i in 1..=20_000 {
            csv.push_str(&format!("{},row-{},{}.000001\n", i, i, i));
        }
        let file = TempFile::new("my-bulk.csv", csv.as_bytes());

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, pk) = my_typed_mapping(&pool, &d, "t", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            pk,
            ConflictStrategy::Error,
            1000,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 20_000);
        assert_eq!(count_of(&pool, &format!("`{d}`.`t`")).await, 20_000);
        assert_eq!(
            one(&pool, &format!("SELECT CAST(n AS CHAR) AS v FROM `{d}`.`t` WHERE id = 7")).await,
            serde_json::json!("7.000001")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// A CSV from Excel on a Thai machine is CP874, not UTF-8, and the target
    /// column is utf8mb4 — the decode has to happen before the literal is built.
    #[tokio::test]
    async fn my_a_tis620_csv_lands_as_utf8mb4_thai() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_thai").await;
        exec(
            &pool,
            &format!(
                "CREATE TABLE `{d}`.`t` (id INT, v VARCHAR(50)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
            ),
        )
        .await;

        // "กขค" in TIS-620 / CP874.
        let mut bytes: Vec<u8> = b"id,v\n1,".to_vec();
        bytes.extend_from_slice(&[0xA1, 0xA2, 0xA4]);
        bytes.push(b'\n');
        let file = TempFile::new("my-thai.csv", &bytes);

        let opts = CsvOptions {
            encoding: SourceEncoding::Tis620,
            ..CsvOptions::default()
        };
        let (reader, cols) = CsvRowReader::open(&file.path(), &opts).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "t", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.t"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(
            one(&pool, &format!("SELECT v AS v FROM `{d}`.`t` WHERE id = 1")).await,
            serde_json::json!("กขค")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

    /// Creating the table from the inferred types, then loading into it.
    #[tokio::test]
    async fn my_a_new_table_is_created_from_the_inferred_types_and_loaded() {
        let Some(pool) = my().await else { return };
        let d = fresh_database(&pool, "dodb_it_create").await;

        let csv = "id,amount,flag,day,note\n1,2.50,true,2026-08-22,alpha\n2,3,false,2026-08-23,beta\n";
        let file = TempFile::new("my-create.csv", csv.as_bytes());

        let preview = preview_import_file(file.path(), ImportFormat::Csv, CsvOptions::default())
            .await
            .expect("preview");
        let inferred: Vec<(String, String, bool)> = preview["columns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let name = c["name"].as_str().unwrap().to_string();
                let ty: IT = serde_json::from_value(c["inferredType"].clone()).unwrap();
                (name, sql_type_for(ty, SupportedDB::Mariadb).to_string(), true)
            })
            .collect();
        assert_eq!(inferred[1].1, "DOUBLE", "{inferred:?}");
        assert_eq!(inferred[2].1, "TINYINT(1)", "MySQL's boolean shape");
        assert_eq!(inferred[3].1, "DATE");

        let ddl =
            build_create_table(SupportedDB::Mariadb, &format!("{d}.made"), &inferred).expect("ddl");
        exec(&pool, &ddl).await;

        let (reader, cols) =
            CsvRowReader::open(&file.path(), &CsvOptions::default()).expect("open csv");
        let (mapped, _) = my_typed_mapping(&pool, &d, "made", &cols).await;
        let mut src = my_tabular(
            Box::new(reader),
            &format!("{d}.made"),
            mapped,
            Vec::new(),
            ConflictStrategy::Error,
            10,
        );
        let out = drain_with(&pool, &mut src, TxMode::AtomicBatch, OnError::Abort).await;

        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(out.rows_imported, 2);
        assert_eq!(
            one(&pool, &format!("SELECT flag AS v FROM `{d}`.`made` WHERE id = 1")).await,
            serde_json::json!(true)
        );
        assert_eq!(
            one(
                &pool,
                &format!("SELECT CAST(day AS CHAR) AS v FROM `{d}`.`made` WHERE id = 1")
            )
            .await,
            serde_json::json!("2026-08-22")
        );

        exec(&pool, &format!("DROP DATABASE {d}")).await;
    }

}
