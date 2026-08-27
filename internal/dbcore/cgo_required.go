//go:build !cgo

package dbcore

// This file exists only to fail the build when cgo is disabled.
//
// Without it, CGO_ENABLED=0 produces a binary that looks entirely healthy: the
// SQLite driver still registers itself, so sql.Drivers() lists "sqlite3" and
// sql.Open succeeds, and the failure only appears on the first query as
//
//	Binary was compiled with 'CGO_ENABLED=0', go-sqlite3 requires cgo to
//	work. This is a stub
//
// That is a failure the user discovers, not one CI does. Nothing else in the app
// needs cgo -- Wails on Windows drives WebView2 through pure Go, and both other
// drivers are pure Go too -- so a build with cgo switched off compiles cleanly
// and ships broken SQLite support. Loading the SpatiaLite extension needs cgo
// as well.
//
// The compile error names the fix:
//
//	undefined: dodbMustBeBuiltWithCGO_ENABLED_1
func init() {
	dodbMustBeBuiltWithCGO_ENABLED_1()
}
