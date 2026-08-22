//! Data import: file sniffing, SQL statement splitting, type inference and the
//! SQL literal/statement builders that turn a CSV/JSON row into DML.
//!
//! Everything here is a pure function or a self-contained state machine so it
//! can be covered by `cargo test` without a database or a Tauri handle. The
//! Tauri layer lives in `commands/import_cmd.rs` and the streaming executor in
//! `db_core::execute_import_stream`.

use serde::{Deserialize, Serialize};

use crate::commands::database_cmd::{quote_column_ident, quote_table_ident};
use crate::db_core::escape_sql_literal;
use crate::models::SupportedDB;

// ==========================================
// Wire types (mirrored by ui/src/utils/importManager.ts)
// ==========================================

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    /// A `.sql` script: replay its statements verbatim.
    Sql,
    /// Delimiter-separated text (`.csv`, `.tsv`).
    Csv,
    /// A top-level JSON array, or one JSON object per line (`.jsonl`).
    Json,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ConflictStrategy {
    /// Let the database raise the duplicate-key error.
    #[default]
    Error,
    /// Keep the row already in the table.
    Skip,
    /// Overwrite the row already in the table.
    Update,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum OnError {
    /// Stop at the first failing statement.
    #[default]
    Abort,
    /// Record the failure and carry on with the next batch.
    SkipRow,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum TxMode {
    /// No transaction. The only mode that survives MariaDB's implicit commit
    /// on DDL, which is why `execute_ddl` avoids transactions too.
    PerStatement,
    /// One transaction per batch: a failed batch rolls back only its own rows.
    #[default]
    AtomicBatch,
    /// One transaction around the whole file. Truly all-or-nothing, but holds
    /// locks for the entire run.
    SingleTransaction,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SourceEncoding {
    #[default]
    Utf8,
    /// TIS-620 / CP874 — what Excel on a Thai locale writes.
    Tis620,
    Windows1252,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    pub delimiter: String,
    pub quote: String,
    pub has_header: bool,
    /// Extra spelling of NULL in the source file (`\N` is always honoured).
    pub null_literal: Option<String>,
    pub encoding: SourceEncoding,
}

impl Default for CsvOptions {
    fn default() -> Self {
        Self {
            delimiter: ",".to_string(),
            quote: "\"".to_string(),
            has_header: true,
            null_literal: None,
            encoding: SourceEncoding::Utf8,
        }
    }
}

impl CsvOptions {
    /// The delimiter as a single byte, falling back to `,` for anything that is
    /// not exactly one ASCII character.
    pub fn delimiter_byte(&self) -> u8 {
        one_ascii(&self.delimiter).unwrap_or(b',')
    }

    pub fn quote_byte(&self) -> u8 {
        one_ascii(&self.quote).unwrap_or(b'"')
    }
}

fn one_ascii(s: &str) -> Option<u8> {
    let b = s.as_bytes();
    if b.len() == 1 && b[0].is_ascii() {
        Some(b[0])
    } else if s == "\\t" {
        Some(b'\t')
    } else {
        None
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ColumnMapping {
    /// Column name (or JSON key) in the source file.
    pub source: String,
    /// Target column, or `None` to leave the column out of the INSERT.
    pub target: Option<String>,
    /// Declared SQL type, used only when creating the table.
    pub sql_type: Option<String>,
    /// How to coerce the text. A hint from the preview; `run_import` overrides
    /// it from the real column type when importing into an existing table.
    pub value_type: InferredType,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub file_path: String,
    pub format: ImportFormat,
    /// Required for `Csv`/`Json`; ignored for `Sql` (the script names its own).
    pub target_table: Option<String>,
    pub create_table: bool,
    pub truncate_first: bool,
    #[serde(default)]
    pub columns: Vec<ColumnMapping>,
    #[serde(default)]
    pub csv: CsvOptions,
    pub batch_size: usize,
    #[serde(default)]
    pub conflict: ConflictStrategy,
    #[serde(default)]
    pub on_error: OnError,
    #[serde(default)]
    pub tx_mode: TxMode,
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default = "default_max_errors")]
    pub max_errors: usize,
}

fn default_max_errors() -> usize {
    200
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// `preparing` | `importing` | `done`
    pub phase: String,
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub percentage: u8,
    pub rows_imported: u64,
    pub statements_run: u64,
    pub errors: u64,
    pub current_table: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    /// 1-based index of the failing statement or row.
    pub index: u64,
    pub line: Option<u64>,
    /// Truncated SQL, so a bad 5 MB INSERT does not travel to the UI.
    pub excerpt: String,
    pub message: String,
}

impl ImportFailure {
    pub fn new(index: u64, line: Option<u64>, sql: &str, message: String) -> Self {
        Self {
            index,
            line,
            excerpt: excerpt(sql, 400),
            message,
        }
    }
}

/// Shortens `s` to at most `max` characters without splitting a UTF-8 char.
pub fn excerpt(s: &str, max: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max).collect();
    format!("{}…", head)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub success: bool,
    pub cancelled: bool,
    pub dry_run: bool,
    pub rows_imported: u64,
    pub statements_run: u64,
    pub tables_touched: Vec<String>,
    pub elapsed_ms: u64,
    pub failures: Vec<ImportFailure>,
    pub failures_truncated: bool,
    /// mysqldump `/*!… */` blocks that were skipped rather than executed.
    pub skipped_version_comments: u64,
    /// psql directives (`\restrict`, `\connect`) dropped from the script.
    pub skipped_meta_commands: u64,
    /// Rows that came out of `COPY … FROM stdin` blocks in a `pg_dump`.
    pub copy_rows: u64,
}

// ==========================================
// Type inference
// ==========================================

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum InferredType {
    Integer,
    Bigint,
    Double,
    Boolean,
    Date,
    Timestamp,
    Json,
    #[default]
    Text,
}

impl InferredType {
    /// Whether an empty cell means NULL rather than an empty value.
    fn blank_is_null(self) -> bool {
        !matches!(self, InferredType::Text | InferredType::Json)
    }

    fn label(self) -> &'static str {
        match self {
            InferredType::Integer => "integer",
            InferredType::Bigint => "bigint",
            InferredType::Double => "number",
            InferredType::Boolean => "boolean",
            InferredType::Date => "date",
            InferredType::Timestamp => "timestamp",
            InferredType::Json => "json",
            InferredType::Text => "text",
        }
    }
}

/// The spellings of NULL that every tabular exporter emits.
fn is_null_token(raw: &str) -> bool {
    let t = raw.trim();
    t == "\\N" || t.eq_ignore_ascii_case("null")
}

fn looks_boolean(t: &str) -> bool {
    matches!(
        t.to_ascii_lowercase().as_str(),
        "true" | "false" | "t" | "f" | "yes" | "no" | "y" | "n"
    )
}

fn looks_date(t: &str) -> bool {
    // YYYY-MM-DD
    let b = t.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b[..4].iter().all(u8::is_ascii_digit)
        && b[5..7].iter().all(u8::is_ascii_digit)
        && b[8..].iter().all(u8::is_ascii_digit)
}

fn looks_timestamp(t: &str) -> bool {
    if t.len() < 16 {
        return false;
    }
    let (date, rest) = t.split_at(10);
    if !looks_date(date) {
        return false;
    }
    let sep = rest.as_bytes()[0];
    (sep == b' ' || sep == b'T' || sep == b't') && rest[1..].starts_with(|c: char| c.is_ascii_digit())
}

fn looks_json(t: &str) -> bool {
    (t.starts_with('{') && t.ends_with('}')) || (t.starts_with('[') && t.ends_with(']'))
}

/// Picks the narrowest type that holds every sample.
///
/// Widening only ever goes one way (integer → bigint → double → text), so a
/// column of ids that ends with one free-text row comes back as `Text` instead
/// of failing halfway through the import.
pub fn infer_type(samples: &[Option<&str>]) -> (InferredType, bool) {
    let mut nullable = false;
    let mut seen = 0usize;

    let mut all_int = true;
    let mut fits_i32 = true;
    let mut all_float = true;
    let mut all_bool = true;
    let mut all_date = true;
    let mut all_ts = true;
    let mut all_json = true;

    for s in samples {
        let raw = match s {
            None => {
                nullable = true;
                continue;
            }
            Some(v) => *v,
        };
        let t = raw.trim();
        if t.is_empty() || is_null_token(t) {
            nullable = true;
            continue;
        }
        seen += 1;

        match t.parse::<i64>() {
            Ok(v) => {
                if v < i32::MIN as i64 || v > i32::MAX as i64 {
                    fits_i32 = false;
                }
            }
            Err(_) => all_int = false,
        }
        if t.parse::<f64>().map(|f| f.is_finite()).unwrap_or(false) {
            // ok
        } else {
            all_float = false;
        }
        if !looks_boolean(t) {
            all_bool = false;
        }
        if !looks_date(t) {
            all_date = false;
        }
        if !looks_timestamp(t) {
            all_ts = false;
        }
        if !looks_json(t) {
            all_json = false;
        }
    }

    if seen == 0 {
        return (InferredType::Text, true);
    }

    // Booleans first: "1"/"0" parse as integers too, but a column of only 1/0
    // is far more often a flag than a counter, so integer wins that tie.
    let ty = if all_int {
        if fits_i32 {
            InferredType::Integer
        } else {
            InferredType::Bigint
        }
    } else if all_bool {
        InferredType::Boolean
    } else if all_float {
        InferredType::Double
    } else if all_date {
        InferredType::Date
    } else if all_ts {
        InferredType::Timestamp
    } else if all_json {
        InferredType::Json
    } else {
        InferredType::Text
    };

    (ty, nullable)
}

/// The column type to declare when creating a table for `ty`.
pub fn sql_type_for(ty: InferredType, db: SupportedDB) -> &'static str {
    match (ty, db) {
        (InferredType::Integer, SupportedDB::Postgres) => "INTEGER",
        (InferredType::Integer, SupportedDB::Mariadb) => "INT",
        (InferredType::Integer, SupportedDB::Sqlite) => "INTEGER",

        (InferredType::Bigint, _) => "BIGINT",

        (InferredType::Double, SupportedDB::Postgres) => "DOUBLE PRECISION",
        (InferredType::Double, SupportedDB::Mariadb) => "DOUBLE",
        (InferredType::Double, SupportedDB::Sqlite) => "REAL",

        (InferredType::Boolean, SupportedDB::Postgres) => "BOOLEAN",
        (InferredType::Boolean, SupportedDB::Mariadb) => "TINYINT(1)",
        (InferredType::Boolean, SupportedDB::Sqlite) => "INTEGER",

        (InferredType::Date, SupportedDB::Sqlite) => "TEXT",
        (InferredType::Date, _) => "DATE",

        (InferredType::Timestamp, SupportedDB::Postgres) => "TIMESTAMP",
        (InferredType::Timestamp, SupportedDB::Mariadb) => "DATETIME",
        (InferredType::Timestamp, SupportedDB::Sqlite) => "TEXT",

        (InferredType::Json, SupportedDB::Postgres) => "JSONB",
        (InferredType::Json, SupportedDB::Mariadb) => "JSON",
        (InferredType::Json, SupportedDB::Sqlite) => "TEXT",

        (InferredType::Text, SupportedDB::Mariadb) => "TEXT",
        (InferredType::Text, _) => "TEXT",
    }
}

/// Maps a column type reported by `get_columns` back to a coercion rule.
///
/// Importing into an existing table must follow the column that is actually
/// there, not what the file looked like, or a text-shaped CSV cell lands
/// quoted in an integer column and the whole batch fails.
pub fn value_type_from_sql_type(sql_type: &str) -> InferredType {
    let t = sql_type.trim().to_ascii_lowercase();
    let head = t.split(['(', ' ']).next().unwrap_or("");

    match head {
        "bool" | "boolean" => InferredType::Boolean,
        // MySQL spells BOOLEAN as TINYINT(1), and BIT(1) is the other one-bit
        // shape. A wider BIT(n) holds arbitrary bits, so it stays text.
        "tinyint" => {
            if t.starts_with("tinyint(1)") {
                InferredType::Boolean
            } else {
                InferredType::Integer
            }
        }
        "bit" => {
            if t == "bit" || t.starts_with("bit(1)") {
                InferredType::Boolean
            } else {
                InferredType::Text
            }
        }
        "smallint" | "int2" | "mediumint" | "int" | "integer" | "int4" | "serial" => {
            InferredType::Integer
        }
        "bigint" | "int8" | "bigserial" => InferredType::Bigint,
        "real" | "float" | "float4" | "float8" | "double" | "numeric" | "decimal" => {
            InferredType::Double
        }
        // MONEY is written "$1,234.56", which no float parser accepts; Postgres
        // casts the string literal itself.
        "money" => InferredType::Text,
        "date" => InferredType::Date,
        "datetime" | "timestamp" | "timestamptz" => InferredType::Timestamp,
        "json" | "jsonb" => InferredType::Json,
        _ => InferredType::Text,
    }
}

// ==========================================
// Identifiers
// ==========================================

/// Turns a spreadsheet header into a usable column name.
pub fn sanitize_ident(raw: &str) -> String {
    let mut out = String::new();
    let mut last_underscore = false;
    for ch in raw.trim().chars() {
        // Keep every non-ASCII character: the engines accept them once quoted,
        // and `is_alphanumeric` is false for Thai tone marks and vowel signs,
        // so filtering on it silently mangles a Thai header.
        let keep = ch.is_ascii_alphanumeric()
            || ch == '_'
            || (!ch.is_ascii() && !ch.is_whitespace() && !ch.is_control());
        if keep {
            out.push(ch);
            last_underscore = false;
        } else if !last_underscore && !out.is_empty() {
            out.push('_');
            last_underscore = true;
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        return "column".to_string();
    }
    // A leading digit is not a valid unquoted identifier on any of the three.
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

/// Sanitizes a whole header row, resolving collisions with a numeric suffix.
pub fn sanitize_header(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(raw.len());
    for h in raw {
        let base = sanitize_ident(h);
        let mut name = base.clone();
        let mut n = 2;
        while out.iter().any(|e| e.eq_ignore_ascii_case(&name)) {
            name = format!("{}_{}", base, n);
            n += 1;
        }
        out.push(name);
    }
    out
}

// ==========================================
// Format / delimiter sniffing
// ==========================================

pub fn detect_format(path: &str, head: &str) -> ImportFormat {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".sql") {
        return ImportFormat::Sql;
    }
    if lower.ends_with(".json") || lower.ends_with(".jsonl") || lower.ends_with(".ndjson") {
        return ImportFormat::Json;
    }
    if lower.ends_with(".csv") || lower.ends_with(".tsv") {
        return ImportFormat::Csv;
    }

    // Unknown extension: go by content.
    let t = head.trim_start();
    if t.starts_with('{') || t.starts_with('[') {
        return ImportFormat::Json;
    }
    let upper = t.to_ascii_uppercase();
    for kw in [
        "CREATE TABLE",
        "INSERT INTO",
        "DROP TABLE",
        "ALTER TABLE",
        "SET ",
        "-- ",
        "/*",
    ] {
        if upper.starts_with(kw) {
            return ImportFormat::Sql;
        }
    }
    ImportFormat::Csv
}

/// Guesses the delimiter from the first non-empty line.
pub fn sniff_delimiter(head: &str) -> char {
    let line = head.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    let mut best = (',', 0usize);
    for cand in [',', '\t', ';', '|'] {
        let n = line.matches(cand).count();
        if n > best.1 {
            best = (cand, n);
        }
    }
    best.0
}

/// Whether `bytes` is valid UTF-8, tolerating a sequence cut off at the end.
///
/// Used to pick the default encoding: a Thai CSV exported from Excel is CP874,
/// and decoding it as UTF-8 turns every Thai column into replacement chars.
pub fn looks_utf8(bytes: &[u8]) -> bool {
    match std::str::from_utf8(bytes) {
        Ok(_) => true,
        // `error_len() == None` means the input simply ends mid-character.
        Err(e) => e.error_len().is_none(),
    }
}

pub fn decode_bytes(bytes: &[u8], encoding: SourceEncoding) -> String {
    let enc = match encoding {
        SourceEncoding::Utf8 => encoding_rs::UTF_8,
        SourceEncoding::Tis620 => encoding_rs::WINDOWS_874,
        SourceEncoding::Windows1252 => encoding_rs::WINDOWS_1252,
    };
    let (text, _, _) = enc.decode(bytes);
    text.into_owned()
}

/// Fingerprints a dump so the UI can warn about a dialect mismatch.
pub fn dialect_hints(head: &str) -> Vec<String> {
    let mut hints = Vec::new();
    let upper = head.to_ascii_uppercase();
    if head.contains('`')
        || upper.contains("AUTO_INCREMENT")
        || upper.contains("ENGINE=")
        || upper.contains("FOREIGN_KEY_CHECKS")
        || upper.contains("DEFAULT CHARSET")
    {
        hints.push("mariadb".to_string());
    }
    if upper.contains("SERIAL")
        || upper.contains("OWNER TO")
        || upper.contains("PG_CATALOG")
        || upper.contains("SET SEARCH_PATH")
        || upper.contains("COPY ")
    {
        hints.push("postgres".to_string());
    }
    if upper.contains("AUTOINCREMENT") || upper.contains("PRAGMA ") {
        hints.push("sqlite".to_string());
    }
    hints
}

// ==========================================
// Value + statement builders
// ==========================================

/// Renders one source cell as a SQL literal for `value_type`.
///
/// `raw: None` is an explicit NULL (a missing JSON key). An empty cell is NULL
/// for every type except text and json, where the difference between `''` and
/// NULL is usually meaningful.
pub fn format_import_value(
    db: SupportedDB,
    column: &str,
    value_type: InferredType,
    raw: Option<&str>,
    null_literal: Option<&str>,
) -> Result<String, String> {
    let raw = match raw {
        None => return Ok("NULL".to_string()),
        Some(v) => v,
    };

    // A NUL byte cannot be escaped into a literal on any of the three engines;
    // interpolating it truncates the statement silently.
    if raw.contains('\0') {
        return Err(format!(
            "column \"{}\": value contains a NUL byte, which cannot be imported",
            column
        ));
    }

    if let Some(nl) = null_literal {
        if !nl.is_empty() && raw == nl {
            return Ok("NULL".to_string());
        }
    }
    if raw.trim() == "\\N" {
        return Ok("NULL".to_string());
    }

    let t = raw.trim();
    if t.is_empty() {
        return Ok(if value_type.blank_is_null() {
            "NULL".to_string()
        } else {
            "''".to_string()
        });
    }

    match value_type {
        InferredType::Integer | InferredType::Bigint => t
            .parse::<i64>()
            .map(|v| v.to_string())
            .map_err(|_| invalid(column, t, value_type)),
        InferredType::Double => match t.parse::<f64>() {
            // Parse only to validate. Re-printing through `f64` would round a
            // NUMERIC/DECIMAL column down to 17 significant digits, which is
            // silent data loss — the literal goes through untouched instead.
            Ok(v) if v.is_finite() => Ok(t.to_string()),
            _ => Err(invalid(column, t, value_type)),
        },
        InferredType::Boolean => {
            let truthy = match t.to_ascii_lowercase().as_str() {
                "true" | "t" | "yes" | "y" | "1" => true,
                "false" | "f" | "no" | "n" | "0" => false,
                _ => return Err(invalid(column, t, value_type)),
            };
            Ok(match db {
                SupportedDB::Sqlite => if truthy { "1" } else { "0" }.to_string(),
                _ => if truthy { "TRUE" } else { "FALSE" }.to_string(),
            })
        }
        InferredType::Date | InferredType::Timestamp | InferredType::Json | InferredType::Text => {
            Ok(format!("'{}'", escape_sql_literal(db, raw)))
        }
    }
}

fn invalid(column: &str, value: &str, ty: InferredType) -> String {
    format!(
        "column \"{}\": {} is not a valid {}",
        column,
        excerpt(value, 60),
        ty.label()
    )
}

/// Builds one multi-row INSERT for `rows` of pre-formatted literals.
pub fn build_insert_batch(
    db: SupportedDB,
    table: &str,
    columns: &[String],
    rows: &[Vec<String>],
    conflict: ConflictStrategy,
    pk_columns: &[String],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("No columns are mapped, so there is nothing to insert.".to_string());
    }
    if rows.is_empty() {
        return Err("No rows to insert.".to_string());
    }

    let verb = match (conflict, db) {
        (ConflictStrategy::Skip, SupportedDB::Mariadb) => "INSERT IGNORE INTO",
        (ConflictStrategy::Skip, SupportedDB::Sqlite) => "INSERT OR IGNORE INTO",
        (ConflictStrategy::Update, SupportedDB::Sqlite) => "INSERT OR REPLACE INTO",
        _ => "INSERT INTO",
    };

    let col_list = columns
        .iter()
        .map(|c| quote_column_ident(db, c))
        .collect::<Vec<_>>()
        .join(", ");

    let values = rows
        .iter()
        .map(|r| format!("({})", r.join(", ")))
        .collect::<Vec<_>>()
        .join(",\n  ");

    let mut sql = format!(
        "{} {} ({}) VALUES\n  {}",
        verb,
        quote_table_ident(db, table),
        col_list,
        values
    );

    let non_pk: Vec<&String> = columns
        .iter()
        .filter(|c| !pk_columns.iter().any(|p| p.eq_ignore_ascii_case(c)))
        .collect();

    match (conflict, db) {
        (ConflictStrategy::Skip, SupportedDB::Postgres) => {
            sql.push_str("\nON CONFLICT DO NOTHING");
        }
        (ConflictStrategy::Update, SupportedDB::Mariadb) => {
            if non_pk.is_empty() {
                return Err(format!(
                    "Every mapped column of \"{}\" is part of the key, so there is nothing left to update on a duplicate.",
                    table
                ));
            }
            let sets = non_pk
                .iter()
                .map(|c| {
                    let q = quote_column_ident(db, c);
                    format!("{} = VALUES({})", q, q)
                })
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!("\nON DUPLICATE KEY UPDATE {}", sets));
        }
        (ConflictStrategy::Update, SupportedDB::Postgres) => {
            if pk_columns.is_empty() {
                return Err(format!(
                    "\"{}\" has no primary key, so Postgres cannot tell which rows conflict. Pick another duplicate strategy.",
                    table
                ));
            }
            if non_pk.is_empty() {
                return Err(format!(
                    "Every mapped column of \"{}\" is part of the key, so there is nothing left to update on a duplicate.",
                    table
                ));
            }
            let target = pk_columns
                .iter()
                .map(|c| quote_column_ident(db, c))
                .collect::<Vec<_>>()
                .join(", ");
            let sets = non_pk
                .iter()
                .map(|c| {
                    let q = quote_column_ident(db, c);
                    format!("{} = EXCLUDED.{}", q, q)
                })
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(&format!(
                "\nON CONFLICT ({}) DO UPDATE SET {}",
                target, sets
            ));
        }
        _ => {}
    }

    Ok(sql)
}

/// `CREATE TABLE` for a freshly inferred set of columns.
///
/// No primary key is declared: the source is a flat file, and guessing one
/// would reject rows the user asked us to load.
pub fn build_create_table(
    db: SupportedDB,
    table: &str,
    columns: &[(String, String, bool)],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("Cannot create a table with no columns.".to_string());
    }
    let defs = columns
        .iter()
        .map(|(name, ty, nullable)| {
            format!(
                "  {} {}{}",
                quote_column_ident(db, name),
                ty,
                if *nullable { "" } else { " NOT NULL" }
            )
        })
        .collect::<Vec<_>>()
        .join(",\n");

    Ok(format!(
        "CREATE TABLE {} (\n{}\n)",
        quote_table_ident(db, table),
        defs
    ))
}

/// Empties a table before an import.
///
/// SQLite has no TRUNCATE, and on Postgres/MariaDB TRUNCATE trips over inbound
/// foreign keys, so DELETE is the portable choice.
pub fn build_clear_table(db: SupportedDB, table: &str) -> String {
    format!("DELETE FROM {}", quote_table_ident(db, table))
}



// ==========================================
// JSON records
// ==========================================

/// One JSON record, keeping both the key order and the raw text of each value.
///
/// Going through `serde_json::Value` would lose both: its objects are a
/// `BTreeMap`, so a 30-field export shows up sorted alphabetically, and its
/// numbers are `f64`, so `12345678901234.5678` becomes `…5680` in a
/// `NUMERIC(20,4)` column. Holding the raw token keeps every digit and lets the
/// database do the parsing.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct JsonRecord {
    /// `(key, raw JSON text of the value)`, in file order.
    pub fields: Vec<(String, String)>,
    /// Set instead of `fields` when the record is a bare scalar or array.
    pub scalar: Option<String>,
}

impl JsonRecord {
    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.fields.iter().map(|(k, _)| k.as_str())
    }

    /// The cell for `key`, or `None` when the key is absent or JSON `null`.
    pub fn cell(&self, key: &str) -> Option<String> {
        let raw = self.fields.iter().find(|(k, _)| k == key).map(|(_, v)| v)?;
        json_raw_to_cell(raw)
    }
}

impl<'de> Deserialize<'de> for JsonRecord {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct V;

        impl<'de> serde::de::Visitor<'de> for V {
            type Value = JsonRecord;

            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("any JSON value")
            }

            fn visit_map<A>(self, mut map: A) -> Result<JsonRecord, A::Error>
            where
                A: serde::de::MapAccess<'de>,
            {
                let mut fields = Vec::new();
                while let Some(key) = map.next_key::<String>()? {
                    let raw = map.next_value::<Box<serde_json::value::RawValue>>()?;
                    fields.push((key, raw.get().to_string()));
                }
                Ok(JsonRecord {
                    fields,
                    scalar: None,
                })
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<JsonRecord, A::Error>
            where
                A: serde::de::SeqAccess<'de>,
            {
                // A record that is an array has no column names of its own; keep
                // it whole so it can land in the single column it maps to.
                let mut parts: Vec<String> = Vec::new();
                while let Some(raw) = seq.next_element::<Box<serde_json::value::RawValue>>()? {
                    parts.push(raw.get().to_string());
                }
                Ok(JsonRecord {
                    fields: Vec::new(),
                    scalar: Some(format!("[{}]", parts.join(","))),
                })
            }

            fn visit_unit<E>(self) -> Result<JsonRecord, E> {
                Ok(JsonRecord::default())
            }
            fn visit_none<E>(self) -> Result<JsonRecord, E> {
                Ok(JsonRecord::default())
            }
            fn visit_bool<E>(self, v: bool) -> Result<JsonRecord, E> {
                Ok(JsonRecord { fields: Vec::new(), scalar: Some(v.to_string()) })
            }
            fn visit_i64<E>(self, v: i64) -> Result<JsonRecord, E> {
                Ok(JsonRecord { fields: Vec::new(), scalar: Some(v.to_string()) })
            }
            fn visit_u64<E>(self, v: u64) -> Result<JsonRecord, E> {
                Ok(JsonRecord { fields: Vec::new(), scalar: Some(v.to_string()) })
            }
            fn visit_f64<E>(self, v: f64) -> Result<JsonRecord, E> {
                Ok(JsonRecord { fields: Vec::new(), scalar: Some(v.to_string()) })
            }
            fn visit_str<E>(self, v: &str) -> Result<JsonRecord, E> {
                Ok(JsonRecord { fields: Vec::new(), scalar: Some(v.to_string()) })
            }
        }

        deserializer.deserialize_any(V)
    }
}

/// Turns one raw JSON token into the text that goes into the SQL literal.
///
/// Numbers, objects and arrays pass through verbatim: re-serialising them would
/// round the numbers and re-sort the keys.
pub fn json_raw_to_cell(raw: &str) -> Option<String> {
    let t = raw.trim();
    if t == "null" {
        return None;
    }
    if t.starts_with('"') {
        // Let serde undo the string escapes.
        return serde_json::from_str::<String>(t).ok().or_else(|| Some(t.to_string()));
    }
    Some(t.to_string())
}

/// Adds every key of `record` that `keys` does not already hold, in order.
pub fn merge_record_keys(keys: &mut Vec<String>, record: &JsonRecord) {
    for k in record.keys() {
        if !keys.iter().any(|e| e == k) {
            keys.push(k.to_string());
        }
    }
}

// ==========================================
// Postgres COPY blocks
// ==========================================

/// The table and columns named by a `COPY … FROM stdin` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct CopyHeader {
    pub table: String,
    /// Empty when the statement named no columns.
    pub columns: Vec<String>,
}

/// Recognises the `COPY … FROM stdin` that opens a default `pg_dump` data block.
///
/// This matters because a plain `pg_dump` puts the rows in the file as
/// tab-separated text after the statement, not as INSERTs. Handing those lines
/// to the server as SQL produces a wall of syntax errors, so the reader has to
/// know where a COPY block starts and consume its data itself.
///
/// Returns `Err` for a COPY whose data is not in the default text format, since
/// parsing it as tabs would quietly mangle every row.
pub fn parse_copy_header(sql: &str) -> Option<Result<CopyHeader, String>> {
    let trimmed = sql.trim();
    let upper = trimmed.to_ascii_uppercase();
    if !upper.starts_with("COPY") || !upper[4..5.min(upper.len())].trim().is_empty() {
        return None;
    }
    if !upper.contains("FROM STDIN") {
        return None;
    }
    // `WITH (FORMAT csv)` and friends change the on-the-wire shape entirely.
    if upper.contains("FORMAT") && (upper.contains("CSV") || upper.contains("BINARY")) {
        return Some(Err(
            "This COPY block is not in the default text format, so its rows cannot be read. Re-dump with `pg_dump --inserts`."
                .to_string(),
        ));
    }

    let rest = trimmed[4..].trim_start();
    // The table name ends at the column list or at FROM, whichever comes first.
    let paren = rest.find('(');
    let from = find_keyword(&upper, "FROM").map(|i| i - (trimmed.len() - rest.len()));

    let (table_end, columns) = match (paren, from) {
        (Some(p), Some(f)) if p < f => {
            let close = rest[p..].find(')').map(|i| i + p)?;
            let list = &rest[p + 1..close];
            (p, split_ident_list(list))
        }
        (_, Some(f)) => (f, Vec::new()),
        _ => return None,
    };

    let table = strip_ident(rest[..table_end].trim());
    if table.is_empty() {
        return None;
    }
    Some(Ok(CopyHeader { table, columns }))
}

/// Finds `kw` as a standalone word in already-upper-cased text.
fn find_keyword(upper: &str, kw: &str) -> Option<usize> {
    let b = upper.as_bytes();
    let k = kw.as_bytes();
    let mut i = 0;
    while i + k.len() <= b.len() {
        if &b[i..i + k.len()] == k {
            let before_ok = i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
            let after = i + k.len();
            let after_ok = after >= b.len() || !(b[after].is_ascii_alphanumeric() || b[after] == b'_');
            if before_ok && after_ok {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn split_ident_list(list: &str) -> Vec<String> {
    list.split(',')
        .map(|c| strip_ident(c.trim()))
        .filter(|c| !c.is_empty())
        .collect()
}

/// Removes the double quotes Postgres puts around an identifier that needs them.
fn strip_ident(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2 && t.starts_with('"') && t.ends_with('"') {
        return t[1..t.len() - 1].replace("\"\"", "\"");
    }
    t.to_string()
}

/// Decodes one field of a COPY text-format row.
///
/// `\N` on its own is NULL — checked before unescaping, so a field holding the
/// letter N (written `\\N`) is not mistaken for it.
pub fn unescape_copy_field(raw: &str) -> Option<String> {
    if raw == "\\N" {
        return None;
    }
    if !raw.contains('\\') {
        return Some(raw.to_string());
    }

    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            None => out.push('\\'),
            Some('b') => out.push('\u{08}'),
            Some('f') => out.push('\u{0c}'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('v') => out.push('\u{0b}'),
            Some('\\') => out.push('\\'),
            Some('x') => {
                // \xHH, one or two hex digits.
                let mut hex = String::new();
                let mut peek = chars.clone();
                for _ in 0..2 {
                    match peek.next() {
                        Some(h) if h.is_ascii_hexdigit() => {
                            hex.push(h);
                            chars.next();
                        }
                        _ => break,
                    }
                    peek = chars.clone();
                }
                match u8::from_str_radix(&hex, 16) {
                    Ok(v) if !hex.is_empty() => out.push(v as char),
                    _ => out.push('x'),
                }
            }
            Some(d) if d.is_digit(8) => {
                // Up to three octal digits.
                let mut oct = d.to_string();
                let mut peek = chars.clone();
                for _ in 0..2 {
                    match peek.next() {
                        Some(o) if o.is_digit(8) => {
                            oct.push(o);
                            chars.next();
                        }
                        _ => break,
                    }
                    peek = chars.clone();
                }
                match u8::from_str_radix(&oct, 8) {
                    Ok(v) => out.push(v as char),
                    Err(_) => out.push_str(&oct),
                }
            }
            // Postgres reads a backslash before anything else as that character.
            Some(other) => out.push(other),
        }
    }
    Some(out)
}

/// Splits one COPY text-format line into its fields.
pub fn split_copy_row(line: &str) -> Vec<Option<String>> {
    line.split('\t').map(unescape_copy_field).collect()
}

/// True for a psql meta-command line such as `\restrict` or `\connect`.
///
/// `pg_dump` 17+ wraps its output in `\restrict`/`\unrestrict`, which are
/// client-side directives; sending them to the server is a syntax error.
pub fn is_psql_meta_command(line: &str) -> bool {
    let t = line.trim_start();
    let mut chars = t.chars();
    if chars.next() != Some('\\') {
        return false;
    }
    matches!(chars.next(), Some(c) if c.is_ascii_alphabetic() || c == '.' || c == '?' || c == '!')
}

// ==========================================
// SQL statement splitter
// ==========================================

#[derive(Clone, Copy, Debug, PartialEq)]
enum ScanState {
    Normal,
    LineComment,
    /// `gated` marks a mysqldump `/*!40101 … */` block, which we skip rather
    /// than execute — it is version-conditional server configuration.
    BlockComment { gated: bool },
    Single,
    Double,
    Backtick,
    /// Inside `$tag$ … $tag$`; the closing tag is held in `dollar_tag`.
    Dollar,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SplitStatement {
    pub sql: String,
    /// 1-based line of the statement's first non-comment character.
    pub line: u64,
}

/// Splits a SQL script into statements, one chunk at a time.
///
/// The frontend has its own splitter in `ui/src/utils/sqlUtils.ts`, but it
/// needs the whole script in memory and recomputes line numbers in O(n²), so a
/// multi-hundred-megabyte dump has to be split here instead. Feeding is
/// incremental: state and scan position survive between `feed` calls, so a
/// statement that straddles two chunks is still reassembled correctly.
pub struct SqlSplitter {
    pending: String,
    scan_pos: usize,
    stmt_start: usize,
    stmt_line: u64,
    cur_line: u64,
    state: ScanState,
    dollar_tag: String,
    delimiter: String,
    has_content: bool,
    backslash_escapes: bool,
    skipped_version_comments: u64,
    skipped_meta_commands: u64,
}

impl SqlSplitter {
    /// `backslash_escapes` follows the target dialect: MySQL/MariaDB treat
    /// `\'` as an escaped quote, Postgres and SQLite do not, and guessing
    /// wrong swallows a string terminator.
    pub fn new(backslash_escapes: bool) -> Self {
        Self {
            pending: String::new(),
            scan_pos: 0,
            stmt_start: 0,
            stmt_line: 1,
            cur_line: 1,
            state: ScanState::Normal,
            dollar_tag: String::new(),
            delimiter: ";".to_string(),
            has_content: false,
            backslash_escapes,
            skipped_version_comments: 0,
            skipped_meta_commands: 0,
        }
    }

    pub fn for_dialect(db: SupportedDB) -> Self {
        Self::new(matches!(db, SupportedDB::Mariadb))
    }

    pub fn skipped_version_comments(&self) -> u64 {
        self.skipped_version_comments
    }

    /// psql directives (`\restrict`, `\connect`) that were dropped because the
    /// server has no idea what they are.
    pub fn skipped_meta_commands(&self) -> u64 {
        self.skipped_meta_commands
    }

    pub fn feed(&mut self, chunk: &str) -> Vec<SplitStatement> {
        self.pending.push_str(chunk);
        self.scan(false)
    }

    /// Flushes whatever is left, including a final statement with no delimiter.
    pub fn finish(&mut self) -> Vec<SplitStatement> {
        self.scan(true)
    }

    fn scan(&mut self, eof: bool) -> Vec<SplitStatement> {
        let src = std::mem::take(&mut self.pending);
        let b = src.as_bytes();
        let n = b.len();

        let mut out: Vec<SplitStatement> = Vec::new();
        let mut pos = self.scan_pos;
        let mut state = self.state;
        let mut dollar_tag = std::mem::take(&mut self.dollar_tag);
        let mut delimiter = std::mem::take(&mut self.delimiter);
        let mut cur_line = self.cur_line;
        let mut stmt_start = self.stmt_start;
        let mut stmt_line = self.stmt_line;
        let mut has_content = self.has_content;
        let mut skipped = self.skipped_version_comments;
        let mut skipped_meta = self.skipped_meta_commands;

        // Records where the statement's real content begins, so the reported
        // line skips the blank lines and comments in front of it.
        macro_rules! mark {
            () => {
                if !has_content {
                    has_content = true;
                    stmt_line = cur_line;
                }
            };
        }
        // Whitespace and comments in front of a statement belong to nobody, so
        // drag the start forward past them instead of prefixing the statement.
        macro_rules! sync_start {
            () => {
                if !has_content {
                    stmt_start = pos;
                }
            };
        }

        'scan: while pos < n {
            match state {
                ScanState::Normal => {
                    // A psql meta-command (`\restrict`, `\connect`) is a client
                    // directive, not SQL: drop the line rather than send it.
                    if !has_content && b[pos] == b'\\' {
                        match find_byte(b, pos, b'\n') {
                            Some(nl) => {
                                if is_psql_meta_command(&src[pos..nl]) {
                                    skipped_meta += 1;
                                }
                                cur_line += 1;
                                pos = nl + 1;
                                stmt_start = pos;
                                continue 'scan;
                            }
                            None if eof => {
                                if is_psql_meta_command(&src[pos..]) {
                                    skipped_meta += 1;
                                }
                                pos = n;
                                stmt_start = n;
                                continue 'scan;
                            }
                            None => break 'scan,
                        }
                    }

                    // `DELIMITER ;;` — only meaningful at a statement start.
                    if !has_content && starts_with_delimiter_kw(b, pos) {
                        match find_byte(b, pos, b'\n') {
                            Some(nl) => {
                                if let Some(d) = parse_delimiter_line(&src[pos..nl]) {
                                    delimiter = d;
                                }
                                cur_line += 1;
                                pos = nl + 1;
                                stmt_start = pos;
                                continue 'scan;
                            }
                            None if eof => {
                                if let Some(d) = parse_delimiter_line(&src[pos..]) {
                                    delimiter = d;
                                }
                                pos = n;
                                stmt_start = n;
                                continue 'scan;
                            }
                            None => break 'scan,
                        }
                    }

                    if b[pos..].starts_with(delimiter.as_bytes()) {
                        let end = pos;
                        pos += delimiter.len();
                        if has_content {
                            let sql = src[stmt_start..end].trim();
                            if !sql.is_empty() {
                                out.push(SplitStatement {
                                    sql: sql.to_string(),
                                    line: stmt_line,
                                });
                            }
                        }
                        has_content = false;
                        stmt_start = pos;
                        continue 'scan;
                    }
                    // A multi-byte delimiter cut in half by the chunk boundary.
                    if !eof && n - pos < delimiter.len() && delimiter.as_bytes().starts_with(&b[pos..])
                    {
                        break 'scan;
                    }

                    match b[pos] {
                        b'\n' => {
                            cur_line += 1;
                            pos += 1;
                            sync_start!();
                        }
                        b' ' | b'\t' | b'\r' => {
                            pos += 1;
                            sync_start!();
                        }
                        b'-' => {
                            if pos + 1 >= n {
                                if !eof {
                                    break 'scan;
                                }
                                mark!();
                                pos += 1;
                            } else if b[pos + 1] == b'-' {
                                state = ScanState::LineComment;
                                pos += 2;
                            } else {
                                mark!();
                                pos += 1;
                            }
                        }
                        // Only a comment when it opens a token: Postgres uses
                        // `#>` as a JSON operator.
                        b'#' if pos == 0 || b[pos - 1].is_ascii_whitespace() => {
                            state = ScanState::LineComment;
                            pos += 1;
                        }
                        b'/' => {
                            if pos + 1 >= n {
                                if !eof {
                                    break 'scan;
                                }
                                mark!();
                                pos += 1;
                            } else if b[pos + 1] == b'*' {
                                if pos + 2 >= n && !eof {
                                    break 'scan;
                                }
                                let gated = pos + 2 < n && b[pos + 2] == b'!';
                                state = ScanState::BlockComment { gated };
                                pos += 2;
                            } else {
                                mark!();
                                pos += 1;
                            }
                        }
                        b'\'' => {
                            mark!();
                            state = ScanState::Single;
                            pos += 1;
                        }
                        b'"' => {
                            mark!();
                            state = ScanState::Double;
                            pos += 1;
                        }
                        b'`' => {
                            mark!();
                            state = ScanState::Backtick;
                            pos += 1;
                        }
                        b'$' => match read_dollar_tag(b, pos, n) {
                            DollarTag::Tag(end) => {
                                mark!();
                                dollar_tag.clear();
                                dollar_tag.push_str(&src[pos..end]);
                                state = ScanState::Dollar;
                                pos = end;
                            }
                            DollarTag::NeedMore if !eof => break 'scan,
                            _ => {
                                mark!();
                                pos += 1;
                            }
                        },
                        _ => {
                            mark!();
                            pos += 1;
                        }
                    }
                }

                ScanState::LineComment => match find_byte(b, pos, b'\n') {
                    Some(nl) => {
                        cur_line += 1;
                        pos = nl + 1;
                        state = ScanState::Normal;
                        sync_start!();
                    }
                    None => {
                        pos = n;
                        if eof {
                            state = ScanState::Normal;
                        }
                        sync_start!();
                    }
                },

                ScanState::BlockComment { gated } => match find_pair(b, pos, b'*', b'/') {
                    Some(idx) => {
                        cur_line += count_newlines(&b[pos..idx]);
                        if gated {
                            skipped += 1;
                        }
                        pos = idx + 2;
                        state = ScanState::Normal;
                        sync_start!();
                    }
                    None => {
                        // Hold back a trailing `*` so `*/` can span chunks.
                        let stop = if !eof && n > pos && b[n - 1] == b'*' {
                            n - 1
                        } else {
                            n
                        };
                        cur_line += count_newlines(&b[pos..stop]);
                        pos = stop;
                        if eof {
                            state = ScanState::Normal;
                        } else {
                            break 'scan;
                        }
                    }
                },

                ScanState::Single => {
                    match self.scan_quoted(b, n, pos, b'\'', self.backslash_escapes, eof) {
                        QuotedStep::Closed { next, newlines } => {
                            cur_line += newlines;
                            pos = next;
                            state = ScanState::Normal;
                        }
                        QuotedStep::Continue { next, newlines } => {
                            cur_line += newlines;
                            pos = next;
                            break 'scan;
                        }
                        QuotedStep::Advance { next, newlines } => {
                            cur_line += newlines;
                            pos = next;
                        }
                    }
                }
                ScanState::Double => match self.scan_quoted(b, n, pos, b'"', false, eof) {
                    QuotedStep::Closed { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                        state = ScanState::Normal;
                    }
                    QuotedStep::Continue { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                        break 'scan;
                    }
                    QuotedStep::Advance { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                    }
                },
                ScanState::Backtick => match self.scan_quoted(b, n, pos, b'`', false, eof) {
                    QuotedStep::Closed { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                        state = ScanState::Normal;
                    }
                    QuotedStep::Continue { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                        break 'scan;
                    }
                    QuotedStep::Advance { next, newlines } => {
                        cur_line += newlines;
                        pos = next;
                    }
                },

                ScanState::Dollar => {
                    let t = dollar_tag.as_bytes();
                    match find_slice(b, pos, t) {
                        Some(idx) => {
                            cur_line += count_newlines(&b[pos..idx]);
                            pos = idx + t.len();
                            state = ScanState::Normal;
                        }
                        None => {
                            let keep = t.len().saturating_sub(1);
                            let stop = if !eof { n.saturating_sub(keep).max(pos) } else { n };
                            cur_line += count_newlines(&b[pos..stop]);
                            pos = stop;
                            if eof {
                                state = ScanState::Normal;
                            } else {
                                break 'scan;
                            }
                        }
                    }
                }
            }
        }

        if eof && has_content && stmt_start < n {
            let sql = src[stmt_start..].trim();
            if !sql.is_empty() {
                out.push(SplitStatement {
                    sql: sql.to_string(),
                    line: stmt_line,
                });
            }
            has_content = false;
            stmt_start = n;
        }

        // Drop everything already turned into statements; keep the tail.
        let mut pending = src;
        if stmt_start > 0 {
            pending.drain(..stmt_start);
            pos -= stmt_start;
            stmt_start = 0;
        }

        self.pending = pending;
        self.scan_pos = pos;
        self.state = state;
        self.dollar_tag = dollar_tag;
        self.delimiter = delimiter;
        self.cur_line = cur_line;
        self.stmt_start = stmt_start;
        self.stmt_line = stmt_line;
        self.has_content = has_content;
        self.skipped_version_comments = skipped;
        self.skipped_meta_commands = skipped_meta;

        out
    }

    /// One step through a quoted run. `Continue` means the decision needs a
    /// byte that has not arrived yet.
    fn scan_quoted(
        &self,
        b: &[u8],
        n: usize,
        from: usize,
        quote: u8,
        backslash: bool,
        eof: bool,
    ) -> QuotedStep {
        let mut i = from;
        let mut newlines = 0u64;
        while i < n {
            let c = b[i];
            if c == b'\n' {
                newlines += 1;
                i += 1;
                continue;
            }
            if backslash && c == b'\\' {
                if i + 1 >= n {
                    return if eof {
                        QuotedStep::Advance {
                            next: n,
                            newlines,
                        }
                    } else {
                        QuotedStep::Continue { next: i, newlines }
                    };
                }
                if b[i + 1] == b'\n' {
                    newlines += 1;
                }
                i += 2;
                continue;
            }
            if c == quote {
                if i + 1 >= n {
                    if eof {
                        return QuotedStep::Closed {
                            next: n,
                            newlines,
                        };
                    }
                    return QuotedStep::Continue { next: i, newlines };
                }
                // A doubled quote is an escaped quote, not the end.
                if b[i + 1] == quote {
                    i += 2;
                    continue;
                }
                return QuotedStep::Closed {
                    next: i + 1,
                    newlines,
                };
            }
            i += 1;
        }
        QuotedStep::Advance { next: n, newlines }
    }
}

enum QuotedStep {
    /// The quote closed; resume normal scanning at `next`.
    Closed { next: usize, newlines: u64 },
    /// Ran out of input mid-decision; stop here and wait for more.
    Continue { next: usize, newlines: u64 },
    /// Consumed up to `next` and still inside the quote.
    Advance { next: usize, newlines: u64 },
}

enum DollarTag {
    /// A complete `$tag$` ending just before this index.
    Tag(usize),
    NeedMore,
    NotATag,
}

/// Recognises a Postgres dollar-quote opener at `pos`.
fn read_dollar_tag(b: &[u8], pos: usize, n: usize) -> DollarTag {
    let mut i = pos + 1;
    while i < n {
        let c = b[i];
        if c == b'$' {
            return DollarTag::Tag(i + 1);
        }
        let first = i == pos + 1;
        let ok = c == b'_' || c.is_ascii_alphabetic() || (!first && c.is_ascii_digit());
        if !ok {
            // `$1` is a placeholder, not a quote opener.
            return DollarTag::NotATag;
        }
        i += 1;
    }
    DollarTag::NeedMore
}

fn find_byte(b: &[u8], from: usize, needle: u8) -> Option<usize> {
    b[from..].iter().position(|c| *c == needle).map(|i| i + from)
}

fn find_pair(b: &[u8], from: usize, a: u8, c: u8) -> Option<usize> {
    if from + 1 >= b.len() {
        return None;
    }
    (from..b.len() - 1).find(|&i| b[i] == a && b[i + 1] == c)
}

fn find_slice(b: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || b.len() < needle.len() {
        return None;
    }
    (from..=b.len() - needle.len()).find(|&i| &b[i..i + needle.len()] == needle)
}

fn count_newlines(b: &[u8]) -> u64 {
    b.iter().filter(|c| **c == b'\n').count() as u64
}

fn starts_with_delimiter_kw(b: &[u8], pos: usize) -> bool {
    const KW: &[u8] = b"delimiter";
    if pos + KW.len() >= b.len() {
        return false;
    }
    for (i, k) in KW.iter().enumerate() {
        if b[pos + i].to_ascii_lowercase() != *k {
            return false;
        }
    }
    b[pos + KW.len()].is_ascii_whitespace()
}

fn parse_delimiter_line(line: &str) -> Option<String> {
    let rest = line.trim().get(9..)?.trim();
    if rest.is_empty() {
        None
    } else {
        Some(rest.to_string())
    }
}

/// Convenience wrapper for whole-script splitting (preview and tests).
pub fn split_sql(script: &str, backslash_escapes: bool) -> Vec<SplitStatement> {
    let mut s = SqlSplitter::new(backslash_escapes);
    let mut out = s.feed(script);
    out.extend(s.finish());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sqls(script: &str) -> Vec<String> {
        split_sql(script, true).into_iter().map(|s| s.sql).collect()
    }

    // ---------- SqlSplitter ----------

    #[test]
    fn semicolon_inside_a_string_does_not_end_the_statement() {
        let out = sqls("INSERT INTO t VALUES ('a;b'); SELECT 1;");
        assert_eq!(out, vec!["INSERT INTO t VALUES ('a;b')", "SELECT 1"]);
    }

    #[test]
    fn doubled_and_backslash_quote_escapes_are_both_understood() {
        let out = sqls("INSERT INTO t VALUES ('it''s'); INSERT INTO t VALUES ('it\\'s; still one');");
        assert_eq!(
            out,
            vec![
                "INSERT INTO t VALUES ('it''s')",
                "INSERT INTO t VALUES ('it\\'s; still one')"
            ]
        );
    }

    #[test]
    fn backslash_is_literal_when_the_dialect_does_not_escape_with_it() {
        // Postgres: 'a\' is a complete string, so the semicolon after it ends
        // the statement. Treating \' as an escape would swallow the terminator.
        let out: Vec<String> = split_sql("SELECT 'a\\'; SELECT 2;", false)
            .into_iter()
            .map(|s| s.sql)
            .collect();
        assert_eq!(out, vec!["SELECT 'a\\'", "SELECT 2"]);
    }

    #[test]
    fn all_three_comment_styles_are_skipped() {
        let script = "-- leading\n# hash\n/* block ; still comment */\nSELECT 1; -- trailing\nSELECT 2;";
        assert_eq!(sqls(script), vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn a_hash_inside_an_operator_is_not_a_comment() {
        // Postgres `#>` must survive; only whitespace-led `#` opens a comment.
        let out = sqls("SELECT data#>'{a}' FROM t;");
        assert_eq!(out, vec!["SELECT data#>'{a}' FROM t"]);
    }

    #[test]
    fn dollar_quoted_bodies_keep_their_semicolons() {
        let script = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 1;";
        let out = sqls(script);
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(out[0].contains("RETURN 1;"), "{}", out[0]);
        assert_eq!(out[1], "SELECT 1");
    }

    #[test]
    fn named_dollar_tags_only_close_on_a_matching_tag() {
        let script = "SELECT $body$ a $$ b ; $body$;";
        let out = sqls(script);
        assert_eq!(out.len(), 1, "{out:?}");
        assert!(out[0].contains("$$ b ;"), "{}", out[0]);
    }

    #[test]
    fn a_dollar_placeholder_is_not_a_quote_opener() {
        assert_eq!(sqls("SELECT $1; SELECT $2;"), vec!["SELECT $1", "SELECT $2"]);
    }

    #[test]
    fn delimiter_directive_switches_the_terminator_and_back() {
        let script = "DELIMITER ;;\nCREATE TRIGGER t BEGIN SELECT 1; SELECT 2; END;;\nDELIMITER ;\nSELECT 3;";
        let out = sqls(script);
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(out[0].starts_with("CREATE TRIGGER"), "{}", out[0]);
        assert!(out[0].contains("SELECT 2;"), "{}", out[0]);
        assert_eq!(out[1], "SELECT 3");
    }

    #[test]
    fn version_gated_mysqldump_comments_are_skipped_and_counted() {
        let script = "/*!40101 SET NAMES utf8 */;\n/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\nSELECT 1;";
        let mut s = SqlSplitter::new(true);
        let mut out = s.feed(script);
        out.extend(s.finish());
        let stmts: Vec<String> = out.into_iter().map(|s| s.sql).collect();
        assert_eq!(stmts, vec!["SELECT 1"]);
        assert_eq!(s.skipped_version_comments(), 2);
    }

    #[test]
    fn a_final_statement_without_a_terminator_is_still_emitted() {
        assert_eq!(sqls("SELECT 1;\nSELECT 2"), vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn blank_input_and_comment_only_input_yield_nothing() {
        assert!(sqls("").is_empty());
        assert!(sqls("   \n\n  ").is_empty());
        assert!(sqls("-- just a note\n/* and a block */\n;;;").is_empty());
    }

    /// The reason the splitter lives in Rust at all: a dump is fed in chunks,
    /// and a statement, string, comment or dollar body may straddle any
    /// boundary. Splitting byte-by-byte is the harshest version of that.
    #[test]
    fn statements_reassemble_across_every_chunk_boundary() {
        let script = "-- head\nINSERT INTO `t` (a,b) VALUES ('x;y', 'it''s'); \
/* mid ; comment */ UPDATE t SET a='\\'' WHERE b=1;\n\
CREATE FUNCTION f() RETURNS int AS $tag$ BEGIN RETURN 1; END $tag$ LANGUAGE plpgsql;\n\
SELECT 3";
        let expected = sqls(script);
        assert_eq!(expected.len(), 4, "{expected:?}");

        for size in [1usize, 2, 3, 5, 7, 13, 31, 64] {
            let mut s = SqlSplitter::new(true);
            let mut got: Vec<String> = Vec::new();
            let bytes = script.as_bytes();
            let mut i = 0;
            while i < bytes.len() {
                // Keep chunks on char boundaries; the script is ASCII here.
                let end = (i + size).min(bytes.len());
                got.extend(s.feed(&script[i..end]).into_iter().map(|st| st.sql));
                i = end;
            }
            got.extend(s.finish().into_iter().map(|st| st.sql));
            assert_eq!(got, expected, "chunk size {size}");
        }
    }

    #[test]
    fn multi_byte_delimiter_split_across_chunks_still_terminates() {
        let mut s = SqlSplitter::new(true);
        let mut out = s.feed("DELIMITER ;;\nSELECT 1;");
        out.extend(s.feed(";\nSELECT 2;;"));
        out.extend(s.finish());
        let stmts: Vec<String> = out.into_iter().map(|s| s.sql).collect();
        assert_eq!(stmts, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn reported_lines_point_at_the_statements_first_real_character() {
        let script = "-- note\n\nSELECT 1;\n\n/* two\n   lines */\nSELECT 2;";
        let out = split_sql(script, true);
        assert_eq!(out[0].line, 3, "{out:?}");
        assert_eq!(out[1].line, 7, "{out:?}");
    }

    #[test]
    fn utf8_payloads_survive_the_byte_level_scan() {
        let out = sqls("INSERT INTO t VALUES ('ทดสอบ; ภาษาไทย'); SELECT 'ก';");
        assert_eq!(
            out,
            vec!["INSERT INTO t VALUES ('ทดสอบ; ภาษาไทย')", "SELECT 'ก'"]
        );
    }

    // ---------- inference ----------

    fn some(v: &[&str]) -> Vec<Option<&'static str>> {
        // Leaks are fine in a test; this keeps the call sites readable.
        v.iter()
            .map(|s| Some(&*Box::leak(s.to_string().into_boxed_str())))
            .collect()
    }

    #[test]
    fn narrow_integers_stay_integers_and_wide_ones_widen() {
        assert_eq!(infer_type(&some(&["1", "2", "-3"])).0, InferredType::Integer);
        assert_eq!(
            infer_type(&some(&["1", "9999999999"])).0,
            InferredType::Bigint
        );
    }

    #[test]
    fn mixing_an_integer_with_a_decimal_widens_to_double() {
        assert_eq!(infer_type(&some(&["1", "2.5"])).0, InferredType::Double);
    }

    #[test]
    fn one_free_text_row_demotes_the_whole_column_to_text() {
        assert_eq!(infer_type(&some(&["1", "2", "n/a"])).0, InferredType::Text);
    }

    #[test]
    fn booleans_dates_timestamps_and_json_are_recognised() {
        assert_eq!(
            infer_type(&some(&["true", "FALSE", "yes"])).0,
            InferredType::Boolean
        );
        assert_eq!(
            infer_type(&some(&["2026-08-22", "1999-01-01"])).0,
            InferredType::Date
        );
        assert_eq!(
            infer_type(&some(&["2026-08-22 10:11:12", "2026-08-22T10:11:12"])).0,
            InferredType::Timestamp
        );
        assert_eq!(
            infer_type(&some(&["{\"a\":1}", "[1,2]"])).0,
            InferredType::Json
        );
    }

    #[test]
    fn a_column_of_ones_and_zeros_reads_as_integer_not_boolean() {
        // Ties go to integer: a counter mis-typed as boolean loses data, a
        // flag stored as integer does not.
        assert_eq!(infer_type(&some(&["1", "0", "1"])).0, InferredType::Integer);
    }

    #[test]
    fn every_spelling_of_null_marks_the_column_nullable() {
        for token in ["", "  ", "\\N", "NULL", "null"] {
            let samples = vec![Some("1"), Some(token)];
            let (ty, nullable) = infer_type(&samples);
            assert_eq!(ty, InferredType::Integer, "token {token:?}");
            assert!(nullable, "token {token:?}");
        }
        let (ty, nullable) = infer_type(&[Some("1"), None]);
        assert_eq!(ty, InferredType::Integer);
        assert!(nullable);
    }

    #[test]
    fn an_all_empty_column_falls_back_to_nullable_text() {
        let (ty, nullable) = infer_type(&[Some(""), None, Some("\\N")]);
        assert_eq!(ty, InferredType::Text);
        assert!(nullable);
    }

    #[test]
    fn sql_type_for_covers_all_three_dialects() {
        assert_eq!(
            sql_type_for(InferredType::Boolean, SupportedDB::Postgres),
            "BOOLEAN"
        );
        assert_eq!(
            sql_type_for(InferredType::Boolean, SupportedDB::Mariadb),
            "TINYINT(1)"
        );
        assert_eq!(
            sql_type_for(InferredType::Boolean, SupportedDB::Sqlite),
            "INTEGER"
        );
        assert_eq!(
            sql_type_for(InferredType::Double, SupportedDB::Postgres),
            "DOUBLE PRECISION"
        );
        assert_eq!(
            sql_type_for(InferredType::Double, SupportedDB::Sqlite),
            "REAL"
        );
        assert_eq!(
            sql_type_for(InferredType::Json, SupportedDB::Postgres),
            "JSONB"
        );
        assert_eq!(
            sql_type_for(InferredType::Timestamp, SupportedDB::Mariadb),
            "DATETIME"
        );
        assert_eq!(
            sql_type_for(InferredType::Timestamp, SupportedDB::Sqlite),
            "TEXT"
        );
    }

    #[test]
    fn declared_column_types_map_back_to_a_coercion_rule() {
        assert_eq!(value_type_from_sql_type("int(11)"), InferredType::Integer);
        assert_eq!(
            value_type_from_sql_type("character varying(255)"),
            InferredType::Text
        );
        assert_eq!(value_type_from_sql_type("BIGINT"), InferredType::Bigint);
        assert_eq!(value_type_from_sql_type("bigserial"), InferredType::Bigint);
        assert_eq!(
            value_type_from_sql_type("numeric(10,2)"),
            InferredType::Double
        );
        assert_eq!(value_type_from_sql_type("boolean"), InferredType::Boolean);
        assert_eq!(value_type_from_sql_type("tinyint(1)"), InferredType::Boolean);
        assert_eq!(value_type_from_sql_type("tinyint(4)"), InferredType::Integer);
        // MariaDB reports the full column type, so the width is part of it.
        assert_eq!(value_type_from_sql_type("mediumint(9)"), InferredType::Integer);
        assert_eq!(value_type_from_sql_type("bigint(20)"), InferredType::Bigint);
        assert_eq!(value_type_from_sql_type("decimal(30,6)"), InferredType::Double);
        assert_eq!(value_type_from_sql_type("varchar(50)"), InferredType::Text);
        assert_eq!(value_type_from_sql_type("longtext"), InferredType::Text);
        assert_eq!(value_type_from_sql_type("datetime"), InferredType::Timestamp);
        // TIME is not a timestamp, and YEAR/ENUM/SET are all literal text.
        assert_eq!(value_type_from_sql_type("time"), InferredType::Text);
        assert_eq!(value_type_from_sql_type("year(4)"), InferredType::Text);
        assert_eq!(value_type_from_sql_type("enum('x','y')"), InferredType::Text);
        assert_eq!(value_type_from_sql_type("set('p','q')"), InferredType::Text);
        // Only a one-bit BIT is a boolean; BIT(8) holds arbitrary bits.
        assert_eq!(value_type_from_sql_type("bit(1)"), InferredType::Boolean);
        assert_eq!(value_type_from_sql_type("bit(8)"), InferredType::Text);
        assert_eq!(
            value_type_from_sql_type("timestamp with time zone"),
            InferredType::Timestamp
        );
        assert_eq!(value_type_from_sql_type("jsonb"), InferredType::Json);
        assert_eq!(value_type_from_sql_type("geometry"), InferredType::Text);
    }

    // ---------- identifiers ----------

    #[test]
    fn headers_become_usable_identifiers() {
        assert_eq!(sanitize_ident("  First Name  "), "First_Name");
        assert_eq!(sanitize_ident("total ($)"), "total");
        assert_eq!(sanitize_ident("a//b"), "a_b");
        assert_eq!(sanitize_ident("2024"), "_2024");
        assert_eq!(sanitize_ident("!!!"), "column");
        assert_eq!(sanitize_ident(""), "column");
        // Thai headers are kept: the engines accept them once quoted.
        assert_eq!(sanitize_ident("ชื่อ สินค้า"), "ชื่อ_สินค้า");
    }

    #[test]
    fn colliding_headers_get_a_numeric_suffix() {
        let raw = vec![
            "Name".to_string(),
            "name".to_string(),
            "na me".to_string(),
            "!!".to_string(),
            "!!".to_string(),
        ];
        assert_eq!(
            sanitize_header(&raw),
            vec!["Name", "name_2", "na_me", "column", "column_2"]
        );
    }

    // ---------- sniffing ----------

    #[test]
    fn format_comes_from_the_extension_then_the_content() {
        assert_eq!(detect_format("a/b.SQL", ""), ImportFormat::Sql);
        assert_eq!(detect_format("a.jsonl", ""), ImportFormat::Json);
        assert_eq!(detect_format("a.tsv", ""), ImportFormat::Csv);
        assert_eq!(detect_format("dump", "  [\n{}"), ImportFormat::Json);
        assert_eq!(
            detect_format("dump", "INSERT INTO t VALUES (1);"),
            ImportFormat::Sql
        );
        assert_eq!(detect_format("dump", "a,b,c\n1,2,3"), ImportFormat::Csv);
    }

    #[test]
    fn the_delimiter_is_guessed_from_the_first_real_line() {
        assert_eq!(sniff_delimiter("\n\na;b;c\n1;2;3"), ';');
        assert_eq!(sniff_delimiter("a\tb\tc"), '\t');
        assert_eq!(sniff_delimiter("a,b,c"), ',');
        assert_eq!(sniff_delimiter("single"), ',');
    }

    #[test]
    fn dialect_hints_fingerprint_a_dump() {
        assert!(dialect_hints("CREATE TABLE `t` (a INT AUTO_INCREMENT)")
            .contains(&"mariadb".to_string()));
        assert!(dialect_hints("CREATE TABLE t (a SERIAL); ALTER TABLE t OWNER TO x;")
            .contains(&"postgres".to_string()));
        assert!(dialect_hints("PRAGMA foreign_keys=OFF;").contains(&"sqlite".to_string()));
        assert!(dialect_hints("SELECT 1").is_empty());
    }

    // ---------- value formatting ----------

    fn fmt(db: SupportedDB, ty: InferredType, raw: &str) -> Result<String, String> {
        format_import_value(db, "c", ty, Some(raw), None)
    }

    #[test]
    fn a_blank_cell_is_null_for_numbers_but_an_empty_string_for_text() {
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Integer, "").unwrap(),
            "NULL"
        );
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Text, "").unwrap(),
            "''"
        );
    }

    #[test]
    fn explicit_null_tokens_and_a_custom_literal_both_become_null() {
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Text, "\\N").unwrap(),
            "NULL"
        );
        assert_eq!(
            format_import_value(SupportedDB::Postgres, "c", InferredType::Text, None, None).unwrap(),
            "NULL"
        );
        assert_eq!(
            format_import_value(
                SupportedDB::Postgres,
                "c",
                InferredType::Text,
                Some("-"),
                Some("-")
            )
            .unwrap(),
            "NULL"
        );
        // An empty null_literal must not turn every empty cell into NULL twice.
        assert_eq!(
            format_import_value(
                SupportedDB::Postgres,
                "c",
                InferredType::Text,
                Some("x"),
                Some("")
            )
            .unwrap(),
            "'x'"
        );
    }

    /// A NUMERIC/DECIMAL column keeps more digits than an `f64`, so the
    /// literal has to reach the engine exactly as the file wrote it.
    #[test]
    fn a_high_precision_decimal_is_passed_through_without_an_f64_round_trip() {
        assert_eq!(
            fmt(
                SupportedDB::Postgres,
                InferredType::Double,
                "12345678901234567890.123"
            )
            .unwrap(),
            "12345678901234567890.123"
        );
        // Forms Postgres, MariaDB and SQLite all accept verbatim.
        assert_eq!(fmt(SupportedDB::Postgres, InferredType::Double, ".5").unwrap(), ".5");
        assert_eq!(fmt(SupportedDB::Postgres, InferredType::Double, "1e5").unwrap(), "1e5");
        assert_eq!(fmt(SupportedDB::Postgres, InferredType::Double, "-0.0001").unwrap(), "-0.0001");
        // Still rejects anything that is not a number at all.
        assert!(fmt(SupportedDB::Postgres, InferredType::Double, "1,5").is_err());
        assert!(fmt(SupportedDB::Postgres, InferredType::Double, "NaN").is_err());
        assert!(fmt(SupportedDB::Postgres, InferredType::Double, "inf").is_err());
    }

    #[test]
    fn money_is_treated_as_text_because_of_its_currency_formatting() {
        assert_eq!(value_type_from_sql_type("money"), InferredType::Text);
    }

    #[test]
    fn numbers_and_booleans_are_emitted_unquoted() {
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Integer, " 42 ").unwrap(),
            "42"
        );
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Double, "2.50").unwrap(),
            "2.50"
        );
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Boolean, "Yes").unwrap(),
            "TRUE"
        );
        assert_eq!(
            fmt(SupportedDB::Mariadb, InferredType::Boolean, "0").unwrap(),
            "FALSE"
        );
        // SQLite has no boolean type, so it gets the integer form.
        assert_eq!(
            fmt(SupportedDB::Sqlite, InferredType::Boolean, "t").unwrap(),
            "1"
        );
        assert_eq!(
            fmt(SupportedDB::Sqlite, InferredType::Boolean, "n").unwrap(),
            "0"
        );
    }

    #[test]
    fn quotes_are_escaped_and_mariadb_also_escapes_backslashes() {
        assert_eq!(
            fmt(SupportedDB::Postgres, InferredType::Text, "it's").unwrap(),
            "'it''s'"
        );
        assert_eq!(
            fmt(SupportedDB::Mariadb, InferredType::Text, "a\\b'c").unwrap(),
            "'a\\\\b''c'"
        );
        assert_eq!(
            fmt(SupportedDB::Sqlite, InferredType::Text, "a\\b").unwrap(),
            "'a\\b'"
        );
    }

    #[test]
    fn a_value_that_cannot_be_coerced_names_the_column_and_the_value() {
        let err = fmt(SupportedDB::Postgres, InferredType::Integer, "twelve").unwrap_err();
        assert!(err.contains("\"c\""), "{err}");
        assert!(err.contains("twelve"), "{err}");
        assert!(err.contains("integer"), "{err}");

        let err = fmt(SupportedDB::Postgres, InferredType::Boolean, "maybe").unwrap_err();
        assert!(err.contains("boolean"), "{err}");

        let err = fmt(SupportedDB::Postgres, InferredType::Double, "inf").unwrap_err();
        assert!(err.contains("number"), "{err}");
    }

    #[test]
    fn a_nul_byte_is_rejected_rather_than_silently_truncating_the_statement() {
        let err = fmt(SupportedDB::Postgres, InferredType::Text, "a\0b").unwrap_err();
        assert!(err.contains("NUL byte"), "{err}");
    }

    // ---------- statement builders ----------

    fn cols(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn several_rows_collapse_into_one_insert() {
        let sql = build_insert_batch(
            SupportedDB::Postgres,
            "users",
            &cols(&["id", "name"]),
            &[
                vec!["1".into(), "'a'".into()],
                vec!["2".into(), "'b'".into()],
            ],
            ConflictStrategy::Error,
            &[],
        )
        .unwrap();
        assert_eq!(
            sql,
            "INSERT INTO \"users\" (\"id\", \"name\") VALUES\n  (1, 'a'),\n  (2, 'b')"
        );
    }

    #[test]
    fn skip_on_conflict_uses_each_dialects_own_spelling() {
        let row = [vec!["1".to_string()]];
        let c = cols(&["id"]);
        let pg = build_insert_batch(
            SupportedDB::Postgres,
            "t",
            &c,
            &row,
            ConflictStrategy::Skip,
            &c,
        )
        .unwrap();
        assert!(pg.ends_with("ON CONFLICT DO NOTHING"), "{pg}");
        assert!(pg.starts_with("INSERT INTO"), "{pg}");

        let my =
            build_insert_batch(SupportedDB::Mariadb, "t", &c, &row, ConflictStrategy::Skip, &c)
                .unwrap();
        assert!(my.starts_with("INSERT IGNORE INTO `t`"), "{my}");

        let lite =
            build_insert_batch(SupportedDB::Sqlite, "t", &c, &row, ConflictStrategy::Skip, &c)
                .unwrap();
        assert!(lite.starts_with("INSERT OR IGNORE INTO \"t\""), "{lite}");
    }

    #[test]
    fn update_on_conflict_only_touches_the_non_key_columns() {
        let row = [vec!["1".to_string(), "'a'".to_string()]];
        let c = cols(&["id", "name"]);
        let pk = cols(&["id"]);

        let pg = build_insert_batch(
            SupportedDB::Postgres,
            "t",
            &c,
            &row,
            ConflictStrategy::Update,
            &pk,
        )
        .unwrap();
        assert!(
            pg.ends_with("ON CONFLICT (\"id\") DO UPDATE SET \"name\" = EXCLUDED.\"name\""),
            "{pg}"
        );

        let my = build_insert_batch(
            SupportedDB::Mariadb,
            "t",
            &c,
            &row,
            ConflictStrategy::Update,
            &pk,
        )
        .unwrap();
        assert!(
            my.ends_with("ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)"),
            "{my}"
        );

        let lite = build_insert_batch(
            SupportedDB::Sqlite,
            "t",
            &c,
            &row,
            ConflictStrategy::Update,
            &pk,
        )
        .unwrap();
        assert!(lite.starts_with("INSERT OR REPLACE INTO"), "{lite}");
    }

    #[test]
    fn update_on_conflict_refuses_to_guess_when_postgres_has_no_key() {
        let err = build_insert_batch(
            SupportedDB::Postgres,
            "t",
            &cols(&["a", "b"]),
            &[vec!["1".into(), "2".into()]],
            ConflictStrategy::Update,
            &[],
        )
        .unwrap_err();
        assert!(err.contains("no primary key"), "{err}");
    }

    #[test]
    fn update_on_conflict_refuses_when_every_column_is_part_of_the_key() {
        let c = cols(&["a"]);
        let err = build_insert_batch(
            SupportedDB::Mariadb,
            "t",
            &c,
            &[vec!["1".into()]],
            ConflictStrategy::Update,
            &c,
        )
        .unwrap_err();
        assert!(err.contains("nothing left to update"), "{err}");
    }

    #[test]
    fn an_insert_with_no_mapped_columns_is_an_error_not_an_empty_statement() {
        let err = build_insert_batch(
            SupportedDB::Sqlite,
            "t",
            &[],
            &[vec![]],
            ConflictStrategy::Error,
            &[],
        )
        .unwrap_err();
        assert!(err.contains("No columns"), "{err}");
    }

    #[test]
    fn create_table_quotes_per_dialect_and_honours_nullability() {
        let c = vec![
            ("id".to_string(), "INTEGER".to_string(), false),
            ("note".to_string(), "TEXT".to_string(), true),
        ];
        assert_eq!(
            build_create_table(SupportedDB::Postgres, "t", &c).unwrap(),
            "CREATE TABLE \"t\" (\n  \"id\" INTEGER NOT NULL,\n  \"note\" TEXT\n)"
        );
        assert_eq!(
            build_create_table(SupportedDB::Mariadb, "s.t", &c).unwrap(),
            "CREATE TABLE `s`.`t` (\n  `id` INTEGER NOT NULL,\n  `note` TEXT\n)"
        );
        assert!(build_create_table(SupportedDB::Sqlite, "t", &[]).is_err());
    }

    #[test]
    fn clearing_a_table_uses_delete_so_it_works_on_sqlite_too() {
        assert_eq!(
            build_clear_table(SupportedDB::Sqlite, "t"),
            "DELETE FROM \"t\""
        );
        assert_eq!(
            build_clear_table(SupportedDB::Mariadb, "t"),
            "DELETE FROM `t`"
        );
    }

    #[test]
    fn csv_options_accept_an_escaped_tab_as_a_delimiter() {
        let mut o = CsvOptions::default();
        assert_eq!(o.delimiter_byte(), b',');
        o.delimiter = "\\t".to_string();
        assert_eq!(o.delimiter_byte(), b'\t');
        o.delimiter = ";".to_string();
        assert_eq!(o.delimiter_byte(), b';');
        // Anything unusable falls back rather than panicking.
        o.delimiter = "??".to_string();
        assert_eq!(o.delimiter_byte(), b',');
    }

    // ---------- JSON records ----------

    /// `serde_json` objects are a `BTreeMap`, so reading keys off a parsed
    /// `Value` returns them alphabetically and the mapping table shows an
    /// export sorted rather than as written.
    #[test]
    fn json_object_keys_keep_the_order_the_file_wrote_them_in() {
        let r: JsonRecord = serde_json::from_str(r#"{"zebra":1,"apple":2,"middle":3}"#).unwrap();
        assert_eq!(
            r.keys().collect::<Vec<_>>(),
            vec!["zebra", "apple", "middle"]
        );
    }

    /// Routing a JSON number through `f64` rounds it: 12345678901234.5678
    /// becomes ...5680 in a NUMERIC(20,4) column.
    #[test]
    fn json_numbers_keep_every_digit_they_were_written_with() {
        let r: JsonRecord = serde_json::from_str(
            r#"{"n":12345678901234.5678,"big":123456789012345678901234567890,"neg":-0.000001}"#,
        )
        .unwrap();
        assert_eq!(r.cell("n").as_deref(), Some("12345678901234.5678"));
        assert_eq!(
            r.cell("big").as_deref(),
            Some("123456789012345678901234567890")
        );
        assert_eq!(r.cell("neg").as_deref(), Some("-0.000001"));
    }

    #[test]
    fn json_nulls_strings_booleans_and_nested_values_map_to_cells() {
        let r: JsonRecord = serde_json::from_str(
            r#"{"a":null,"b":"it's \"quoted\"","c":true,"d":{"ก":1},"e":[1,2]}"#,
        )
        .unwrap();
        // An explicit null is NULL, not the four letters.
        assert_eq!(r.cell("a"), None);
        // String escapes are undone exactly once.
        assert_eq!(r.cell("b").as_deref(), Some(r#"it's "quoted""#));
        assert_eq!(r.cell("c").as_deref(), Some("true"));
        // Nested values pass through verbatim rather than being re-serialised,
        // so their own key order and number precision survive too.
        assert_eq!(r.cell("d").as_deref(), Some(r#"{"ก":1}"#));
        assert_eq!(r.cell("e").as_deref(), Some("[1,2]"));
        // A key that is not there is indistinguishable from an explicit null.
        assert_eq!(r.cell("missing"), None);
    }

    #[test]
    fn a_bare_scalar_record_becomes_a_single_cell() {
        let r: JsonRecord = serde_json::from_str("42").unwrap();
        assert!(r.fields.is_empty());
        assert_eq!(r.scalar.as_deref(), Some("42"));

        let r: JsonRecord = serde_json::from_str(r#""hello""#).unwrap();
        assert_eq!(r.scalar.as_deref(), Some("hello"));

        let r: JsonRecord = serde_json::from_str("[1,2]").unwrap();
        assert_eq!(r.scalar.as_deref(), Some("[1,2]"));
    }

    #[test]
    fn merging_keys_over_several_records_keeps_first_seen_order() {
        let mut keys: Vec<String> = Vec::new();
        for line in [
            r#"{"id":1,"name":"a"}"#,
            r#"{"id":2,"extra":true}"#,
            r#"{"name":"c","id":3}"#,
        ] {
            let r: JsonRecord = serde_json::from_str(line).unwrap();
            merge_record_keys(&mut keys, &r);
        }
        assert_eq!(keys, vec!["id", "name", "extra"]);
    }

    // ---------- Postgres COPY blocks ----------

    #[test]
    fn a_copy_from_stdin_header_yields_its_table_and_columns() {
        let h = parse_copy_header("COPY public.orders (id, customer, total) FROM stdin")
            .unwrap()
            .unwrap();
        assert_eq!(h.table, "public.orders");
        assert_eq!(h.columns, vec!["id", "customer", "total"]);

        // No column list is legal and means "every column, in table order".
        let h = parse_copy_header("copy t from stdin").unwrap().unwrap();
        assert_eq!(h.table, "t");
        assert!(h.columns.is_empty());

        // Quoted identifiers are unwrapped so the writer can re-quote them.
        let h = parse_copy_header("COPY \"My Schema\".\"T\" (\"Id\") FROM stdin")
            .unwrap()
            .unwrap();
        assert_eq!(h.columns, vec!["Id"]);
    }

    #[test]
    fn only_a_copy_from_stdin_is_treated_as_a_data_block() {
        // A COPY that reads from a file is the server's problem, not ours.
        assert!(parse_copy_header("COPY t FROM '/tmp/x.csv'").is_none());
        assert!(parse_copy_header("COPY t TO stdin").is_none());
        assert!(parse_copy_header("SELECT 1").is_none());
        assert!(parse_copy_header("COPYRIGHT FROM stdin").is_none());
    }

    #[test]
    fn a_csv_or_binary_copy_block_is_refused_rather_than_parsed_as_tabs() {
        let err = parse_copy_header("COPY t (a) FROM stdin WITH (FORMAT csv)")
            .unwrap()
            .unwrap_err();
        assert!(err.contains("--inserts"), "{err}");
        assert!(parse_copy_header("COPY t (a) FROM stdin WITH (FORMAT binary)")
            .unwrap()
            .is_err());
    }

    #[test]
    fn copy_text_format_escapes_are_decoded() {
        assert_eq!(unescape_copy_field("plain"), Some("plain".to_string()));
        // `\N` alone is NULL; `\\N` is the letter N behind a backslash.
        assert_eq!(unescape_copy_field("\\N"), None);
        assert_eq!(unescape_copy_field("\\\\N"), Some("\\N".to_string()));
        assert_eq!(
            unescape_copy_field("tab\\there\\nnewline\\rcr"),
            Some("tab\there\nnewline\rcr".to_string())
        );
        assert_eq!(unescape_copy_field("\\\\"), Some("\\".to_string()));
        // Octal and hex forms.
        assert_eq!(unescape_copy_field("\\101"), Some("A".to_string()));
        assert_eq!(unescape_copy_field("\\x41"), Some("A".to_string()));
        // A backslash before anything else is that character.
        assert_eq!(unescape_copy_field("\\q"), Some("q".to_string()));
        // Thai text has no escapes and must be untouched.
        assert_eq!(unescape_copy_field("ร้าน"), Some("ร้าน".to_string()));
    }

    #[test]
    fn a_copy_row_splits_on_tabs_and_keeps_empty_fields() {
        assert_eq!(
            split_copy_row("1\tabc\t\\N\t"),
            vec![
                Some("1".to_string()),
                Some("abc".to_string()),
                None,
                Some(String::new())
            ]
        );
    }

    #[test]
    fn psql_meta_commands_are_recognised_but_sql_is_not() {
        assert!(is_psql_meta_command("\\restrict abc"));
        assert!(is_psql_meta_command("  \\unrestrict abc"));
        assert!(is_psql_meta_command("\\connect mydb"));
        assert!(is_psql_meta_command("\\."));
        assert!(!is_psql_meta_command("SELECT 1"));
        assert!(!is_psql_meta_command("\\"));
    }

    /// pg_dump 17+ wraps its output in `\restrict`; sending those to the server
    /// is a syntax error, so the splitter has to drop them.
    #[test]
    fn the_splitter_drops_psql_directives_and_counts_them() {
        let script = "\\restrict token\nSELECT 1;\n\\unrestrict token\nSELECT 2;\n";
        let mut sp = SqlSplitter::new(false);
        let mut out = sp.feed(script);
        out.extend(sp.finish());
        let stmts: Vec<String> = out.into_iter().map(|s| s.sql).collect();
        assert_eq!(stmts, vec!["SELECT 1", "SELECT 2"]);
        assert_eq!(sp.skipped_meta_commands(), 2);
    }

    #[test]
    fn a_truncated_utf8_tail_still_looks_like_utf8() {
        let full = "ทดสอบ".as_bytes();
        assert!(looks_utf8(full));
        // Cut inside the last character, the way a bounded head read does.
        assert!(looks_utf8(&full[..full.len() - 1]));
        // A CP874 Thai byte is not valid UTF-8 at all.
        assert!(!looks_utf8(&[0x41, 0xA1, 0x42]));
    }

    #[test]
    fn tis620_bytes_decode_to_thai_text() {
        // "ก" is 0xA1 in TIS-620 / CP874.
        assert_eq!(decode_bytes(&[0xA1], SourceEncoding::Tis620), "ก");
        assert_eq!(decode_bytes("ก".as_bytes(), SourceEncoding::Utf8), "ก");
    }

    #[test]
    fn excerpt_never_splits_a_multibyte_character() {
        let s = "กขคงจฉชซ";
        assert_eq!(excerpt(s, 3), "กขค…");
        assert_eq!(excerpt(s, 100), s);
    }
}
