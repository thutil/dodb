// Command dodb-devserver serves the same 33 commands over plain HTTP.
//
// Two jobs:
//
//   - Development: point `next dev` at it and the whole app runs in a browser,
//     with fast refresh and real devtools, which no webview gives you.
//   - Verification: every command is reachable with curl, so the backend can be
//     exercised end to end without a GUI. That is what made it possible to port
//     these commands without a human clicking through the app.
//
// Native file dialogs are the one thing missing; commands needing them return a
// clear error rather than pretending.
package main

import (
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/thutil/dodb"
	"github.com/thutil/dodb/internal/api"
	"github.com/thutil/dodb/internal/crypto"
	"github.com/thutil/dodb/internal/transport/httprpc"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:5822", "address to listen on")
	serveUI := flag.Bool("ui", true, "also serve the embedded frontend")
	flag.Parse()

	if err := crypto.Init(); err != nil {
		slog.Warn("master key unavailable; saved passwords will not decrypt", "err", err)
	}

	svc := api.New("0.0.0-dev")
	svc.SetDialogs(noDialogs{})
	defer svc.Shutdown()

	handler := httprpc.New(svc)

	mux := http.NewServeMux()
	mux.Handle(httprpc.Prefix, handler)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "ok %d commands\n", len(handler.Commands()))
	})
	if *serveUI {
		mux.Handle("/", http.FileServer(http.FS(dodb.Frontend())))
	}

	fmt.Printf("dodb-devserver on http://%s (%d commands)\n", *addr, len(handler.Commands()))
	server := &http.Server{
		Addr:              *addr,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 10 * time.Second,
		// No write timeout: run_import streams progress for as long as the
		// import takes, and a timeout here would sever it mid-file.
	}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		fmt.Fprintln(os.Stderr, "devserver failed:", err)
		os.Exit(1)
	}
}

// withCORS lets `next dev` on another port talk to this one.
//
// Wide open on purpose and safe only because this binary is a development tool
// bound to loopback: it holds live database credentials and must never be the
// one that ships.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (strings.HasPrefix(origin, "http://localhost:") ||
			strings.HasPrefix(origin, "http://127.0.0.1:")) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "content-type")
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// noDialogs stands in for the host's file dialogs, which a browser cannot offer.
type noDialogs struct{}

func (noDialogs) OpenFile(string, []api.FileFilter) (string, error) {
	return "", fmt.Errorf("%w: run the packaged app, or pass the path directly", api.ErrNoDialogs)
}

func (noDialogs) SaveFile(string, string) (string, error) {
	return "", fmt.Errorf("%w: run the packaged app to export", api.ErrNoDialogs)
}
