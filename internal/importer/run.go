package importer

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/model"
)

// TargetColumn is one column of an existing target table.
type TargetColumn struct {
	Name          string
	SQLType       string
	PrimaryKey    bool
	AutoIncrement bool
}

// ColumnLookup reads a target table's real columns.
type ColumnLookup func(table string) ([]TargetColumn, error)

// PreviewRows samples a tabular file and infers a column type for each field.
func PreviewRows(path string, format Format, csv CsvOptions, limit int) ([][]*string, []PreviewColumn, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, fmt.Errorf("could not open %s: %w", path, err)
	}
	defer file.Close()

	reader := decodedReader(file, csv.Encoding)

	var (
		header []string
		rows   [][]*string
	)

	switch format {
	case FormatCSV:
		r, err := newCSVReader(reader, csv)
		if err != nil {
			return nil, nil, err
		}
		header = r.Header()
		for len(rows) < limit {
			row, err := r.Next()
			if err != nil {
				return nil, nil, err
			}
			if row == nil {
				break
			}
			rows = append(rows, row.Fields)
		}

	case FormatJSON:
		r, err := newJSONReader(reader)
		if err != nil {
			return nil, nil, err
		}
		// Objects are collected first, then flattened: JSON records need not
		// share a key set, so the column list is the union of every key seen
		// -- in first-seen order, which is why it cannot be a Go map.
		var objects []map[string]*string
		for len(objects) < limit {
			obj, _, err := r.NextObject()
			if err != nil {
				return nil, nil, err
			}
			if obj == nil {
				break
			}
			flat := map[string]*string{}
			for _, k := range obj.Keys() {
				v, _ := obj.Get(k)
				flat[k] = jsonValueToCell(v)
			}
			objects = append(objects, flat)
		}
		header = r.Header()
		for _, obj := range objects {
			row := make([]*string, len(header))
			for i, key := range header {
				row[i] = obj[key]
			}
			rows = append(rows, row)
		}

	default:
		return nil, nil, fmt.Errorf("cannot preview format %q as rows", format)
	}

	columns := make([]PreviewColumn, 0, len(header))
	for i, name := range header {
		samples := make([]*string, 0, len(rows))
		for _, row := range rows {
			if i < len(row) {
				samples = append(samples, row[i])
			}
		}
		valueType, nullable := InferType(samples)
		columns = append(columns, PreviewColumn{
			Name:      SanitizeIdent(name),
			ValueType: valueType,
			Nullable:  nullable,
			SQLType:   SQLTypeFor(valueType, model.Postgres),
		})
	}

	if rows == nil {
		rows = [][]*string{}
	}
	return rows, columns, nil
}

// Run performs a whole import.
func Run(
	ctx context.Context,
	pool *dbcore.Pool,
	db model.SupportedDB,
	req Request,
	lookup ColumnLookup,
	onProgress func(Progress),
) (Report, error) {
	req.applyDefaults()

	report := Report{
		DryRun:        req.DryRun,
		Failures:      []Failure{},
		TablesTouched: []string{},
	}

	emit := func(phase string, t Tick, table string) {
		if onProgress == nil {
			return
		}
		pct := uint8(0)
		if t.TotalBytes > 0 {
			p := t.BytesRead * 100 / t.TotalBytes
			if p > 100 {
				p = 100
			}
			pct = uint8(p)
		}
		onProgress(Progress{
			Phase: phase, BytesRead: t.BytesRead, TotalBytes: t.TotalBytes,
			Percentage: pct, RowsImported: t.RowsImported,
			StatementsRun: t.StatementsRun, Errors: t.Errors, CurrentTable: table,
		})
	}

	table := ""
	if req.TargetTable != nil {
		table = strings.TrimSpace(*req.TargetTable)
	}
	emit("preparing", Tick{}, table)

	var (
		source BatchSource
		err    error
	)

	if req.Format == FormatSQL {
		source, err = newSQLSource(db, req)
	} else {
		if table == "" {
			return report, fmt.Errorf("A target table is required for a %s import.", req.Format)
		}
		mappings := req.Columns
		var pkColumns []string

		if req.CreateTable {
			if err := createTargetTable(ctx, pool, db, table, mappings); err != nil {
				return report, err
			}
		} else if lookup != nil {
			// Follow the table that is actually there, not what the file looked
			// like: a text-shaped cell must land unquoted in an integer column.
			mappings, pkColumns, err = applyDeclaredTypes(mappings, lookup, table)
			if err != nil {
				return report, err
			}
		}

		if req.TruncateFirst {
			if _, err := pool.Exec(ctx, BuildClearTable(db, table)); err != nil {
				return report, fmt.Errorf("could not clear %s: %w", table, err)
			}
		}
		source, err = newTabularSource(db, table, req, mappings, pkColumns)
	}
	if err != nil {
		return report, err
	}
	defer source.Close()

	if req.DryRun {
		// Walk and coerce the whole file without writing anything, so the user
		// finds out row 480,000 is bad BEFORE 479,999 rows have been inserted.
		out, err := dryRun(ctx, source, req, func(t Tick) { emit("importing", t, table) })
		if err != nil {
			return report, err
		}
		finishReport(&report, out, source)
		emit("done", Tick{BytesRead: source.BytesRead(), TotalBytes: source.TotalBytes(),
			RowsImported: report.RowsImported, StatementsRun: report.StatementsRun}, table)
		return report, nil
	}

	out, err := Execute(ctx, pool, source, ExecOptions{
		TxMode: req.TxMode, OnError: req.OnError, MaxErrors: req.MaxErrors,
	}, func(t Tick) { emit("importing", t, table) })
	if err != nil {
		return report, err
	}

	finishReport(&report, out, source)
	emit("done", Tick{BytesRead: source.BytesRead(), TotalBytes: source.TotalBytes(),
		RowsImported: report.RowsImported, StatementsRun: report.StatementsRun}, table)
	return report, nil
}

// dryRun exercises the source without touching the database.
func dryRun(ctx context.Context, source BatchSource, req Request, onTick func(Tick)) (Outcome, error) {
	var out Outcome
	for {
		if err := ctx.Err(); err != nil {
			out.Cancelled = true
			return out, nil
		}
		batch, err := source.NextBatch()
		if err != nil {
			return out, err
		}
		collectFailures(&out, source.TakeFailures(), req.MaxErrors)
		if batch == nil {
			return out, nil
		}
		for _, item := range batch {
			out.StatementsRun++
			out.RowsImported += item.Rows
		}
		if onTick != nil {
			onTick(Tick{
				BytesRead: source.BytesRead(), TotalBytes: source.TotalBytes(),
				StatementsRun: out.StatementsRun, RowsImported: out.RowsImported,
				Errors: uint64(len(out.Failures)),
			})
		}
	}
}

func finishReport(report *Report, out Outcome, source BatchSource) {
	stats := source.Stats()
	report.Success = !out.Cancelled && len(out.Failures) == 0
	report.Cancelled = out.Cancelled
	report.RowsImported = out.RowsImported
	report.StatementsRun = out.StatementsRun
	report.Failures = out.Failures
	if report.Failures == nil {
		report.Failures = []Failure{}
	}
	report.FailuresTruncated = out.FailuresTruncated
	report.SkippedVersionComments = stats.SkippedVersionComments
	report.SkippedMetaCommands = stats.SkippedMetaCommands
	report.CopyRows = stats.CopyRows
	report.TablesTouched = source.TablesTouched()
	if report.TablesTouched == nil {
		report.TablesTouched = []string{}
	}
}

// createTargetTable creates the destination from the preview's inferred types.
func createTargetTable(
	ctx context.Context,
	pool *dbcore.Pool,
	db model.SupportedDB,
	table string,
	mappings []ColumnMapping,
) error {
	cols := make([]CreateColumn, 0, len(mappings))
	for _, m := range mappings {
		if m.Target == nil || *m.Target == "" {
			continue
		}
		sqlType := SQLTypeFor(m.ValueType, db)
		if m.SQLType != nil && strings.TrimSpace(*m.SQLType) != "" {
			sqlType = *m.SQLType
		}
		// Every column is nullable: the source is a flat file, and a NOT NULL
		// guess would reject rows the user asked to load.
		cols = append(cols, CreateColumn{Name: *m.Target, SQLType: sqlType, Nullable: true})
	}
	stmt, err := BuildCreateTable(db, table, cols)
	if err != nil {
		return err
	}
	if _, err := pool.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("could not create %s: %w", table, err)
	}
	return nil
}

// applyDeclaredTypes retypes the mapping from the real table and reports its
// primary key, which the conflict clauses need.
func applyDeclaredTypes(
	mappings []ColumnMapping,
	lookup ColumnLookup,
	table string,
) ([]ColumnMapping, []string, error) {
	target, err := lookup(table)
	if err != nil {
		// Not fatal: without the lookup the preview's guess is still usable, and
		// failing here would block an import over a permissions quirk.
		return mappings, nil, nil
	}

	byName := make(map[string]TargetColumn, len(target))
	var pk []string
	for _, c := range target {
		byName[strings.ToLower(c.Name)] = c
		if c.PrimaryKey {
			pk = append(pk, c.Name)
		}
	}

	out := make([]ColumnMapping, 0, len(mappings))
	for _, m := range mappings {
		if m.Target != nil {
			if c, ok := byName[strings.ToLower(*m.Target)]; ok {
				m.ValueType = ValueTypeFromSQLType(c.SQLType)
			}
		}
		out = append(out, m)
	}
	return out, pk, nil
}
