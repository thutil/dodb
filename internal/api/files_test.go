package api

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

type mockDialogs struct {
	savePath string
	saveErr  error
}

func (m *mockDialogs) OpenFile(title string, filters []FileFilter) (string, error) {
	return "", nil
}

func (m *mockDialogs) SaveFile(title, suggestedName string) (string, error) {
	return m.savePath, m.saveErr
}

type mockWindow struct {
	printCalled bool
}

func (m *mockWindow) Print() error {
	m.printCalled = true
	return nil
}

func TestSaveTextFile_PlainText(t *testing.T) {
	tmpDir := t.TempDir()
	outPath := filepath.Join(tmpDir, "test.sql")

	svc := New("test")
	svc.SetDialogs(&mockDialogs{savePath: outPath})

	got, err := svc.SaveTextFile("test.sql", "SELECT 1;")
	if err != nil {
		t.Fatalf("SaveTextFile error: %v", err)
	}
	if got == nil || *got != outPath {
		t.Errorf("got %v, want %q", got, outPath)
	}

	content, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	if string(content) != "SELECT 1;" {
		t.Errorf("content = %q, want %q", string(content), "SELECT 1;")
	}
}

func TestSaveTextFile_Base64DataUrl(t *testing.T) {
	tmpDir := t.TempDir()
	outPath := filepath.Join(tmpDir, "image.png")

	svc := New("test")
	svc.SetDialogs(&mockDialogs{savePath: outPath})

	rawBinary := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRtestdata")
	b64 := base64.StdEncoding.EncodeToString(rawBinary)
	dataUrl := "data:image/png;base64," + b64

	got, err := svc.SaveTextFile("image.png", dataUrl)
	if err != nil {
		t.Fatalf("SaveTextFile error: %v", err)
	}
	if got == nil || *got != outPath {
		t.Errorf("got %v, want %q", got, outPath)
	}

	content, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("ReadFile error: %v", err)
	}
	if string(content) != string(rawBinary) {
		t.Errorf("decoded content mismatch: got %v, want %v", content, rawBinary)
	}
}

func TestSaveTextFile_Cancelled(t *testing.T) {
	svc := New("test")
	svc.SetDialogs(&mockDialogs{savePath: ""})

	got, err := svc.SaveTextFile("image.png", "data:image/png;base64,abc")
	if err != nil {
		t.Fatalf("SaveTextFile error: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil for cancelled dialog, got %v", got)
	}
}

func TestPrintWindow(t *testing.T) {
	svc := New("test")
	win := &mockWindow{}
	svc.SetWindow(win)

	if err := svc.PrintWindow(); err != nil {
		t.Fatalf("PrintWindow error: %v", err)
	}
	if !win.printCalled {
		t.Errorf("expected Print to be called")
	}
}
