package importer

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
)

// FormatValue coerces one source cell into a SQL literal.
//
// The coercion is driven by the target column's type, not by what the text looks
// like, so a CSV whose "id" column happens to hold "007" lands as 7 in an
// integer column rather than as a quoted string the server would reject.
func FormatValue(
	db model.SupportedDB,
	column string,
	valueType InferredType,
	raw *string,
	nullLiteral *string,
) (string, error) {
	if raw == nil {
		return "NULL", nil
	}
	text := *raw

	// A NUL byte cannot be escaped into a literal on any of the three engines;
	// interpolating it truncates the statement silently, which is far worse
	// than refusing the row.
	if strings.ContainsRune(text, 0) {
		return "", fmt.Errorf(
			"column %q: value contains a NUL byte, which cannot be imported", column)
	}

	if nullLiteral != nil && *nullLiteral != "" && text == *nullLiteral {
		return "NULL", nil
	}
	if strings.TrimSpace(text) == `\N` {
		return "NULL", nil
	}

	t := strings.TrimSpace(text)
	if t == "" {
		if valueType.blankIsNull() {
			return "NULL", nil
		}
		return "''", nil
	}

	switch valueType {
	case TypeInteger, TypeBigint:
		v, err := strconv.ParseInt(t, 10, 64)
		if err != nil {
			return "", invalidValue(column, t, valueType)
		}
		return strconv.FormatInt(v, 10), nil

	case TypeDouble:
		// Parsed only to validate. Re-printing through float64 would round a
		// NUMERIC/DECIMAL column to 17 significant digits, which is silent data
		// loss, so the original literal goes through untouched.
		f, err := strconv.ParseFloat(t, 64)
		if err != nil || isNonFinite(f) {
			return "", invalidValue(column, t, valueType)
		}
		return t, nil

	case TypeBoolean:
		var truthy bool
		switch strings.ToLower(t) {
		case "true", "t", "yes", "y", "1":
			truthy = true
		case "false", "f", "no", "n", "0":
			truthy = false
		default:
			return "", invalidValue(column, t, valueType)
		}
		if db == model.Sqlite {
			if truthy {
				return "1", nil
			}
			return "0", nil
		}
		if truthy {
			return "TRUE", nil
		}
		return "FALSE", nil

	default:
		// Date, Timestamp, JSON and Text all go through as quoted text and let
		// the server parse them. Note this quotes the UNTRIMMED value: leading
		// whitespace can be meaningful in a text column.
		return "'" + dialect.EscapeLiteral(db, text) + "'", nil
	}
}

func invalidValue(column, value string, t InferredType) error {
	return fmt.Errorf("column %q: %s is not a valid %s", column, Excerpt(value, 60), typeLabel(t))
}

func typeLabel(t InferredType) string {
	if t == TypeDouble {
		return "number"
	}
	return string(t)
}

// BuildInsertBatch builds one multi-row INSERT from pre-formatted literals.
//
// One statement per batch rather than one per row: a 500-row batch is a single
// round trip, which is most of why importing a large file is not glacial.
func BuildInsertBatch(
	db model.SupportedDB,
	table string,
	columns []string,
	rows [][]string,
	conflict ConflictStrategy,
	pkColumns []string,
) (string, error) {
	if len(columns) == 0 {
		return "", fmt.Errorf("No columns are mapped, so there is nothing to insert.")
	}
	if len(rows) == 0 {
		return "", fmt.Errorf("No rows to insert.")
	}

	verb := "INSERT INTO"
	switch {
	case conflict == ConflictSkip && db == model.Mariadb:
		verb = "INSERT IGNORE INTO"
	case conflict == ConflictSkip && db == model.Sqlite:
		verb = "INSERT OR IGNORE INTO"
	case conflict == ConflictUpdate && db == model.Sqlite:
		verb = "INSERT OR REPLACE INTO"
	}

	quotedCols := make([]string, 0, len(columns))
	for _, c := range columns {
		quotedCols = append(quotedCols, dialect.QuoteColumn(db, c))
	}

	tuples := make([]string, 0, len(rows))
	for _, r := range rows {
		tuples = append(tuples, "("+strings.Join(r, ", ")+")")
	}

	var sql strings.Builder
	fmt.Fprintf(&sql, "%s %s (%s) VALUES\n  %s",
		verb, dialect.QuoteTable(db, table),
		strings.Join(quotedCols, ", "),
		strings.Join(tuples, ",\n  "))

	nonPK := make([]string, 0, len(columns))
	for _, c := range columns {
		if !containsFold(pkColumns, c) {
			nonPK = append(nonPK, c)
		}
	}

	switch {
	case conflict == ConflictSkip && db == model.Postgres:
		sql.WriteString("\nON CONFLICT DO NOTHING")

	case conflict == ConflictUpdate && db == model.Mariadb:
		if len(nonPK) == 0 {
			return "", fmt.Errorf(
				"Every mapped column of %q is part of the key, so there is nothing left to update on a duplicate.", table)
		}
		sets := make([]string, 0, len(nonPK))
		for _, c := range nonPK {
			q := dialect.QuoteColumn(db, c)
			sets = append(sets, q+" = VALUES("+q+")")
		}
		fmt.Fprintf(&sql, "\nON DUPLICATE KEY UPDATE %s", strings.Join(sets, ", "))

	case conflict == ConflictUpdate && db == model.Postgres:
		// Postgres needs an explicit conflict target, so without a key there is
		// nothing to name and the statement cannot be written at all.
		if len(pkColumns) == 0 {
			return "", fmt.Errorf(
				"%q has no primary key, so Postgres cannot tell which rows conflict. Pick another duplicate strategy.", table)
		}
		if len(nonPK) == 0 {
			return "", fmt.Errorf(
				"Every mapped column of %q is part of the key, so there is nothing left to update on a duplicate.", table)
		}
		target := make([]string, 0, len(pkColumns))
		for _, c := range pkColumns {
			target = append(target, dialect.QuoteColumn(db, c))
		}
		sets := make([]string, 0, len(nonPK))
		for _, c := range nonPK {
			q := dialect.QuoteColumn(db, c)
			sets = append(sets, q+" = EXCLUDED."+q)
		}
		fmt.Fprintf(&sql, "\nON CONFLICT (%s) DO UPDATE SET %s",
			strings.Join(target, ", "), strings.Join(sets, ", "))
	}

	return sql.String(), nil
}

// CreateColumn is one column of a table being created from a flat file.
type CreateColumn struct {
	Name     string
	SQLType  string
	Nullable bool
}

// BuildCreateTable writes a CREATE TABLE for freshly inferred columns.
//
// No primary key is declared: the source is a flat file, and guessing one would
// reject rows the user explicitly asked to load.
func BuildCreateTable(db model.SupportedDB, table string, columns []CreateColumn) (string, error) {
	if len(columns) == 0 {
		return "", fmt.Errorf("Cannot create a table with no columns.")
	}
	defs := make([]string, 0, len(columns))
	for _, c := range columns {
		def := dialect.QuoteColumn(db, c.Name) + " " + c.SQLType
		if !c.Nullable {
			def += " NOT NULL"
		}
		defs = append(defs, def)
	}
	return fmt.Sprintf("CREATE TABLE %s (\n  %s\n)",
		dialect.QuoteTable(db, table), strings.Join(defs, ",\n  ")), nil
}

// BuildClearTable empties a table before an import.
//
// DELETE rather than TRUNCATE: SQLite has no TRUNCATE at all, and on
// Postgres/MariaDB TRUNCATE trips over inbound foreign keys.
func BuildClearTable(db model.SupportedDB, table string) string {
	return "DELETE FROM " + dialect.QuoteTable(db, table)
}
