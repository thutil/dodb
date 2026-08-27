// Package dialect builds the SQL text that varies between engines.
//
// Ported from src-tauri/src/commands/database_cmd.rs and the escape helper in
// db_core.rs. Every query dodb sends is assembled by string formatting -- there
// is not a single bound parameter in the Rust build -- so the quoting and
// escaping here is the only thing standing between a table named `o"dd` and a
// syntax error, and between a filter value and an injection.
package dialect

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/thutil/dodb/internal/model"
)

// LikeEscape is the escape character used in generated LIKE patterns.
const LikeEscape = '\\'

// QuoteTable quotes a table name, splitting a schema-qualified name on the
// first dot so `public.users` becomes two quoted identifiers rather than one
// identifier containing a dot.
func QuoteTable(db model.SupportedDB, table string) string {
	switch db {
	case model.Postgres:
		return quoteQualified(table, `"`)
	case model.Mariadb:
		return quoteQualified(table, "`")
	default:
		// SQLite has no schemas worth qualifying here, so a dot is part of the name.
		return `"` + strings.ReplaceAll(table, `"`, "") + `"`
	}
}

func quoteQualified(table, q string) string {
	if schema, name, found := strings.Cut(table, "."); found {
		return q + strings.ReplaceAll(schema, q, "") + q + "." + q + strings.ReplaceAll(name, q, "") + q
	}
	return q + strings.ReplaceAll(table, q, "") + q
}

// QuoteColumn quotes a column name.
func QuoteColumn(db model.SupportedDB, col string) string {
	if db == model.Mariadb {
		return "`" + strings.ReplaceAll(col, "`", "") + "`"
	}
	return `"` + strings.ReplaceAll(col, `"`, "") + `"`
}

// EscapeLiteral escapes a string for a single-quoted SQL literal.
//
// MySQL treats backslash as an escape character inside string literals and the
// other two do not, so doubling it there is required and doing so elsewhere
// would corrupt the value.
func EscapeLiteral(db model.SupportedDB, raw string) string {
	if db == model.Mariadb {
		return strings.ReplaceAll(strings.ReplaceAll(raw, `\`, `\\`), "'", "''")
	}
	return strings.ReplaceAll(raw, "'", "''")
}

// FormatValue renders a JSON value as a SQL literal.
func FormatValue(db model.SupportedDB, v any) string {
	switch t := v.(type) {
	case nil:
		return "NULL"
	case bool:
		return formatBool(db, t)
	case json.Number:
		return t.String()
	case float64:
		// Only reached for values decoded without UseNumber; keep the shortest
		// round-trip form rather than Go's default %v.
		return strings.TrimSuffix(fmt.Sprintf("%v", t), ".0")
	case int64:
		return fmt.Sprintf("%d", t)
	case int:
		return fmt.Sprintf("%d", t)
	case string:
		return "'" + EscapeLiteral(db, t) + "'"
	default:
		// Objects and arrays are serialised and stored as text, which is what
		// serde's fallback arm does.
		encoded, err := json.Marshal(t)
		if err != nil {
			return "'" + EscapeLiteral(db, fmt.Sprint(t)) + "'"
		}
		return "'" + EscapeLiteral(db, string(encoded)) + "'"
	}
}

func formatBool(db model.SupportedDB, b bool) string {
	if db == model.Sqlite {
		// SQLite has no boolean literal; it stores 1/0.
		if b {
			return "1"
		}
		return "0"
	}
	if b {
		return "TRUE"
	}
	return "FALSE"
}

// Filter is one grid filter row.
type Filter struct {
	Column   string `json:"column"`
	Operator string `json:"operator"`
	Value    any    `json:"value"`
}

// BuildFilterClause renders one filter as a WHERE fragment.
//
// It returns an error for anything it cannot express, and that is deliberate: a
// filter dropped silently shows the user unfiltered rows that look filtered, and
// because the COUNT query reuses the same clause list the total would agree with
// the wrong rows. Failing loudly is the only safe option.
func BuildFilterClause(db model.SupportedDB, f Filter) (string, error) {
	if strings.TrimSpace(f.Column) == "" {
		return "", fmt.Errorf("Filter with operator '%s' has no column selected.", f.Operator)
	}
	col := QuoteColumn(db, f.Column)

	// A comparison against NULL never matches, so those operators are spelled
	// out as IS [NOT] NULL rather than generating `= NULL`.
	if f.Value == nil {
		switch f.Operator {
		case "equals", "isNull":
			return col + " IS NULL", nil
		case "neq", "isNotNull":
			return col + " IS NOT NULL", nil
		default:
			return "", fmt.Errorf("Operator '%s' cannot be used with an empty value on %s.", f.Operator, f.Column)
		}
	}

	switch f.Operator {
	case "equals":
		return col + " = " + FormatValue(db, f.Value), nil
	case "neq":
		return col + " <> " + FormatValue(db, f.Value), nil
	case "gt":
		return col + " > " + FormatValue(db, f.Value), nil
	case "gte":
		return col + " >= " + FormatValue(db, f.Value), nil
	case "lt":
		return col + " < " + FormatValue(db, f.Value), nil
	case "lte":
		return col + " <= " + FormatValue(db, f.Value), nil
	case "contains":
		return likeClause(db, col, f.Value, true, true)
	case "startsWith":
		return likeClause(db, col, f.Value, false, true)
	case "endsWith":
		return likeClause(db, col, f.Value, true, false)
	case "isNull":
		return col + " IS NULL", nil
	case "isNotNull":
		return col + " IS NOT NULL", nil
	default:
		return "", fmt.Errorf("Unsupported filter operator '%s' on column %s.", f.Operator, f.Column)
	}
}

// likeClause builds a LIKE with the wildcards in the user's value escaped, so a
// search for "50%" matches the literal text rather than everything.
func likeClause(db model.SupportedDB, col string, v any, lead, trail bool) (string, error) {
	var raw string
	switch t := v.(type) {
	case string:
		raw = t
	case json.Number:
		raw = t.String()
	case bool:
		if t {
			raw = "true"
		} else {
			raw = "false"
		}
	case float64:
		raw = fmt.Sprintf("%v", t)
	case int64:
		raw = fmt.Sprintf("%d", t)
	default:
		return "", fmt.Errorf("LIKE filters need a text value.")
	}

	var pattern strings.Builder
	pattern.Grow(len(raw) + 2)
	if lead {
		pattern.WriteByte('%')
	}
	for _, ch := range raw {
		if ch == '%' || ch == '_' || ch == LikeEscape {
			pattern.WriteRune(LikeEscape)
		}
		pattern.WriteRune(ch)
	}
	if trail {
		pattern.WriteByte('%')
	}

	return fmt.Sprintf("%s LIKE '%s' ESCAPE '%s'",
		col,
		EscapeLiteral(db, pattern.String()),
		EscapeLiteral(db, string(LikeEscape)),
	), nil
}

// rowReturningKeywords are the statement heads that produce a result set.
var rowReturningKeywords = map[string]bool{
	"select": true, "with": true, "show": true, "explain": true,
	"describe": true, "desc": true, "pragma": true, "values": true,
	"table": true, "analyze": true,
}

// StatementReturnsRows classifies a statement once, so execute_command can pick
// between fetching rows and reporting an affected count without running the
// statement twice -- which for an INSERT would insert twice.
func StatementReturnsRows(sql string) bool {
	var body strings.Builder
	for _, line := range strings.Split(sql, "\n") {
		trimmed := strings.TrimLeft(line, " \t\r")
		if strings.HasPrefix(trimmed, "--") || strings.HasPrefix(trimmed, "#") {
			continue
		}
		body.WriteString(trimmed)
		body.WriteByte(' ')
	}

	text := body.String()
	// Strip block comments so `/* SELECT */ INSERT ...` is not misread.
	for {
		open := strings.Index(text, "/*")
		close := strings.Index(text, "*/")
		if open < 0 || close < 0 || close < open {
			break
		}
		text = text[:open] + " " + text[close+2:]
	}

	lowered := strings.ToLower(strings.TrimSpace(text))
	// RETURNING makes a writing statement produce rows.
	if strings.Contains(lowered, " returning ") || strings.HasSuffix(lowered, " returning") {
		return true
	}
	for _, word := range strings.FieldsFunc(lowered, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '(' || r == ';'
	}) {
		if word != "" {
			return rowReturningKeywords[word]
		}
	}
	return false
}
