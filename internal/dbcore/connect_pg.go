package dbcore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thutil/dodb/internal/model"
)

// The connect ladder from db_core.rs:98-201.
//
// sqlx hardcodes TimeZone=UTC in the Postgres startup message, and a server
// whose time zone files cannot resolve that name rejects the connection
// outright -- which is why the Rust build carries a patched fork of sqlx just to
// make the parameter settable. pgx exposes RuntimeParams directly, so the fork
// disappears here, but the ladder itself must stay: the servers that need it are
// still out there.
var (
	pgSSLModes  = []string{"prefer", "disable"}
	pgTimezones = []string{"UTC", "UTC0", "Etc/UTC", ""}
)

// PgConnectHint remembers the (ssl, timezone) pair that worked for a server, so
// the next database on the same host skips straight to it.
type PgConnectHint struct {
	SSL int
	TZ  int
}

type connectRetry int

const (
	retryFatal connectRetry = iota
	retrySSL
	retryTimeZone
)

// classifyPgError decides whether a failure is worth another rung of the ladder.
//
// The authentication and permission SQLSTATEs are fatal on purpose: retrying
// them would multiply every failed attempt by eight and can trip an account
// lockout policy, turning a mistyped password into a locked account.
func classifyPgError(err error) connectRetry {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "28P01", // invalid_password
			"28000", // invalid_authorization_specification
			"3D000", // invalid_catalog_name
			"42501": // insufficient_privilege
			return retryFatal
		}
		if strings.Contains(pgErr.Message, "TimeZone") || strings.Contains(pgErr.Message, "time zone") {
			return retryTimeZone
		}
		return retryFatal
	}

	msg := strings.ToLower(err.Error())
	for _, needle := range []string{"sslrequest", "tls", "ssl", "0x5a"} {
		if strings.Contains(msg, needle) {
			return retrySSL
		}
	}
	return retryFatal
}

// connectPostgresWithFallback walks the ssl x timezone ladder and reports which
// rung succeeded.
func connectPostgresWithFallback(
	ctx context.Context,
	profile model.ConnectionProfile,
	dbName string,
	hint *PgConnectHint,
	tune func(*pgxpool.Config),
) (*pgxpool.Pool, PgConnectHint, error) {
	sslIdx, tzIdx := 0, 0
	if hint != nil {
		sslIdx = min(hint.SSL, len(pgSSLModes)-1)
		tzIdx = min(hint.TZ, len(pgTimezones)-1)
	}

	var lastErr error
	timezoneRejected := false

	for tzIdx < len(pgTimezones) {
		cfg, err := pgPoolConfig(profile, dbName, pgSSLModes[sslIdx], pgTimezones[tzIdx])
		if err != nil {
			return nil, PgConnectHint{}, fmt.Errorf(
				"Failed to connect to Postgres database '%s': %w", dbName, err)
		}
		if tune != nil {
			tune(cfg)
		}

		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			// NewWithConfig is lazy, so force a real connection before calling
			// this rung a success -- otherwise every rung "works" and the
			// failure surfaces later as a query error.
			err = pool.Ping(ctx)
			if err == nil {
				return pool, PgConnectHint{SSL: sslIdx, TZ: tzIdx}, nil
			}
			pool.Close()
		}

		lastErr = err
		switch classifyPgError(err) {
		case retryFatal:
			tzIdx = len(pgTimezones) // break out
		case retrySSL:
			if sslIdx+1 >= len(pgSSLModes) {
				tzIdx = len(pgTimezones)
			} else {
				sslIdx++
			}
		case retryTimeZone:
			timezoneRejected = true
			tzIdx++
		}
	}

	return nil, PgConnectHint{}, pgConnectError(dbName, lastErr, timezoneRejected)
}

func pgConnectError(dbName string, lastErr error, timezoneRejected bool) error {
	detail := "no connection attempt was made"
	if lastErr != nil {
		detail = lastErr.Error()
	}
	if timezoneRejected {
		return fmt.Errorf(
			"Failed to connect to Postgres database '%s': the server rejected every time zone "+
				"setting (UTC, UTC0, Etc/UTC, and the server's own default). Its PostgreSQL time zone "+
				"data files are most likely missing or corrupt - ask the DBA to reinstall them. "+
				"Last error: %s", dbName, detail)
	}
	return fmt.Errorf("Failed to connect to Postgres database '%s': %s", dbName, detail)
}

// pgPoolConfig builds a config with no pgpass lookup, matching
// PgConnectOptions::new_without_pgpass.
func pgPoolConfig(profile model.ConnectionProfile, dbName, sslMode, timezone string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, err
	}
	cc := cfg.ConnConfig
	cc.Host = strings.TrimSpace(profile.Host)
	cc.Port = profile.Port
	cc.User = profile.User
	cc.Password = profile.Password
	cc.Database = dbName
	if cc.RuntimeParams == nil {
		cc.RuntimeParams = map[string]string{}
	}
	cc.RuntimeParams["application_name"] = "dodb"
	if timezone != "" {
		// The whole reason the Rust build needs a forked sqlx.
		cc.RuntimeParams["TimeZone"] = timezone
	}
	// ParseConfig("") reads no pgpass file, matching
	// PgConnectOptions::new_without_pgpass: a profile with a blank password must
	// fail as configured rather than silently picking up an unrelated credential.

	if sslMode == "disable" {
		// Ask for plaintext outright, and drop the TLS fallbacks so the ladder
		// -- not pgx -- decides what to try next.
		cc.TLSConfig = nil
		cc.Fallbacks = nil
	}
	// "prefer" is pgx's own default: attempt TLS, fall back to plaintext via the
	// fallbacks ParseConfig installed.

	cfg.MaxConns = 5
	return cfg, nil
}

// tunePgPool mirrors tune_pool: a keep-alive profile holds a warm connection and
// validates it before handing it out, so a dropped link reconnects instead of
// surfacing as a query error.
func tunePgPool(keepAlive bool) func(*pgxpool.Config) {
	return func(cfg *pgxpool.Config) {
		cfg.MaxConns = 5
		if keepAlive {
			cfg.MinConns = 1
			cfg.MaxConnIdleTime = 0
			cfg.MaxConnLifetime = 0
			cfg.HealthCheckPeriod = 30 * time.Second
		}
	}
}
