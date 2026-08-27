package api

import (
	"fmt"
	"os"
	"path/filepath"
)

// FileFilter is one entry in a native file dialog's type list.
type FileFilter struct {
	DisplayName string
	Pattern     string // e.g. "*.db;*.sqlite;*.sqlite3"
}

// Dialogs is the host's native file dialogs.
//
// An interface because the two transports differ: the packaged Wails app has
// real dialogs, and the browser-based dev server has none. Injecting it keeps
// api free of any window-system dependency, which is also what lets the parity
// tests construct a Service without a GUI.
type Dialogs interface {
	OpenFile(title string, filters []FileFilter) (string, error)
	SaveFile(title, suggestedName string) (string, error)
}

// SetDialogs installs the host's dialog implementation.
func (s *Service) SetDialogs(d Dialogs) { s.dialogs = d }

// ErrNoDialogs is returned when a command needing a native dialog runs in a
// context that has none.
var ErrNoDialogs = fmt.Errorf("native file dialogs are not available in this build")

// SelectFile opens a picker for a SQLite database file.
func (s *Service) SelectFile() (*string, error) {
	if s.dialogs == nil {
		return nil, ErrNoDialogs
	}
	path, err := s.dialogs.OpenFile("Select a database file", []FileFilter{
		{DisplayName: "Database", Pattern: "*.db;*.sqlite;*.sqlite3;*.sql"},
	})
	if err != nil {
		return nil, err
	}
	if path == "" {
		// A cancelled dialog is not an error; the frontend checks for null.
		return nil, nil
	}
	return &path, nil
}

// SaveTextFile writes an export to a location the user picks.
//
// This replaces the frontend's `<a download>` + blob URL, which the Phase 0
// spike proved does nothing under Wails' webview: the click dispatches without
// error and no file appears. Every export path in the UI routes here instead.
func (s *Service) SaveTextFile(suggestedName, contents string) (*string, error) {
	if s.dialogs == nil {
		return nil, ErrNoDialogs
	}
	path, err := s.dialogs.SaveFile("Save", suggestedName)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("could not create %s: %w", dir, err)
		}
	}
	// 0644 rather than 0600: an export is a document the user asked for and will
	// likely share, unlike the master key.
	if err := os.WriteFile(path, []byte(contents), 0o644); err != nil {
		return nil, fmt.Errorf("could not write %s: %w", path, err)
	}
	return &path, nil
}
