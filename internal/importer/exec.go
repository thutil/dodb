package importer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/model"
)

// ExecOptions configures one import run.
type ExecOptions struct {
	TxMode    TxMode
	OnError   OnError
	MaxErrors int
}

// Outcome is what an import run produced.
type Outcome struct {
	StatementsRun     uint64
	RowsImported      uint64
	Failures          []Failure
	FailuresTruncated bool
	Cancelled         bool
}

// Tick is a progress update.
type Tick struct {
	BytesRead     uint64
	TotalBytes    uint64
	StatementsRun uint64
	RowsImported  uint64
	Errors        uint64
}

// execer is one statement target: a bare connection, or a transaction on it.
type execer interface {
	exec(ctx context.Context, sql string) error
}

// Execute streams a source into the database.
//
// The whole run is pinned to ONE connection, not to the pool. Replaying a dump
// is a single session: `USE db`, `SET`, `LOCK TABLES` and Postgres' search_path
// all persist per connection, and letting the pool hand out a different one
// mid-file would silently drop those settings.
//
// Go's *sql.Conn and pgx.Conn make this one function. The Rust build needs the
// same body instantiated three times through a macro, because sqlx's Executor
// and Transaction types do not unify across drivers.
func Execute(
	ctx context.Context,
	pool *dbcore.Pool,
	source BatchSource,
	opts ExecOptions,
	onTick func(Tick),
) (Outcome, error) {
	if pool.Kind == model.Postgres {
		conn, err := pool.Postgres.Acquire(ctx)
		if err != nil {
			return Outcome{}, err
		}
		defer conn.Release()
		return runImport(ctx, &pgExecTarget{conn: conn.Conn()}, source, opts, onTick)
	}

	conn, err := pool.SQL.Conn(ctx)
	if err != nil {
		return Outcome{}, err
	}
	defer conn.Close()
	return runImport(ctx, &sqlExecTarget{conn: conn}, source, opts, onTick)
}

// execTarget is a connection that can open transactions.
type execTarget interface {
	execer
	begin(ctx context.Context) (txHandle, error)
}

type txHandle interface {
	execer
	commit(ctx context.Context) error
	rollback(ctx context.Context)
}

func runImport(
	ctx context.Context,
	target execTarget,
	source BatchSource,
	opts ExecOptions,
	onTick func(Tick),
) (Outcome, error) {
	var out Outcome

	// SingleTransaction holds one transaction open across every batch, so the
	// whole file is all-or-nothing.
	var outer txHandle
	if opts.TxMode == TxSingleTransaction {
		tx, err := target.begin(ctx)
		if err != nil {
			return out, err
		}
		outer = tx
	}

	rollbackOuter := func() {
		if outer != nil {
			outer.rollback(ctx)
			outer = nil
		}
	}

	for {
		if err := ctx.Err(); err != nil {
			// Cancelled by the user. An outer transaction is rolled back, so a
			// cancelled all-or-nothing run leaves nothing behind.
			rollbackOuter()
			out.Cancelled = true
			if opts.TxMode == TxSingleTransaction {
				out.RowsImported, out.StatementsRun = 0, 0
			}
			return out, nil
		}

		batch, err := source.NextBatch()
		if err != nil {
			rollbackOuter()
			return out, err
		}
		collectFailures(&out, source.TakeFailures(), opts.MaxErrors)

		if batch == nil {
			break
		}
		if len(batch) == 0 {
			// Every row in that window failed; keep reading.
			emitTick(onTick, source, &out)
			continue
		}

		if err := runBatch(ctx, target, outer, batch, opts, &out); err != nil {
			rollbackOuter()
			return out, err
		}
		emitTick(onTick, source, &out)
	}

	if outer != nil {
		if err := outer.commit(ctx); err != nil {
			return out, err
		}
	}
	return out, nil
}

// runBatch applies one batch under the configured transaction granularity.
func runBatch(
	ctx context.Context,
	target execTarget,
	outer txHandle,
	batch []BatchItem,
	opts ExecOptions,
	out *Outcome,
) error {
	// Inside a single outer transaction, or with no transaction at all, the
	// statements go straight to the target.
	if outer != nil || opts.TxMode == TxPerStatement {
		dest := execer(target)
		if outer != nil {
			dest = outer
		}
		for _, item := range batch {
			if err := applyOne(ctx, dest, item, opts, out); err != nil {
				return err
			}
		}
		return nil
	}

	// AtomicBatch: a failure rolls back only this batch's rows.
	tx, err := target.begin(ctx)
	if err != nil {
		return err
	}
	before := *out
	for _, item := range batch {
		if err := applyOne(ctx, tx, item, opts, out); err != nil {
			tx.rollback(ctx)
			return err
		}
	}
	if err := tx.commit(ctx); err != nil {
		// The batch did not land after all, so its counters must not stand.
		*out = before
		if opts.OnError == OnErrorAbort {
			return err
		}
		recordFailure(out, NewFailure(batch[0].Index, batch[0].Line, batch[0].SQL, err.Error()), opts.MaxErrors)
	}
	return nil
}

// applyOne runs a single statement, deciding whether a failure stops the run.
func applyOne(ctx context.Context, dest execer, item BatchItem, opts ExecOptions, out *Outcome) error {
	if err := dest.exec(ctx, item.SQL); err != nil {
		if opts.OnError == OnErrorAbort {
			return fmt.Errorf("%w\nSQL: %s", err, Excerpt(item.SQL, 400))
		}
		recordFailure(out, NewFailure(item.Index, item.Line, item.SQL, err.Error()), opts.MaxErrors)
		return nil
	}
	out.StatementsRun++
	out.RowsImported += item.Rows
	return nil
}

// recordFailure appends a failure up to the cap, then only counts them.
//
// Capped because the failure list travels to the UI: a file whose every row is
// malformed would otherwise ship half a million error objects into the webview.
func recordFailure(out *Outcome, f Failure, maxErrors int) {
	if len(out.Failures) < maxErrors {
		out.Failures = append(out.Failures, f)
		return
	}
	out.FailuresTruncated = true
}

func collectFailures(out *Outcome, incoming []Failure, maxErrors int) {
	for _, f := range incoming {
		recordFailure(out, f, maxErrors)
	}
}

func emitTick(onTick func(Tick), source BatchSource, out *Outcome) {
	if onTick == nil {
		return
	}
	onTick(Tick{
		BytesRead:     source.BytesRead(),
		TotalBytes:    source.TotalBytes(),
		StatementsRun: out.StatementsRun,
		RowsImported:  out.RowsImported,
		Errors:        uint64(len(out.Failures)),
	})
}

// ---- pgx target ----

type pgExecTarget struct{ conn *pgx.Conn }

func (t *pgExecTarget) exec(ctx context.Context, sql string) error {
	_, err := t.conn.Exec(ctx, sql)
	return err
}

func (t *pgExecTarget) begin(ctx context.Context) (txHandle, error) {
	tx, err := t.conn.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &pgTx{tx: tx}, nil
}

type pgTx struct{ tx pgx.Tx }

func (t *pgTx) exec(ctx context.Context, sql string) error {
	_, err := t.tx.Exec(ctx, sql)
	return err
}
func (t *pgTx) commit(ctx context.Context) error { return t.tx.Commit(ctx) }
func (t *pgTx) rollback(ctx context.Context) {
	// A rollback on an already-finished transaction is not a problem worth
	// reporting; the caller is already handling the real error.
	if err := t.tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		_ = err
	}
}

// ---- database/sql target ----

type sqlExecTarget struct{ conn *sql.Conn }

func (t *sqlExecTarget) exec(ctx context.Context, statement string) error {
	_, err := t.conn.ExecContext(ctx, statement)
	return err
}

func (t *sqlExecTarget) begin(ctx context.Context) (txHandle, error) {
	tx, err := t.conn.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	return &sqlTx{tx: tx}, nil
}

type sqlTx struct{ tx *sql.Tx }

func (t *sqlTx) exec(ctx context.Context, statement string) error {
	_, err := t.tx.ExecContext(ctx, statement)
	return err
}
func (t *sqlTx) commit(context.Context) error { return t.tx.Commit() }
func (t *sqlTx) rollback(context.Context) {
	if err := t.tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		_ = err
	}
}
