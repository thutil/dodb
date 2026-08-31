package httprpc

import (
	"encoding/json"

	"github.com/thutil/dodb/internal/api"

	"github.com/thutil/dodb/internal/dialect"
	"github.com/thutil/dodb/internal/model"
)

// buildRoutes maps every command name the frontend sends to the service method
// behind it.
//
// Written out by hand rather than derived by reflection: the argument names in
// each struct are part of the wire contract with apiClient.ts, and a typo in one
// of them should be a compile error here, not a silently-null argument at
// runtime.
func (h *Handler) buildRoutes() map[string]func(json.RawMessage) (any, error) {
	s := h.svc

	routes := map[string]func(json.RawMessage) (any, error){

		// ---- profiles ----

		"get_profiles": func(json.RawMessage) (any, error) {
			return s.GetProfiles()
		},
		"save_profile": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Profile model.ConnectionProfile `json:"profile"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.SaveProfile(a.Profile)
		},
		"save_all_profiles": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Profiles []model.ConnectionProfile `json:"profiles"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.SaveAllProfiles(a.Profiles))
		},
		"delete_profile": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID string `json:"id"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.DeleteProfile(a.ID))
		},
		"register_session_profile": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Profile model.ConnectionProfile `json:"profile"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.RegisterSessionProfile(a.Profile)
		},
		"unregister_session_profile": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID string `json:"id"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.UnregisterSessionProfile(a.ID))
		},
		"set_runtime_password": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Password string `json:"password"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.SetRuntimePassword(a.ID, a.Password))
		},
		"clear_runtime_password": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID string `json:"id"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.ClearRuntimePassword(a.ID))
		},
		"test_connection": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Profile model.ConnectionProfile `json:"profile"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.TestConnection(a.Profile)
		},

		// ---- database & table operations ----

		"get_databases": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID string `json:"id"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetDatabases(a.ID)
		},
		"get_tables": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetTables(a.ID, a.Database)
		},
		"get_columns": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				Table    string `json:"table"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetColumns(a.ID, a.Database, a.Table)
		},
		"get_rows": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID          string           `json:"id"`
				Database    string           `json:"database"`
				Table       string           `json:"table"`
				Limit       uint32           `json:"limit"`
				Offset      uint32           `json:"offset"`
				SortColumn  string           `json:"sortColumn"`
				SortOrder   string           `json:"sortOrder"`
				SearchQuery string           `json:"searchQuery"`
				Filters     []dialect.Filter `json:"filters"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetRows(a.ID, a.Database, a.Table, a.Limit, a.Offset,
				a.SortColumn, a.SortOrder, a.SearchQuery, a.Filters)
		},
		"execute_command": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				Command  string `json:"command"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.ExecuteCommand(a.ID, a.Database, a.Command)
		},
		"commit_changes": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string          `json:"id"`
				Database string          `json:"database"`
				Table    string          `json:"table"`
				Changes  api.GridChanges `json:"changes"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.CommitChanges(a.ID, a.Database, a.Table, a.Changes)
		},
		"get_table_constraints": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				Table    string `json:"table"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetTableConstraints(a.ID, a.Database, a.Table)
		},
		"execute_ddl": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID         string   `json:"id"`
				Database   string   `json:"database"`
				Statements []string `json:"statements"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.ExecuteDDL(a.ID, a.Database, a.Statements)
		},
		"disconnect_database": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID string `json:"id"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.DisconnectDatabase(a.ID)
		},
		"ping_database": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.PingDatabase(a.ID, a.Database)
		},

		// ---- ER diagram ----

		"get_schema_diagram": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.GetSchemaDiagram(a.ID, a.Database)
		},

		// ---- server administration ----

		"admin_get_users": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.AdminGetUsers(a.ID, a.Database)
		},
		"admin_get_processes": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.AdminGetProcesses(a.ID, a.Database)
		},
		"admin_create_database": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID        string `json:"id"`
				Database  string `json:"database"`
				Name      string `json:"name"`
				Charset   string `json:"charset"`
				Collation string `json:"collation"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.AdminCreateDatabase(a.ID, a.Database, a.Name, a.Charset, a.Collation))
		},
		"admin_drop_database": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				Name     string `json:"name"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.AdminDropDatabase(a.ID, a.Database, a.Name))
		},
		"admin_create_user": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID          string `json:"id"`
				Database    string `json:"database"`
				Username    string `json:"username"`
				Password    string `json:"password"`
				IsSuperuser bool   `json:"isSuperuser"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.AdminCreateUser(a.ID, a.Database, a.Username, a.Password, a.IsSuperuser))
		},
		"admin_drop_user": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				Username string `json:"username"`
				Host     string `json:"host"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.AdminDropUser(a.ID, a.Database, a.Username, a.Host))
		},
		"admin_kill_process": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				ID       string `json:"id"`
				Database string `json:"database"`
				PID      string `json:"pid"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return ok(s.AdminKillProcess(a.ID, a.Database, a.PID))
		},

		// ---- native dialogs ----

		"select_file": func(json.RawMessage) (any, error) {
			return s.SelectFile()
		},
		"save_text_file": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				SuggestedName string `json:"suggestedName"`
				Contents      string `json:"contents"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.SaveTextFile(a.SuggestedName, a.Contents)
		},

		// ---- app ----

		"app_version": func(json.RawMessage) (any, error) {
			return s.AppVersion(), nil
		},
		"print_window": func(json.RawMessage) (any, error) {
			return nil, s.PrintWindow()
		},
	}

	for name, route := range h.importRoutes() {
		routes[name] = route
	}
	// run_import is served separately; register a placeholder so it is counted
	// and so an accidental non-streaming call gets a real explanation.
	routes["run_import"] = func(json.RawMessage) (any, error) {
		return nil, errRunImportNeedsStream
	}

	return routes
}
