// Package dodb holds the embedded frontend bundle.
//
// This file must live at the module root: go:embed patterns cannot escape the
// directory of the file that declares them, and the Next.js export lives in
// ../ui/out relative to anything under cmd/.
package dodb

import (
	"embed"
	"io/fs"
)

// The `all:` prefix is load-bearing. Without it go:embed silently skips
// directories whose names begin with "_" or "." — and the Next.js static
// export puts every chunk, style and font under ui/out/_next. A plain
// //go:embed ui/out compiles fine and ships a blank window.
//
//go:embed all:ui/out
var bundle embed.FS

// Frontend is the export rooted at ui/out, ready to hand to an asset server.
func Frontend() fs.FS {
	sub, err := fs.Sub(bundle, "ui/out")
	if err != nil {
		panic("dodb: embedded frontend is missing ui/out: " + err.Error())
	}
	return sub
}
