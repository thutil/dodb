package api

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/orderedjson"
)

// GetDatabases lists the databases on the server.
func (s *Service) GetDatabases(id string) ([]string, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return nil, err
	}
	var query string
	var maintenanceDb string
	switch profile.Type {
	case model.Postgres:
		query = "SELECT datname::text as name FROM pg_database WHERE datistemplate = false ORDER BY datname"
		maintenanceDb = "postgres"
	case model.Mariadb:
		query = "SHOW DATABASES"
		maintenanceDb = "information_schema"
	default:
		query = "SELECT name FROM pragma_database_list"
		maintenanceDb = ""
	}

	pool, err := s.DB.GetPool(ctx(), profile, maintenanceDb)
	if err != nil && profile.Type == model.Postgres {
		pool, err = s.DB.GetPool(ctx(), profile, "template1")
	}
	if err != nil {
		return nil, err
	}
	rows, err := pool.Query(ctx(), query, nil)
	if err != nil {
		return nil, err
	}
	return firstColumnStrings(rows), nil
}

// TableList is the get_tables payload.
type TableList struct {
	Tables []string `json:"tables"`
}

// GetTables lists user tables, Postgres names qualified when outside public.
func (s *Service) GetTables(id, database string) (TableList, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return TableList{}, err
	}
	var query string
	switch profile.Type {
	case model.Postgres:
		// public first and unqualified, everything else schema-qualified, which
		// is the naming the rest of the app then quotes and splits on.
		query = `
            SELECT
                CASE
                    WHEN schemaname = 'public' THEN tablename::text
                    ELSE (schemaname || '.' || tablename)::text
                END AS name
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY (schemaname = 'public') DESC, tablename ASC
        `
	case model.Mariadb:
		query = "SHOW TABLES"
	default:
		query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return TableList{}, err
	}
	rows, err := pool.Query(ctx(), query, nil)
	if err != nil {
		return TableList{}, err
	}
	return TableList{Tables: firstColumnStrings(rows)}, nil
}

// Column is one entry of the get_columns payload.
type Column struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	Nullable      bool   `json:"nullable"`
	PrimaryKey    bool   `json:"primaryKey"`
	Default       any    `json:"default"`
	AutoIncrement bool   `json:"autoIncrement"`
	// Extra carries MySQL's Extra column, which the table designer reads.
	Extra string `json:"extra,omitempty"`
}

// ColumnList is the get_columns payload.
type ColumnList struct {
	Columns []Column `json:"columns"`
}

// GetColumns describes a table's columns, normalised across the three dialects.
func (s *Service) GetColumns(id, database, table string) (ColumnList, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return ColumnList{}, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return ColumnList{}, err
	}

	rows, err := pool.Query(ctx(), columnsQuery(profile.Type, table), nil)
	if err != nil && profile.Type != model.Postgres {
		return ColumnList{}, err
	}

	columns := make([]Column, 0, len(rows))
	for _, row := range rows {
		columns = append(columns, normaliseColumn(profile.Type, row))
	}

	if len(columns) == 0 {
		// The catalog said nothing: probe the table itself. A view over a
		// foreign table, or a name whose casing the catalog query missed, still
		// has to be browsable.
		probe, probeErr := pool.Query(ctx(), probeQuery(profile.Type, table), nil)
		if probeErr != nil {
			return ColumnList{}, fmt.Errorf("Could not read the columns of %s: %w", table, probeErr)
		}
		if len(probe) > 0 {
			for _, key := range probe[0].Keys() {
				isID := strings.EqualFold(key, "id")
				columns = append(columns, Column{
					Name: key, Type: "text", Nullable: true,
					PrimaryKey: isID, AutoIncrement: isID,
				})
			}
		}
		if len(columns) == 0 {
			return ColumnList{}, fmt.Errorf(
				"Could not determine the columns of %s: the catalog lookup returned nothing "+
					"and the table has no rows to probe.", table)
		}
	}
	return ColumnList{Columns: columns}, nil
}

func columnsQuery(db model.SupportedDB, table string) string {
	switch db {
	case model.Postgres:
		schema, name, qualified := "public", table, false
		if s, n, found := strings.Cut(table, "."); found {
			schema, name, qualified = s, n, true
		}
		schema = strings.ReplaceAll(schema, "'", "''")
		name = strings.ReplaceAll(name, "'", "''")

		// A qualified name resolves inside its own schema only. Falling back to
		// public or CURRENT_SCHEMA() there would mix in the columns of a
		// same-named table from another schema, which corrupts primary-key
		// detection in the grid.
		schemaFilter := fmt.Sprintf(
			"(c.table_schema = '%[1]s' OR LOWER(c.table_schema) = LOWER('%[1]s') OR c.table_schema = CURRENT_SCHEMA())", schema)
		if qualified {
			schemaFilter = fmt.Sprintf(
				"(c.table_schema = '%[1]s' OR LOWER(c.table_schema) = LOWER('%[1]s'))", schema)
		}

		return fmt.Sprintf(`
                SELECT
                    c.column_name::text AS name,
                    CASE
                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name::text
                        ELSE c.data_type::text
                    END AS type,
                    (c.is_nullable = 'YES') AS nullable,
                    c.column_default::text AS default_value,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                          AND (tc.table_name = c.table_name OR LOWER(tc.table_name) = LOWER(c.table_name))
                          AND (tc.table_schema = c.table_schema OR LOWER(tc.table_schema) = LOWER(c.table_schema))
                          AND kcu.column_name = c.column_name
                    ) AS primary_key
                FROM information_schema.columns c
                WHERE %s
                  AND (c.table_name = '%[2]s' OR LOWER(c.table_name) = LOWER('%[2]s'))
                ORDER BY c.ordinal_position
            `, schemaFilter, name)
	case model.Mariadb:
		return "SHOW FULL COLUMNS FROM `" + strings.ReplaceAll(table, "`", "") + "`"
	default:
		return `PRAGMA table_info("` + strings.ReplaceAll(table, `"`, "") + `")`
	}
}

func probeQuery(db model.SupportedDB, table string) string {
	return "SELECT * FROM " + dialect.QuoteTable(db, table) + " LIMIT 1"
}

// normaliseColumn maps one catalog row onto the shape the frontend expects.
func normaliseColumn(db model.SupportedDB, row *orderedjson.Object) Column {
	get := func(key string) any {
		v, _ := row.Get(key)
		return v
	}

	switch db {
	case model.Sqlite:
		colType := asString(get("type"))
		isPK := asBoolish(get("pk"))
		return Column{
			Name:       asString(get("name")),
			Type:       colType,
			Nullable:   !asBoolish(get("notnull")),
			PrimaryKey: isPK,
			Default:    get("dflt_value"),
			// SQLite's rowid alias: an INTEGER PRIMARY KEY auto-assigns.
			AutoIncrement: isPK && strings.Contains(strings.ToLower(colType), "int"),
		}
	case model.Mariadb:
		extra := asString(get("Extra"))
		return Column{
			Name:          asString(get("Field")),
			Type:          asString(get("Type")),
			Nullable:      asString(get("Null")) == "YES",
			PrimaryKey:    asString(get("Key")) == "PRI",
			Default:       get("Default"),
			AutoIncrement: strings.Contains(strings.ToLower(extra), "auto_increment"),
			Extra:         extra,
		}
	default:
		def := get("default_value")
		defStr := asString(def)
		return Column{
			Name:       asString(get("name")),
			Type:       asString(get("type")),
			Nullable:   asBoolish(get("nullable")),
			PrimaryKey: asBoolish(get("primary_key")),
			Default:    def,
			// A serial or an identity column: the grid must not send a value.
			AutoIncrement: strings.Contains(defStr, "nextval") || strings.Contains(defStr, "identity"),
		}
	}
}

// RowPage is the get_rows payload.
type RowPage struct {
	Rows  []*orderedjson.Object `json:"rows"`
	Total uint32                `json:"total"`
}

// GetRows reads one page of a table, with filters, quick search and sorting.
func (s *Service) GetRows(
	id, database, table string,
	limit, offset uint32,
	sortColumn, sortOrder, searchQuery string,
	filters []dialect.Filter,
) (RowPage, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return RowPage{}, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return RowPage{}, err
	}

	tableIdent := dialect.QuoteTable(profile.Type, table)

	var where []string
	for _, f := range filters {
		clause, err := dialect.BuildFilterClause(profile.Type, f)
		if err != nil {
			// Deliberately fatal: a dropped filter shows unfiltered rows that
			// look filtered, and the COUNT below would agree with them.
			return RowPage{}, err
		}
		where = append(where, clause)
	}

	if q := strings.TrimSpace(searchQuery); q != "" {
		if clause := s.quickSearchClause(pool, profile.Type, table, q); clause != "" {
			where = append(where, clause)
		}
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	orderSQL := ""
	if col := strings.TrimSpace(sortColumn); col != "" {
		dir := "ASC"
		if strings.EqualFold(sortOrder, "DESC") {
			dir = "DESC"
		}
		orderSQL = "ORDER BY " + dialect.QuoteColumn(profile.Type, col) + " " + dir
	}

	hints := pool.ColumnHintsFor(database, table)

	query := fmt.Sprintf("SELECT * FROM %s %s %s LIMIT %d OFFSET %d",
		tableIdent, whereSQL, orderSQL, limit, offset)
	countQuery := fmt.Sprintf("SELECT COUNT(*) AS total FROM %s %s", tableIdent, whereSQL)

	rows, firstErr := pool.Query(ctx(), query, hints)
	countRows, countErr := pool.Query(ctx(), countQuery, nil)

	if firstErr != nil || countErr != nil {
		// Retry unquoted, for a server whose identifier casing does not survive
		// quoting. If that fails too, report the ORIGINAL error: the retry's
		// complaint is usually about the bare identifier and hides the real
		// cause, which is normally a bad filter or a permission problem.
		unquoted := fmt.Sprintf("SELECT * FROM %s %s %s LIMIT %d OFFSET %d",
			table, whereSQL, orderSQL, limit, offset)
		unquotedCount := fmt.Sprintf("SELECT COUNT(*) AS total FROM %s %s", table, whereSQL)

		r2, e2 := pool.Query(ctx(), unquoted, hints)
		c2, ce2 := pool.Query(ctx(), unquotedCount, nil)
		switch {
		case e2 == nil && ce2 == nil:
			rows, countRows = r2, c2
		case orderSQL != "":
			// A stale sort column left over from another table is the other
			// common cause, so drop the ORDER BY and try once more.
			noSort := fmt.Sprintf("SELECT * FROM %s %s LIMIT %d OFFSET %d",
				tableIdent, whereSQL, limit, offset)
			r3, e3 := pool.Query(ctx(), noSort, hints)
			c3, ce3 := pool.Query(ctx(), countQuery, nil)
			if e3 != nil || ce3 != nil {
				return RowPage{}, firstNonNil(firstErr, countErr)
			}
			rows, countRows = r3, c3
		default:
			return RowPage{}, firstNonNil(firstErr, countErr)
		}
	}

	return RowPage{Rows: rows, Total: totalFromCount(countRows)}, nil
}

// quickSearchClause ORs a cast-to-text LIKE across every column.
//
// Returns "" when the column list cannot be resolved: a search that silently
// matches nothing is better than one that errors out of an otherwise fine page
// load, and the user can see their search box had no effect.
func (s *Service) quickSearchClause(pool *dbcore.Pool, db model.SupportedDB, table, needle string) string {
	cols := s.tableColumnNames(pool, db, table)
	if len(cols) == 0 {
		return ""
	}
	escaped := dialect.EscapeLiteral(db, needle)
	parts := make([]string, 0, len(cols))
	for _, col := range cols {
		ident := dialect.QuoteColumn(db, col)
		switch db {
		case model.Postgres:
			parts = append(parts, fmt.Sprintf("CAST(%s AS TEXT) ILIKE '%%%s%%'", ident, escaped))
		case model.Mariadb:
			parts = append(parts, fmt.Sprintf("CAST(%s AS CHAR) LIKE '%%%s%%'", ident, escaped))
		default:
			parts = append(parts, fmt.Sprintf("CAST(%s AS TEXT) LIKE '%%%s%%'", ident, escaped))
		}
	}
	return "(" + strings.Join(parts, " OR ") + ")"
}

// tableColumnNames resolves column names from the catalog, probing the table
// itself if the catalog says nothing.
func (s *Service) tableColumnNames(pool *dbcore.Pool, db model.SupportedDB, table string) []string {
	var query string
	switch db {
	case model.Postgres:
		schema, name := "public", table
		if sc, n, found := strings.Cut(table, "."); found {
			schema, name = sc, n
		}
		schema = strings.ReplaceAll(schema, `"`, "")
		name = strings.ReplaceAll(name, `"`, "")
		query = fmt.Sprintf(
			"SELECT column_name::text AS name FROM information_schema.columns "+
				"WHERE (table_schema = '%[1]s' OR LOWER(table_schema) = LOWER('%[1]s')) "+
				"AND (table_name = '%[2]s' OR LOWER(table_name) = LOWER('%[2]s')) ORDER BY ordinal_position",
			schema, name)
	case model.Mariadb:
		query = "SHOW COLUMNS FROM `" + strings.ReplaceAll(table, "`", "") + "`"
	default:
		query = `PRAGMA table_info("` + strings.ReplaceAll(table, `"`, "") + `")`
	}

	if rows, err := pool.Query(ctx(), query, nil); err == nil {
		var cols []string
		for _, row := range rows {
			if v, ok := row.Get("name"); ok {
				cols = append(cols, asString(v))
				continue
			}
			if v, ok := row.Get("Field"); ok {
				cols = append(cols, asString(v))
			}
		}
		if len(cols) > 0 {
			return cols
		}
	}

	if rows, err := pool.Query(ctx(), probeQuery(db, table), nil); err == nil && len(rows) > 0 {
		return rows[0].Keys()
	}
	return nil
}

// CommandResult is the execute_command payload.
type CommandResult struct {
	Rows         []*orderedjson.Object `json:"rows"`
	RowsReturned int                   `json:"rowsReturned"`
	AffectedRows *int64                `json:"affectedRows"`
}

// ExecuteCommand runs ad-hoc SQL from the console.
//
// The statement is classified once and run once. Retrying a failed fetch as an
// exec (or the reverse) would re-run side effects -- an INSERT would insert
// twice -- so the classification is trusted rather than probed.
func (s *Service) ExecuteCommand(id, database, command string) (CommandResult, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return CommandResult{}, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return CommandResult{}, err
	}

	if dialect.StatementReturnsRows(command) {
		rows, err := pool.Query(ctx(), command, nil)
		if err != nil {
			return CommandResult{}, err
		}
		return CommandResult{Rows: rows, RowsReturned: len(rows)}, nil
	}

	affected, err := pool.Exec(ctx(), command)
	if err != nil {
		return CommandResult{}, err
	}
	return CommandResult{
		Rows:         []*orderedjson.Object{},
		RowsReturned: 0,
		AffectedRows: &affected,
	}, nil
}

// CommitResult is the commit_changes payload.
type CommitResult struct {
	Success       bool     `json:"success"`
	Queries       []string `json:"queries"`
	Affected      []int64  `json:"affected"`
	TotalAffected int64    `json:"totalAffected"`
}

// GridChanges is the staged mutation set the grid sends.
type GridChanges struct {
	Inserts []map[string]any `json:"inserts"`
	Updates []GridRowChange  `json:"updates"`
	Deletes []GridRowChange  `json:"deletes"`
}

// GridRowChange identifies a row by its original key values and, for an update,
// carries the changed columns.
type GridRowChange struct {
	Keys map[string]any `json:"keys"`
	Data map[string]any `json:"data"`
}

// CommitChanges applies the grid's staged edits in one transaction.
func (s *Service) CommitChanges(id, database, table string, changes GridChanges) (CommitResult, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return CommitResult{}, err
	}

	steps, queries, err := buildCommitSteps(profile.Type, table, changes)
	if err != nil {
		return CommitResult{}, err
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return CommitResult{}, err
	}
	affected, err := dbcore.ExecuteTransaction(ctx(), pool, steps)
	if err != nil {
		return CommitResult{}, err
	}
	var total int64
	for _, n := range affected {
		total += n
	}
	return CommitResult{Success: true, Queries: queries, Affected: affected, TotalAffected: total}, nil
}

// DisconnectDatabase closes the pools for one profile, or all of them.
func (s *Service) DisconnectDatabase(id string) (bool, error) {
	s.DB.ClosePools(id)
	return true, nil
}

// PingDatabase reports round-trip latency in milliseconds.
func (s *Service) PingDatabase(id, database string) (int64, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return 0, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return 0, err
	}
	start := time.Now()
	if _, err := pool.Query(ctx(), "SELECT 1", nil); err != nil {
		return 0, err
	}
	// Floored at 1: a sub-millisecond local connection reporting 0 reads as a
	// broken measurement rather than a fast one.
	ms := time.Since(start).Milliseconds()
	if ms < 1 {
		ms = 1
	}
	return ms, nil
}

// ---- helpers ----

func firstColumnStrings(rows []*orderedjson.Object) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		keys := row.Keys()
		if len(keys) == 0 {
			continue
		}
		v, _ := row.Get(keys[0])
		if s := asString(v); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func totalFromCount(rows []*orderedjson.Object) uint32 {
	if len(rows) == 0 {
		return 0
	}
	row := rows[0]
	v, ok := row.Get("total")
	if !ok {
		keys := row.Keys()
		if len(keys) == 0 {
			return 0
		}
		v, _ = row.Get(keys[0])
	}
	switch t := v.(type) {
	case int64:
		return uint32(t)
	case uint64:
		return uint32(t)
	case float64:
		return uint32(t)
	case string:
		n, _ := strconv.ParseUint(t, 10, 32)
		return uint32(n)
	default:
		n, _ := strconv.ParseUint(asString(v), 10, 32)
		return uint32(n)
	}
}

func firstNonNil(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return fmt.Errorf("Failed to read table rows")
}
