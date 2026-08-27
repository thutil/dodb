//! Captures the exact JSON that db_core::execute_query produces, so the Go
//! decoder can be diffed against it row by row.
//!
//! This is the whole reason the port can be trusted: the row -> JSON chains in
//! db_core.rs work by trying Rust types in order and letting sqlx's type
//! compatibility rules decide, which has no equivalent in Go's database/sql. The
//! Go decoder is therefore a re-derivation, not a translation, and only a
//! byte-level diff against the real output can show it agrees.
//!
//! Nothing here touches Tauri: `DbState::default()`, `get_pool_in` and
//! `execute_query` are all public and `State`-free, so the real data path runs
//! headless.
//!
//! Run with the fixtures up:
//!   docker compose -f testdata/docker-compose.yml up -d
//!   cargo run --manifest-path src-tauri/Cargo.toml --example gen_query_golden

use app_lib::db_core::{execute_query, get_pool_in, DbState};
use app_lib::models::{ConnectionProfile, SupportedDB};
use serde_json::{json, Value};

fn profile(target: &str, repo_root: &str) -> ConnectionProfile {
    let mut p = ConnectionProfile {
        id: format!("fixture-{target}"),
        name: target.to_string(),
        save_password: true,
        ..Default::default()
    };
    match target {
        "postgres" => {
            p.r#type = SupportedDB::Postgres;
            p.host = "127.0.0.1".into();
            p.port = 55432;
            p.user = "dodb".into();
            p.password = "dodb".into();
            p.database = "dodb_fixture".into();
        }
        "mysql" => {
            p.r#type = SupportedDB::Mariadb;
            p.host = "127.0.0.1".into();
            p.port = 53306;
            p.user = "root".into();
            p.password = "dodb".into();
            p.database = "dodb_fixture".into();
        }
        "mariadb" => {
            p.r#type = SupportedDB::Mariadb;
            p.host = "127.0.0.1".into();
            p.port = 53307;
            p.user = "root".into();
            p.password = "dodb".into();
            p.database = "dodb_fixture".into();
        }
        "sqlite" => {
            p.r#type = SupportedDB::Sqlite;
            p.file_path = Some(format!("{repo_root}/testdata/fixtures/fixture.sqlite"));
        }
        other => panic!("unknown target {other}"),
    }
    p
}

#[tokio::main]
async fn main() {
    let repo_root = std::env::var("DODB_REPO_ROOT").unwrap_or_else(|_| "..".into());
    let raw = std::fs::read_to_string(format!("{repo_root}/testdata/queries.json"))
        .expect("read testdata/queries.json");
    let spec: Value = serde_json::from_str(&raw).expect("parse queries.json");
    let cases = spec["cases"].as_array().expect("cases array");

    let targets = ["postgres", "mysql", "mariadb", "sqlite"];
    let state = DbState::default();
    let mut out = Vec::new();
    let mut failures = Vec::new();

    for target in targets {
        let prof = profile(target, &repo_root);
        for case in cases {
            let applies = case["targets"]
                .as_array()
                .map(|a| a.iter().any(|t| t.as_str() == Some(target)))
                .unwrap_or(false);
            if !applies {
                continue;
            }
            let name = case["name"].as_str().unwrap();
            let sql = case["sql"].as_str().unwrap();

            let pool = match get_pool_in(&state, &prof, None).await {
                Ok(p) => p,
                Err(e) => {
                    failures.push(format!("{target}/{name}: pool: {e}"));
                    continue;
                }
            };
            match execute_query(&pool, sql).await {
                Ok(rows) => out.push(json!({
                    "target": target,
                    "case": name,
                    "sql": sql,
                    "rows": rows,
                })),
                Err(e) => failures.push(format!("{target}/{name}: query: {e}")),
            }
        }
    }

    if !failures.is_empty() {
        eprintln!("--- {} failure(s) ---", failures.len());
        for f in &failures {
            eprintln!("  {f}");
        }
    }
    eprintln!("captured {} result set(s)", out.len());

    // Pretty-printed so a diff on the golden file is reviewable by eye.
    println!("{}", serde_json::to_string_pretty(&json!({ "results": out })).unwrap());

    if !failures.is_empty() {
        std::process::exit(1);
    }
}
