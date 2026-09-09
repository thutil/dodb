package api

import (
	"fmt"
	"sort"
	"strings"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/model"
)

// DiagramColumn is one column node in the ER diagram.
type DiagramColumn struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	PrimaryKey bool   `json:"primaryKey"`
}

// DiagramTable is one table node.
type DiagramTable struct {
	Name    string          `json:"name"`
	Columns []DiagramColumn `json:"columns"`
}

// DiagramRelation is one foreign-key edge.
type DiagramRelation struct {
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
}

// SchemaDiagram is the get_schema_diagram payload. Layout happens in the
// frontend; this is only the topology.
type SchemaDiagram struct {
	Tables    []DiagramTable    `json:"tables"`
	Relations []DiagramRelation `json:"relations"`
}

// GetSchemaDiagram collects tables, columns and foreign keys for the ER diagram.
func (s *Service) GetSchemaDiagram(id, database string) (SchemaDiagram, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return SchemaDiagram{}, err
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return SchemaDiagram{}, err
	}

	if profile.Type == model.Sqlite {
		return s.sqliteDiagram(pool)
	}

	tableQuery, colQuery, fkQuery := diagramQueries(profile.Type)

	tableRows, err := pool.Query(ctx(), tableQuery, nil)
	if err != nil {
		return SchemaDiagram{}, fmt.Errorf("Could not read the table list: %w", err)
	}
	// Every table is seeded first so one with no columns visible to this user
	// still appears as a node instead of vanishing from the diagram.
	byTable := map[string][]DiagramColumn{}
	order := make([]string, 0, len(tableRows))
	for _, row := range tableRows {
		name := asString(mustGet(row, "name"))
		if name == "" {
			continue
		}
		if _, seen := byTable[name]; !seen {
			byTable[name] = nil
			order = append(order, name)
		}
	}

	colRows, err := pool.Query(ctx(), colQuery, nil)
	if err != nil {
		return SchemaDiagram{}, fmt.Errorf("Could not read column metadata: %w", err)
	}
	for _, row := range colRows {
		table := asString(mustGet(row, "table_name"))
		name := asString(mustGet(row, "column_name"))
		if table == "" || name == "" {
			continue
		}
		if _, known := byTable[table]; !known {
			// A column whose table the list query missed (a view, a permission
			// quirk) still belongs somewhere.
			order = append(order, table)
		}
		byTable[table] = append(byTable[table], DiagramColumn{
			Name:       name,
			Type:       asString(mustGet(row, "data_type")),
			PrimaryKey: asBoolish(mustGet(row, "is_primary_key")),
		})
	}

	// The Rust build accumulates into a BTreeMap, so the diagram arrives sorted
	// by name rather than in catalog order.
	sort.Strings(order)
	tables := make([]DiagramTable, 0, len(order))
	seen := map[string]bool{}
	for _, name := range order {
		if seen[name] {
			continue
		}
		seen[name] = true
		tables = append(tables, DiagramTable{Name: name, Columns: byTable[name]})
	}

	fkRows, err := pool.Query(ctx(), fkQuery, nil)
	if err != nil {
		return SchemaDiagram{}, fmt.Errorf("Could not read foreign key metadata: %w", err)
	}
	relations := make([]DiagramRelation, 0, len(fkRows))
	for _, row := range fkRows {
		from := asString(mustGet(row, "from_table"))
		to := asString(mustGet(row, "to_table"))
		if from == "" || to == "" {
			continue
		}
		relations = append(relations, DiagramRelation{
			FromTable:  from,
			FromColumn: asString(mustGet(row, "from_column")),
			ToTable:    to,
			ToColumn:   asString(mustGet(row, "to_column")),
		})
	}

	return SchemaDiagram{Tables: tables, Relations: relations}, nil
}

func diagramQueries(db model.SupportedDB) (tables, columns, fks string) {
	if db == model.Postgres {
		return `
                SELECT
                    CASE
                        WHEN schemaname = 'public' THEN tablename::text
                        ELSE (schemaname || '.' || tablename)::text
                    END AS name
                FROM pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY (schemaname = 'public') DESC, tablename ASC
            `, `
                SELECT
                    CASE
                        WHEN c.table_schema = 'public' THEN c.table_name::text
                        ELSE (c.table_schema || '.' || c.table_name)::text
                    END AS table_name,
                    c.column_name::text AS column_name,
                    CASE
                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name::text
                        ELSE c.data_type::text
                    END AS data_type,
                    EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                          AND tc.table_schema = kcu.table_schema
                        WHERE tc.constraint_type = 'PRIMARY KEY'
                          AND tc.table_name = c.table_name
                          AND tc.table_schema = c.table_schema
                          AND kcu.column_name = c.column_name
                    ) AS is_primary_key
                FROM information_schema.columns c
                WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY c.table_schema, c.table_name, c.ordinal_position
            `, `
                SELECT
                    CASE WHEN n_src.nspname = 'public' THEN src.relname::text ELSE (n_src.nspname || '.' || src.relname)::text END AS from_table,
                    a_src.attname::text AS from_column,
                    CASE WHEN n_tgt.nspname = 'public' THEN tgt.relname::text ELSE (n_tgt.nspname || '.' || tgt.relname)::text END AS to_table,
                    a_tgt.attname::text AS to_column
                FROM (
                    SELECT
                        conrelid,
                        confrelid,
                        unnest(conkey) AS conkey_attnum,
                        unnest(confkey) AS confkey_attnum,
                        connamespace
                    FROM pg_constraint
                    WHERE contype = 'f'
                ) fk
                JOIN pg_class src ON src.oid = fk.conrelid
                JOIN pg_namespace n_src ON n_src.oid = src.relnamespace
                JOIN pg_attribute a_src ON a_src.attrelid = fk.conrelid AND a_src.attnum = fk.conkey_attnum
                JOIN pg_class tgt ON tgt.oid = fk.confrelid
                JOIN pg_namespace n_tgt ON n_tgt.oid = tgt.relnamespace
                JOIN pg_attribute a_tgt ON a_tgt.attrelid = fk.confrelid AND a_tgt.attnum = fk.confkey_attnum
                WHERE n_src.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND n_tgt.nspname NOT IN ('pg_catalog', 'information_schema')
            `
	}
	// MySQL/MariaDB. unnest has no equivalent, but KEY_COLUMN_USAGE already has
	// one row per column of a composite key.
	if db == model.Mssql {
		return `
            SELECT
                CASE
                    WHEN TABLE_SCHEMA = 'dbo' THEN TABLE_NAME
                    ELSE (TABLE_SCHEMA + '.' + TABLE_NAME)
                END AS name
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_TYPE = 'BASE TABLE'
            ORDER BY (CASE WHEN TABLE_SCHEMA = 'dbo' THEN 1 ELSE 0 END) DESC, TABLE_NAME ASC
        `, `
            SELECT
                CASE
                    WHEN c.TABLE_SCHEMA = 'dbo' THEN c.TABLE_NAME
                    ELSE (c.TABLE_SCHEMA + '.' + c.TABLE_NAME)
                END AS table_name,
                c.COLUMN_NAME AS column_name,
                c.DATA_TYPE AS data_type,
                CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_primary_key
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                  ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                  AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
            ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
            ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
        `, `
            SELECT
                CASE WHEN s.name = 'dbo' THEN t.name ELSE (s.name + '.' + t.name) END AS from_table,
                c.name AS from_column,
                CASE WHEN r_s.name = 'dbo' THEN r_t.name ELSE (r_s.name + '.' + r_t.name) END AS to_table,
                r_c.name AS to_column
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            JOIN sys.tables t ON t.object_id = fk.parent_object_id
            JOIN sys.schemas s ON s.schema_id = t.schema_id
            JOIN sys.tables r_t ON r_t.object_id = fk.referenced_object_id
            JOIN sys.schemas r_s ON r_s.schema_id = r_t.schema_id
            JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
            JOIN sys.columns r_c ON r_c.object_id = fkc.referenced_object_id AND r_c.column_id = fkc.referenced_column_id
            ORDER BY fk.name, fkc.constraint_column_id
        `
	}

	return `
            SELECT TABLE_NAME AS name
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        `, `
            SELECT
                TABLE_NAME AS table_name,
                COLUMN_NAME AS column_name,
                COLUMN_TYPE AS data_type,
                COLUMN_KEY = 'PRI' AS is_primary_key
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `, `
            SELECT
                TABLE_NAME AS from_table,
                COLUMN_NAME AS from_column,
                REFERENCED_TABLE_NAME AS to_table,
                REFERENCED_COLUMN_NAME AS to_column
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND REFERENCED_TABLE_NAME IS NOT NULL
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        `
}

// sqliteDiagram walks the schema table by table.
//
// SQLite has no catalog view for this, only PRAGMAs, so it is N+1 queries by
// necessity. Views are included because the diagram is a reading aid and a view
// is worth seeing.
func (s *Service) sqliteDiagram(pool *dbcore.Pool) (SchemaDiagram, error) {
	tableRows, err := pool.Query(ctx(),
		"SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name", nil)
	if err != nil {
		return SchemaDiagram{}, fmt.Errorf("Could not read the table list: %w", err)
	}

	var tables []DiagramTable
	var relations []DiagramRelation

	for _, row := range tableRows {
		name := asString(mustGet(row, "name"))
		if name == "" {
			continue
		}
		quoted := strings.ReplaceAll(name, `"`, "")

		colRows, err := pool.Query(ctx(), `PRAGMA table_info("`+quoted+`")`, nil)
		if err != nil {
			return SchemaDiagram{}, fmt.Errorf("Could not read column metadata: %w", err)
		}
		cols := make([]DiagramColumn, 0, len(colRows))
		for _, c := range colRows {
			cols = append(cols, DiagramColumn{
				Name:       asString(mustGet(c, "name")),
				Type:       asString(mustGet(c, "type")),
				PrimaryKey: asBoolish(mustGet(c, "pk")),
			})
		}
		tables = append(tables, DiagramTable{Name: name, Columns: cols})

		fkRows, err := pool.Query(ctx(), `PRAGMA foreign_key_list("`+quoted+`")`, nil)
		if err != nil {
			return SchemaDiagram{}, fmt.Errorf("Could not read foreign key metadata: %w", err)
		}
		for _, f := range fkRows {
			to := asString(mustGet(f, "table"))
			if to == "" {
				continue
			}
			relations = append(relations, DiagramRelation{
				FromTable:  name,
				FromColumn: asString(mustGet(f, "from")),
				ToTable:    to,
				ToColumn:   asString(mustGet(f, "to")),
			})
		}
	}

	if tables == nil {
		tables = []DiagramTable{}
	}
	if relations == nil {
		relations = []DiagramRelation{}
	}
	return SchemaDiagram{Tables: tables, Relations: relations}, nil
}
