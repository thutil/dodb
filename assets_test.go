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

// placeholderName is the committed file that keeps go:embed satisfied before the
// frontend has been built. See ui/out/EMBED_PLACEHOLDER.
const placeholderName = "EMBED_PLACEHOLDER"

// bundleIsPlaceholderOnly reports that no real frontend has been built yet.
//
// Skipping rather than failing here is deliberate: `go test ./...` on a fresh
// clone should tell you what to run, not look like a broken repo. The macOS CI
// job builds the frontend first, so this test does run for real somewhere.
func bundleIsPlaceholderOnly(t *testing.T, f fs.FS) bool {
	t.Helper()
	real := count(t, f, func(p string) bool { return p != placeholderName })
	return real == 0
}

func TestFrontendIncludesNextChunks(t *testing.T) {
	f := Frontend()
	if bundleIsPlaceholderOnly(t, f) {
		t.Skip("no frontend bundle embedded yet - run `pnpm build:ui` (or `make ui`) first")
	}

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
	if bundleIsPlaceholderOnly(t, Frontend()) {
		t.Skip("no frontend bundle embedded yet - run `pnpm build:ui` (or `make ui`) first")
	}

	naive := count(t, naiveBundle, func(string) bool { return true })
	full := count(t, bundle, func(string) bool { return true })

	if naive >= full {
		t.Skipf("naive embed kept %d of %d files; Go's underscore rule may have changed", naive, full)
	}
	t.Logf("`all:` prefix rescues %d files (plain embed: %d, all: %d)", full-naive, naive, full)
}
