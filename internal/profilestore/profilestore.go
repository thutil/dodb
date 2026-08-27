// Package profilestore reads and writes ~/.dodb/profiles.json.
//
// Ported from src-tauri/src/profiles.rs. Two things here are contracts rather
// than choices:
//
//   - The serialised bytes must match serde_json's to_string_pretty exactly, or
//     the first save after upgrading rewrites every user's file for no reason.
//   - Only the password is encrypted. Host, port, user and database sit in
//     plaintext, which is what docs/MASTER_KEY.md documents; this package must
//     not quietly widen or narrow that.
package profilestore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/thutil/dodb/internal/crypto"
	"github.com/thutil/dodb/internal/model"
)

// Path reports the profiles file location, honouring DODB_DATA_DIR.
func Path() string {
	return filepath.Join(crypto.DataDirectory(), "profiles.json")
}

// Load returns every saved profile with its password decrypted.
//
// A missing file is not an error: a first run has no profiles. A password that
// cannot be decrypted is dropped with a warning and the rest of the profile is
// kept, matching load_profiles — losing a saved password is recoverable by
// retyping it, whereas failing the whole load would hide every connection the
// user has.
func Load() ([]model.ConnectionProfile, error) {
	path := Path()
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return []model.ConnectionProfile{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read profiles: %w", err)
	}

	var profiles []model.ConnectionProfile
	if err := json.Unmarshal(raw, &profiles); err != nil {
		return nil, fmt.Errorf("failed to parse profiles: %w", err)
	}

	for i := range profiles {
		if profiles[i].Password == "" {
			continue
		}
		plain, err := crypto.DecryptPassword(profiles[i].Password)
		switch {
		case errors.Is(err, crypto.ErrUndecryptable):
			slog.Warn("stored password could not be decrypted", "profile", profiles[i].ID)
			profiles[i].Password = ""
		case err != nil:
			// A missing master key is a different problem: report it rather than
			// silently presenting every profile as having no password.
			return nil, err
		default:
			profiles[i].Password = plain
		}
	}
	return profiles, nil
}

// Save writes the whole set, encrypting passwords on the way out.
//
// The input is not mutated: callers hold these profiles in memory with plaintext
// passwords and would otherwise find them replaced by ciphertext.
func Save(profiles []model.ConnectionProfile) error {
	dir := crypto.DataDirectory()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create data dir: %w", err)
	}

	forDisk, err := prepareForDisk(profiles)
	if err != nil {
		return err
	}

	raw, err := marshalLikeSerde(forDisk)
	if err != nil {
		return fmt.Errorf("failed to serialize profiles: %w", err)
	}
	if err := os.WriteFile(Path(), raw, 0o600); err != nil {
		return fmt.Errorf("failed to write profiles: %w", err)
	}
	return nil
}

// prepareForDisk copies the set and applies the two password rules: a profile
// that opted out of saving stores nothing, and everything else stores ciphertext.
func prepareForDisk(profiles []model.ConnectionProfile) ([]model.ConnectionProfile, error) {
	out := make([]model.ConnectionProfile, len(profiles))
	copy(out, profiles)
	for i := range out {
		switch {
		case !out[i].SavePassword:
			out[i].Password = ""
		case out[i].Password != "":
			sealed, err := crypto.EncryptPassword(out[i].Password)
			if err != nil {
				return nil, err
			}
			out[i].Password = sealed
		}
	}
	return out, nil
}

// marshalLikeSerde reproduces serde_json::to_string_pretty byte for byte.
//
// Two differences from a plain json.MarshalIndent have to be corrected:
// encoding/json escapes <, > and & as < and friends, which serde does not;
// and Encoder.Encode appends a newline, which to_string_pretty does not.
func marshalLikeSerde(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}
