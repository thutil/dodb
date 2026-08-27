package crypto

import (
	"errors"
	"log/slog"
	"os"
	"runtime"
	"strings"

	"github.com/zalando/go-keyring"
)

// The identifiers an existing install already has items under. The service name
// is the app's bundle identifier, and is also hardcoded in Casks/dodb.rb's zap
// paths, so it is not free to change.
const (
	keychainServiceName = "com.thutil.dodb"
	keychainAccount     = "master-key"
)

// keychainSupported mirrors the cfg(any(macos, windows)) gate in crypto.rs.
// Everywhere else the keychain is simply reported as empty.
func keychainSupported() bool {
	return runtime.GOOS == "darwin" || runtime.GOOS == "windows"
}

// keychainLookup reports the stored key, distinguishing three outcomes the
// caller genuinely needs to tell apart:
//
//	"",  nil  -> no item is stored; safe to generate a new key
//	val, nil  -> the stored key
//	"",  err  -> an item exists but could not be read; MUST NOT be overwritten
//
// Collapsing the third case into the first is the mistake that would silently
// destroy a user's saved passwords, so it is kept explicit.
func keychainLookup() (string, error) {
	if !keychainSupported() {
		return "", nil
	}
	stored, err := keyring.Get(keychainServiceName, keychainAccount)
	switch {
	case errors.Is(err, keyring.ErrNotFound):
		return "", nil
	case err != nil:
		return "", err
	}
	stored = strings.TrimSpace(stored)
	if stored == "" {
		// An empty item is indistinguishable from no item for our purposes.
		return "", nil
	}
	return stored, nil
}

// forgetKeychainEntry drops the item after its key has been rescued into a
// file. Failure is logged, never fatal: the key is already safe in the file and
// a leftover keychain item is untidy rather than harmful.
func forgetKeychainEntry() {
	if !keychainSupported() {
		return
	}
	if err := keyring.Delete(keychainServiceName, keychainAccount); err != nil {
		if errors.Is(err, keyring.ErrNotFound) {
			return
		}
		slog.Warn("master key is now in a file but the keychain item remains", "err", err)
	}
}

// keychainSecret is the keychain-backend path: read the item, or adopt whatever
// the file holds (or a fresh key) into the keychain. Windows is the only
// platform where this is the default.
func keychainSecret() (string, error) {
	if !keychainSupported() {
		return "", unavailable("this build has no OS keychain support; unset DODB_KEY_BACKEND to use the key file")
	}
	stored, err := keyring.Get(keychainServiceName, keychainAccount)
	switch {
	case err == nil && strings.TrimSpace(stored) != "":
		return strings.TrimSpace(stored), nil
	case err == nil, errors.Is(err, keyring.ErrNotFound):
		return adoptOrGenerate()
	default:
		return "", unavailable("%v", err)
	}
}

// adoptOrGenerate moves the file's key into the keychain, or mints one, then
// verifies the write by reading it back before deleting the file.
//
// Every branch below prefers keeping the existing file over trusting a keychain
// that behaved unexpectedly: the file is the thing that currently decrypts the
// user's passwords.
func adoptOrGenerate() (string, error) {
	path := masterKeyPath()
	fromFile := readKeyFile()

	candidate := fromFile
	if candidate == "" {
		fresh, err := newSecret()
		if err != nil {
			return "", err
		}
		candidate = fresh
	}

	if err := keyring.Set(keychainServiceName, keychainAccount, candidate); err != nil {
		return "", unavailable("%v", err)
	}

	readBack, err := keyring.Get(keychainServiceName, keychainAccount)
	if err != nil {
		if fromFile != "" {
			slog.Warn("keychain write could not be read back; keeping the key file",
				"path", path, "err", err)
			return fromFile, nil
		}
		return "", unavailable("%v", err)
	}
	verified := strings.TrimSpace(readBack) == candidate

	switch {
	case verified && fromFile != "":
		if err := os.Remove(path); err != nil {
			slog.Warn("master key is in the keychain but the file remains", "path", path, "err", err)
		} else {
			slog.Info("master key moved into the OS keychain", "removed", path)
		}
		return candidate, nil
	case verified:
		return candidate, nil
	case fromFile != "":
		slog.Warn("keychain returned a different master key; keeping the key file", "path", path)
		return fromFile, nil
	default:
		return "", unavailable("the keychain returned a different master key than the one just written")
	}
}
