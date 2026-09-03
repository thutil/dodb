package main

import (
	"fmt"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// dispatchMenuAction executes JavaScript in the webview window to dispatch a custom DOM event.
func dispatchMenuAction(window *application.WebviewWindow, action string) {
	if window == nil {
		return
	}
	window.HandleMessage("wails:runtime:ready")
	js := fmt.Sprintf("window.dispatchEvent(new CustomEvent('dodb-menu-action', { detail: '%s' }));", action)
	window.ExecJS(js)
}

// setupAppMenu configures the native macOS Application Menu bar.
func setupAppMenu(app *application.App, window *application.WebviewWindow) {
	if runtime.GOOS != "darwin" {
		return
	}

	menu := app.NewMenu()

	// 1. Application menu (dodb)
	appMenu := menu.AddSubmenu("dodb")
	appMenu.Add("About dodb").OnClick(func(*application.Context) {
		dispatchMenuAction(window, "open-about")
	})
	appMenu.Add("Check for Updates...").OnClick(func(*application.Context) {
		dispatchMenuAction(window, "check-updates")
	})
	appMenu.AddSeparator()
	settingsItem := appMenu.Add("Settings...")
	settingsItem.SetAccelerator("CmdOrCtrl+,")
	settingsItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "open-settings")
	})
	appMenu.AddSeparator()
	appMenu.AddRole(application.ServicesMenu)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.ShowAll)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)

	// 2. File menu
	fileMenu := menu.AddSubmenu("File")
	newConn := fileMenu.Add("New Connection...")
	newConn.SetAccelerator("CmdOrCtrl+N")
	newConn.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "open-connections")
	})

	importItem := fileMenu.Add("Import Data...")
	importItem.SetAccelerator("CmdOrCtrl+I")
	importItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "open-import")
	})
	fileMenu.AddSeparator()
	fileMenu.AddRole(application.CloseWindow)

	// 3. Edit menu
	editMenu := menu.AddSubmenu("Edit")
	editMenu.AddRole(application.Undo)
	editMenu.AddRole(application.Redo)
	editMenu.AddSeparator()
	editMenu.AddRole(application.Cut)
	editMenu.AddRole(application.Copy)
	editMenu.AddRole(application.Paste)
	editMenu.AddRole(application.SelectAll)

	// 4. View menu
	viewMenu := menu.AddSubmenu("View")
	expItem := viewMenu.Add("Data Explorer")
	expItem.SetAccelerator("CmdOrCtrl+1")
	expItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "switch-view-explorer")
	})

	sqlItem := viewMenu.Add("SQL Console")
	sqlItem.SetAccelerator("CmdOrCtrl+2")
	sqlItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "switch-view-sql")
	})

	vqItem := viewMenu.Add("Visual Query Builder")
	vqItem.SetAccelerator("CmdOrCtrl+3")
	vqItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "switch-view-visual-query")
	})

	erdItem := viewMenu.Add("ER Diagram")
	erdItem.SetAccelerator("CmdOrCtrl+4")
	erdItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "switch-view-diagram")
	})

	adminItem := viewMenu.Add("Admin & Processes")
	adminItem.SetAccelerator("CmdOrCtrl+5")
	adminItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "switch-view-admin")
	})

	viewMenu.AddSeparator()
	themeItem := viewMenu.Add("Toggle Dark/Light Theme")
	themeItem.SetAccelerator("CmdOrCtrl+T")
	themeItem.OnClick(func(*application.Context) {
		dispatchMenuAction(window, "toggle-theme")
	})

	viewMenu.AddSeparator()
	viewMenu.AddRole(application.ZoomIn)
	viewMenu.AddRole(application.ZoomOut)
	viewMenu.AddRole(application.ResetZoom)
	viewMenu.AddSeparator()
	viewMenu.AddRole(application.ToggleFullscreen)

	// 5. Window menu
	windowMenu := menu.AddSubmenu("Window")
	windowMenu.AddRole(application.Minimise)
	windowMenu.AddRole(application.Zoom)
	windowMenu.AddSeparator()
	windowMenu.AddRole(application.BringAllToFront)

	// 6. Help menu
	helpMenu := menu.AddSubmenu("Help")
	helpMenu.Add("dodb Documentation").OnClick(func(*application.Context) {
		app.Browser.OpenURL("https://github.com/thutil/dodb")
	})
	helpMenu.Add("Report an Issue...").OnClick(func(*application.Context) {
		app.Browser.OpenURL("https://github.com/thutil/dodb/issues")
	})

	app.Menu.SetApplicationMenu(menu)
}
