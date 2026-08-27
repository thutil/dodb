package dbcore

import (
	"database/sql"
	"strings"
	"sync"
)

// ColumnHint carries what the MySQL wire protocol will not tell us.
//
// go-sql-driver reports "TINYINT" for both tinyint(1) and tinyint(4), and
// "TEXT" for a MariaDB JSON column and a plain text column alike -- the display
// width lives in an unexported mysqlField.length and ColumnTypeLength is
// commented out in the driver. sqlx has both facts, so the Rust build renders
// tinyint(1) as true/false and a MariaDB JSON column as a parsed object.
//
// Rather than fork a driver -- the very thing this port exists to stop doing --
// the facts are recovered from information_schema for the paths that know which
// table they are reading, which is every path whose output reaches the DataGrid.
type ColumnHint struct {
	Boolean bool
	JSON    bool
}

// ColumnHints maps a column name to its hint. A nil map is valid and means
// "no metadata available", which is the arbitrary-SQL case.
type ColumnHints map[string]ColumnHint

// Get is nil-safe so callers need no guard.
func (h ColumnHints) Get(column string) ColumnHint {
	if h == nil {
		return ColumnHint{}
	}
	return h[column]
}

// hintCache memoises hints per schema+table. Column types change only under
// DDL, and execute_ddl clears the cache.
type hintCache struct {
	mu   sync.Mutex
	seen map[string]ColumnHints
}

func newHintCache() *hintCache {
	return &hintCache{seen: map[string]ColumnHints{}}
}

func (c *hintCache) key(schema, table string) string { return schema + "\x00" + table }

func (c *hintCache) lookup(schema, table string) (ColumnHints, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	h, ok := c.seen[c.key(schema, table)]
	return h, ok
}

func (c *hintCache) store(schema, table string, h ColumnHints) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seen[c.key(schema, table)] = h
}

// Invalidate drops cached hints. Called after DDL, which is the only thing that
// can change a column's declared type.
func (c *hintCache) Invalidate(schema, table string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if table == "" {
		c.seen = map[string]ColumnHints{}
		return
	}
	delete(c.seen, c.key(schema, table))
}

// mysqlColumnHints reads the two facts the driver withholds.
//
// COLUMN_TYPE = 'tinyint(1)' identifies a boolean on both servers, and is the
// same predicate the frontend already applies in DataGrid.tsx:1733. MySQL 8.0.19
// dropped display widths from COLUMN_TYPE but kept tinyint(1) as a special case,
// and MariaDB reports widths for everything, so the test holds either way.
func mysqlColumnHints(db *sql.DB, schema, table string) (ColumnHints, error) {
	hints := ColumnHints{}

	rows, err := db.Query(
		`SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
		   FROM information_schema.COLUMNS
		  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, dataType, columnType string
		if err := rows.Scan(&name, &dataType, &columnType); err != nil {
			return nil, err
		}
		h := hints[name]
		if strings.EqualFold(strings.TrimSpace(columnType), "tinyint(1)") {
			h.Boolean = true
		}
		if strings.EqualFold(dataType, "json") {
			h.JSON = true
		}
		hints[name] = h
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// MariaDB has no JSON data type: `col JSON` is longtext plus a
	// `json_valid(col)` CHECK constraint, and that constraint is the only
	// durable record that the author meant JSON.
	//
	// Best effort on purpose: MySQL's own CHECK_CONSTRAINTS view has no
	// TABLE_NAME column, so this query fails there -- and it does not need to
	// succeed, because MySQL already reported DATA_TYPE = 'json' above.
	if checks, err := mariadbJSONChecks(db, schema, table); err == nil {
		for _, name := range checks {
			h := hints[name]
			h.JSON = true
			hints[name] = h
		}
	}

	return hints, nil
}

// mariadbJSONChecks lists columns carrying a json_valid() CHECK constraint.
func mariadbJSONChecks(db *sql.DB, schema, table string) ([]string, error) {
	rows, err := db.Query(
		`SELECT CHECK_CLAUSE
		   FROM information_schema.CHECK_CONSTRAINTS
		  WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var clause string
		if err := rows.Scan(&clause); err != nil {
			return nil, err
		}
		if name, ok := parseJSONValidClause(clause); ok {
			out = append(out, name)
		}
	}
	return out, rows.Err()
}

// parseJSONValidClause extracts the column from "json_valid(`doc`)".
//
// Matched narrowly rather than by substring: a hand-written CHECK such as
// `json_valid(payload) AND length(payload) < 100` is a real constraint on a
// text column, not MariaDB's marker for a JSON column, and treating it as one
// would silently start parsing that column's contents.
func parseJSONValidClause(clause string) (string, bool) {
	s := strings.TrimSpace(clause)
	const prefix = "json_valid("
	if !strings.HasPrefix(strings.ToLower(s), prefix) || !strings.HasSuffix(s, ")") {
		return "", false
	}
	inner := strings.TrimSpace(s[len(prefix) : len(s)-1])
	inner = strings.Trim(inner, "`\"")
	if inner == "" || strings.ContainsAny(inner, "`\"() ") {
		return "", false
	}
	return inner, true
}
