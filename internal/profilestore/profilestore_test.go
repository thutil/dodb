package profilestore

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/thutil/dodb/internal/model"
)

// The master secret the Rust generator used, so Go derives the same v2 key and
// can both read that file and reproduce its ciphertext format.
const goldenSecret = "4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b"

func str(s string) *string { return &s }

// goldenProfiles mirrors the input to src-tauri/examples/gen_profiles_golden.rs.
func goldenProfiles() []model.ConnectionProfile {
	return []model.ConnectionProfile{
		{
			ID: "p-postgres", Name: "prod pg", Type: model.Postgres,
			Host: "db.example.com", Port: 5432, User: "dodb",
			Password: "hunter2", Database: "app",
			FilePath: nil, Group: str("production"),
			KeepAlive: true, SavePassword: true,
			CreatedAt: "2026-01-02T03:04:05Z", UpdatedAt: "2026-08-27T10:00:00Z",
		},
		{
			ID: "p-sqlite", Name: "local file", Type: model.Sqlite,
			Password: "should-not-persist",
			FilePath: str("/tmp/local.sqlite"), Group: nil,
			KeepAlive: false, SavePassword: false,
			CreatedAt: "2026-02-03T00:00:00Z",
		},
		{
			ID: "p-maria", Name: "ทดสอบไทย <staging & qa>", Type: model.Mariadb,
			Host: "127.0.0.1", Port: 3306, User: "root",
			Database:     "dodb_fixture",
			SavePassword: true,
		},
	}
}

func isolate(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DODB_DATA_DIR", dir)
	t.Setenv("DODB_KEY_BACKEND", "file")
	t.Setenv("DODB_ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY", "")
	if err := os.WriteFile(filepath.Join(dir, ".master_key"), []byte(goldenSecret), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func readGolden(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "testdata", "golden", "profiles.json"))
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	return raw
}

// TestSaveMatchesSerdeByteForByte is the wire-format gate. The IV is random, so
// the password field cannot match literally; every other byte must, because a
// Go build that reformats the file would rewrite every user's profiles on the
// first save they make.
func TestSaveMatchesSerdeByteForByte(t *testing.T) {
	isolate(t)

	if err := Save(goldenProfiles()); err != nil {
		t.Fatalf("Save: %v", err)
	}
	got, err := os.ReadFile(Path())
	if err != nil {
		t.Fatal(err)
	}
	want := readGolden(t)

	gotNorm := blankPasswords(t, got)
	wantNorm := blankPasswords(t, want)
	if gotNorm != wantNorm {
		t.Fatalf("serialised bytes differ from serde_json\n--- go ---\n%s\n--- rust ---\n%s", gotNorm, wantNorm)
	}

	// Indentation, escaping and the absent trailing newline are part of the
	// contract, so assert them on the raw bytes rather than trusting the
	// normalised comparison above.
	if got[len(got)-1] == '\n' {
		t.Error("Go added a trailing newline that to_string_pretty does not emit")
	}
	if len(want) > 0 && want[len(want)-1] == '\n' {
		t.Error("golden has a trailing newline; regenerate it")
	}
}

// ciphertextField matches a sealed password value in the serialised text.
var ciphertextField = regexp.MustCompile(`"password": "enc:v2:[0-9a-f]+:[0-9a-f]+:[0-9a-f]*"`)

// blankPasswords substitutes ciphertext in the RAW text, leaving every other
// byte -- indentation, key order, escaping, whitespace -- exactly as written.
//
// An earlier version of this helper re-marshalled both sides through
// marshalLikeSerde before comparing, which normalised away the very formatting
// the test claims to pin: switching the encoder to a four-space indent still
// passed. Do not reintroduce a round trip here.
func blankPasswords(t *testing.T, raw []byte) string {
	t.Helper()
	if !json.Valid(raw) {
		t.Fatalf("not valid JSON: %s", raw)
	}
	out := ciphertextField.ReplaceAll(raw, []byte(`"password": "<enc:v2>"`))
	if bytesContains(out, "enc:v2:") {
		t.Fatalf("a ciphertext escaped substitution, comparison would be unstable: %s", out)
	}
	return string(out)
}

// TestLoadRustWrittenFile is the read half: Go must open the file the shipping
// Rust build produced, decrypting the one saved password.
func TestLoadRustWrittenFile(t *testing.T) {
	dir := isolate(t)
	if err := os.WriteFile(filepath.Join(dir, "profiles.json"), readGolden(t), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d profiles, want 3", len(got))
	}

	// The values Rust's own load_profiles reported for this file.
	want := []struct {
		id, password string
		typ          model.SupportedDB
		group        *string
		port         uint16
	}{
		{"p-postgres", "hunter2", model.Postgres, str("production"), 5432},
		{"p-sqlite", "", model.Sqlite, nil, 0},
		{"p-maria", "", model.Mariadb, nil, 3306},
	}
	for i, w := range want {
		g := got[i]
		if g.ID != w.id || g.Password != w.password || g.Type != w.typ || g.Port != w.port {
			t.Errorf("profile %d: got {%s %q %s %d}, want {%s %q %s %d}",
				i, g.ID, g.Password, g.Type, g.Port, w.id, w.password, w.typ, w.port)
		}
		switch {
		case w.group == nil && g.Group != nil:
			t.Errorf("profile %d: group should be nil, got %q", i, *g.Group)
		case w.group != nil && (g.Group == nil || *g.Group != *w.group):
			t.Errorf("profile %d: group mismatch", i)
		}
	}
	if got[1].FilePath == nil || *got[1].FilePath != "/tmp/local.sqlite" {
		t.Error("sqlite profile lost its filePath")
	}
}

// TestSavePasswordOptOut pins the rule that a profile which opted out stores
// nothing on disk -- not ciphertext, not the plaintext.
func TestSavePasswordOptOut(t *testing.T) {
	isolate(t)
	if err := Save(goldenProfiles()); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(Path())
	if err != nil {
		t.Fatal(err)
	}
	var rows []map[string]any
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatal(err)
	}
	if pw := rows[1]["password"]; pw != "" {
		t.Fatalf("savePassword:false profile persisted %q", pw)
	}
	if bytesContains(raw, "should-not-persist") {
		t.Fatal("the opted-out plaintext password reached the file")
	}
}

// TestSaveDoesNotMutateCaller guards the in-memory copies: callers keep these
// profiles with plaintext passwords after a save.
func TestSaveDoesNotMutateCaller(t *testing.T) {
	isolate(t)
	in := goldenProfiles()
	if err := Save(in); err != nil {
		t.Fatal(err)
	}
	if in[0].Password != "hunter2" {
		t.Fatalf("Save rewrote the caller's password to %q", in[0].Password)
	}
	if in[1].Password != "should-not-persist" {
		t.Fatalf("Save blanked the caller's opted-out password")
	}
}

func TestLoadMissingFileIsEmpty(t *testing.T) {
	isolate(t)
	got, err := Load()
	if err != nil {
		t.Fatalf("Load on a fresh install: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %d profiles from a missing file", len(got))
	}
}

// TestLoadKeepsProfileWhenPasswordIsGarbage pins the recovery behaviour: an
// undecryptable password costs the password, not the connection.
func TestLoadKeepsProfileWhenPasswordIsGarbage(t *testing.T) {
	dir := isolate(t)
	bad := `[{"id":"x","name":"n","type":"postgres","host":"h","port":1,"user":"u",` +
		`"password":"enc:v2:000102030405060708090a0b:00000000000000000000000000000000:00",` +
		`"database":"d","filePath":null,"group":null,"keepAlive":false,"savePassword":true,` +
		`"createdAt":"","updatedAt":""}]`
	if err := os.WriteFile(filepath.Join(dir, "profiles.json"), []byte(bad), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d profiles, want the profile kept", len(got))
	}
	if got[0].Password != "" {
		t.Errorf("password should have been cleared, got %q", got[0].Password)
	}
	if got[0].Host != "h" {
		t.Errorf("the rest of the profile should survive, host = %q", got[0].Host)
	}
}

func bytesContains(haystack []byte, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		func() bool {
			for i := 0; i+len(needle) <= len(haystack); i++ {
				if string(haystack[i:i+len(needle)]) == needle {
					return true
				}
			}
			return false
		}()
}
