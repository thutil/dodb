package crypto

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// The gate for Phase 2: every vector in these files was produced by the Rust
// build (src-tauri/examples/gen_crypto_golden.rs) and verified by Rust's own
// decrypt_password before being written out. If Go cannot open them, an
// upgrading user loses every saved password, so this test failing is a stop.
//
// Regenerate with:
//
//	DODB_ENCRYPTION_KEY=<hex> cargo run --manifest-path src-tauri/Cargo.toml \
//	  --example gen_crypto_golden -- env > testdata/golden/crypto_env.json

type goldenCase struct {
	Gen       string  `json:"gen"`
	Idx       int     `json:"idx"`
	Plain     *string `json:"plain"`
	Cipher    string  `json:"cipher"`
	Encrypted bool    `json:"encrypted"`
	OpensTo   *string `json:"opensTo"`
}

type goldenFile struct {
	Mode         string       `json:"mode"`
	Secret       string       `json:"secret"`
	V2KeyHex     string       `json:"v2KeyHex"`
	V1KeyHex     string       `json:"v1KeyHex"`
	LegacyKeyHex string       `json:"legacyKeyHex"`
	Cases        []goldenCase `json:"cases"`
}

func loadGolden(t *testing.T, name string) goldenFile {
	t.Helper()
	path := filepath.Join("..", "..", "testdata", "golden", name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var g goldenFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	if len(g.Cases) == 0 {
		t.Fatalf("%s has no cases", path)
	}
	return g
}

// isolate points the package at a throwaway data directory and clears the
// derived-key cache, so several master secrets can be driven through one
// process. DODB_KEY_BACKEND is pinned to file to keep the run hermetic: the
// keychain must never be consulted by a test.
func isolate(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DODB_DATA_DIR", dir)
	t.Setenv("DODB_KEY_BACKEND", "file")
	t.Setenv("DODB_ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY", "")
	resetForTest()
	t.Cleanup(resetForTest)
	return dir
}

func TestGoldenEnvSecret(t *testing.T) {
	g := loadGolden(t, "crypto_env.json")
	isolate(t)
	// An env-supplied secret takes precedence over any backend, and is stretched
	// with PBKDF2 before it becomes HKDF input keying material.
	t.Setenv("DODB_ENCRYPTION_KEY", g.Secret)
	resetForTest()
	runGolden(t, g)
}

func TestGoldenStoredSecret(t *testing.T) {
	g := loadGolden(t, "crypto_store.json")
	dir := isolate(t)
	// A stored secret is used as its own ASCII bytes -- NOT hex-decoded. Getting
	// this backwards yields a valid-looking key that opens nothing.
	if err := os.WriteFile(filepath.Join(dir, ".master_key"), []byte(g.Secret), 0o600); err != nil {
		t.Fatal(err)
	}
	resetForTest()
	runGolden(t, g)
}

func runGolden(t *testing.T, g goldenFile) {
	t.Helper()

	t.Run("derived keys", func(t *testing.T) {
		v2, err := v2Key()
		if err != nil {
			t.Fatalf("v2Key: %v", err)
		}
		if got := hex.EncodeToString(v2); got != g.V2KeyHex {
			t.Errorf("v2 key\n got %s\nwant %s", got, g.V2KeyHex)
		}
		v1, err := v1Key()
		if err != nil {
			t.Fatalf("v1Key: %v", err)
		}
		if got := hex.EncodeToString(v1); got != g.V1KeyHex {
			t.Errorf("v1 key\n got %s\nwant %s", got, g.V1KeyHex)
		}
		if got := hex.EncodeToString(legacyKey()); got != g.LegacyKeyHex {
			t.Errorf("legacy key\n got %s\nwant %s", got, g.LegacyKeyHex)
		}
	})

	for _, c := range g.Cases {
		c := c
		name := c.Gen
		if c.Plain != nil {
			name += "/" + *c.Plain
		} else {
			name += "/" + c.Cipher
		}
		t.Run(name, func(t *testing.T) {
			if c.Gen == "malformed" {
				got, err := DecryptPassword(c.Cipher)
				if c.OpensTo == nil {
					if !errors.Is(err, ErrUndecryptable) {
						t.Fatalf("malformed blob %q: got (%q, %v), want ErrUndecryptable", c.Cipher, got, err)
					}
					return
				}
				if err != nil || got != *c.OpensTo {
					t.Fatalf("malformed blob %q: got (%q, %v), want %q", c.Cipher, got, err, *c.OpensTo)
				}
				return
			}

			if !c.Encrypted {
				// encrypt_password short-circuits empty input, so the recorded
				// "cipher" is the plaintext itself.
				if c.Cipher != *c.Plain {
					t.Fatalf("unencrypted case should pass through: got %q want %q", c.Cipher, *c.Plain)
				}
				out, err := EncryptPassword(*c.Plain)
				if err != nil || out != *c.Plain {
					t.Fatalf("EncryptPassword(%q) = (%q, %v), want passthrough", *c.Plain, out, err)
				}
				return
			}

			got, err := DecryptPassword(c.Cipher)
			if err != nil {
				t.Fatalf("DecryptPassword(%q): %v", c.Cipher, err)
			}
			if got != *c.Plain {
				t.Fatalf("DecryptPassword(%q)\n got %q\nwant %q", c.Cipher, got, *c.Plain)
			}
		})
	}

	t.Run("round trip through Go", func(t *testing.T) {
		for _, plain := range []string{"hunter2", "รหัสผ่านภาษาไทย", "p@ss:with:colons", "\x00\x01binary\x7f"} {
			sealed, err := EncryptPassword(plain)
			if err != nil {
				t.Fatalf("EncryptPassword(%q): %v", plain, err)
			}
			if sealed == plain {
				t.Fatalf("EncryptPassword(%q) returned its input", plain)
			}
			back, err := DecryptPassword(sealed)
			if err != nil {
				t.Fatalf("DecryptPassword(%q): %v", sealed, err)
			}
			if back != plain {
				t.Fatalf("round trip: got %q want %q", back, plain)
			}
		}
	})
}
