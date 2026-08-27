package dialect

import (
	"testing"

	"github.com/thutil/dodb/internal/model"
)

func TestQuoteTable(t *testing.T) {
	tests := []struct {
		name     string
		db       model.SupportedDB
		table    string
		expected string
	}{
		{"mysql table", model.Mariadb, "users", "`users`"},
		{"mysql qualified", model.Mariadb, "mydb.users", "`mydb`.`users`"},
		{"postgres table", model.Postgres, "users", `"users"`},
		{"postgres qualified", model.Postgres, "public.users", `"public"."users"`},
		{"sqlite table", model.Sqlite, "users", `"users"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := QuoteTable(tt.db, tt.table)
			if got != tt.expected {
				t.Errorf("QuoteTable(%v, %q) = %q; want %q", tt.db, tt.table, got, tt.expected)
			}
		})
	}
}

func TestQuoteColumn(t *testing.T) {
	tests := []struct {
		name     string
		db       model.SupportedDB
		col      string
		expected string
	}{
		{"mysql column", model.Mariadb, "username", "`username`"},
		{"postgres column", model.Postgres, "username", `"username"`},
		{"sqlite column", model.Sqlite, "username", `"username"`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := QuoteColumn(tt.db, tt.col)
			if got != tt.expected {
				t.Errorf("QuoteColumn(%v, %q) = %q; want %q", tt.db, tt.col, got, tt.expected)
			}
		})
	}
}

func TestBuildFilterClause(t *testing.T) {
	// MySQL filter
	f := Filter{
		Column:   "email",
		Operator: "equals",
		Value:    "test@example.com",
	}
	got, err := BuildFilterClause(model.Mariadb, f)
	if err != nil {
		t.Fatalf("BuildFilterClause error: %v", err)
	}
	expected := "`email` = 'test@example.com'"
	if got != expected {
		t.Errorf("BuildFilterClause MySQL = %q; want %q", got, expected)
	}

	// Postgres filter
	gotPg, err := BuildFilterClause(model.Postgres, f)
	if err != nil {
		t.Fatalf("BuildFilterClause error: %v", err)
	}
	expectedPg := `"email" = 'test@example.com'`
	if gotPg != expectedPg {
		t.Errorf("BuildFilterClause Postgres = %q; want %q", gotPg, expectedPg)
	}
}
