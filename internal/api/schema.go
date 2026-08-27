package api

import (
	"fmt"
	"sort"
	"strings"

	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/orderedjson"
)

// Index is one non-primary index.
type Index struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Columns []string `json:"columns"`
}

// ForeignKey is one foreign-key constraint, columns in declaration order.
type ForeignKey struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete"`
	OnUpdate   string   `json:"onUpdate"`
}

// TableConstraints is the get_table_constraints payload.
type TableConstraints struct {
	Indexes     []Index      `json:"indexes"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
	// PrimaryKeyName is nil unless the server names the PK constraint. Postgres
	// needs the name to drop it; the PK itself is edited on the columns tab.
	PrimaryKeyName *string `json:"primaryKeyName"`
}

// GetTableConstraints reports indexes and foreign keys, normalised across
// dialects the way GetColumns normalises columns.
//
// Both come back one row per column, so they are grouped by constraint name
// while first-seen order is preserved and the columns within each are sorted by
// the server's sequence number -- a composite key whose columns arrive out of
// order would generate wrong DDL.
func (s *Service) GetTableConstraints(id, database, table string) (TableConstraints, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return TableConstraints{}, err
	}

	empty := TableConstraints{Indexes: []Index{}, ForeignKeys: []ForeignKey{}}
	if profile.Type == model.Sqlite {
		// Structure editing is disabled for SQLite, so there is nothing the
		// designer could do with this.
		return empty, nil
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return TableConstraints{}, err
	}
	schema, tbl := splitSchemaTable(table)

	var (
		idxRows, fkRows []*orderedjson.Object
		indexes         []Index
		pkName          *string
		fks             []ForeignKey
	)

	if profile.Type == model.Postgres {
		idxRows, err = pool.Query(ctx(), pgIndexQuery(profile.Type, schema, tbl), nil)
		if err != nil {
			return TableConstraints{}, fmt.Errorf("Could not read the indexes of this table: %w", err)
		}
		indexes, pkName = groupIndexes(idxRows, "index_name", "column_name", "seq", "is_unique", "is_primary", nil)

		fkRows, err = pool.Query(ctx(), pgForeignKeyQuery(profile.Type, schema, tbl), nil)
		if err != nil {
			return TableConstraints{}, fmt.Errorf("Could not read the foreign keys of this table: %w", err)
		}
		fks = groupForeignKeys(fkRows, pgAction)
	} else {
		idxRows, err = pool.Query(ctx(), "SHOW INDEX FROM `"+strings.ReplaceAll(tbl, "`", "")+"`", nil)
		if err != nil {
			return TableConstraints{}, fmt.Errorf("Could not read the indexes of this table: %w", err)
		}
		indexes, pkName = groupIndexes(idxRows, "Key_name", "Column_name", "Seq_in_index", "Non_unique", "", mysqlIndexFlags)

		fkRows, err = pool.Query(ctx(), myForeignKeyQuery(profile.Type, tbl), nil)
		if err != nil {
			return TableConstraints{}, fmt.Errorf("Could not read the foreign keys of this table: %w", err)
		}
		fks = groupForeignKeys(fkRows, myAction)
	}

	if indexes == nil {
		indexes = []Index{}
	}
	if fks == nil {
		fks = []ForeignKey{}
	}
	return TableConstraints{Indexes: indexes, ForeignKeys: fks, PrimaryKeyName: pkName}, nil
}

// splitSchemaTable splits a possibly schema-qualified name, defaulting to public.
func splitSchemaTable(table string) (schema, name string) {
	if i := strings.Index(table, "."); i > 0 {
		return table[:i], table[i+1:]
	}
	return "public", table
}

// pgAction maps a pg_constraint action code to its SQL spelling.
func pgAction(code string) string {
	switch code {
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	default:
		return "NO ACTION"
	}
}

// myAction normalises a MariaDB referential rule to the same vocabulary.
func myAction(rule string) string {
	switch strings.ToUpper(rule) {
	case "RESTRICT":
		return "RESTRICT"
	case "CASCADE":
		return "CASCADE"
	case "SET NULL":
		return "SET NULL"
	case "SET DEFAULT":
		return "SET DEFAULT"
	default:
		return "NO ACTION"
	}
}

// mysqlIndexFlags reads SHOW INDEX's flags, where uniqueness is reported
// INVERTED as Non_unique and the primary key is identified only by its name.
func mysqlIndexFlags(row *orderedjson.Object, name string) (unique, primary bool) {
	return !asBoolish(mustGet(row, "Non_unique")), name == "PRIMARY"
}

type indexAcc struct {
	name            string
	unique, primary bool
	columns         []seqCol
}

type seqCol struct {
	seq int64
	col string
}

func groupIndexes(
	rows []*orderedjson.Object,
	nameKey, colKey, seqKey, uniqueKey, primaryKey string,
	flags func(*orderedjson.Object, string) (bool, bool),
) ([]Index, *string) {
	var accs []*indexAcc
	byName := map[string]*indexAcc{}

	for _, row := range rows {
		name := asString(mustGet(row, nameKey))
		col := asString(mustGet(row, colKey))
		if name == "" || col == "" {
			continue
		}
		seq := asSeq(mustGet(row, seqKey))
		if acc, ok := byName[name]; ok {
			acc.columns = append(acc.columns, seqCol{seq, col})
			continue
		}
		unique, primary := false, false
		if flags != nil {
			unique, primary = flags(row, name)
		} else {
			unique = asBoolish(mustGet(row, uniqueKey))
			primary = asBoolish(mustGet(row, primaryKey))
		}
		acc := &indexAcc{name: name, unique: unique, primary: primary, columns: []seqCol{{seq, col}}}
		byName[name] = acc
		accs = append(accs, acc)
	}

	var out []Index
	var pkName *string
	for _, acc := range accs {
		sort.SliceStable(acc.columns, func(i, j int) bool { return acc.columns[i].seq < acc.columns[j].seq })
		cols := make([]string, 0, len(acc.columns))
		for _, c := range acc.columns {
			cols = append(cols, c.col)
		}
		if acc.primary {
			name := acc.name
			pkName = &name
			continue
		}
		out = append(out, Index{Name: acc.name, Unique: acc.unique, Columns: cols})
	}
	return out, pkName
}

type fkAcc struct {
	name               string
	refTable           string
	onDelete, onUpdate string
	columns, refCols   []seqCol
}

func groupForeignKeys(rows []*orderedjson.Object, action func(string) string) []ForeignKey {
	var accs []*fkAcc
	byName := map[string]*fkAcc{}

	for _, row := range rows {
		name := asString(mustGet(row, "fk_name"))
		if name == "" {
			continue
		}
		seq := asSeq(mustGet(row, "seq"))
		col := asString(mustGet(row, "column_name"))
		refCol := asString(mustGet(row, "ref_column"))

		if acc, ok := byName[name]; ok {
			acc.columns = append(acc.columns, seqCol{seq, col})
			acc.refCols = append(acc.refCols, seqCol{seq, refCol})
			continue
		}
		acc := &fkAcc{
			name:     name,
			refTable: asString(mustGet(row, "ref_table")),
			onDelete: action(asString(mustGet(row, "on_delete"))),
			onUpdate: action(asString(mustGet(row, "on_update"))),
			columns:  []seqCol{{seq, col}},
			refCols:  []seqCol{{seq, refCol}},
		}
		byName[name] = acc
		accs = append(accs, acc)
	}

	out := make([]ForeignKey, 0, len(accs))
	for _, acc := range accs {
		sort.SliceStable(acc.columns, func(i, j int) bool { return acc.columns[i].seq < acc.columns[j].seq })
		sort.SliceStable(acc.refCols, func(i, j int) bool { return acc.refCols[i].seq < acc.refCols[j].seq })
		cols := make([]string, 0, len(acc.columns))
		for _, c := range acc.columns {
			cols = append(cols, c.col)
		}
		refs := make([]string, 0, len(acc.refCols))
		for _, c := range acc.refCols {
			refs = append(refs, c.col)
		}
		out = append(out, ForeignKey{
			Name: acc.name, Columns: cols, RefTable: acc.refTable,
			RefColumns: refs, OnDelete: acc.onDelete, OnUpdate: acc.onUpdate,
		})
	}
	return out
}

func pgIndexQuery(db model.SupportedDB, schema, table string) string {
	return fmt.Sprintf(`
                SELECT
                    i.relname::text AS index_name,
                    ix.indisunique AS is_unique,
                    ix.indisprimary AS is_primary,
                    pg_get_indexdef(ix.indexrelid, s.n::int, true) AS column_name,
                    s.n::int AS seq
                FROM pg_index ix
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN pg_namespace ns ON ns.oid = t.relnamespace
                CROSS JOIN generate_series(1, ix.indnkeyatts) AS s(n)
                WHERE t.relname = '%s' AND ns.nspname = '%s'
                ORDER BY i.relname, s.n
                `, dialect.EscapeLiteral(db, table), dialect.EscapeLiteral(db, schema))
}

func pgForeignKeyQuery(db model.SupportedDB, schema, table string) string {
	// unnest(...) WITH ORDINALITY on both sides, joined on matching ordinality,
	// is what keeps a composite key's columns paired with the right referenced
	// columns rather than producing the cross product.
	return fmt.Sprintf(`
                SELECT
                    con.conname::text AS fk_name,
                    att.attname::text AS column_name,
                    CASE WHEN rn.nspname = 'public'
                         THEN rt.relname::text
                         ELSE (rn.nspname || '.' || rt.relname)::text
                    END AS ref_table,
                    ratt.attname::text AS ref_column,
                    con.confdeltype::text AS on_delete,
                    con.confupdtype::text AS on_update,
                    k.ord::int AS seq
                FROM pg_constraint con
                JOIN pg_class t ON t.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = t.relnamespace
                JOIN pg_class rt ON rt.oid = con.confrelid
                JOIN pg_namespace rn ON rn.oid = rt.relnamespace
                CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
                CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS rk(attnum, ord)
                JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = rk.attnum
                WHERE con.contype = 'f'
                  AND t.relname = '%s'
                  AND ns.nspname = '%s'
                  AND rk.ord = k.ord
                ORDER BY con.conname, k.ord
                `, dialect.EscapeLiteral(db, table), dialect.EscapeLiteral(db, schema))
}

func myForeignKeyQuery(db model.SupportedDB, table string) string {
	return fmt.Sprintf(`
                SELECT
                    k.CONSTRAINT_NAME AS fk_name,
                    k.COLUMN_NAME AS column_name,
                    k.REFERENCED_TABLE_NAME AS ref_table,
                    k.REFERENCED_COLUMN_NAME AS ref_column,
                    r.DELETE_RULE AS on_delete,
                    r.UPDATE_RULE AS on_update,
                    k.ORDINAL_POSITION AS seq
                FROM information_schema.KEY_COLUMN_USAGE k
                JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                  ON r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                 AND r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                WHERE k.TABLE_SCHEMA = DATABASE()
                  AND k.TABLE_NAME = '%s'
                  AND k.REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
                `, dialect.EscapeLiteral(db, table))
}

// DDLResult is the execute_ddl payload.
type DDLResult struct {
	Success         bool   `json:"success"`
	Executed        int    `json:"executed"`
	Total           int    `json:"total"`
	FailedIndex     *int   `json:"failedIndex,omitempty"`
	FailedStatement string `json:"failedStatement,omitempty"`
	Error           string `json:"error,omitempty"`
}

// ExecuteDDL runs statements in order.
//
// Deliberately not wrapped in a transaction: MariaDB issues an implicit commit
// per DDL statement, so a transaction would promise an atomicity it cannot
// deliver. Partial application is reported honestly instead -- on failure the
// caller learns how many statements landed and which one broke.
func (s *Service) ExecuteDDL(id, database string, statements []string) (DDLResult, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return DDLResult{}, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return DDLResult{}, err
	}

	runnable := make([]string, 0, len(statements))
	for _, stmt := range statements {
		if trimmed := strings.TrimSpace(stmt); trimmed != "" {
			runnable = append(runnable, trimmed)
		}
	}
	if len(runnable) == 0 {
		return DDLResult{}, fmt.Errorf("No statements to execute")
	}

	executed := 0
	for i, stmt := range runnable {
		if _, err := pool.Exec(ctx(), stmt); err != nil {
			idx := i
			return DDLResult{
				Success: false, Executed: executed, Total: len(runnable),
				FailedIndex: &idx, FailedStatement: stmt, Error: err.Error(),
			}, nil
		}
		executed++
	}

	// Column types may have changed, so the cached hints are now stale.
	pool.InvalidateHints(database, "")
	return DDLResult{Success: true, Executed: executed, Total: len(runnable)}, nil
}
