package dbcore

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/thutil/dodb/internal/orderedjson"
)

// This file covers the two database/sql engines. Unlike pgx, neither driver
// decodes to a rich type set, so the decision is driven by the type name the
// driver reports for the column plus the Go value it produced.

// mysqlDateTimeLayouts are the shapes MySQL sends for temporal columns, longest
// fraction first so the most specific match wins.
var mysqlDateTimeLayouts = []string{
	"2006-01-02 15:04:05.999999999",
	"2006-01-02 15:04:05",
	"2006-01-02",
}

var mysqlTimeLayouts = []string{
	"15:04:05.999999999",
	"15:04:05",
}

// queryMySQL decodes a MySQL/MariaDB result to match db_core.rs:541-626.
//
// hints supply the two facts the driver withholds (see ColumnHint). Pass nil for
// arbitrary SQL, where no single table backs the result.
func queryMySQL(db *sql.DB, query string, hints ColumnHints) ([]*orderedjson.Object, error) {
	return querySQLGeneric(db, query, func(dbType, column string, v any) any {
		return mysqlValueToJSON(dbType, v, hints.Get(column))
	})
}

// querySQLite decodes a SQLite result to match db_core.rs:627-687.
//
// No hints are needed: SQLite reports the DECLARED column type, so a column
// declared BOOLEAN arrives as BOOLEAN and the rule ports directly.
func querySQLite(db *sql.DB, query string) ([]*orderedjson.Object, error) {
	return querySQLGeneric(db, query, func(dbType, _ string, v any) any {
		return sqliteValueToJSON(dbType, v)
	})
}

// querySQLGeneric walks a database/sql result set, handing each cell to the
// engine's mapper along with the driver's reported column type.
func querySQLGeneric(
	db *sql.DB,
	query string,
	mapValue func(dbType, column string, v any) any,
) ([]*orderedjson.Object, error) {
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	types, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}

	out := make([]*orderedjson.Object, 0, 16)
	for rows.Next() {
		holders := make([]any, len(cols))
		dest := make([]any, len(cols))
		for i := range holders {
			holders[i] = new(any)
			dest[i] = holders[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}

		row := orderedjson.NewObject(len(cols))
		for i, name := range cols {
			unique := UniqueColName(row, name)
			value := *(holders[i].(*any))
			dbType := ""
			if i < len(types) {
				dbType = strings.ToUpper(types[i].DatabaseTypeName())
			}
			// The hint is keyed on the column's real name, not the
			// de-duplicated label, so a join that exposes "flag" twice still
			// resolves both to the same declared type.
			row.Set(unique, mapValue(dbType, name, value))
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// mysqlValueToJSON maps one MySQL cell.
//
// Where the driver is silent, ColumnHint fills in: a tinyint(1) is rendered as
// true/false and a MariaDB JSON column as a parsed object, matching sqlx.
//
// SCOPE: hints are available only where the caller knows the table -- get_rows,
// commit_changes and the other table-scoped commands, which is everything whose
// output reaches the DataGrid. For arbitrary console SQL there is no single
// table to ask about, so a tinyint(1) there renders as 1 rather than true and a
// MariaDB JSON column as a string. Both round-trip into the server identically,
// and DataGrid.tsx:1733 decides whether to draw a boolean control from
// get_columns metadata rather than from the value's JSON type.
func mysqlValueToJSON(dbType string, v any, hint ColumnHint) any {
	if v == nil {
		return nil
	}

	// Hints first: they carry the declared type, which outranks the coarser
	// type the wire protocol reports.
	if hint.Boolean {
		if i, ok := asInt64(v); ok {
			return i != 0
		}
	}
	if hint.JSON {
		if parsed, err := orderedjson.RawObject(asBytes(v)); err == nil {
			return parsed
		}
	}

	switch dbType {
	case "DECIMAL", "NEWDECIMAL":
		// A decimal must arrive as a string; a float64 would silently drop
		// digits from a monetary value.
		return asText(v)

	case "JSON":
		if parsed, err := orderedjson.RawObject(asBytes(v)); err == nil {
			return parsed
		}
		return asText(v)

	case "TIMESTAMP", "DATETIME":
		// Both render as a zoned RFC3339 string, even DATETIME, which carries no
		// zone. That is not an oversight being copied blindly: the Rust MySQL
		// chain tries DateTime<Utc> before NaiveDateTime, so a DATETIME is
		// labelled +00:00 there too, and the frontend already parses it that way.
		if t, ok := parseTemporal(v, mysqlDateTimeLayouts); ok {
			return FormatRFC3339(t)
		}
		return asText(v)

	case "DATE":
		if t, ok := parseTemporal(v, mysqlDateTimeLayouts); ok {
			return FormatNaiveDate(t)
		}
		return asText(v)

	case "TIME":
		// Re-rendered rather than passed through: MySQL sends a TIME(6) as
		// "10:30:00.123000" and chrono's AutoSi prints "10:30:00.123".
		if t, ok := parseTemporal(v, mysqlTimeLayouts); ok {
			return FormatNaiveTime(t)
		}
		return asText(v)

	case "BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB",
		"BINARY", "VARBINARY", "GEOMETRY", "BIT":
		// GEOMETRY lands here on purpose: no Go driver decodes MySQL Spatial, so
		// the bytes reach the frontend as hex and its own WKB reader handles them.
		return DecodeBytesOrHex(asBytes(v))

	case "CHAR", "VARCHAR", "TEXT", "TINYTEXT", "MEDIUMTEXT", "LONGTEXT",
		"ENUM", "SET":
		return asText(v)
	}

	// Numeric and anything unrecognised: fall back to the Go value's own shape.
	return numericOrText(v)
}

// sqliteValueToJSON maps one SQLite cell.
//
// SQLite has no static column types, only affinities, so the DECLARED type is
// all the decoder has -- which is exactly why is_boolean_column works here: a
// column declared BOOLEAN is reported as BOOLEAN, and an INTEGER holding 0/1
// stays numeric.
func sqliteValueToJSON(dbType string, v any) any {
	if v == nil {
		return nil
	}

	switch dbType {
	case "BOOLEAN", "BOOL":
		if b, ok := v.(bool); ok {
			return b
		}
		// A declared BOOLEAN can still hold anything; only 0/1 become a bool.
		if i, ok := asInt64(v); ok && (i == 0 || i == 1) {
			return i == 1
		}
		return numericOrText(v)

	case "DATE", "DATETIME", "TIMESTAMP":
		// Unlike MySQL, these render unzoned: the Rust SQLite chain has no
		// DateTime<Utc> branch at all, only NaiveDateTime and NaiveDate.
		if t, ok := parseTemporal(v, mysqlDateTimeLayouts); ok {
			if dbType == "DATE" {
				return FormatNaiveDate(t)
			}
			return FormatNaiveDateTime(t)
		}
		return asText(v)

	case "BLOB":
		return DecodeBytesOrHex(asBytes(v))

	case "TEXT", "CHAR", "VARCHAR", "CLOB":
		// Note there is no JSON branch: SQLite stores JSON as text, and the Rust
		// chain's String arm wins before the serde_json arm, so a JSON document
		// reaches the frontend as a string, not as a parsed object.
		return asText(v)
	}

	return numericOrText(v)
}

// numericOrText maps a value with no useful type name behind it.
func numericOrText(v any) any {
	switch t := v.(type) {
	case bool:
		return t
	case int64:
		return t
	case uint64:
		return t
	case int32:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		return t
	case float32:
		return float64(t)
	case time.Time:
		return FormatNaiveDateTime(t)
	case string:
		return t
	case []byte:
		// Driver-unknown binary: keep the bytes rather than dropping the column.
		return DecodeBytesOrHex(t)
	default:
		return fmt.Sprint(v)
	}
}

func asBytes(v any) []byte {
	switch t := v.(type) {
	case []byte:
		return t
	case sql.RawBytes:
		return []byte(t)
	case string:
		return []byte(t)
	default:
		return []byte(fmt.Sprint(v))
	}
}

func asText(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	case sql.RawBytes:
		return string(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case uint64:
		return strconv.FormatUint(t, 10)
	case float64:
		return strconv.FormatFloat(t, 'g', -1, 64)
	case time.Time:
		return FormatNaiveDateTime(t)
	default:
		return fmt.Sprint(v)
	}
}

func asInt64(v any) (int64, bool) {
	switch t := v.(type) {
	case int64:
		return t, true
	case uint64:
		return int64(t), true
	case int32:
		return int64(t), true
	case int:
		return int64(t), true
	case []byte:
		i, err := strconv.ParseInt(string(t), 10, 64)
		return i, err == nil
	case string:
		i, err := strconv.ParseInt(t, 10, 64)
		return i, err == nil
	}
	return 0, false
}

// parseTemporal accepts either a driver-parsed time.Time or the raw text MySQL
// and SQLite send, trying each layout in turn.
func parseTemporal(v any, layouts []string) (time.Time, bool) {
	if t, ok := v.(time.Time); ok {
		return t, true
	}
	raw := strings.TrimSpace(asText(v))
	if raw == "" {
		return time.Time{}, false
	}
	for _, layout := range layouts {
		if t, err := time.ParseInLocation(layout, raw, time.UTC); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
