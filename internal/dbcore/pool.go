package dbcore

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/mattn/go-sqlite3"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/orderedjson"
	"github.com/thutil/dodb/internal/profilestore"
)

// SessionIDPrefix marks a connection that was never saved to disk.
const SessionIDPrefix = "session-"

// ConnectionTimeout matches CONNECTION_TIMEOUT_SECS.
const ConnectionTimeout = 180 * time.Second

// Pool is one live connection pool. Exactly one field is non-nil.
//
// A tagged struct rather than an interface: the three engines differ in enough
// places (row decoding, transaction semantics, identifier quoting) that hiding
// which one you have behind an interface only moves the switch elsewhere.
type Pool struct {
	Kind     model.SupportedDB
	Postgres *pgxpool.Pool
	SQL      *sql.DB // MySQL/MariaDB or SQLite

	// hints caches information_schema lookups for the MySQL family, where the
	// wire protocol does not report enough to decode tinyint(1) or MariaDB JSON.
	hints *hintCache
}

// Close releases the pool.
func (p *Pool) Close() {
	switch {
	case p == nil:
	case p.Postgres != nil:
		p.Postgres.Close()
	case p.SQL != nil:
		_ = p.SQL.Close()
	}
}

// State holds everything a running dodb knows about connections.
//
// Replaces the four Mutex<HashMap> fields of the Rust DbState. Kept as one
// struct with its own lock per map so a slow connect does not block an unrelated
// profile lookup.
type State struct {
	poolsMu sync.Mutex
	pools   map[string]*Pool

	sessionMu sync.Mutex
	sessions  map[string]model.ConnectionProfile

	passwordMu sync.Mutex
	passwords  map[string]string

	hintMu sync.Mutex
	hints  map[string]PgConnectHint
}

// NewState returns an empty State.
func NewState() *State {
	return &State{
		pools:     map[string]*Pool{},
		sessions:  map[string]model.ConnectionProfile{},
		passwords: map[string]string{},
		hints:     map[string]PgConnectHint{},
	}
}

// RegisterSession stores an unsaved connection for the life of the process.
func (s *State) RegisterSession(p model.ConnectionProfile) {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	s.sessions[p.ID] = p
}

// UnregisterSession forgets an unsaved connection.
func (s *State) UnregisterSession(id string) {
	s.sessionMu.Lock()
	defer s.sessionMu.Unlock()
	delete(s.sessions, id)
}

// SetRuntimePassword stashes a password for a profile that opted out of saving.
func (s *State) SetRuntimePassword(id, password string) {
	s.passwordMu.Lock()
	defer s.passwordMu.Unlock()
	s.passwords[id] = password
}

// ClearRuntimePassword forgets one stashed password, or all of them when id is empty.
func (s *State) ClearRuntimePassword(id string) {
	s.passwordMu.Lock()
	defer s.passwordMu.Unlock()
	if strings.TrimSpace(id) == "" {
		s.passwords = map[string]string{}
		return
	}
	delete(s.passwords, id)
}

// ResolveProfile finds the connection a command should use.
//
// Session connections are checked before the profiles on disk so an unsaved
// connection behaves exactly like a saved one everywhere downstream.
func (s *State) ResolveProfile(id string) (model.ConnectionProfile, error) {
	if strings.TrimSpace(id) == "" {
		return model.ConnectionProfile{}, fmt.Errorf(
			"No connection was selected. Open the connection dialog and connect first.")
	}

	s.sessionMu.Lock()
	if p, ok := s.sessions[id]; ok {
		s.sessionMu.Unlock()
		return p, nil
	}
	s.sessionMu.Unlock()

	saved, err := profilestore.Load()
	if err != nil {
		return model.ConnectionProfile{}, err
	}
	for _, p := range saved {
		if p.ID != id {
			continue
		}
		if p.Password == "" {
			// A profile that opted out of saving still needs the password the
			// user typed this session.
			s.passwordMu.Lock()
			if pw, ok := s.passwords[id]; ok {
				p.Password = pw
			}
			s.passwordMu.Unlock()
		}
		return p, nil
	}

	if strings.HasPrefix(id, SessionIDPrefix) {
		return model.ConnectionProfile{}, fmt.Errorf(
			"Connection '%s' is gone. Unsaved connections only live while the app is running - "+
				"open the connection dialog and connect again.", id)
	}
	return model.ConnectionProfile{}, fmt.Errorf(
		"Connection '%s' not found. It may have been deleted - pick it again in the connection dialog.", id)
}

// resolveDatabase applies the same defaults as get_pool_in: an explicit override
// wins, then the profile's own database, then the engine's admin database.
func resolveDatabase(profile model.ConnectionProfile, override string) string {
	if o := strings.TrimSpace(override); o != "" {
		return o
	}
	if d := strings.TrimSpace(profile.Database); d != "" {
		return d
	}
	switch profile.Type {
	case model.Postgres:
		return "postgres"
	case model.Mariadb:
		return "mysql"
	default:
		return ""
	}
}

// sqlitePath resolves which file to open: an explicit database name that is not
// a placeholder, else the profile's file, else an in-memory database.
func sqlitePath(profile model.ConnectionProfile, dbName string) string {
	if dbName != "" && dbName != "main" && dbName != ":memory:" {
		return dbName
	}
	if profile.FilePath != nil && *profile.FilePath != "" {
		return *profile.FilePath
	}
	return ":memory:"
}

// poolCacheKey identifies a pool. Everything that changes where the connection
// goes is in the key, so editing a profile's host cannot hand back the old pool.
func poolCacheKey(profile model.ConnectionProfile, dbName string) string {
	if profile.Type == model.Sqlite {
		return profile.ID + ":sqlite:" + sqlitePath(profile, dbName)
	}
	return strings.Join([]string{
		profile.ID, profile.Host, strconv.Itoa(int(profile.Port)),
		profile.User, string(profile.Type), dbName,
	}, ":")
}

// GetPool returns a cached pool or opens one.
func (s *State) GetPool(ctx context.Context, profile model.ConnectionProfile, databaseOverride string) (*Pool, error) {
	dbName := resolveDatabase(profile, databaseOverride)
	key := poolCacheKey(profile, dbName)

	s.poolsMu.Lock()
	if p, ok := s.pools[key]; ok {
		s.poolsMu.Unlock()
		return p, nil
	}
	s.poolsMu.Unlock()

	pool, err := s.openPool(ctx, profile, dbName)
	if err != nil {
		return nil, err
	}

	s.poolsMu.Lock()
	defer s.poolsMu.Unlock()
	// Another goroutine may have opened the same pool while this one connected.
	if existing, ok := s.pools[key]; ok {
		pool.Close()
		return existing, nil
	}
	s.pools[key] = pool
	return pool, nil
}

func (s *State) openPool(ctx context.Context, profile model.ConnectionProfile, dbName string) (*Pool, error) {
	switch profile.Type {
	case model.Postgres:
		serverKey := strings.TrimSpace(profile.Host) + ":" + strconv.Itoa(int(profile.Port))

		s.hintMu.Lock()
		hint, hasHint := s.hints[serverKey]
		s.hintMu.Unlock()

		var hintPtr *PgConnectHint
		if hasHint {
			hintPtr = &hint
		}

		pool, used, err := connectPostgresWithFallback(ctx, profile, dbName, hintPtr, tunePgPool(profile.KeepAlive))
		if err != nil {
			// A cached combination that stopped working must not pin the ladder
			// to a bad starting point forever.
			if hasHint {
				s.hintMu.Lock()
				delete(s.hints, serverKey)
				s.hintMu.Unlock()
			}
			return nil, err
		}
		s.hintMu.Lock()
		s.hints[serverKey] = used
		s.hintMu.Unlock()

		return &Pool{Kind: model.Postgres, Postgres: pool, hints: newHintCache()}, nil

	case model.Mariadb:
		// charset and loc are pinned rather than left to the server: the
		// fixtures showed that a latin1 connection double-encodes UTF-8, and a
		// non-UTC loc would shift every timestamp the decoder re-renders.
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&loc=UTC&parseTime=false",
			profile.User, profile.Password, strings.TrimSpace(profile.Host), profile.Port, dbName)
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return nil, fmt.Errorf("Failed to connect to MySQL database '%s': %w", dbName, err)
		}
		tuneSQLPool(db, profile.KeepAlive)
		if err := pingWithTimeout(ctx, db); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("Failed to connect to MySQL database '%s': %w", dbName, err)
		}
		return &Pool{Kind: model.Mariadb, SQL: db, hints: newHintCache()}, nil

	default:
		path := sqlitePath(profile, dbName)
		// _enable_load_extension is what lets SpatiaLite be loaded later; the
		// pure-Go SQLite driver cannot do this at all, which is why this build
		// needs CGO.
		dsn := path + "?_enable_load_extension=1&_busy_timeout=5000"
		db, err := sql.Open("sqlite3", dsn)
		if err != nil {
			return nil, fmt.Errorf("Failed to open SQLite database '%s': %w", path, err)
		}
		tuneSQLPool(db, profile.KeepAlive)
		if err := pingWithTimeout(ctx, db); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("Failed to open SQLite database '%s': %w", path, err)
		}
		return &Pool{Kind: model.Sqlite, SQL: db, hints: newHintCache()}, nil
	}
}

func tuneSQLPool(db *sql.DB, keepAlive bool) {
	db.SetMaxOpenConns(5)
	if keepAlive {
		db.SetMaxIdleConns(1)
		db.SetConnMaxIdleTime(0)
		db.SetConnMaxLifetime(0)
	}
}

func pingWithTimeout(ctx context.Context, db *sql.DB) error {
	ctx, cancel := context.WithTimeout(ctx, ConnectionTimeout)
	defer cancel()
	return db.PingContext(ctx)
}

// ClosePools closes the pools for one profile, or every pool when id is empty.
func (s *State) ClosePools(id string) {
	var doomed []*Pool

	s.poolsMu.Lock()
	if trimmed := strings.TrimSpace(id); trimmed != "" {
		prefix := trimmed + ":"
		for key, pool := range s.pools {
			if strings.HasPrefix(key, prefix) {
				doomed = append(doomed, pool)
				delete(s.pools, key)
			}
		}
	} else {
		for key, pool := range s.pools {
			doomed = append(doomed, pool)
			delete(s.pools, key)
		}
	}
	s.poolsMu.Unlock()

	// Closed outside the lock: closing waits for in-flight queries to finish,
	// and holding the map lock through that would stall every other connection.
	for _, pool := range doomed {
		pool.Close()
	}
}

// ColumnHintsFor resolves the metadata the MySQL wire protocol withholds,
// caching per table. Returns nil for engines that need no hints.
func (p *Pool) ColumnHintsFor(schema, table string) ColumnHints {
	if p.Kind != model.Mariadb || p.SQL == nil || strings.TrimSpace(table) == "" {
		return nil
	}
	if cached, ok := p.hints.lookup(schema, table); ok {
		return cached
	}
	hints, err := mysqlColumnHints(p.SQL, schema, table)
	if err != nil {
		// Metadata is an enhancement, not a requirement: a permission-restricted
		// user who cannot read information_schema still gets their rows, just
		// with tinyint(1) rendered numerically.
		return nil
	}
	p.hints.store(schema, table, hints)
	return hints
}

// InvalidateHints drops cached column metadata after DDL.
func (p *Pool) InvalidateHints(schema, table string) {
	if p.hints != nil {
		p.hints.Invalidate(schema, table)
	}
}

// Query runs a statement and decodes its rows.
func (p *Pool) Query(ctx context.Context, sql string, hints ColumnHints) ([]*orderedjson.Object, error) {
	switch p.Kind {
	case model.Postgres:
		return queryPostgres(ctx, p.Postgres, sql)
	case model.Mariadb:
		return queryMySQL(p.SQL, sql, hints)
	default:
		return querySQLite(p.SQL, sql)
	}
}

// Exec runs a statement that returns no rows and reports how many it affected.
func (p *Pool) Exec(ctx context.Context, statement string) (int64, error) {
	if p.Kind == model.Postgres {
		tag, err := p.Postgres.Exec(ctx, statement)
		if err != nil {
			return 0, err
		}
		return tag.RowsAffected(), nil
	}
	res, err := p.SQL.ExecContext(ctx, statement)
	if err != nil {
		return 0, err
	}
	// Not every driver reports this; a missing count is not an error.
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return n, nil
}
