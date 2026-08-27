package dbcore

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
)

// Development aid: what does each driver actually report? The critical question
// is whether go-sql-driver can tell a BOOLEAN (tinyint(1)) from a plain TINYINT,
// which sqlx distinguishes and is_boolean_column depends on.
func TestProbeMySQLTypes(t *testing.T) {
	if os.Getenv("DODB_PROBE") == "" {
		t.Skip("set DODB_PROBE=1")
	}
	db, err := sql.Open("mysql", "root:dodb@tcp(127.0.0.1:53306)/dodb_fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	probeSQL(t, db, "SELECT * FROM hazards WHERE id = 1")
	probeSQL(t, db, "SELECT * FROM ts_precision WHERE id = 2")
	probeSQL(t, db, "SELECT COUNT(*) FROM hazards")

	// MariaDB implements JSON as an alias for LONGTEXT, so the same query can
	// report a different column type there.
	mdb, err := sql.Open("mysql", "root:dodb@tcp(127.0.0.1:53307)/dodb_fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer mdb.Close()
	t.Log("---- MariaDB ----")
	probeSQL(t, mdb, "SELECT id, doc, feeling, plain_text FROM hazards WHERE id = 1")
}

func TestProbeSQLiteTypes(t *testing.T) {
	if os.Getenv("DODB_PROBE") == "" {
		t.Skip("set DODB_PROBE=1")
	}
	abs, _ := filepath.Abs(repoPath("testdata", "fixtures", "fixture.sqlite"))
	db, err := sql.Open("sqlite3", abs)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	probeSQL(t, db, "SELECT * FROM hazards WHERE id = 1")
	probeSQL(t, db, "SELECT COUNT(*) FROM hazards")
}

func probeSQL(t *testing.T, db *sql.DB, query string) {
	t.Helper()
	t.Logf("=== %s", query)
	rows, err := db.Query(query)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	defer rows.Close()
	cts, err := rows.ColumnTypes()
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		dest := make([]any, len(cts))
		holders := make([]any, len(cts))
		for i := range dest {
			holders[i] = new(any)
			dest[i] = holders[i]
		}
		if err := rows.Scan(dest...); err != nil {
			t.Fatalf("scan: %v", err)
		}
		for i, ct := range cts {
			nullable, _ := ct.Nullable()
			prec, scale, hasPS := ct.DecimalSize()
			length, hasLen := ct.Length()
			v := *(holders[i].(*any))
			t.Logf("  %-14s dbType=%-12s scan=%-18v nullable=%-5v ps=(%d,%d,%v) len=(%d,%v) go=%-14T val=%s",
				ct.Name(), ct.DatabaseTypeName(), ct.ScanType(), nullable,
				prec, scale, hasPS, length, hasLen, v, truncate(fmt.Sprintf("%v", v)))
		}
	}
}
