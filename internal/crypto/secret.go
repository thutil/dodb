package crypto

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// Where the master secret came from. It changes how the secret becomes keying
// material — see v2Key — so it travels with the value.
type secretSource int

const (
	sourceEnv secretSource = iota
	sourceStore
)

type masterSecret struct {
	value  string
	source secretSource
}

type backend int

const (
	backendFile backend = iota
	backendKeychain
)

var (
	secretMu     sync.Mutex
	cachedSecret *masterSecret
)

// defaultBackend is File everywhere except Windows.
//
// Not a portability oversight: on macOS an app that is not signed with a real
// certificate cannot read the login keychain without a consent prompt on every
// single launch, because an ad-hoc signature's designated requirement is a bare
// cdhash that changes on every compile, so "Always Allow" has nothing stable to
// record. Windows Credential Manager keys on the login account instead, so it
// works unsigned — and adds DPAPI-at-rest. See docs/MASTER_KEY.md.
func defaultBackend() backend {
	if runtime.GOOS == "windows" {
		return backendKeychain
	}
	return backendFile
}

func resolveBackend() backend {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("DODB_KEY_BACKEND"))) {
	case "file":
		return backendFile
	case "keychain":
		return backendKeychain
	case "":
		return defaultBackend()
	default:
		slog.Warn("unknown DODB_KEY_BACKEND, using the default backend",
			"value", os.Getenv("DODB_KEY_BACKEND"))
		return defaultBackend()
	}
}

// DataDirectory resolves ~/.dodb, or DODB_DATA_DIR when set.
//
// Deliberately not the OS-idiomatic application-support path: the layout is
// identical on macOS, Linux and Windows, which keeps profiles portable and made
// this the one thing the Go port did not have to change.
func DataDirectory() string {
	if dir := os.Getenv("DODB_DATA_DIR"); dir != "" {
		return dir
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".dodb")
}

func masterKeyPath() string {
	if dir := os.Getenv("DODB_DATA_DIR"); dir != "" {
		return filepath.Join(dir, ".master_key")
	}
	return filepath.Join(DataDirectory(), ".master_key")
}

// envSecret honours both names the Rust build accepts.
func envSecret() string {
	for _, name := range []string{"DODB_ENCRYPTION_KEY", "ENCRYPTION_KEY"} {
		if v := strings.TrimSpace(os.Getenv(name)); v != "" {
			return v
		}
	}
	return ""
}

func newSecret() (string, error) {
	raw := make([]byte, keyLength)
	if _, err := rand.Read(raw); err != nil {
		return "", unavailable("could not generate a master key: %v", err)
	}
	return hex.EncodeToString(raw), nil
}

func readKeyFile() string {
	content, err := os.ReadFile(masterKeyPath())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(content))
}

// writeKeyFile writes 0600 and then reads the file back.
//
// The read-back is not paranoia: a key that silently failed to persist would
// mint a fresh one on the next launch and every saved password would become
// undecryptable, with no error anywhere.
func writeKeyFile(secret string) error {
	path := masterKeyPath()
	if parent := filepath.Dir(path); parent != "" {
		if err := os.MkdirAll(parent, 0o700); err != nil {
			return unavailable("could not create %s: %v", parent, err)
		}
	}
	if err := os.WriteFile(path, []byte(secret), 0o600); err != nil {
		return unavailable("could not write %s: %v", path, err)
	}
	// WriteFile only applies the mode when it creates the file, so an existing
	// file keeps whatever permissions it had.
	if err := os.Chmod(path, 0o600); err != nil {
		slog.Warn("could not tighten master key permissions", "path", path, "err", err)
	}
	if readKeyFile() != secret {
		return unavailable("%s did not read back as written", path)
	}
	return nil
}

type fileAction int

const (
	actionUse fileAction = iota
	actionRescue
	actionGenerate
)

// errKeychainUnreadable marks the one branch that must not fall through to
// generating a new key.
var errKeychainUnreadable = errors.New("keychain item present but unreadable")

// decideFileAction is the file-backend state machine from crypto.rs.
//
// The important arm is the last one: a keychain that holds a key but refuses to
// hand it over (access denied, keychain locked) is an error, NOT a reason to
// mint a replacement. Overwriting there would destroy every saved password to
// work around a dialog the user could simply have approved.
func decideFileAction(file string, probeKeychain func() (string, error)) (fileAction, string, error) {
	if file != "" {
		// Deliberately before any keychain access: docs/MASTER_KEY.md promises
		// that an existing key file means no prompt, ever. crypto.rs passes
		// keychain_lookup() as an eager argument and so probes anyway; taking a
		// callback here keeps the promise the docs actually make.
		return actionUse, file, nil
	}
	keychainValue, keychainErr := probeKeychain()
	if keychainErr != nil {
		return 0, "", unavailable(
			"a master key is stored in the keychain but could not be read (%v); "+
				"allow access and reopen dodb, or delete the %s item from Keychain Access to start over",
			keychainErr, keychainServiceName)
	}
	if keychainValue != "" {
		return actionRescue, keychainValue, nil
	}
	return actionGenerate, "", nil
}

func fileSecret() (string, error) {
	action, value, err := decideFileAction(readKeyFile(), keychainLookup)
	if err != nil {
		return "", err
	}
	switch action {
	case actionUse:
		return value, nil
	case actionRescue:
		// A key left behind by a build that used the keychain: move it into a
		// file so no further launch needs a prompt, then drop the item.
		if err := writeKeyFile(value); err != nil {
			return "", err
		}
		slog.Info("master key moved out of the keychain", "path", masterKeyPath())
		forgetKeychainEntry()
		return value, nil
	default:
		fresh, err := newSecret()
		if err != nil {
			return "", err
		}
		if err := writeKeyFile(fresh); err != nil {
			return "", err
		}
		return fresh, nil
	}
}

func loadSecret() (*masterSecret, error) {
	if v := envSecret(); v != "" {
		return &masterSecret{value: v, source: sourceEnv}, nil
	}
	var (
		value string
		err   error
	)
	switch resolveBackend() {
	case backendKeychain:
		value, err = keychainSecret()
	default:
		value, err = fileSecret()
	}
	if err != nil {
		return nil, err
	}
	return &masterSecret{value: value, source: sourceStore}, nil
}

// secret caches only on success, so a launch that began with a locked keychain
// picks the key up once it is unlocked instead of staying broken for the run.
func secret() (*masterSecret, error) {
	secretMu.Lock()
	defer secretMu.Unlock()
	if cachedSecret != nil {
		return cachedSecret, nil
	}
	loaded, err := loadSecret()
	if err != nil {
		return nil, err
	}
	cachedSecret = loaded
	return loaded, nil
}

func resetSecretForTest() {
	secretMu.Lock()
	defer secretMu.Unlock()
	cachedSecret = nil
}
