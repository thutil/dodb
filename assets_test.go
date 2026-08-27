package dodb

import (
	"embed"
	"io/fs"
	"strings"
	"testing"
)

// naiveBundle is the mistake this test exists to catch: the same pattern
// without the `all:` prefix. Keeping both side by side turns "remember the
// prefix" into a failing test rather than a code comment nobody reads.
//
//go:embed ui/out
var naiveBundle embed.FS

func count(t *testing.T, f fs.FS, pred func(string) bool) int {
	t.Helper()
	n := 0
	if err := fs.WalkDir(f, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && pred(p) {
			n++
		}
		return nil
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
	return n
}

func TestFrontendIncludesNextChunks(t *testing.T) {
	f := Frontend()

	if _, err := fs.Stat(f, "index.html"); err != nil {
		t.Fatalf("index.html missing from embedded bundle: %v", err)
	}

	next := count(t, f, func(p string) bool { return strings.HasPrefix(p, "_next/") })
	if next == 0 {
		t.Fatal("no files under _next/: the go:embed pattern lost the `all:` prefix, " +
			"which ships a bundle that renders a blank window")
	}
	t.Logf("embedded %d files under _next/", next)
}

func TestNaiveEmbedDropsNextDirectory(t *testing.T) {
	naive := count(t, naiveBundle, func(string) bool { return true })
	full := count(t, bundle, func(string) bool { return true })

	if naive >= full {
		t.Skipf("naive embed kept %d of %d files; Go's underscore rule may have changed", naive, full)
	}
	t.Logf("`all:` prefix rescues %d files (plain embed: %d, all: %d)", full-naive, naive, full)
}
