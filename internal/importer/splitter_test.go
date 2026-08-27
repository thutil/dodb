package importer

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/thutil/dodb/internal/model"
)

// These are the splitter tests from src-tauri/src/import.rs, ported one for one.
// They are the specification for the state machine: every case here exists
// because a real dump broke on it.

func sqls(t *testing.T, script string) []string {
	t.Helper()
	out := SplitSQL(script, true)
	stmts := make([]string, 0, len(out))
	for _, s := range out {
		stmts = append(stmts, s.SQL)
	}
	return stmts
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestSemicolonInsideAStringDoesNotEndTheStatement(t *testing.T) {
	got := sqls(t, "INSERT INTO t VALUES ('a;b'); SELECT 1;")
	want := []string{"INSERT INTO t VALUES ('a;b')", "SELECT 1"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDoubledAndBackslashQuoteEscapesAreBothUnderstood(t *testing.T) {
	got := sqls(t, `INSERT INTO t VALUES ('it''s'); INSERT INTO t VALUES ('it\'s; still one');`)
	want := []string{
		`INSERT INTO t VALUES ('it''s')`,
		`INSERT INTO t VALUES ('it\'s; still one')`,
	}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestBackslashIsLiteralWhenTheDialectDoesNotEscapeWithIt(t *testing.T) {
	// Postgres: 'a\' is a complete string, so the semicolon after it ends the
	// statement. Treating \' as an escape would swallow the terminator and merge
	// the two statements.
	out := SplitSQL(`SELECT 'a\'; SELECT 2;`, false)
	got := make([]string, 0, len(out))
	for _, s := range out {
		got = append(got, s.SQL)
	}
	want := []string{`SELECT 'a\'`, "SELECT 2"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestAllThreeCommentStylesAreSkipped(t *testing.T) {
	script := "-- leading\n# hash\n/* block ; still comment */\nSELECT 1; -- trailing\nSELECT 2;"
	got := sqls(t, script)
	want := []string{"SELECT 1", "SELECT 2"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestAHashInsideAnOperatorIsNotAComment(t *testing.T) {
	// Postgres #> must survive; only a whitespace-led # opens a comment.
	got := sqls(t, "SELECT data#>'{a}' FROM t;")
	want := []string{"SELECT data#>'{a}' FROM t"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDollarQuotedBodiesKeepTheirSemicolons(t *testing.T) {
	script := "CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\nSELECT 1;"
	got := sqls(t, script)
	if len(got) != 2 {
		t.Fatalf("got %d statements: %q", len(got), got)
	}
	if !strings.Contains(got[0], "RETURN 1;") {
		t.Errorf("dollar body lost its semicolon: %q", got[0])
	}
	if got[1] != "SELECT 1" {
		t.Errorf("got %q", got[1])
	}
}

func TestNamedDollarTagsOnlyCloseOnAMatchingTag(t *testing.T) {
	got := sqls(t, "SELECT $body$ a $$ b ; $body$;")
	if len(got) != 1 {
		t.Fatalf("got %d statements: %q", len(got), got)
	}
	if !strings.Contains(got[0], "$$ b ;") {
		t.Errorf("inner $$ should not have closed the body: %q", got[0])
	}
}

func TestADollarPlaceholderIsNotAQuoteOpener(t *testing.T) {
	got := sqls(t, "SELECT $1; SELECT $2;")
	want := []string{"SELECT $1", "SELECT $2"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestDelimiterDirectiveSwitchesTheTerminatorAndBack(t *testing.T) {
	script := "DELIMITER ;;\nCREATE TRIGGER t BEGIN SELECT 1; SELECT 2; END;;\nDELIMITER ;\nSELECT 3;"
	got := sqls(t, script)
	if len(got) != 2 {
		t.Fatalf("got %d statements: %q", len(got), got)
	}
	if !strings.HasPrefix(got[0], "CREATE TRIGGER") {
		t.Errorf("got %q", got[0])
	}
	if !strings.Contains(got[0], "SELECT 2;") {
		t.Errorf("the trigger body was split: %q", got[0])
	}
	if got[1] != "SELECT 3" {
		t.Errorf("got %q", got[1])
	}
}

func TestVersionGatedMysqldumpCommentsAreSkippedAndCounted(t *testing.T) {
	// MariaDB's /*M!...*/ flavour opens every modern mariadb-dump.
	script := "/*M!999999\\- enable the sandbox mode */ \n/*!40101 SET NAMES utf8 */;\n" +
		"/*!40014 SET FOREIGN_KEY_CHECKS=0 */;\nSELECT 1;"
	s := NewSqlSplitter(true)
	out := s.Feed([]byte(script))
	out = append(out, s.Finish()...)

	got := make([]string, 0, len(out))
	for _, st := range out {
		got = append(got, st.SQL)
	}
	if want := []string{"SELECT 1"}; !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
	if s.SkippedVersionComments() != 3 {
		t.Errorf("skipped %d version comments, want 3", s.SkippedVersionComments())
	}
}

func TestAFinalStatementWithoutATerminatorIsStillEmitted(t *testing.T) {
	got := sqls(t, "SELECT 1;\nSELECT 2")
	want := []string{"SELECT 1", "SELECT 2"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestBlankAndCommentOnlyInputYieldNothing(t *testing.T) {
	for _, script := range []string{"", "   \n\n  ", "-- just a note\n/* and a block */\n;;;"} {
		if got := sqls(t, script); len(got) != 0 {
			t.Errorf("script %q produced %q", script, got)
		}
	}
}

// TestStatementsReassembleAcrossEveryChunkBoundary is the reason the splitter is
// incremental at all: a dump arrives in chunks, and a statement, string, comment
// or dollar body may straddle any boundary. Feeding one byte at a time is the
// harshest version of that.
func TestStatementsReassembleAcrossEveryChunkBoundary(t *testing.T) {
	script := "-- head\nINSERT INTO `t` (a,b) VALUES ('x;y', 'it''s'); " +
		`/* mid ; comment */ UPDATE t SET a='\'' WHERE b=1;` + "\n" +
		"CREATE FUNCTION f() RETURNS int AS $tag$ BEGIN RETURN 1; END $tag$ LANGUAGE plpgsql;\n" +
		"SELECT 3"

	want := sqls(t, script)
	if len(want) != 4 {
		t.Fatalf("baseline produced %d statements: %q", len(want), want)
	}

	for _, size := range []int{1, 2, 3, 5, 7, 13, 31, 64} {
		s := NewSqlSplitter(true)
		var got []string
		b := []byte(script)
		for i := 0; i < len(b); {
			end := min(i+size, len(b))
			for _, st := range s.Feed(b[i:end]) {
				got = append(got, st.SQL)
			}
			i = end
		}
		for _, st := range s.Finish() {
			got = append(got, st.SQL)
		}
		if !equalStrings(got, want) {
			t.Errorf("chunk size %d:\n got %q\nwant %q", size, got, want)
		}
	}
}

func TestMultiByteDelimiterSplitAcrossChunksStillTerminates(t *testing.T) {
	s := NewSqlSplitter(true)
	out := s.Feed([]byte("DELIMITER ;;\nSELECT 1;"))
	out = append(out, s.Feed([]byte(";\nSELECT 2;;"))...)
	out = append(out, s.Finish()...)

	got := make([]string, 0, len(out))
	for _, st := range out {
		got = append(got, st.SQL)
	}
	if want := []string{"SELECT 1", "SELECT 2"}; !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestReportedLinesPointAtTheStatementsFirstRealCharacter(t *testing.T) {
	script := "-- note\n\nSELECT 1;\n\n/* two\n   lines */\nSELECT 2;"
	out := SplitSQL(script, true)
	if len(out) != 2 {
		t.Fatalf("got %d statements", len(out))
	}
	if out[0].Line != 3 {
		t.Errorf("first statement reported line %d, want 3", out[0].Line)
	}
	if out[1].Line != 7 {
		t.Errorf("second statement reported line %d, want 7", out[1].Line)
	}
}

func TestUTF8PayloadsSurviveTheByteLevelScan(t *testing.T) {
	got := sqls(t, "INSERT INTO t VALUES ('ทดสอบ; ภาษาไทย'); SELECT 'ก';")
	want := []string{"INSERT INTO t VALUES ('ทดสอบ; ภาษาไทย')", "SELECT 'ก'"}
	if !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPsqlMetaCommandsAreDroppedAndCounted(t *testing.T) {
	// pg_dump 17+ wraps its output in \restrict / \unrestrict, which are client
	// directives; sending them to the server is a syntax error.
	script := "\\restrict abc123\nSELECT 1;\n\\unrestrict abc123\nSELECT 2;"
	s := NewSqlSplitter(false)
	out := s.Feed([]byte(script))
	out = append(out, s.Finish()...)

	got := make([]string, 0, len(out))
	for _, st := range out {
		got = append(got, st.SQL)
	}
	if want := []string{"SELECT 1", "SELECT 2"}; !equalStrings(got, want) {
		t.Fatalf("got %q want %q", got, want)
	}
	if s.SkippedMetaCommands() != 2 {
		t.Errorf("skipped %d meta commands, want 2", s.SkippedMetaCommands())
	}
}

// TestRawBinaryInASqlFileIsRefused ports the Rust test of the same name.
//
// A mysqldump written without --hex-blob stores BLOB columns as raw bytes.
// Replacing them with U+FFFD would import something that merely looks like the
// original, so the file is refused with an actionable message instead.
func TestRawBinaryInASqlFileIsRefused(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "rawbytes.sql")

	dump := []byte("CREATE TABLE b (v BLOB);\nINSERT INTO b VALUES ('")
	dump = append(dump, 0x00, 0xFF, 0x10)
	dump = append(dump, []byte("');\n")...)
	if err := os.WriteFile(path, dump, 0o600); err != nil {
		t.Fatal(err)
	}

	src, err := newSQLSource(model.Mariadb, Request{FilePath: path, BatchSize: 10, CSV: DefaultCsvOptions()})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer src.Close()

	var lastErr error
	for i := 0; i < 10; i++ {
		if _, lastErr = src.NextBatch(); lastErr != nil {
			break
		}
	}
	if lastErr == nil {
		t.Fatal("a file carrying raw bytes was accepted; it must be refused")
	}
	msg := lastErr.Error()
	for _, want := range []string{"not valid UTF-8", "--hex-blob", "Line 2"} {
		if !strings.Contains(msg, want) {
			t.Errorf("error should mention %q, got: %s", want, msg)
		}
	}
}
