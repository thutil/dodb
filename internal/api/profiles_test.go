package api_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/thutil/dodb/internal/api"
	"github.com/thutil/dodb/internal/model"
)

const goldenSecret = "4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b"

func setupTestService(t *testing.T) *api.Service {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("DODB_DATA_DIR", dir)
	t.Setenv("DODB_KEY_BACKEND", "file")
	t.Setenv("DODB_ENCRYPTION_KEY", "")
	t.Setenv("ENCRYPTION_KEY", "")
	if err := os.WriteFile(filepath.Join(dir, ".master_key"), []byte(goldenSecret), 0o600); err != nil {
		t.Fatal(err)
	}
	return api.New("1.0.0")
}

func TestSaveProfile_GeneratesIDWhenEmpty(t *testing.T) {
	svc := setupTestService(t)

	p := model.ConnectionProfile{
		Name: "New MySQL",
		Type: model.Mariadb,
		Host: "localhost",
		Port: 3306,
		User: "root",
	}

	saved, err := svc.SaveProfile(p)
	if err != nil {
		t.Fatalf("SaveProfile failed: %v", err)
	}
	if saved.ID == "" {
		t.Fatalf("expected generated ID, got empty")
	}

	profiles, err := svc.GetProfiles()
	if err != nil {
		t.Fatalf("GetProfiles failed: %v", err)
	}
	if len(profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(profiles))
	}
	if profiles[0].ID != saved.ID {
		t.Fatalf("expected ID %q, got %q", saved.ID, profiles[0].ID)
	}
}

func TestSaveProfile_ReplacesSessionPrefix(t *testing.T) {
	svc := setupTestService(t)

	p := model.ConnectionProfile{
		ID:   "session-123456",
		Name: "Session MySQL",
		Type: model.Mariadb,
		Host: "localhost",
		Port: 3306,
		User: "root",
	}

	saved, err := svc.SaveProfile(p)
	if err != nil {
		t.Fatalf("SaveProfile failed: %v", err)
	}
	if saved.ID == "" || saved.ID == "session-123456" {
		t.Fatalf("expected new persistent ID, got %q", saved.ID)
	}
}
