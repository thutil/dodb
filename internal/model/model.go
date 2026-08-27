// Package model holds the wire types shared by every dodb command.
//
// Ported from src-tauri/src/models.rs. The JSON names and the field order below
// are the on-disk format of ~/.dodb/profiles.json and the IPC contract the
// frontend already speaks, so neither is free to change.
package model

// SupportedDB is the engine selector.
//
// There are only three values, and MySQL is not one of them: MySQL and MariaDB
// speak the same protocol and share the "mariadb" tag. Adding a "mysql" value
// would make every existing profile unreadable.
type SupportedDB string

const (
	Sqlite   SupportedDB = "sqlite"
	Mariadb  SupportedDB = "mariadb"
	Postgres SupportedDB = "postgres"
)

// Valid reports whether the tag is one the backend can dispatch on. Unknown
// values are rejected at the edge rather than defaulted, so a typo in a
// hand-edited profiles.json surfaces as an error instead of silently
// connecting to the wrong kind of server.
func (d SupportedDB) Valid() bool {
	switch d {
	case Sqlite, Mariadb, Postgres:
		return true
	}
	return false
}

// ConnectionProfile is one saved connection.
//
// Field order is significant: it is the key order serde_json emits, and the Go
// port must produce byte-identical files so that merely opening dodb does not
// rewrite every user's profiles.json.
type ConnectionProfile struct {
	ID   string      `json:"id"`
	Name string      `json:"name"`
	Type SupportedDB `json:"type"`
	Host string      `json:"host"`
	Port uint16      `json:"port"`
	User string      `json:"user"`
	// Password is plaintext in memory and ciphertext on disk; the profilestore
	// package owns that transition. Never log it.
	Password string  `json:"password"`
	Database string  `json:"database"`
	FilePath *string `json:"filePath"`
	Group    *string `json:"group"`
	// KeepAlive keeps the pool warm, reconnects when it drops, and connects on
	// app launch.
	KeepAlive bool `json:"keepAlive"`
	// SavePassword false means the password lives only in memory for the
	// session; prepareForDisk blanks it before writing.
	SavePassword bool   `json:"savePassword"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}

// NewConnectionProfile matches the Rust Default impl, whose one non-zero field
// is SavePassword. A zero-valued Go struct would silently opt every new profile
// out of saving its password.
func NewConnectionProfile() ConnectionProfile {
	return ConnectionProfile{Type: Sqlite, SavePassword: true}
}

// IsSession reports a profile that was never written to disk. register_session_profile
// mints these with a "session-" prefix so an unsaved connection can still own a pool.
func (p ConnectionProfile) IsSession() bool {
	return len(p.ID) >= 8 && p.ID[:8] == "session-"
}
