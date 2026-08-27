# Building and developing dodb

dodb is a **Go + Wails v3** desktop app with a **Next.js** frontend. The Rust /
Tauri implementation was replaced in v0.3.0; if you are looking for `src-tauri`,
see [the note at the bottom](#where-did-the-rust-go).

---

## TL;DR

```bash
make doctor    # check your toolchain can build this
make dev       # fast loop: backend + next dev, in a browser
make run       # the real desktop window
make build     # dist/dodb.app and dist/dodb_<version>_universal.dmg
```

`pnpm dev`, `pnpm run`, `pnpm build` and `pnpm test` are thin wrappers over the
same targets, so old muscle memory still works.

---

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Go | 1.25+ | the floor comes from a dependency, not from this code; `go.mod` records it, so `go build` will tell you if yours is too old |
| Node | 18+ | Next.js 16 |
| pnpm | 9+ | workspace resolution |
| Xcode command line tools | any recent | CGO needs a C compiler, and the macOS bundle needs `codesign` / `lipo` |
| Docker | optional | only for the parity tests |
| `sqlite3` CLI | optional | only for building the SQLite fixture |

### Two things that will bite you

**1. The Go toolchain must be native for your CPU.**

CGO is mandatory here — the SQLite driver needs it, and so does loading the
SpatiaLite extension — so an `amd64` Go on an Apple Silicon Mac (easy to end up
with, and it runs fine under Rosetta) produces confusing failures. `make doctor`
checks it:

```
$ make doctor
go:        go version go1.27.0 darwin/arm64
GOARCH:    arm64   (must match arm64)
CGO:       1   (must be 1)
```

If `GOARCH` does not match `uname -m`, reinstall Go — `brew install go` gives you
the right one, and Homebrew's `bin` already precedes `/usr/local/go/bin` on a
standard setup.

**2. The frontend is embedded at compile time.**

`assets.go` does `//go:embed all:ui/out`. That means:

- editing the UI and re-running only `go build` ships you the **previous**
  frontend. `make run` and `make build` rebuild the UI first for this reason.
- the `all:` prefix is load-bearing. `go:embed` silently skips directories whose
  names begin with `_`, and the Next.js export puts every chunk, style and font
  under `ui/out/_next`. Dropping `all:` compiles fine and ships a **blank
  window**. `assets_test.go` fails if anyone removes it.
- one placeholder file, `ui/out/EMBED_PLACEHOLDER`, is committed. `go:embed` is
  resolved at compile time and needs at least one match, so without it
  `go build ./...` on a fresh clone fails with `pattern all:ui/out: no matching
  files found` — an error that says nothing about the real cause. With it, the Go
  toolchain works before the frontend has ever been built, and `assets_test.go`
  skips itself and tells you to run `make ui`.

---

## The three ways to run it

### `make dev` — browser, fast refresh

Runs `cmd/dodb-devserver` on `127.0.0.1:5822` and `next dev` on `localhost:5821`.
Open **5821**.

This is by far the fastest loop: real fast refresh and real browser devtools,
neither of which a webview gives you.

`output: "export"` means Next.js rewrites do not work, so the UI cannot proxy
`/invoke`. Instead `NEXT_PUBLIC_DODB_API` points `apiClient` straight at the
backend; `make dev` sets it for you. In the packaged app the variable is empty
and every call is same-origin against the Wails asset server.

**What is missing here:** native file dialogs. `select_file`, `pick_import_file`
and every export return a clear error, because a browser has no dialogs to offer.
Use `make run` to exercise those.

### `make run` — the real window

Builds the frontend, embeds it, and runs the actual Wails app. Everything works,
including dialogs. Slower, because the UI is rebuilt every time.

### `make devserver` — backend only, for `curl`

The backend speaks plain HTTP, so every command is reachable without a GUI:

```bash
make devserver

inv() { curl -s -X POST "http://127.0.0.1:5822/invoke/$1" \
          -H 'content-type: application/json' -d "${2:-{\}}"; echo; }

inv app_version
ID=$(inv register_session_profile '{"profile":{
  "name":"local","type":"postgres","host":"127.0.0.1","port":55432,
  "user":"dodb","password":"dodb","database":"dodb_fixture","savePassword":true}}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

inv get_tables "{\"id\":\"$ID\",\"database\":\"dodb_fixture\"}"
inv get_rows   "{\"id\":\"$ID\",\"database\":\"dodb_fixture\",\"table\":\"hazards\",\"limit\":2,\"offset\":0}"
```

`curl http://127.0.0.1:5822/healthz` reports how many commands are registered.

> `dodb-devserver` holds live database credentials and binds to loopback with
> permissive CORS. It is a development tool and must never be the binary you
> ship.

---

## Building a release

```bash
make build                  # version comes from package.json
make build VERSION=0.3.0    # or set it explicitly
```

Produces:

```
dist/dodb.app
dist/dodb_0.3.0_universal.dmg
```

The DMG filename is a **contract** — `Casks/dodb.rb` and the release workflow
both hardcode `dodb_<version>_universal.dmg`. Renaming it breaks Homebrew.

### What `scripts/build-macos.sh` does

1. `pnpm build:ui` → `ui/out`
2. `go build` for `arm64`, then for `amd64`, then `lipo` them into one binary
3. assembles `dodb.app` (`Info.plist` from `build/darwin/`, icon from `assets/`)
4. `codesign` with hardened runtime and `build/darwin/entitlements.plist`
5. `hdiutil create` the DMG
6. `notarytool submit` + `stapler staple`, if the credentials are present

Steps 4 and 6 are opt-in through environment variables, so a local build works
with no Apple account:

| Variable | Effect if set |
|---|---|
| `APPLE_SIGNING_IDENTITY` | signs with that identity instead of ad-hoc |
| `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` | notarizes and staples (all three required) |

With none of them, the DMG is **ad-hoc signed** — which is what dodb releases
have always been. Gatekeeper still refuses first launch, so users clear
quarantine by hand. See [SIGNING.md](SIGNING.md) for how to fix that properly.

### Other targets

```bash
make binary   # just a host-arch binary in dist/dodb, no bundle. Fastest full check.
make ui       # frontend only
make fmt      # gofmt every Go file
make vet      # go vet
make clean    # remove dist/, ui/out, ui/.next
```

### Windows

CI builds it (`.github/workflows/release.yml`), producing a **zip**, not an
installer: the Tauri build made `.msi`/`.exe` through WiX and NSIS and neither
has been ported. Locally, on Windows with MinGW installed:

```bash
pnpm build:ui
CGO_ENABLED=1 go build -trimpath -ldflags "-H windowsgui -X main.version=0.3.0" -o dist/dodb.exe ./cmd/dodb
```

---

## Tests

```bash
make test          # everything that needs no database. Fast.
make fixtures-up   # start Postgres + MySQL + MariaDB and build the SQLite file
make test-parity   # diff decoded rows against output recorded from the Rust build
make fixtures-down # stop them and delete their data
```

### What the parity suite actually is

`testdata/golden/` holds output captured from the **Rust implementation** running
against the same fixture databases. The Go row decoders are a *re-derivation*,
not a translation — sqlx decided a value's type by trying Rust types in order,
and Go's `database/sql` has no equivalent — so the only way to show the two agree
is to diff real output.

A diff in `testdata/golden/` is a **bug report about the Go code**, not a file to
refresh. See [`testdata/golden/rust-generators/README.md`](../testdata/golden/rust-generators/README.md).

The fixtures are not "some databases to talk to": they hold the values that make
row decoding go wrong. A `numeric(30,10)` that loses digits through a float, a
`tinyint(1)` next to a real `BOOLEAN`, timestamps with and without a zone, PostGIS
geometry no driver understands, and column labels that collide across a join.

### Regenerating the goldens

You should not need to. If you must, the Rust tree is still in git history and
the generators are archived — the linked README has the steps.

---

## Layout

```
cmd/dodb/            the desktop app (Wails)
cmd/dodb-devserver/  the same commands over plain HTTP
internal/
  api/               the 33 commands, defined once, transport-agnostic
  crypto/            master key and AES-GCM password sealing
  profilestore/      ~/.dodb/profiles.json
  dbcore/            pools, the Postgres connect ladder, row -> JSON
  dialect/           identifier quoting, literal escaping, filter -> WHERE
  importer/          .sql / .csv / .json loading
  orderedjson/       a JSON object that remembers key order
  model/             wire types
  transport/httprpc/ POST /invoke/<command>
assets.go            //go:embed all:ui/out
build/darwin/        Info.plist, entitlements
scripts/             build-macos.sh, sync-version.js
testdata/            fixtures, golden files, the shared parity query list
ui/                  Next.js frontend
```

### How the frontend reaches the backend

Every call goes through **one file**: `ui/src/utils/apiClient.ts`. It POSTs to
`/invoke/<command_name>` with the arguments as JSON. Command names and argument
shapes are unchanged from the Tauri build, which is why the port touched almost
no components.

`run_import` is the exception: it streams progress as Server-Sent Events, because
an import can run for minutes and there is a progress bar to feed.

Adding a command means three places: a method on `internal/api.Service`, a route
in `internal/transport/httprpc/routes.go`, and a method on `apiClient`.

---

## Releasing

```bash
node scripts/sync-version.js 0.3.0   # package.json, ui/package.json, Casks/dodb.rb
git commit -am "chore: release v0.3.0"
git tag v0.3.0
git push origin main --tags
```

The tag triggers `release.yml`, which builds both platforms, publishes the
release, and regenerates the Homebrew cask from the real artifact's checksum.

The Go binary takes its version from an `-ldflags` stamp at build time, so there
is nothing version-shaped to sync on that side.

---

## Where did the Rust go?

`src-tauri/` was removed in v0.3.0. It is still in git history:

```bash
git checkout 6afe6d2 -- src-tauri
```

The port kept the on-disk format (`~/.dodb/profiles.json`, `~/.dodb/.master_key`),
the bundle identifier (`com.thutil.dodb`), and all 33 IPC command names, so a
v0.2.x install upgrades in place with its saved passwords intact.

Two behaviours deliberately differ, both documented at their call sites:

- **`tinyint(1)` in arbitrary console SQL** renders as `1` rather than `true`.
  go-sql-driver does not expose the display width sqlx used to identify a
  boolean. Table-scoped reads (everything the DataGrid shows) recover it from
  `information_schema`; see `internal/dbcore/colmeta.go`.
- **A MariaDB `JSON` column in arbitrary console SQL** arrives as a string rather
  than a parsed object, for the same reason — MariaDB implements JSON as
  `longtext` plus a `json_valid()` constraint.
