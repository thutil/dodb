package api

import (
	"crypto/rand"
	"encoding/hex"
)

// newID returns a random identifier for a session-only connection.
func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// A collision here would only mean two unsaved connections clash, but
		// crypto/rand failing at all is not something to paper over silently.
		panic("api: could not generate an id: " + err.Error())
	}
	return hex.EncodeToString(b)
}
