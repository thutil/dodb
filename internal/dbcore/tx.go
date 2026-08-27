package dbcore

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/thutil/dodb/internal/model"
)

// StepKind distinguishes the two things a write transaction does.
type StepKind int

const (
	// StepExec runs a statement and records how many rows it touched.
	StepExec StepKind = iota
	// StepRequireOne runs a COUNT guard and aborts unless it matches exactly one row.
	StepRequireOne
)

// TxStep is one step inside a write transaction.
//
// StepRequireOne exists because rows_affected alone cannot tell "no such row"
// from "the row already held this value" on MySQL/MariaDB, which report CHANGED
// rows rather than MATCHED rows. Without the guard, editing a cell to its
// current value looks identical to editing a row that no longer exists -- and a
// non-unique key would silently overwrite several rows while reporting one.
type TxStep struct {
	Kind StepKind
	SQL  string
	// Label names the target row in the error message for a failed guard.
	Label string
}

// Exec builds a statement step.
func Exec(sql string) TxStep { return TxStep{Kind: StepExec, SQL: sql} }

// RequireOne builds a guard step.
func RequireOne(sql, label string) TxStep {
	return TxStep{Kind: StepRequireOne, SQL: sql, Label: label}
}

// ExecuteTransaction runs every step in one transaction and returns the rows
// affected by each StepExec, in order. Any error -- including a failed guard --
// rolls the whole thing back.
//
// Go's *sql.Tx and pgx.Tx make this one function; the Rust build needs the same
// body instantiated three times through a macro because sqlx's Executor and
// Transaction types do not unify across drivers.
func ExecuteTransaction(ctx context.Context, pool *Pool, steps []TxStep) ([]int64, error) {
	if pool.Kind == model.Postgres {
		return executeTxPostgres(ctx, pool, steps)
	}
	return executeTxSQL(ctx, pool, steps)
}

func executeTxPostgres(ctx context.Context, pool *Pool, steps []TxStep) ([]int64, error) {
	tx, err := pool.Postgres.Begin(ctx)
	if err != nil {
		return nil, err
	}
	affected := make([]int64, 0, len(steps))

	for _, step := range steps {
		switch step.Kind {
		case StepExec:
			tag, err := tx.Exec(ctx, step.SQL)
			if err != nil {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("%w\nSQL: %s", err, step.SQL)
			}
			affected = append(affected, tag.RowsAffected())
		case StepRequireOne:
			var raw any
			if err := tx.QueryRow(ctx, step.SQL).Scan(&raw); err != nil {
				_ = tx.Rollback(ctx)
				if err == pgx.ErrNoRows {
					return nil, guardError(step, 0)
				}
				return nil, fmt.Errorf("%w\nSQL: %s", err, step.SQL)
			}
			count, ok := countFromScan(raw)
			if !ok {
				_ = tx.Rollback(ctx)
				return nil, fmt.Errorf("Could not verify target row\nSQL: %s", step.SQL)
			}
			if count != 1 {
				_ = tx.Rollback(ctx)
				return nil, guardError(step, count)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return affected, nil
}

func executeTxSQL(ctx context.Context, pool *Pool, steps []TxStep) ([]int64, error) {
	tx, err := pool.SQL.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	affected := make([]int64, 0, len(steps))

	for _, step := range steps {
		switch step.Kind {
		case StepExec:
			res, err := tx.ExecContext(ctx, step.SQL)
			if err != nil {
				_ = tx.Rollback()
				return nil, fmt.Errorf("%w\nSQL: %s", err, step.SQL)
			}
			n, err := res.RowsAffected()
			if err != nil {
				n = 0
			}
			affected = append(affected, n)
		case StepRequireOne:
			var raw any
			if err := tx.QueryRowContext(ctx, step.SQL).Scan(&raw); err != nil {
				_ = tx.Rollback()
				if err == sql.ErrNoRows {
					return nil, guardError(step, 0)
				}
				return nil, fmt.Errorf("%w\nSQL: %s", err, step.SQL)
			}
			count, ok := countFromScan(raw)
			if !ok {
				_ = tx.Rollback()
				return nil, fmt.Errorf("Could not verify target row\nSQL: %s", step.SQL)
			}
			if count != 1 {
				_ = tx.Rollback()
				return nil, guardError(step, count)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return affected, nil
}

// countFromScan reads a COUNT(*) whatever shape the driver gave it: MySQL sends
// BIGINT UNSIGNED, SQLite an int64, and a driver may hand back the digits as text.
func countFromScan(raw any) (int64, bool) {
	if n, ok := asInt64(raw); ok {
		return n, true
	}
	switch t := raw.(type) {
	case float64:
		return int64(t), true
	case []byte:
		n, err := strconv.ParseInt(string(t), 10, 64)
		return n, err == nil
	}
	return 0, false
}

// guardError explains a failed guard in terms of what the user was trying to do,
// and states plainly that nothing was written.
func guardError(step TxStep, count int64) error {
	if count == 0 {
		return fmt.Errorf(
			"%s matched 0 rows - the row no longer exists or the key columns are wrong. "+
				"Transaction rolled back, nothing was written.\nSQL: %s", step.Label, step.SQL)
	}
	return fmt.Errorf(
		"%s matched %d rows - the key is not unique, so this would overwrite other rows. "+
			"Transaction rolled back, nothing was written.\nSQL: %s", step.Label, count, step.SQL)
}
