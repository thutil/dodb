package dbcore

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestProbePgTypes is a development aid, not an assertion: it prints the Go type
// pgx hands back for every fixture column so the mapping in pgValueToJSON can be
// derived from observation instead of guesswork.
//
//	go test ./internal/dbcore -run TestProbePgTypes -v -tags probe
func TestProbePgTypes(t *testing.T) {
	if os.Getenv("DODB_PROBE") == "" {
		t.Skip("set DODB_PROBE=1 to run the type probe")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, "postgres://dodb:dodb@127.0.0.1:55432/dodb_fixture")
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	for _, sql := range []string{
		"SELECT * FROM hazards WHERE id = 1",
		"SELECT * FROM ts_precision WHERE id IN (1,2,3)",
		"SELECT COUNT(*) FROM hazards",
	} {
		t.Logf("=== %s", sql)
		rows, err := conn.Query(ctx, sql)
		if err != nil {
			t.Fatalf("query: %v", err)
		}
		fields := rows.FieldDescriptions()
		for rows.Next() {
			vals, err := rows.Values()
			if err != nil {
				t.Fatal(err)
			}
			for i, f := range fields {
				t.Logf("  %-14s oid=%-6d fmt=%d go=%-24T value=%v",
					f.Name, f.DataTypeOID, f.Format, vals[i], truncate(fmt.Sprint(vals[i])))
			}
		}
		rows.Close()
	}
}

func truncate(s string) string {
	if len(s) > 60 {
		return s[:60] + "..."
	}
	return s
}
