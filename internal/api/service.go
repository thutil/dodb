// Package api is the single definition of dodb's 33 commands.
//
// Every command lives here exactly once, transport-agnostic, so the same code
// serves both the Wails bindings the packaged app uses and the local HTTP shim
// the parity tests drive. Method names and JSON shapes match the Rust
// #[tauri::command] set one for one -- ui/src/utils/apiClient.ts is the only
// frontend file that knows about any of this, and it keeps calling the same 33
// names.
package api

import (
	"context"

	"github.com/thutil/dodb/internal/dbcore"
)

// WindowHandler provides host window actions.
type WindowHandler interface {
	Print() error
}

// Service holds the process-wide connection state.
type Service struct {
	DB *dbcore.State

	// Version is reported to the frontend, replacing @tauri-apps/api/app's
	// getVersion.
	Version string

	// dialogs is nil until the host installs one; see SetDialogs.
	dialogs Dialogs

	// window is nil until the host installs one; see SetWindow.
	window WindowHandler

	// imports guards the single-import-at-a-time slot.
	imports importState
}

// New returns a Service with empty connection state.
func New(version string) *Service {
	return &Service{DB: dbcore.NewState(), Version: version}
}

// SetWindow installs the host window implementation.
func (s *Service) SetWindow(w WindowHandler) { s.window = w }

// PrintWindow triggers the host window print dialog.
func (s *Service) PrintWindow() error {
	if s.window == nil {
		return nil
	}
	return s.window.Print()
}

// AppVersion replaces the getVersion() call at ui/src/pages/index.tsx:220.
func (s *Service) AppVersion() string { return s.Version }

// Shutdown closes every pool. Called from the app's shutdown hook so a
// keep-alive connection does not outlive the window.
func (s *Service) Shutdown() { s.DB.ClosePools("") }

// ctx returns a background context. Wails calls service methods without one;
// the HTTP shim passes the request's context instead.
func ctx() context.Context { return context.Background() }
