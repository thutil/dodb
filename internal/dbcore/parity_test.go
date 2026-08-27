package dbcore

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/mattn/go-sqlite3"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/orderedjson"
)

// The parity suite. Every expected value in testdata/golden/queries.json was
// produced by db_core::execute_query in the shipping Rust build, against the
// same fixture databases these tests connect to. A diff here is a behaviour
// change the frontend would see.
//
//	docker compose -f testdata/docker-compose.yml up -d
//	go test ./internal/dbcore -run TestParity

type queryCase struct {
	Name    string   `json:"name"`
	Why     string   `json:"why"`
	Targets []string `json:"targets"`
	SQL     string   `json:"sql"`
	// Table, when set, marks a case that models the table-scoped get_rows path,
	// where the backend can consult information_schema for column metadata.
	Table string `json:"table"`
}

type goldenResult struct {
	Target string            `json:"target"`
	Case   string            `json:"case"`
	SQL    string            `json:"sql"`
	Rows   []json.RawMessage `json:"rows"`
}

func repoPath(parts ...string) string {
	return filepath.Join(append([]string{"..", ".."}, parts...)...)
}

func loadCases(t *testing.T) []queryCase {
	t.Helper()
	raw, err := os.ReadFile(repoPath("testdata", "queries.json"))
	if err != nil {
		t.Fatalf("read queries.json: %v", err)
	}
	var spec struct {
		Cases []queryCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse queries.json: %v", err)
	}
	return spec.Cases
}

func loadGoldenResults(t *testing.T) map[string]goldenResult {
	t.Helper()
	raw, err := os.ReadFile(repoPath("testdata", "golden", "queries.json"))
	if err != nil {
		t.Fatalf("read golden queries.json: %v", err)
	}
	var doc struct {
		Results []goldenResult `json:"results"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse golden: %v", err)
	}
	out := map[string]goldenResult{}
	for _, r := range doc.Results {
		out[r.Target+"/"+r.Case] = r
	}
	if len(out) == 0 {
		t.Fatal("golden file has no results")
	}
	return out
}

func appliesTo(c queryCase, target string) bool {
	for _, t := range c.Targets {
		if t == target {
			return true
		}
	}
	return false
}

// fixtureProfile mirrors the profiles in src-tauri/examples/gen_query_golden.rs.
func fixtureProfile(t *testing.T, target string) model.ConnectionProfile {
	t.Helper()
	p := model.NewConnectionProfile()
	p.ID = "fixture-" + target
	p.Name = target
	switch target {
	case "postgres":
		p.Type = model.Postgres
		p.Host, p.Port, p.User, p.Password, p.Database = "127.0.0.1", 55432, "dodb", "dodb", "dodb_fixture"
	case "mysql":
		p.Type = model.Mariadb
		p.Host, p.Port, p.User, p.Password, p.Database = "127.0.0.1", 53306, "root", "dodb", "dodb_fixture"
	case "mariadb":
		p.Type = model.Mariadb
		p.Host, p.Port, p.User, p.Password, p.Database = "127.0.0.1", 53307, "root", "dodb", "dodb_fixture"
	case "sqlite":
		p.Type = model.Sqlite
		abs, err := filepath.Abs(repoPath("testdata", "fixtures", "fixture.sqlite"))
		if err != nil {
			t.Fatal(err)
		}
		p.FilePath = &abs
	default:
		t.Fatalf("unknown target %q", target)
	}
	return p
}

// compareRows diffs decoded rows against the golden, reporting the first
// mismatch per column rather than dumping whole result sets.
func compareRows(t *testing.T, got []*orderedjson.Object, want []json.RawMessage) {
	t.Helper()
	if len(got) != len(want) {
		t.Errorf("row count: got %d, want %d", len(got), len(want))
	}
	n := min(len(got), len(want))
	for i := 0; i < n; i++ {
		gotJSON, err := orderedjson.Marshal(got[i])
		if err != nil {
			t.Fatalf("row %d: marshal: %v", i, err)
		}
		// Compare as canonical text so key ORDER is part of the assertion:
		// the frontend renders DataGrid columns in the order they arrive.
		wantText := canonical(t, want[i])
		gotText := canonical(t, gotJSON)
		if gotText == wantText {
			continue
		}
		t.Errorf("row %d differs:\n  got  %s\n  want %s", i, gotText, wantText)
		reportFieldDiffs(t, i, gotJSON, want[i])
	}
}

// canonical re-encodes without reordering, so whitespace and the spelling of a
// number are ignored but key order is not.
func canonical(t *testing.T, raw []byte) string {
	t.Helper()
	obj := orderedjson.NewObject(0)
	if err := obj.UnmarshalJSON(raw); err != nil {
		return string(raw)
	}
	out, err := orderedjson.Marshal(normalizeNumbers(obj))
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

// normalizeNumbers rewrites every JSON number to one canonical spelling.
//
// This is the one relaxation in the parity comparison, and it is sound: serde_json
// formats floats with ryu and Go uses strconv, and while both emit the shortest
// text that round-trips to the same float64, they disagree on when to write a
// trailing ".0" and when to switch to exponent notation -- Rust prints 0.0 and
// 12345678901234.568 where Go prints 0 and 1.2345678901234568e+13. Every such
// pair parses to the identical float64, so JSON.parse in the webview yields the
// identical JS number and no frontend code can tell them apart.
//
// It deliberately does NOT loosen anything else. Integers are compared as
// integers so a bigint keeps full precision, and decimal/numeric columns travel
// as STRINGS on both sides -- their digits are still compared exactly, which is
// the case that actually matters for a database client.
func normalizeNumbers(v any) any {
	switch t := v.(type) {
	case *orderedjson.Object:
		out := orderedjson.NewObject(t.Len())
		for _, k := range t.Keys() {
			val, _ := t.Get(k)
			out.Set(k, normalizeNumbers(val))
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = normalizeNumbers(item)
		}
		return out
	case json.Number:
		// Integers stay exact; only genuine floats are re-spelled.
		if i, err := strconv.ParseInt(t.String(), 10, 64); err == nil {
			return json.Number(strconv.FormatInt(i, 10))
		}
		if u, err := strconv.ParseUint(t.String(), 10, 64); err == nil {
			return json.Number(strconv.FormatUint(u, 10))
		}
		f, err := t.Float64()
		if err != nil {
			return t
		}
		return json.Number(strconv.FormatFloat(f, 'g', -1, 64))
	default:
		return v
	}
}

func reportFieldDiffs(t *testing.T, rowIdx int, gotJSON, wantJSON []byte) {
	t.Helper()
	g, w := orderedjson.NewObject(0), orderedjson.NewObject(0)
	if err := g.UnmarshalJSON(gotJSON); err != nil {
		return
	}
	if err := w.UnmarshalJSON(wantJSON); err != nil {
		return
	}
	for _, k := range w.Keys() {
		wv, _ := w.Get(k)
		gv, present := g.Get(k)
		if !present {
			t.Errorf("  row %d column %q: missing from Go output", rowIdx, k)
			continue
		}
		wb, _ := orderedjson.Marshal(normalizeNumbers(wv))
		gb, _ := orderedjson.Marshal(normalizeNumbers(gv))
		if string(wb) != string(gb) {
			t.Errorf("  row %d column %q: got %s, want %s", rowIdx, k, gb, wb)
		}
	}
	for _, k := range g.Keys() {
		if !w.Has(k) {
			gv, _ := g.Get(k)
			gb, _ := orderedjson.Marshal(gv)
			t.Errorf("  row %d column %q: extra in Go output (%s)", rowIdx, k, gb)
		}
	}
}

func TestParityPostgres(t *testing.T) {
	ctx := context.Background()
	profile := fixtureProfile(t, "postgres")

	pool, _, err := connectPostgresWithFallback(ctx, profile, profile.Database, nil, tunePgPool(false))
	if err != nil {
		t.Skipf("postgres fixture unavailable (docker compose -f testdata/docker-compose.yml up -d): %v", err)
	}
	defer pool.Close()

	golden := loadGoldenResults(t)
	ran := 0
	for _, c := range loadCases(t) {
		if !appliesTo(c, "postgres") {
			continue
		}
		want, ok := golden["postgres/"+c.Name]
		if !ok {
			t.Errorf("no golden for postgres/%s -- regenerate testdata/golden/queries.json", c.Name)
			continue
		}
		ran++
		t.Run(c.Name, func(t *testing.T) {
			rows, err := queryPostgres(ctx, pool, c.SQL)
			if err != nil {
				t.Fatalf("query failed: %v\nSQL: %s", err, c.SQL)
			}
			compareRows(t, rows, want.Rows)
		})
	}
	if ran == 0 {
		t.Fatal("no postgres cases ran")
	}
	t.Logf("compared %d postgres result sets", ran)
}

// openMySQLFixture builds a DSN for one of the two MySQL-family fixtures.
//
// parseTime is deliberately OFF so temporal columns arrive as the raw text the
// server sent; the decoder re-renders them to match chrono's formatting, and a
// driver-parsed time.Time would hide which layout the server actually used.
func openMySQLFixture(t *testing.T, target string) *sql.DB {
	t.Helper()
	p := fixtureProfile(t, target)
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=utf8mb4&loc=UTC",
		p.User, p.Password, p.Host, p.Port, p.Database)
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Skipf("%s fixture unavailable: %v", target, err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Skipf("%s fixture unavailable (docker compose -f testdata/docker-compose.yml up -d): %v", target, err)
	}
	return db
}

func runSQLParity(t *testing.T, target string, db *sql.DB, decode func(*sql.DB, string, ColumnHints) ([]*orderedjson.Object, error)) {
	t.Helper()
	golden := loadGoldenResults(t)
	ran := 0
	for _, c := range loadCases(t) {
		if !appliesTo(c, target) {
			continue
		}
		want, ok := golden[target+"/"+c.Name]
		if !ok {
			t.Errorf("no golden for %s/%s -- regenerate testdata/golden/queries.json", target, c.Name)
			continue
		}
		ran++
		t.Run(c.Name, func(t *testing.T) {
			// Mirror what get_rows does: a table-scoped read resolves column
			// metadata first, arbitrary SQL gets none.
			var hints ColumnHints
			if c.Table != "" && target != "sqlite" {
				var err error
				hints, err = mysqlColumnHints(db, "dodb_fixture", c.Table)
				if err != nil {
					t.Fatalf("column hints for %s: %v", c.Table, err)
				}
			}
			rows, err := decode(db, c.SQL, hints)
			if err != nil {
				t.Fatalf("query failed: %v\nSQL: %s", err, c.SQL)
			}
			compareRows(t, rows, want.Rows)
		})
	}
	if ran == 0 {
		t.Fatalf("no %s cases ran", target)
	}
	t.Logf("compared %d %s result sets", ran, target)
}

func TestParityMySQL(t *testing.T) {
	db := openMySQLFixture(t, "mysql")
	defer db.Close()
	runSQLParity(t, "mysql", db, queryMySQL)
}

func TestParityMariaDB(t *testing.T) {
	db := openMySQLFixture(t, "mariadb")
	defer db.Close()
	runSQLParity(t, "mariadb", db, queryMySQL)
}

func TestParitySQLite(t *testing.T) {
	abs, err := filepath.Abs(repoPath("testdata", "fixtures", "fixture.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	// Checked explicitly: the fixture is generated from sqlite.sql rather than
	// checked in, and sql.Open on SQLite succeeds lazily even for a path that
	// does not exist -- it would only fail later, as a confusing query error.
	if _, statErr := os.Stat(abs); statErr != nil {
		t.Skip("sqlite fixture not built - run `make fixtures-up`")
	}

	db, err := sql.Open("sqlite3", abs)
	if err != nil {
		t.Skipf("sqlite fixture unavailable: %v", err)
	}
	defer db.Close()
	runSQLParity(t, "sqlite", db, func(d *sql.DB, q string, _ ColumnHints) ([]*orderedjson.Object, error) {
		return querySQLite(d, q)
	})
}
