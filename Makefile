# dodb build entry points.
#
# The Go replacement for `tauri dev` / `tauri build`. Two things are worth
# knowing before reading further:
#
#   1. assets.go embeds ui/out at COMPILE time, so any target that produces a Go
#      binary depends on the frontend being built first. That is why `build` and
#      `run` both run the UI build, and why editing the UI and re-running only
#      `go build` shows you the previous frontend.
#   2. CGO is required (the SQLite driver, and SpatiaLite extension loading), so
#      the toolchain must be a native build for the host arch. `make doctor`
#      checks that.

SHELL := /bin/bash
VERSION ?= $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0-dev)
GO ?= go
LDFLAGS := -X main.version=$(VERSION)

# cmd/dodb is the only package that imports Wails, and Wails on Linux needs GTK4
# and WebKitGTK headers through pkg-config. Tests never need the window toolkit,
# so they run against everything else and stay buildable on a bare Linux box.
GO_TEST_PKGS = $(shell $(GO) list ./... | grep -v '/cmd/dodb$$')
DEVSERVER_ADDR ?= 127.0.0.1:5822

.DEFAULT_GOAL := help

## help: list the targets
help:
	@echo "dodb $(VERSION)"
	@echo
	@grep -E '^## [a-z-]+:' $(MAKEFILE_LIST) \
	  | sed -E 's/^## ([a-z-]+): */  make \1|/' \
	  | sort | awk -F'|' '{printf "  %-16s %s\n", $$1, $$2}' | sed 's/^  *  make/  make/'
	@echo
	@echo "  Fast loop:   make dev        (browser + fast refresh)"
	@echo "  Real window: make run        (the actual Wails app)"
	@echo "  Ship it:     make build      (.app + .dmg)"

## doctor: check the toolchain can build this
doctor:
	@echo "go:        $$($(GO) version)"
	@echo "GOARCH:    $$($(GO) env GOARCH)   (must match $$(uname -m | sed 's/x86_64/amd64/'))"
	@echo "CGO:       $$($(GO) env CGO_ENABLED)   (must be 1)"
	@[[ "$$($(GO) env CGO_ENABLED)" == "1" ]] || { echo "!! CGO is off; the SQLite driver will not build"; exit 1; }
	@echo "node:      $$(node --version)"
	@echo "pnpm:      $$(pnpm --version)"
	@echo "docker:    $$(docker --version 2>/dev/null || echo 'not running (only needed for make test-parity)')"
	@echo "OK"

## ui: build the Next.js static export into ui/out
ui:
	pnpm build:ui

## dev: run the backend and `next dev` together, in a browser
##      Fastest loop by far: fast refresh and real devtools, which no webview
##      gives you. Native file dialogs are the one thing missing here.
dev:
	@echo "backend on http://$(DEVSERVER_ADDR)"
	@echo "UI       on http://localhost:5821   <- open this one"
	@trap 'kill 0' EXIT; \
	$(GO) run ./cmd/dodb-devserver -addr $(DEVSERVER_ADDR) -ui=false & \
	NEXT_PUBLIC_DODB_API=http://$(DEVSERVER_ADDR) pnpm ui:dev & \
	wait

## devserver: just the backend, for curl-ing commands
devserver:
	$(GO) run ./cmd/dodb-devserver -addr $(DEVSERVER_ADDR)

## run: build the frontend and run the real Wails app
run: ui
	$(GO) run -ldflags "$(LDFLAGS)" ./cmd/dodb

## build: produce dist/dodb.app and dist/dodb_<version>_universal.dmg
build:
	./scripts/build-macos.sh $(VERSION)

## binary: just the Go binary for this host, into dist/dodb
binary: ui
	@mkdir -p dist
	CGO_ENABLED=1 $(GO) build -trimpath -tags production -ldflags "$(LDFLAGS)" -o dist/dodb ./cmd/dodb
	@echo "dist/dodb  ($$(du -h dist/dodb | cut -f1))"

## test: run the Go tests that need no database
test:
	$(GO) test $(GO_TEST_PKGS)

## test-parity: run the tests that diff against the Rust build's output
##              Needs the fixture databases: make fixtures-up
test-parity: fixtures-up
	$(GO) test -count=1 -v ./internal/dbcore -run TestParity

## fixtures-up: start every fixture database (3 containers + the SQLite file)
fixtures-up: testdata/fixtures/fixture.sqlite
	docker compose -f testdata/docker-compose.yml up -d
	@for i in $$(seq 1 45); do \
	  n=$$(docker compose -f testdata/docker-compose.yml ps -a --format '{{.Health}}' | grep -c healthy); \
	  [[ "$$n" == "3" ]] && break; sleep 5; \
	done
	@docker compose -f testdata/docker-compose.yml ps -a --format '{{.Service}}\t{{.Health}}'

# Rebuilt whenever the schema beside it changes, which is why it is generated
# rather than checked in.
testdata/fixtures/fixture.sqlite: testdata/fixtures/sqlite.sql
	rm -f $@
	sqlite3 $@ < $<
	@echo "built $@"

## fixtures-down: stop the fixtures and delete their data
fixtures-down:
	docker compose -f testdata/docker-compose.yml down -v
	rm -f testdata/fixtures/fixture.sqlite

## golden: regenerate the expected output from the RUST build
##         Only needed when the Rust side changes; the goldens are checked in.
##         Requires the Rust toolchain and the fixtures.
golden: fixtures-up
	DODB_ENCRYPTION_KEY=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0 \
	  cargo run --quiet --manifest-path src-tauri/Cargo.toml --example gen_crypto_golden -- env \
	  > testdata/golden/crypto_env.json
	DODB_REPO_ROOT="$$PWD" \
	  cargo run --quiet --manifest-path src-tauri/Cargo.toml --example gen_query_golden \
	  > testdata/golden/queries.json
	@echo "regenerated testdata/golden/{crypto_env,queries}.json"
	@echo "note: crypto_store.json and profiles.json need a seeded DODB_DATA_DIR; see the plan"

## fmt: gofmt every Go file
fmt:
	gofmt -l -w $$(git ls-files '*.go' | grep -v '^src-tauri/')

## vet: go vet
vet:
	$(GO) vet $(GO_TEST_PKGS)
	@# Only type-checks where the toolkit headers exist, i.e. macOS and Windows.
	@[ "$$(uname)" = "Linux" ] || $(GO) vet ./cmd/dodb

## clean: remove build output
clean:
	rm -rf dist ui/out ui/.next

.PHONY: help doctor ui dev devserver run build binary test test-parity \
        fixtures-up fixtures-down golden fmt vet clean
