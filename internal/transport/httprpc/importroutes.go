package httprpc

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/thutil/dodb/internal/importer"
)

// runImportPath is handled outside the normal route table because it streams.
const runImportPath = Prefix + "run_import"

// importRoutes are the four import commands that return a single value.
func (h *Handler) importRoutes() map[string]func(json.RawMessage) (any, error) {
	s := h.svc
	return map[string]func(json.RawMessage) (any, error){
		"pick_import_file": func(json.RawMessage) (any, error) {
			return s.PickImportFile()
		},
		"describe_import_file": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Path string `json:"path"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.DescribeImportFile(a.Path)
		},
		"preview_import_file": func(raw json.RawMessage) (any, error) {
			a, err := decode[struct {
				Path   string              `json:"path"`
				Format importer.Format     `json:"format"`
				CSV    importer.CsvOptions `json:"csv"`
			}](raw)
			if err != nil {
				return nil, err
			}
			return s.PreviewImportFile(a.Path, a.Format, a.CSV)
		},
		"cancel_import": func(json.RawMessage) (any, error) {
			return ok(s.CancelImport())
		},
	}
}

// serveRunImport streams an import's progress as Server-Sent Events.
//
// SSE rather than a single response because an import can run for minutes and
// the UI has a progress bar to feed. Each frame is flushed immediately; without
// that the whole stream would arrive at once when the import finished, which is
// exactly the situation the progress bar exists to avoid.
func (h *Handler) serveRunImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "run_import requires POST")
		return
	}

	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("malformed arguments: %v", err))
		return
	}
	args, err := decode[struct {
		ID       string           `json:"id"`
		Database string           `json:"database"`
		Request  importer.Request `json:"request"`
	}](raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "this server cannot stream progress")
		return
	}

	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache")
	w.Header().Set("x-accel-buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	send := func(event string, payload any) {
		body, err := json.Marshal(payload)
		if err != nil {
			return
		}
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body)
		flusher.Flush()
	}

	report, err := h.svc.RunImport(args.ID, args.Database, args.Request, func(p importer.Progress) {
		send("progress", p)
	})
	if err != nil {
		send("error", errorPayload{Error: err.Error()})
		return
	}
	send("report", report)
}

// errRunImportNeedsStream explains the one command that is not request/response.
var errRunImportNeedsStream = fmt.Errorf(
	"run_import streams its progress; call it and read the Server-Sent Event stream")
