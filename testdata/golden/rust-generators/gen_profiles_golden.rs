//! Emits a profiles.json written by the real Rust code, plus a matching
//! plaintext view, so the Go port can be checked for byte-identical output.
//!
//! Field order, indentation (`to_string_pretty` = 2 spaces), camelCase renaming
//! and Option-as-null all have to match, because a Go build that reformats the
//! file would rewrite every user's profiles on first save.
//!
//! Run: cargo run --example gen_profiles_golden

use app_lib::models::{ConnectionProfile, SupportedDB};
use app_lib::profiles::{load_profiles, save_profiles};

fn main() {
    let mut profiles = vec![
        ConnectionProfile {
            id: "p-postgres".into(),
            name: "prod pg".into(),
            r#type: SupportedDB::Postgres,
            host: "db.example.com".into(),
            port: 5432,
            user: "dodb".into(),
            password: "hunter2".into(),
            database: "app".into(),
            file_path: None,
            group: Some("production".into()),
            keep_alive: true,
            save_password: true,
            created_at: "2026-01-02T03:04:05Z".into(),
            updated_at: "2026-08-27T10:00:00Z".into(),
        },
        ConnectionProfile {
            id: "p-sqlite".into(),
            name: "local file".into(),
            r#type: SupportedDB::Sqlite,
            host: String::new(),
            port: 0,
            user: String::new(),
            // save_password false: this must land on disk empty, not encrypted
            password: "should-not-persist".into(),
            database: String::new(),
            file_path: Some("/tmp/local.sqlite".into()),
            group: None,
            keep_alive: false,
            save_password: false,
            created_at: "2026-02-03T00:00:00Z".into(),
            updated_at: String::new(),
        },
        ConnectionProfile {
            id: "p-maria".into(),
            // <, > and & are exactly what serde leaves alone and Go's
            // encoding/json escapes by default. A connection named
            // "staging & qa" is ordinary, so this belongs in the golden.
            name: "ทดสอบไทย <staging & qa>".into(),
            r#type: SupportedDB::Mariadb,
            host: "127.0.0.1".into(),
            port: 3306,
            user: "root".into(),
            password: String::new(),
            database: "dodb_fixture".into(),
            file_path: None,
            group: None,
            keep_alive: false,
            save_password: true,
            created_at: String::new(),
            updated_at: String::new(),
        },
    ];

    save_profiles(&mut profiles).expect("save");

    let dir = std::env::var("DODB_DATA_DIR").expect("DODB_DATA_DIR");
    let on_disk = std::fs::read_to_string(std::path::Path::new(&dir).join("profiles.json")).unwrap();

    // Round-trip through the real loader so the expected decrypted view is
    // recorded too, not just the ciphertext.
    let reloaded = load_profiles().expect("load");

    eprintln!("--- reloaded passwords ---");
    for p in &reloaded {
        eprintln!("{}: {:?} (savePassword={})", p.id, p.password, p.save_password);
    }

    print!("{on_disk}");
}
