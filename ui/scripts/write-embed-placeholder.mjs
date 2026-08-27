// Writes ui/out/EMBED_PLACEHOLDER after every frontend build.
//
// assets.go carries `//go:embed all:ui/out`, which is resolved at compile time
// and needs at least one matching file. A committed placeholder is not enough on
// its own: `next build` clears ui/out before writing the export, so it deletes
// the file on every build and the next `git add -A` stages that deletion. This
// runs as part of the build script, so the placeholder restores itself no matter
// how the frontend was built.
//
// It also does not start with a dot: assets_test.go carries a second,
// prefix-less `//go:embed ui/out` to prove the `all:` prefix is necessary, and
// that pattern skips dot-prefixed files.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, "..", "out", "EMBED_PLACEHOLDER");

const body = `This file keeps the //go:embed patterns in assets.go and assets_test.go
satisfiable. It is written by ui/scripts/write-embed-placeholder.mjs, which runs
at the end of the frontend build, and a copy is committed so that a fresh clone
can run \`go build ./...\` before the frontend has ever been built.

Without it, the Go toolchain fails with

    pattern all:ui/out: no matching files found

which says nothing about the real cause. Do not rename it to a dot-file: a plain
\`//go:embed ui/out\` skips those, and assets_test.go relies on that pattern.
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, body);
console.log("wrote ui/out/EMBED_PLACEHOLDER");
