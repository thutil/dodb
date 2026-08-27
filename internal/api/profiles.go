package api

import (
	"fmt"
	"strings"

	"github.com/thutil/dodb/internal/dbcore"
	"github.com/thutil/dodb/internal/model"
	"github.com/thutil/dodb/internal/profilestore"
)

// GetProfiles reads every saved connection, passwords decrypted.
func (s *Service) GetProfiles() ([]model.ConnectionProfile, error) {
	return profilestore.Load()
}

// SaveProfile upserts one profile.
func (s *Service) SaveProfile(profile model.ConnectionProfile) error {
	if strings.TrimSpace(profile.ID) == "" {
		return fmt.Errorf("a profile needs an id")
	}
	existing, err := profilestore.Load()
	if err != nil {
		return err
	}
	replaced := false
	for i := range existing {
		if existing[i].ID == profile.ID {
			existing[i] = profile
			replaced = true
			break
		}
	}
	if !replaced {
		existing = append(existing, profile)
	}
	return profilestore.Save(existing)
}

// SaveAllProfiles overwrites the whole set, which is how the UI persists
// reordering and group edits.
func (s *Service) SaveAllProfiles(profiles []model.ConnectionProfile) error {
	return profilestore.Save(profiles)
}

// DeleteProfile removes a profile and closes its pools.
func (s *Service) DeleteProfile(id string) error {
	existing, err := profilestore.Load()
	if err != nil {
		return err
	}
	kept := make([]model.ConnectionProfile, 0, len(existing))
	for _, p := range existing {
		if p.ID != id {
			kept = append(kept, p)
		}
	}
	if err := profilestore.Save(kept); err != nil {
		return err
	}
	s.DB.ClosePools(id)
	return nil
}

// RegisterSessionProfile mints an in-memory-only connection.
//
// The returned profile carries the generated id, which is what the frontend
// then uses for every subsequent call -- an unsaved connection is otherwise
// indistinguishable from a saved one.
func (s *Service) RegisterSessionProfile(profile model.ConnectionProfile) (model.ConnectionProfile, error) {
	if strings.TrimSpace(profile.ID) == "" || !strings.HasPrefix(profile.ID, dbcore.SessionIDPrefix) {
		profile.ID = dbcore.SessionIDPrefix + newID()
	}
	if !profile.Type.Valid() {
		return model.ConnectionProfile{}, fmt.Errorf("unknown connection type %q", profile.Type)
	}
	s.DB.RegisterSession(profile)
	return profile, nil
}

// UnregisterSessionProfile forgets an unsaved connection and closes its pools.
func (s *Service) UnregisterSessionProfile(id string) error {
	s.DB.UnregisterSession(id)
	s.DB.ClosePools(id)
	return nil
}

// SetRuntimePassword stashes a password in memory for a profile that opted out
// of saving one. It is never written to disk.
func (s *Service) SetRuntimePassword(id, password string) error {
	if strings.TrimSpace(id) == "" {
		return fmt.Errorf("a runtime password needs a profile id")
	}
	s.DB.SetRuntimePassword(id, password)
	return nil
}

// ClearRuntimePassword forgets one stashed password, or all of them.
func (s *Service) ClearRuntimePassword(id string) error {
	s.DB.ClearRuntimePassword(id)
	return nil
}

// TestConnection opens a single short-lived connection and throws it away.
func (s *Service) TestConnection(profile model.ConnectionProfile) (bool, error) {
	if !profile.Type.Valid() {
		return false, fmt.Errorf("unknown connection type %q", profile.Type)
	}
	// A throwaway State keeps the probe out of the real pool cache, so a
	// successful test does not leave a pool behind under a profile id that may
	// not exist yet.
	probe := dbcore.NewState()
	defer probe.ClosePools("")

	pool, err := probe.GetPool(ctx(), profile, "")
	if err != nil {
		return false, err
	}
	if _, err := pool.Query(ctx(), "SELECT 1", nil); err != nil {
		return false, err
	}
	return true, nil
}
