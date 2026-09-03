// Command dodb is the packaged desktop app.
//
// The Go replacement for src-tauri: it embeds the same Next.js static export,
// serves the same 33 commands under the same names, and reads the same
// ~/.dodb/profiles.json. The frontend is unchanged apart from
// ui/src/utils/apiClient.ts swapping its transport.
package main

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/thutil/dodb"
	"github.com/thutil/dodb/internal/api"
	"github.com/thutil/dodb/internal/crypto"
	"github.com/thutil/dodb/internal/transport/httprpc"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// version is stamped at build time:
//
//	go build -ldflags "-X main.version=0.3.0"
var version = "0.0.0-dev"

const mainWindow = "main"

func main() {
	svc := api.New(version)

	// Resolve the master key up front so a locked keychain or an unreadable
	// ~/.dodb surfaces now rather than when the user first opens a connection.
	// Not fatal: the app is still usable for unsaved connections.
	if err := crypto.Init(); err != nil {
		slog.Warn("master key unavailable; saved passwords will not decrypt", "err", err)
	}

	handler := httprpc.New(svc)
	if got, want := len(handler.Commands()), 33; got < want {
		// A missing route is a silent 404 at runtime, so it is caught at startup.
		slog.Warn("fewer commands registered than expected", "registered", got, "expected", want)
	}

	app := application.New(application.Options{
		Name:        "dodb",
		Description: "Modern Multi-Platform Database Manager for Postgres, MySQL, MariaDB & SQLite",
		Icon:        dodb.AppIcon,
		LogLevel:    slog.LevelWarn,
		Assets: application.AssetOptions{
			Handler:        application.BundledAssetFileServer(dodb.Frontend()),
			Middleware:     invokeMiddleware(handler),
			DisableLogging: true,
		},
	})

	svc.SetDialogs(&wailsDialogs{app: app})
	app.OnShutdown(svc.Shutdown)

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      mainWindow,
		Title:     "dodb",
		Width:     1280,
		Height:    800,
		MinWidth:  960,
		MinHeight: 640,
		// The Tauri build opened maximised; keep that.
		StartState: application.WindowStateMaximised,
		Linux: application.LinuxWindow{
			Icon: dodb.AppIcon,
		},
	})

	svc.SetWindow(&wailsWindow{window: window})
	setupAppMenu(app, window)

	if runtime.GOOS == "darwin" {
		// macOS convention, and what the Tauri build did: closing the window
		// hides it and leaves the app in the dock, so reopening is instant and
		// warm connection pools survive.
		window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
			e.Cancel()
			window.Hide()
		})
		app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen,
			func(*application.ApplicationEvent) {
				window.Show()
				window.Focus()
			})
	}

	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, "dodb failed to start:", err)
		os.Exit(1)
	}
}

// invokeMiddleware routes /invoke/* to the command handler and lets every other
// request fall through to the embedded frontend.
func invokeMiddleware(handler http.Handler) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, httprpc.Prefix) {
				handler.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// wailsDialogs adapts Wails' dialog manager to the api.Dialogs interface.
type wailsDialogs struct{ app *application.App }

func (d *wailsDialogs) OpenFile(title string, filters []api.FileFilter) (string, error) {
	dialog := d.app.Dialog.OpenFile()
	dialog.SetTitle(title)
	dialog.CanChooseFiles(true)
	dialog.CanChooseDirectories(false)
	for _, f := range filters {
		dialog.AddFilter(f.DisplayName, f.Pattern)
	}
	// A cancelled dialog returns an empty path, which SelectFile turns into null.
	return dialog.PromptForSingleSelection()
}

func (d *wailsDialogs) SaveFile(title, suggestedName string) (string, error) {
	// SaveFileDialogStruct has no SetTitle; SetMessage is the macOS equivalent.
	dialog := d.app.Dialog.SaveFile()
	dialog.SetMessage(title)
	if suggestedName != "" {
		dialog.SetFilename(suggestedName)
	}
	dialog.CanCreateDirectories(true)
	return dialog.PromptForSingleSelection()
}

// wailsWindow adapts Wails' WebviewWindow to the api.WindowHandler interface.
type wailsWindow struct{ window *application.WebviewWindow }

func (w *wailsWindow) Print() error {
	if w.window == nil {
		return nil
	}
	return w.window.Print()
}
