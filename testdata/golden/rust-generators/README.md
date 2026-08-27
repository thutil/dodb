# Where the golden files came from

Every expected value in `testdata/golden/` was produced by the **Rust build** —
the Tauri implementation that the Go port replaced — running against the fixture
databases in `testdata/docker-compose.yml`. They are the reason the port can be
trusted: the Go decoders are a re-derivation rather than a translation, and only
a byte-level diff against real output could show that the two agree.

The generators are archived here because `src-tauri/` has been removed. They no
longer compile against anything in this tree.

## If you ever need to regenerate them

The Rust tree is still in git history:

```bash
git checkout 6afe6d2 -- src-tauri   # the last commit that carried it
cp testdata/golden/rust-generators/*.rs src-tauri/examples/

docker compose -f testdata/docker-compose.yml up -d
DODB_REPO_ROOT="$PWD" cargo run --manifest-path src-tauri/Cargo.toml \
  --example gen_query_golden > testdata/golden/queries.json

git rm -r --cached src-tauri && rm -rf src-tauri   # put it back
```

In practice you should not need to. The goldens describe behaviour that is now
frozen: they are the contract the frontend already depends on, so a change in
them is a change the frontend would see. Treat a diff here as a bug report about
the Go code, not as a file to refresh.

## What each one captured

| Generator | Produces | Pins |
|---|---|---|
| `gen_crypto_golden.rs` | `crypto_env.json`, `crypto_store.json` | AES-GCM wire format across all three key generations, and both master-key derivation paths |
| `gen_profiles_golden.rs` | `profiles.json` | the exact bytes `serde_json::to_string_pretty` writes for `~/.dodb/profiles.json` |
| `gen_query_golden.rs` | `queries.json` | row → JSON decoding for 41 result sets across Postgres, MySQL, MariaDB and SQLite |
