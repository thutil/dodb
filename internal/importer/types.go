// Package importer loads .sql, .csv and .json files into a table.
//
// Ported from src-tauri/src/import.rs and commands/import_cmd.rs, which
// together are ~46% of the Rust build's production code and hold its most
// intricate logic. The wire types below are mirrored by
// ui/src/utils/importManager.ts and must keep their JSON spellings.
package importer

import (
	"strings"

	"github.com/thutil/dodb/internal/model"
)

// Format is the shape of the source file.
type Format string

const (
	// FormatSQL replays a script's statements verbatim.
	FormatSQL Format = "sql"
	// FormatCSV is delimiter-separated text.
	FormatCSV Format = "csv"
	// FormatJSON is a top-level array, or one object per line.
	FormatJSON Format = "json"
)

// ConflictStrategy decides what happens on a duplicate key.
type ConflictStrategy string

const (
	ConflictError  ConflictStrategy = "error"
	ConflictSkip   ConflictStrategy = "skip"
	ConflictUpdate ConflictStrategy = "update"
)

// OnError decides whether a failing statement stops the run.
type OnError string

const (
	OnErrorAbort   OnError = "abort"
	OnErrorSkipRow OnError = "skipRow"
)

// TxMode is the transaction granularity.
type TxMode string

const (
	// TxPerStatement uses no transaction. The only mode that survives MariaDB's
	// implicit commit on DDL, which is why ExecuteDDL avoids transactions too.
	TxPerStatement TxMode = "perStatement"
	// TxAtomicBatch wraps each batch, so a failure rolls back only its own rows.
	TxAtomicBatch TxMode = "atomicBatch"
	// TxSingleTransaction wraps the whole file: truly all-or-nothing, but holds
	// locks for the entire run.
	TxSingleTransaction TxMode = "singleTransaction"
)

// SourceEncoding is the source file's character encoding.
type SourceEncoding string

const (
	EncodingUTF8 SourceEncoding = "utf8"
	// EncodingTIS620 is CP874 -- what Excel on a Thai locale writes.
	EncodingTIS620      SourceEncoding = "tis620"
	EncodingWindows1252 SourceEncoding = "windows1252"
)

// CsvOptions configures the tabular reader.
type CsvOptions struct {
	Delimiter string `json:"delimiter"`
	Quote     string `json:"quote"`
	HasHeader bool   `json:"hasHeader"`
	// NullLiteral is an extra spelling of NULL in this file; \N and NULL are
	// always honoured.
	NullLiteral *string        `json:"nullLiteral"`
	Encoding    SourceEncoding `json:"encoding"`
}

// DefaultCsvOptions matches the Rust Default impl.
func DefaultCsvOptions() CsvOptions {
	return CsvOptions{Delimiter: ",", Quote: `"`, HasHeader: true, Encoding: EncodingUTF8}
}

// DelimiterByte is the delimiter as one byte, falling back to a comma for
// anything that is not a single ASCII character.
func (o CsvOptions) DelimiterByte() byte {
	if b, ok := oneASCII(o.Delimiter); ok {
		return b
	}
	return ','
}

// QuoteByte is the quote character as one byte.
func (o CsvOptions) QuoteByte() byte {
	if b, ok := oneASCII(o.Quote); ok {
		return b
	}
	return '"'
}

func oneASCII(s string) (byte, bool) {
	if len(s) == 1 && s[0] < 0x80 {
		return s[0], true
	}
	// The UI sends a literal backslash-t for a tab-separated file.
	if s == `\t` {
		return '\t', true
	}
	return 0, false
}

// ColumnMapping ties a source column to a target column.
type ColumnMapping struct {
	// Source is the column name or JSON key in the file.
	Source string `json:"source"`
	// Target is the column to write, or nil to leave the column out entirely.
	Target *string `json:"target"`
	// SQLType is used only when creating the table.
	SQLType *string `json:"sqlType"`
	// ValueType is how to coerce the text. The preview supplies a guess;
	// importing into an existing table overrides it from the real column type.
	ValueType InferredType `json:"valueType"`
}

// Request is the run_import payload.
type Request struct {
	FilePath string `json:"filePath"`
	Format   Format `json:"format"`
	// TargetTable is required for CSV and JSON, ignored for SQL scripts, which
	// name their own tables.
	TargetTable   *string          `json:"targetTable"`
	CreateTable   bool             `json:"createTable"`
	TruncateFirst bool             `json:"truncateFirst"`
	Columns       []ColumnMapping  `json:"columns"`
	CSV           CsvOptions       `json:"csv"`
	BatchSize     int              `json:"batchSize"`
	Conflict      ConflictStrategy `json:"conflict"`
	OnError       OnError          `json:"onError"`
	TxMode        TxMode           `json:"txMode"`
	DryRun        bool             `json:"dryRun"`
	MaxErrors     int              `json:"maxErrors"`
}

// DefaultMaxErrors matches default_max_errors.
const DefaultMaxErrors = 200

// applyDefaults fills in the values serde would have defaulted.
func (r *Request) applyDefaults() {
	if r.BatchSize <= 0 {
		r.BatchSize = 500
	}
	if r.MaxErrors <= 0 {
		r.MaxErrors = DefaultMaxErrors
	}
	if r.Conflict == "" {
		r.Conflict = ConflictError
	}
	if r.OnError == "" {
		r.OnError = OnErrorAbort
	}
	if r.TxMode == "" {
		r.TxMode = TxAtomicBatch
	}
	if r.CSV.Delimiter == "" {
		r.CSV.Delimiter = ","
	}
	if r.CSV.Quote == "" {
		r.CSV.Quote = `"`
	}
	if r.CSV.Encoding == "" {
		r.CSV.Encoding = EncodingUTF8
	}
}

// Progress is one tick pushed to the frontend while an import runs.
type Progress struct {
	// Phase is "preparing", "importing" or "done".
	Phase         string `json:"phase"`
	BytesRead     uint64 `json:"bytesRead"`
	TotalBytes    uint64 `json:"totalBytes"`
	Percentage    uint8  `json:"percentage"`
	RowsImported  uint64 `json:"rowsImported"`
	StatementsRun uint64 `json:"statementsRun"`
	Errors        uint64 `json:"errors"`
	CurrentTable  string `json:"currentTable"`
}

// Failure is one rejected statement or row.
type Failure struct {
	// Index is 1-based.
	Index uint64  `json:"index"`
	Line  *uint64 `json:"line"`
	// Excerpt is truncated so a bad 5 MB INSERT does not travel to the UI.
	Excerpt string `json:"excerpt"`
	Message string `json:"message"`
}

// NewFailure builds a failure with a truncated excerpt.
func NewFailure(index uint64, line *uint64, sql, message string) Failure {
	return Failure{Index: index, Line: line, Excerpt: Excerpt(sql, 400), Message: message}
}

// Excerpt shortens s to at most max runes without splitting a character.
func Excerpt(s string, max int) string {
	trimmed := strings.TrimSpace(s)
	runes := []rune(trimmed)
	if len(runes) <= max {
		return trimmed
	}
	return string(runes[:max]) + "…"
}

// Report is the run_import result.
type Report struct {
	Success           bool      `json:"success"`
	Cancelled         bool      `json:"cancelled"`
	DryRun            bool      `json:"dryRun"`
	RowsImported      uint64    `json:"rowsImported"`
	StatementsRun     uint64    `json:"statementsRun"`
	TablesTouched     []string  `json:"tablesTouched"`
	ElapsedMs         uint64    `json:"elapsedMs"`
	Failures          []Failure `json:"failures"`
	FailuresTruncated bool      `json:"failuresTruncated"`
	// SkippedVersionComments counts mysqldump /*!...*/ blocks that were skipped
	// rather than executed.
	SkippedVersionComments uint64 `json:"skippedVersionComments"`
	// SkippedMetaCommands counts psql directives (\restrict, \connect) dropped.
	SkippedMetaCommands uint64 `json:"skippedMetaCommands"`
	// CopyRows counts rows that came out of COPY ... FROM stdin blocks.
	CopyRows uint64 `json:"copyRows"`
}

// FileInfo is the describe_import_file payload.
type FileInfo struct {
	Path      string `json:"path"`
	Name      string `json:"name"`
	Size      uint64 `json:"size"`
	Format    Format `json:"format"`
	Delimiter string `json:"delimiter"`
	LooksUTF8 bool   `json:"looksUtf8"`
}

// PreviewColumn is one inferred column in the preview.
type PreviewColumn struct {
	Name      string       `json:"name"`
	ValueType InferredType `json:"valueType"`
	Nullable  bool         `json:"nullable"`
	SQLType   string       `json:"sqlType"`
}

// Preview is the preview_import_file payload.
type Preview struct {
	Format Format `json:"format"`
	// Columns and Rows are populated for CSV and JSON.
	Columns []PreviewColumn `json:"columns"`
	Rows    [][]*string     `json:"rows"`
	// Statements and EstimatedStatements are populated for SQL scripts.
	Statements          []string `json:"statements"`
	EstimatedStatements uint64   `json:"estimatedStatements"`
	DialectHints        []string `json:"dialectHints"`
	TotalBytes          uint64   `json:"totalBytes"`
}

// InferredType is how a text cell should be coerced.
type InferredType string

const (
	TypeInteger   InferredType = "integer"
	TypeBigint    InferredType = "bigint"
	TypeDouble    InferredType = "double"
	TypeBoolean   InferredType = "boolean"
	TypeDate      InferredType = "date"
	TypeTimestamp InferredType = "timestamp"
	TypeJSON      InferredType = "json"
	TypeText      InferredType = "text"
)

// blankIsNull reports whether an empty cell means NULL rather than an empty value.
//
// Text and JSON keep the empty string, because "" is a legitimate value there;
// for every other type an empty cell is missing data, and inserting ” into a
// numeric column would fail the batch.
func (t InferredType) blankIsNull() bool {
	return t != TypeText && t != TypeJSON
}

// SQLTypeFor is the column type to declare when creating a table.
func SQLTypeFor(t InferredType, db model.SupportedDB) string {
	switch t {
	case TypeInteger:
		if db == model.Mariadb {
			return "INT"
		}
		return "INTEGER"
	case TypeBigint:
		return "BIGINT"
	case TypeDouble:
		switch db {
		case model.Postgres:
			return "DOUBLE PRECISION"
		case model.Mariadb:
			return "DOUBLE"
		default:
			return "REAL"
		}
	case TypeBoolean:
		switch db {
		case model.Postgres:
			return "BOOLEAN"
		case model.Mariadb:
			return "TINYINT(1)"
		default:
			// SQLite has no boolean; INTEGER holding 0/1 is the convention, and
			// the decoder reads a column DECLARED boolean, not this one.
			return "INTEGER"
		}
	case TypeDate:
		if db == model.Sqlite {
			return "TEXT"
		}
		return "DATE"
	case TypeTimestamp:
		switch db {
		case model.Postgres:
			return "TIMESTAMP"
		case model.Mariadb:
			return "DATETIME"
		default:
			return "TEXT"
		}
	case TypeJSON:
		switch db {
		case model.Postgres:
			return "JSONB"
		case model.Mariadb:
			return "JSON"
		default:
			return "TEXT"
		}
	default:
		return "TEXT"
	}
}
