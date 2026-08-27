package api

import (
	"fmt"
	"sort"
	"strings"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
)

// countStarExpr is a COUNT(*) that decodes as a signed 64-bit integer on every
// dialect. MySQL's COUNT is BIGINT UNSIGNED, which the guard cannot read as a
// signed value without the cast.
func countStarExpr(db model.SupportedDB) string {
	switch db {
	case model.Postgres:
		return "COUNT(*)::bigint"
	case model.Mariadb:
		return "CAST(COUNT(*) AS SIGNED)"
	default:
		return "COUNT(*)"
	}
}

// buildCommitSteps turns the grid's staged changes into transaction steps.
//
// Every UPDATE and DELETE is preceded by a RequireOne guard on the identical
// WHERE clause, so a key that no longer matches exactly one row aborts the
// transaction rather than committing a statement that quietly touches nothing --
// or, worse, several rows.
//
// Returns the steps and, separately, just the DML in the same order as the
// affected-row counts reported back to the UI, since the guards produce no count.
func buildCommitSteps(db model.SupportedDB, table string, changes GridChanges) ([]dbcore.TxStep, []string, error) {
	tableIdent := dialect.QuoteTable(db, table)
	var steps []dbcore.TxStep
	var dml []string

	for _, row := range changes.Inserts {
		if len(row) == 0 {
			continue
		}
		// Sorted so a generated statement is stable across runs; Go map order is
		// randomised and an unstable statement makes the UI's query log useless.
		cols := sortedKeys(row)
		quoted := make([]string, 0, len(cols))
		values := make([]string, 0, len(cols))
		for _, col := range cols {
			quoted = append(quoted, dialect.QuoteColumn(db, col))
			values = append(values, dialect.FormatValue(db, row[col]))
		}
		sql := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)",
			tableIdent, strings.Join(quoted, ", "), strings.Join(values, ", "))
		dml = append(dml, sql)
		steps = append(steps, dbcore.Exec(sql))
	}

	for _, row := range changes.Updates {
		whereSQL, err := buildRowWhere(db, row.Keys)
		if err != nil {
			return nil, nil, err
		}
		if len(row.Data) == 0 {
			return nil, nil, fmt.Errorf("Update contains no changed columns")
		}
		cols := sortedKeys(row.Data)
		sets := make([]string, 0, len(cols))
		for _, col := range cols {
			sets = append(sets, dialect.QuoteColumn(db, col)+" = "+dialect.FormatValue(db, row.Data[col]))
		}

		steps = append(steps, dbcore.RequireOne(
			fmt.Sprintf("SELECT %s FROM %s WHERE %s", countStarExpr(db), tableIdent, whereSQL),
			fmt.Sprintf("UPDATE on %s", table),
		))
		sql := fmt.Sprintf("UPDATE %s SET %s WHERE %s", tableIdent, strings.Join(sets, ", "), whereSQL)
		dml = append(dml, sql)
		steps = append(steps, dbcore.Exec(sql))
	}

	for _, row := range changes.Deletes {
		whereSQL, err := buildRowWhere(db, row.Keys)
		if err != nil {
			return nil, nil, err
		}
		steps = append(steps, dbcore.RequireOne(
			fmt.Sprintf("SELECT %s FROM %s WHERE %s", countStarExpr(db), tableIdent, whereSQL),
			fmt.Sprintf("DELETE on %s", table),
		))
		sql := fmt.Sprintf("DELETE FROM %s WHERE %s", tableIdent, whereSQL)
		dml = append(dml, sql)
		steps = append(steps, dbcore.Exec(sql))
	}

	if len(dml) == 0 {
		return nil, nil, fmt.Errorf(
			"Nothing to commit: no statements were generated from the pending changes.")
	}
	return steps, dml, nil
}

// buildRowWhere identifies a row by the ORIGINAL values of its key columns.
//
// A NULL key becomes IS NULL rather than `= NULL`, which never matches -- and
// silently matching nothing is exactly what the RequireOne guard exists to catch.
func buildRowWhere(db model.SupportedDB, keys map[string]any) (string, error) {
	if len(keys) == 0 {
		return "", fmt.Errorf(
			"Cannot identify the row to change: the table has no primary key and no key values were sent.")
	}
	cols := sortedKeys(keys)
	clauses := make([]string, 0, len(cols))
	for _, col := range cols {
		ident := dialect.QuoteColumn(db, col)
		if keys[col] == nil {
			clauses = append(clauses, ident+" IS NULL")
			continue
		}
		clauses = append(clauses, ident+" = "+dialect.FormatValue(db, keys[col]))
	}
	return strings.Join(clauses, " AND "), nil
}

func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
