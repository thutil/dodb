package api

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/orderedjson"
)

// AdminUser is one row of the users panel.
type AdminUser struct {
	Username    string `json:"username"`
	Host        string `json:"host"`
	IsSuperuser bool   `json:"isSuperuser"`
	CanCreateDb bool   `json:"canCreateDb"`
}

// isValidHost restricts a MySQL host pattern to what can safely be interpolated.
//
// The host is spliced into `DROP USER x@'host'` and cannot be parameterised
// there, so anything outside this alphabet is refused rather than escaped: a
// host pattern has no legitimate reason to contain a quote.
func isValidHost(host string) bool {
	if host == "" {
		return false
	}
	for _, c := range host {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		case c == '.' || c == '_' || c == '%' || c == '-' || c == ':':
		default:
			return false
		}
	}
	return true
}

// AdminGetUsers lists server accounts. SQLite has none.
func (s *Service) AdminGetUsers(id, database string) ([]AdminUser, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return nil, err
	}
	if profile.Type == model.Sqlite {
		return []AdminUser{}, nil
	}
	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return nil, err
	}

	query := "SELECT usename::text AS username, '' AS host, usesuper AS is_superuser, usecreatedb AS can_create_db FROM pg_user ORDER BY usename"
	if profile.Type == model.Mariadb {
		query = "SELECT user AS username, host, (super_priv = 'Y') AS is_superuser, true AS can_create_db FROM mysql.user ORDER BY user"
	}

	rows, err := pool.Query(ctx(), query, nil)
	if err != nil {
		return nil, fmt.Errorf("Could not list users: %w", err)
	}
	out := make([]AdminUser, 0, len(rows))
	for _, row := range rows {
		username := asString(mustGet(row, "username"))
		if username == "" {
			continue
		}
		host := asString(mustGet(row, "host"))
		if host == "" {
			host = "%"
		}
		out = append(out, AdminUser{
			Username:    username,
			Host:        host,
			IsSuperuser: asBoolish(mustGet(row, "is_superuser")),
			CanCreateDb: asBoolish(mustGet(row, "can_create_db")),
		})
	}
	return out, nil
}

// AdminGetProcesses lists server activity, capped at 100 rows.
func (s *Service) AdminGetProcesses(id, database string) ([]*orderedjson.Object, error) {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return nil, err
	}

	if profile.Type == model.Sqlite {
		// SQLite is embedded, so there is no server to inspect. A synthetic row
		// keeps the panel meaningful rather than showing an empty table that
		// looks like a failed query.
		row := orderedjson.NewObject(6)
		row.Set("pid", "1")
		row.Set("user", "local")
		row.Set("db", database)
		row.Set("state", "active")
		row.Set("query", "<sqlite embedded engine>")
		row.Set("time", "0")
		return []*orderedjson.Object{row}, nil
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return nil, err
	}

	query := "SELECT pid::text AS pid, COALESCE(usename, '')::text AS user, COALESCE(datname, '')::text AS db, " +
		"COALESCE(state, 'active')::text AS state, COALESCE(NULLIF(TRIM(query), ''), '<idle>')::text AS query, " +
		"COALESCE(ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - query_start)))::text, '0') AS time " +
		"FROM pg_stat_activity ORDER BY query_start DESC NULLS LAST LIMIT 100"
	if profile.Type == model.Mariadb {
		query = "SELECT CAST(id AS CHAR) AS pid, user, COALESCE(db, '') AS db, command AS state, " +
			"COALESCE(info, '<idle>') AS query, CAST(COALESCE(time, 0) AS CHAR) AS time " +
			"FROM information_schema.processlist ORDER BY time DESC LIMIT 100"
	}

	rows, err := pool.Query(ctx(), query, nil)
	if err != nil {
		return nil, fmt.Errorf("Could not list processes: %w", err)
	}
	return rows, nil
}

// AdminCreateDatabase creates a database with optional charset and collation.
func (s *Service) AdminCreateDatabase(id, database, name, charset, collation string) error {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return err
	}
	clean := strings.TrimSpace(name)
	if clean == "" {
		return fmt.Errorf("Database name cannot be empty")
	}
	if profile.Type == model.Sqlite {
		// A SQLite database is a file; there is nothing to CREATE.
		return nil
	}

	cleanCharset := strings.TrimSpace(charset)
	cleanCollation := strings.TrimSpace(collation)

	var stmt string
	if profile.Type == model.Postgres {
		maintenance := "postgres"
		pool, err := s.DB.GetPool(ctx(), profile, maintenance)
		if err != nil {
			maintenance = "template1"
			pool, err = s.DB.GetPool(ctx(), profile, maintenance)
			if err != nil {
				return fmt.Errorf("could not connect to Postgres maintenance database: %w", err)
			}
		}
		stmt = `CREATE DATABASE "` + strings.ReplaceAll(clean, `"`, `""`) + `"`
		if cleanCharset != "" {
			stmt += " ENCODING '" + strings.ReplaceAll(cleanCharset, "'", "''") + "'"
		}
		if cleanCollation != "" {
			stmt += " LC_COLLATE '" + strings.ReplaceAll(cleanCollation, "'", "''") + "' LC_CTYPE '" + strings.ReplaceAll(cleanCollation, "'", "''") + "'"
		}
		if _, err := pool.Exec(ctx(), stmt); err != nil {
			return err
		}
	} else {
		pool, err := s.DB.GetPool(ctx(), profile, "information_schema")
		if err != nil {
			pool, err = s.DB.GetPool(ctx(), profile, "mysql")
			if err != nil {
				return fmt.Errorf("could not connect to MySQL server: %w", err)
			}
		}
		stmt = "CREATE DATABASE `" + strings.ReplaceAll(clean, "`", "``") + "`"
		if cleanCharset != "" {
			stmt += " CHARACTER SET `" + strings.ReplaceAll(cleanCharset, "`", "") + "`"
		}
		if cleanCollation != "" {
			stmt += " COLLATE `" + strings.ReplaceAll(cleanCollation, "`", "") + "`"
		}
		if _, err := pool.Exec(ctx(), stmt); err != nil {
			return err
		}
	}

	// The pool cache is keyed per database name, so a later connect to this
	// name must not reuse a pool opened before it existed.
	s.DB.ClosePools(profile.ID)
	return nil
}

// AdminDropDatabase drops a database.
func (s *Service) AdminDropDatabase(id, database, name string) error {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return err
	}
	clean := strings.TrimSpace(name)
	if clean == "" {
		return fmt.Errorf("Database name cannot be empty")
	}
	if profile.Type == model.Sqlite {
		return fmt.Errorf("SQLite databases cannot be dropped via SQL command")
	}

	// Our own pools must go first: Postgres refuses to drop a database that
	// still has connections, and one of them would be ours.
	s.DB.ClosePools(profile.ID)

	if profile.Type == model.Postgres {
		// In Postgres, you cannot be connected to the database being dropped.
		// Always connect to a maintenance database (postgres or template1).
		maintenance := "postgres"
		if strings.EqualFold(clean, "postgres") {
			maintenance = "template1"
		}
		pool, err := s.DB.GetPool(ctx(), profile, maintenance)
		if err != nil {
			maintenance = "template1"
			pool, err = s.DB.GetPool(ctx(), profile, maintenance)
			if err != nil {
				return fmt.Errorf("could not connect to Postgres maintenance database: %w", err)
			}
		}
		// Terminate all other sessions connected to this database.
		_, _ = pool.Query(ctx(), fmt.Sprintf(
			"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s' AND pid <> pg_backend_pid()",
			strings.ReplaceAll(clean, "'", "''")), nil)

		if _, err := pool.Exec(ctx(), `DROP DATABASE "`+strings.ReplaceAll(clean, `"`, `""`)+`"`); err != nil {
			return err
		}
	} else {
		// For MySQL / MariaDB, connect to information_schema or mysql system database
		pool, err := s.DB.GetPool(ctx(), profile, "information_schema")
		if err != nil {
			pool, err = s.DB.GetPool(ctx(), profile, "mysql")
			if err != nil {
				return fmt.Errorf("could not connect to MySQL server: %w", err)
			}
		}
		if _, err := pool.Exec(ctx(), "DROP DATABASE `"+strings.ReplaceAll(clean, "`", "``")+"`"); err != nil {
			return err
		}
	}

	s.DB.ClosePools(profile.ID)

	// If the profile's saved default database was this dropped database, reset it
	if strings.EqualFold(profile.Database, clean) {
		profile.Database = ""
		_, _ = s.SaveProfile(profile)
	}

	return nil
}

// AdminCreateUser creates a server account.
func (s *Service) AdminCreateUser(id, database, username, password string, isSuperuser bool) error {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return err
	}
	user := strings.TrimSpace(username)
	if user == "" {
		return fmt.Errorf("Username cannot be empty")
	}
	if password == "" {
		return fmt.Errorf("Password cannot be empty")
	}
	if profile.Type == model.Sqlite {
		return nil
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return err
	}
	// The password is escaped but NOT trimmed: trimming would give the account a
	// different password than the one the user typed.
	pw := dialect.EscapeLiteral(profile.Type, password)

	if profile.Type == model.Postgres {
		stmt := fmt.Sprintf(`CREATE USER "%s" WITH PASSWORD '%s'`, strings.ReplaceAll(user, `"`, `""`), pw)
		if isSuperuser {
			stmt += " SUPERUSER"
		}
		_, err := pool.Exec(ctx(), stmt)
		return err
	}

	escaped := strings.ReplaceAll(user, "`", "``")
	if _, err := pool.Exec(ctx(), fmt.Sprintf("CREATE USER `%s`@'%%' IDENTIFIED BY '%s'", escaped, pw)); err != nil {
		return err
	}
	if isSuperuser {
		if _, err := pool.Exec(ctx(), fmt.Sprintf(
			"GRANT ALL PRIVILEGES ON *.* TO `%s`@'%%' WITH GRANT OPTION", escaped)); err != nil {
			// The account exists but is not privileged; say so rather than
			// letting the caller think nothing happened.
			return fmt.Errorf("User %s was created but the privilege grant failed: %w", user, err)
		}
	}
	return nil
}

// AdminDropUser removes a server account.
func (s *Service) AdminDropUser(id, database, username, host string) error {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return err
	}
	user := strings.TrimSpace(username)
	if user == "" {
		return fmt.Errorf("Username cannot be empty")
	}
	if profile.Type == model.Sqlite {
		return nil
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return err
	}
	if profile.Type == model.Postgres {
		_, err := pool.Exec(ctx(), `DROP USER "`+strings.ReplaceAll(user, `"`, `""`)+`"`)
		return err
	}

	if host == "" {
		host = "%"
	}
	if !isValidHost(host) {
		return fmt.Errorf("'%s' is not a valid host pattern.", host)
	}
	_, err = pool.Exec(ctx(), fmt.Sprintf("DROP USER `%s`@'%s'",
		strings.ReplaceAll(user, "`", "``"), host))
	return err
}

// AdminKillProcess terminates a server session.
func (s *Service) AdminKillProcess(id, database, pid string) error {
	profile, err := s.DB.ResolveProfile(id)
	if err != nil {
		return err
	}
	// Parsed as a number rather than escaped: this goes into the statement bare,
	// and a pid is always an integer.
	n, err := strconv.ParseInt(strings.TrimSpace(pid), 10, 64)
	if err != nil {
		return fmt.Errorf("'%s' is not a valid process id.", pid)
	}
	if profile.Type == model.Sqlite {
		return nil
	}

	pool, err := s.DB.GetPool(ctx(), profile, database)
	if err != nil {
		return err
	}
	if profile.Type == model.Postgres {
		_, err := pool.Query(ctx(), fmt.Sprintf("SELECT pg_terminate_backend(%d)", n), nil)
		return err
	}
	_, err = pool.Exec(ctx(), fmt.Sprintf("KILL %d", n))
	return err
}
