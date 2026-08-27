// Package httprpc exposes the api.Service over POST /invoke/<command>.
//
// Why HTTP rather than generated Wails bindings: the frontend already funnels
// every backend call through one file (ui/src/utils/apiClient.ts) as
// invoke("command_name", {args}). Keeping that exact shape means apiClient.ts
// swaps one transport line and no component changes at all, and the same handler
// serves both the packaged Wails app (same-origin fetch to its asset server) and
// a plain browser during development. Generating and consuming 33 typed bindings
// would buy type safety the current apiClient does not have anyway -- most of
// its return types are `any`.
//
// Command names are the Rust #[tauri::command] names, unchanged.
package httprpc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thutil/dodb/internal/api"
)

// Prefix is the path every command is served under.
const Prefix = "/invoke/"

// Handler dispatches commands to the service.
type Handler struct {
	svc    *api.Service
	routes map[string]func(json.RawMessage) (any, error)
}

// New builds the dispatcher.
func New(svc *api.Service) *Handler {
	h := &Handler{svc: svc}
	h.routes = h.buildRoutes()
	return h
}

// Commands lists the registered command names, for a startup sanity check.
func (h *Handler) Commands() []string {
	out := make([]string, 0, len(h.routes))
	for name := range h.routes {
		out = append(out, name)
	}
	return out
}

// errorPayload is the shape the frontend already expects from a failed invoke:
// Tauri rejects with the error string, so the body carries it under "error".
type errorPayload struct {
	Error string `json:"error"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "invoke requires POST")
		return
	}
	// run_import streams, so it bypasses the request/response route table.
	if r.URL.Path == runImportPath {
		h.serveRunImport(w, r)
		return
	}

	name := strings.TrimPrefix(r.URL.Path, Prefix)
	route, ok := h.routes[name]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("unknown command %q", name))
		return
	}

	var raw json.RawMessage
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&raw); err != nil && err.Error() != "EOF" {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("malformed arguments for %s: %v", name, err))
			return
		}
	}

	result, err := route(raw)
	if err != nil {
		// A command failing is routine (a bad password, a syntax error), so this
		// is logged at debug level and reported to the caller, not treated as a
		// server fault.
		slog.Debug("command failed", "command", name, "err", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("content-type", "application/json")
	enc := json.NewEncoder(w)
	// Matches serde: the frontend renders these values verbatim and must not
	// receive < where a < was stored.
	enc.SetEscapeHTML(false)
	if err := enc.Encode(result); err != nil {
		slog.Error("could not encode response", "command", name, "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorPayload{Error: message})
}

// decode unmarshals a command's arguments, tolerating an absent body so a
// no-argument command can be called with nothing at all.
func decode[T any](raw json.RawMessage) (T, error) {
	var args T
	if len(raw) == 0 || string(raw) == "null" {
		return args, nil
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	// Numbers stay as their original text so a bigint key value in a grid edit
	// is not rounded through float64 on its way into a WHERE clause.
	dec.UseNumber()
	if err := dec.Decode(&args); err != nil {
		return args, err
	}
	return args, nil
}

// ok wraps a command that returns only an error, so the frontend receives null
// rather than an empty body.
func ok(err error) (any, error) {
	if err != nil {
		return nil, err
	}
	return nil, nil
}
