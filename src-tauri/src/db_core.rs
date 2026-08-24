use crate::import::{ImportFailure, OnError, TxMode};
use crate::models::{ConnectionProfile, SupportedDB};
use sqlx::{Acquire, Column, Row, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::State;

#[derive(Clone)]
pub enum DbPool {
    Postgres(sqlx::PgPool),
    MySql(sqlx::MySqlPool),
    Sqlite(sqlx::SqlitePool),
}

pub struct DbState {
    pub pools: Mutex<HashMap<String, DbPool>>,
    pub session_profiles: Mutex<HashMap<String, ConnectionProfile>>,
    pub runtime_passwords: Mutex<HashMap<String, String>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            session_profiles: Mutex::new(HashMap::new()),
            runtime_passwords: Mutex::new(HashMap::new()),
        }
    }
}

/// Prefix that marks a connection as unsaved (session-only).
pub const SESSION_ID_PREFIX: &str = "session-";

/// Finds the connection a command should use: unsaved session connections
/// first, then the profiles on disk. Every data command resolves its `id`
/// through here, so an unsaved connection works exactly like a saved one.
pub fn resolve_profile(state: &State<'_, DbState>, id: &str) -> Result<ConnectionProfile, String> {
    resolve_profile_in(state.inner(), id)
}

/// The lookup itself, independent of Tauri's `State` wrapper so it can be tested.
pub fn resolve_profile_in(state: &DbState, id: &str) -> Result<ConnectionProfile, String> {
    if id.trim().is_empty() {
        return Err("No connection was selected. Open the connection dialog and connect first.".to_string());
    }
    {
        let sessions = state.session_profiles.lock().map_err(|e| e.to_string())?;
        if let Some(p) = sessions.get(id) {
            return Ok(p.clone());
        }
    }
    let mut profile = crate::profiles::load_profiles()?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| {
            if id.starts_with(SESSION_ID_PREFIX) {
                format!(
                    "Connection '{}' is gone. Unsaved connections only live while the app is running - open the connection dialog and connect again.",
                    id
                )
            } else {
                format!("Connection '{}' not found. It may have been deleted - pick it again in the connection dialog.", id)
            }
        })?;

    if profile.password.is_empty() {
        let runtime = state.runtime_passwords.lock().map_err(|e| e.to_string())?;
        if let Some(pw) = runtime.get(id) {
            profile.password = pw.clone();
        }
    }

    Ok(profile)
}

pub const CONNECTION_TIMEOUT_SECS: u64 = 180;

fn tune_pool<DB: sqlx::Database>(
    opts: sqlx::pool::PoolOptions<DB>,
    keep_alive: bool,
) -> sqlx::pool::PoolOptions<DB> {
    let opts = opts
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(CONNECTION_TIMEOUT_SECS));
    if keep_alive {
        opts.min_connections(1)
            .idle_timeout(None)
            .max_lifetime(None)
            .test_before_acquire(true)
    } else {
        opts
    }
}

impl DbPool {
    pub async fn close(&self) {
        match self {
            DbPool::Postgres(p) => p.close().await,
            DbPool::MySql(p) => p.close().await,
            DbPool::Sqlite(p) => p.close().await,
        }
    }
}

pub async fn close_profile_pools(state: &State<'_, DbState>, profile_id: Option<&str>) -> Result<(), String> {
    close_profile_pools_in(state.inner(), profile_id).await
}

/// Same as `close_profile_pools`, without Tauri's `State` wrapper.
pub async fn close_profile_pools_in(state: &DbState, profile_id: Option<&str>) -> Result<(), String> {
    let mut pools_to_close = Vec::new();
    {
        let mut pools = state.pools.lock().map_err(|e| e.to_string())?;
        match profile_id {
            Some(id) if !id.trim().is_empty() => {
                let prefix = format!("{}:", id.trim());
                let keys: Vec<String> = pools.keys().filter(|k| k.starts_with(&prefix)).cloned().collect();
                for k in keys {
                    if let Some(p) = pools.remove(&k) {
                        pools_to_close.push(p);
                    }
                }
            }
            _ => {
                for (_, p) in pools.drain() {
                    pools_to_close.push(p);
                }
            }
        }
    }
    for pool in pools_to_close {
        pool.close().await;
    }
    Ok(())
}

pub async fn get_pool(
    state: &State<'_, DbState>,
    profile: &ConnectionProfile,
    database_override: Option<&str>,
) -> Result<DbPool, String> {
    get_pool_in(state.inner(), profile, database_override).await
}

/// The pool lookup itself, independent of Tauri's `State` wrapper so the
/// connect path can be exercised in tests.
pub async fn get_pool_in(
    state: &DbState,
    profile: &ConnectionProfile,
    database_override: Option<&str>,
) -> Result<DbPool, String> {
    let db_name = match database_override {
        Some(db) if !db.trim().is_empty() => db.trim().to_string(),
        _ => {
            if !profile.database.trim().is_empty() {
                profile.database.trim().to_string()
            } else if profile.r#type == SupportedDB::Postgres {
                "postgres".to_string()
            } else if profile.r#type == SupportedDB::Mariadb {
                "mysql".to_string()
            } else {
                "".to_string()
            }
        }
    };

    let cache_key = match profile.r#type {
        SupportedDB::Sqlite => {
            let path = if !db_name.is_empty() && db_name != "main" && db_name != ":memory:" {
                db_name.clone()
            } else {
                profile.file_path.clone().unwrap_or_else(|| ":memory:".to_string())
            };
            format!("{}:sqlite:{}", profile.id, path)
        }
        _ => format!("{}:{}:{}:{}:{:?}:{}", profile.id, profile.host, profile.port, profile.user, profile.r#type, db_name),
    };

    {
        let pools = state.pools.lock().map_err(|e| e.to_string())?;
        if let Some(pool) = pools.get(&cache_key) {
            return Ok(pool.clone());
        }
    }

    let pool = match profile.r#type {
        SupportedDB::Postgres => {
            let url = format!(
                "postgres://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, db_name
            );
            
            let connect_opts = url.parse::<sqlx::postgres::PgConnectOptions>()
                .unwrap_or_else(|_| {
                    sqlx::postgres::PgConnectOptions::new()
                        .host(&profile.host)
                        .port(profile.port)
                        .username(&profile.user)
                        .password(&profile.password)
                        .database(&db_name)
                });

            // Try connecting with Prefer first, fallback to Disable if server fails on SSLRequest
            let connect_res = tune_pool(sqlx::postgres::PgPoolOptions::new(), profile.keep_alive)
                .connect_with(connect_opts.clone().ssl_mode(sqlx::postgres::PgSslMode::Prefer))
                .await;

            let p = match connect_res {
                Ok(pool) => pool,
                Err(err) => {
                    let err_msg = err.to_string();
                    if err_msg.contains("SSLRequest") || err_msg.contains("tls") || err_msg.contains("ssl") || err_msg.contains("0x5a") {
                        tune_pool(sqlx::postgres::PgPoolOptions::new(), profile.keep_alive)
                            .connect_with(connect_opts.ssl_mode(sqlx::postgres::PgSslMode::Disable))
                            .await
                            .map_err(|e2| format!("Failed to connect to Postgres database '{}': {}", db_name, e2))?
                    } else {
                        return Err(format!("Failed to connect to Postgres database '{}': {}", db_name, err));
                    }
                }
            };
            DbPool::Postgres(p)
        }
        SupportedDB::Mariadb => {
            let url = format!(
                "mysql://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, db_name
            );
            let p = tune_pool(sqlx::mysql::MySqlPoolOptions::new(), profile.keep_alive)
                .connect(&url)
                .await
                .map_err(|e| format!("Failed to connect to MySQL database '{}': {}", db_name, e))?;
            DbPool::MySql(p)
        }
        SupportedDB::Sqlite => {
            let path = if !db_name.is_empty() && db_name != "main" && db_name != ":memory:" {
                db_name.clone()
            } else {
                profile.file_path.clone().unwrap_or_else(|| ":memory:".to_string())
            };
            let url = format!("sqlite://{}", path);
            let p = tune_pool(sqlx::sqlite::SqlitePoolOptions::new(), profile.keep_alive)
                .connect(&url)
                .await
                .map_err(|e| format!("Failed to open SQLite database '{}': {}", path, e))?;
            DbPool::Sqlite(p)
        }
    };

    let mut pools = state.pools.lock().map_err(|e| e.to_string())?;
    pools.insert(cache_key, pool.clone());

    Ok(pool)
}

pub async fn test_connection_standalone(profile: &ConnectionProfile) -> Result<bool, String> {
    let timeout = std::time::Duration::from_secs(10);
    match profile.r#type {
        SupportedDB::Postgres => {
            let db_name = if !profile.database.trim().is_empty() {
                profile.database.trim().to_string()
            } else {
                "postgres".to_string()
            };
            let url = format!(
                "postgres://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, db_name
            );
            let connect_opts = url.parse::<sqlx::postgres::PgConnectOptions>()
                .unwrap_or_else(|_| {
                    sqlx::postgres::PgConnectOptions::new()
                        .host(&profile.host)
                        .port(profile.port)
                        .username(&profile.user)
                        .password(&profile.password)
                        .database(&db_name)
                });
            let pool = match sqlx::postgres::PgPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(timeout)
                .connect_with(connect_opts.clone().ssl_mode(sqlx::postgres::PgSslMode::Prefer))
                .await {
                    Ok(p) => p,
                    Err(err) => {
                        let err_msg = err.to_string();
                        if err_msg.contains("SSLRequest") || err_msg.contains("tls") || err_msg.contains("ssl") || err_msg.contains("0x5a") {
                            sqlx::postgres::PgPoolOptions::new()
                                .max_connections(1)
                                .acquire_timeout(timeout)
                                .connect_with(connect_opts.ssl_mode(sqlx::postgres::PgSslMode::Disable))
                                .await
                                .map_err(|e2| format!("Failed to connect to Postgres database '{}': {}", db_name, e2))?
                        } else {
                            return Err(format!("Failed to connect to Postgres database '{}': {}", db_name, err));
                        }
                    }
                };
            pool.close().await;
            Ok(true)
        }
        SupportedDB::Mariadb => {
            let db_name = if !profile.database.trim().is_empty() {
                profile.database.trim().to_string()
            } else {
                "mysql".to_string()
            };
            let url = format!(
                "mysql://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, db_name
            );
            let pool = sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(1)
                .acquire_timeout(timeout)
                .connect(&url)
                .await
                .map_err(|e| format!("Failed to connect to MySQL database '{}': {}", db_name, e))?;
            pool.close().await;
            Ok(true)
        }
        SupportedDB::Sqlite => {
            let path = if !profile.database.trim().is_empty() && profile.database.trim() != "main" && profile.database.trim() != ":memory:" {
                profile.database.trim()
            } else {
                profile.file_path.as_deref().unwrap_or(":memory:")
            };
            let url = format!("sqlite://{}", path);
            let pool = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(1)
                .acquire_timeout(timeout)
                .connect(&url)
                .await
                .map_err(|e| format!("Failed to open SQLite database '{}': {}", path, e))?;
            pool.close().await;
            Ok(true)
        }
    }
}

pub fn decode_bytes_or_hex(bytes: &[u8]) -> String {
    if let Ok(s) = std::str::from_utf8(bytes) {
        if !s.chars().any(|c| c.is_control() && c != '\n' && c != '\r' && c != '\t') {
            return s.to_string();
        }
    }
    bytes.iter().map(|b| format!("{:02X}", b)).collect()
}

/// Whether a column should be presented as a JSON boolean.
///
/// sqlx declares `bool` compatible with *every* integer width on MySQL
/// (TINYINT..BIGINT and BIT) and with SQLite's INTEGER affinity, so a plain
/// `try_get::<bool>()` first in the decode chain silently claims ordinary
/// integer columns and renders them as `true`/`false` - an auto-increment
/// `BIGINT(20)` id or a `COUNT(*)` would come back as `true`. Only a column
/// the driver actually names a boolean is decoded as one: MySQL `TINYINT(1)`
/// (reported as `BOOLEAN`) and a SQLite column declared `BOOLEAN`/`BOOL`.
/// Everything else - `BIT`, `YEAR`, all integer widths - stays numeric.
fn is_boolean_column<C: Column>(column: &C) -> bool {
    column.type_info().name().eq_ignore_ascii_case("BOOLEAN")
}

fn unique_col_name(map: &serde_json::Map<String, serde_json::Value>, raw_name: &str) -> String {
    if !map.contains_key(raw_name) {
        return raw_name.to_string();
    }
    let mut suffix = 1;
    loop {
        let candidate = format!("{}_{}", raw_name, suffix);
        if !map.contains_key(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

pub async fn execute_query(pool: &DbPool, query: &str) -> Result<Vec<serde_json::Value>, String> {
    match pool {
        DbPool::Postgres(p) => {
            let rows = sqlx::query(query).fetch_all(p).await.map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in rows {
                let mut map = serde_json::Map::new();
                for (i, column) in row.columns().iter().enumerate() {
                    let col_name = unique_col_name(&map, column.name());
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(col_name, serde_json::Value::Null);
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<bool, _>(i) {
                        map.insert(col_name, serde_json::Value::Bool(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i16, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i8, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(col_name, serde_json::Value::Number(num));
                        } else {
                            map.insert(col_name, serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<f32, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v as f64) {
                            map.insert(col_name, serde_json::Value::Number(num));
                        } else {
                            map.insert(col_name, serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<rust_decimal::Decimal, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::FixedOffset>, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<uuid::Uuid, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(col_name, v);
                    } else if let Ok(v) = row.try_get::<Vec<String>, _>(i) {
                        map.insert(col_name, serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<i64>, _>(i) {
                        map.insert(col_name, serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<i32>, _>(i) {
                        map.insert(col_name, serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else {
                        map.insert(col_name, serde_json::Value::Null);
                    }
                }
                result.push(serde_json::Value::Object(map));
            }
            Ok(result)
        }
        DbPool::MySql(p) => {
            let rows = sqlx::query(query).fetch_all(p).await.map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in rows {
                let mut map = serde_json::Map::new();
                for (i, column) in row.columns().iter().enumerate() {
                    let col_name = unique_col_name(&map, column.name());
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(col_name, serde_json::Value::Null);
                            continue;
                        }
                    }

                    // Booleans are decoded only for columns the driver calls a
                    // boolean; see `is_boolean_column`. A failure here still
                    // falls through to the generic chain below.
                    if is_boolean_column(column) {
                        if let Ok(v) = row.try_get::<bool, _>(i) {
                            map.insert(col_name, serde_json::Value::Bool(v));
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u64, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u32, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i16, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u16, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i8, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u8, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(col_name, serde_json::Value::Number(num));
                        } else {
                            map.insert(col_name, serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<f32, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v as f64) {
                            map.insert(col_name, serde_json::Value::Number(num));
                        } else {
                            map.insert(col_name, serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<rust_decimal::Decimal, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(col_name, v);
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        // Same unchecked fallback as the Postgres branch: spatial and other
                        // driver-unknown types would otherwise be dropped as null.
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else {
                        map.insert(col_name, serde_json::Value::Null);
                    }
                }
                result.push(serde_json::Value::Object(map));
            }
            Ok(result)
        }
        DbPool::Sqlite(p) => {
            let rows = sqlx::query(query).fetch_all(p).await.map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in rows {
                let mut map = serde_json::Map::new();
                for (i, column) in row.columns().iter().enumerate() {
                    let col_name = unique_col_name(&map, column.name());
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(col_name, serde_json::Value::Null);
                            continue;
                        }
                    }

                    // Booleans are decoded only for columns the driver calls a
                    // boolean; see `is_boolean_column`. A failure here still
                    // falls through to the generic chain below.
                    if is_boolean_column(column) {
                        if let Ok(v) = row.try_get::<bool, _>(i) {
                            map.insert(col_name, serde_json::Value::Bool(v));
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(col_name, serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(col_name, serde_json::Value::Number(num));
                        } else {
                            map.insert(col_name, serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(col_name, v);
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        // Same unchecked fallback as the Postgres branch: spatial and other
                        // driver-unknown types would otherwise be dropped as null.
                        let s = decode_bytes_or_hex(&v);
                        map.insert(col_name, serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(col_name, serde_json::Value::String(v));
                    } else {
                        map.insert(col_name, serde_json::Value::Null);
                    }
                }
                result.push(serde_json::Value::Object(map));
            }
            Ok(result)
        }
    }
}

pub fn escape_sql_literal(db_type: SupportedDB, raw: &str) -> String {
    match db_type {
        SupportedDB::Mariadb => raw.replace('\\', "\\\\").replace('\'', "''"),
        SupportedDB::Postgres | SupportedDB::Sqlite => raw.replace('\'', "''"),
    }
}

pub async fn execute_command_raw(pool: &DbPool, command: &str) -> Result<u64, String> {
    match pool {
        DbPool::Postgres(p) => {
            let res = sqlx::query(command).execute(p).await.map_err(|e| e.to_string())?;
            Ok(res.rows_affected())
        }
        DbPool::MySql(p) => {
            let res = sqlx::query(command).execute(p).await.map_err(|e| e.to_string())?;
            Ok(res.rows_affected())
        }
        DbPool::Sqlite(p) => {
            let res = sqlx::query(command).execute(p).await.map_err(|e| e.to_string())?;
            Ok(res.rows_affected())
        }
    }
}

/// One step inside a write transaction.
///
/// `Exec` runs a statement and records how many rows it touched.
/// `RequireOne` runs a `SELECT COUNT(*)`-style guard and aborts the whole
/// transaction unless it matches exactly one row. The guard exists because
/// `rows_affected()` alone cannot tell "no such row" from "row already had
/// this value" on MySQL/MariaDB (which report *changed* rows, not matched).
#[derive(Debug)]
pub enum TxStep {
    Exec(String),
    RequireOne { sql: String, label: String },
}

macro_rules! run_tx {
    ($pool:expr, $steps:expr) => {{
        let mut tx = $pool.begin().await.map_err(|e| e.to_string())?;
        let mut affected: Vec<u64> = Vec::new();
        for step in $steps {
            match step {
                TxStep::Exec(sql) => match sqlx::query(sql).execute(&mut *tx).await {
                    Ok(res) => affected.push(res.rows_affected()),
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(format!("{}\nSQL: {}", e, sql));
                    }
                },
                TxStep::RequireOne { sql, label } => {
                    let row = match sqlx::query(sql).fetch_one(&mut *tx).await {
                        Ok(r) => r,
                        Err(e) => {
                            let _ = tx.rollback().await;
                            return Err(format!("{}\nSQL: {}", e, sql));
                        }
                    };
                    let count = row
                        .try_get::<i64, _>(0)
                        .or_else(|_| row.try_get::<i32, _>(0).map(|v| v as i64))
                        .or_else(|_| {
                            row.try_get::<String, _>(0)
                                .map(|v| v.parse::<i64>().unwrap_or(-1))
                        });
                    let count = match count {
                        Ok(c) => c,
                        Err(e) => {
                            let _ = tx.rollback().await;
                            return Err(format!("Could not verify target row: {}\nSQL: {}", e, sql));
                        }
                    };
                    if count != 1 {
                        let _ = tx.rollback().await;
                        return Err(if count == 0 {
                            format!(
                                "{} matched 0 rows - the row no longer exists or the key columns are wrong. Transaction rolled back, nothing was written.\nSQL: {}",
                                label, sql
                            )
                        } else {
                            format!(
                                "{} matched {} rows - the key is not unique, so this would overwrite other rows. Transaction rolled back, nothing was written.\nSQL: {}",
                                label, count, sql
                            )
                        });
                    }
                }
            }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(affected)
    }};
}

/// Runs `steps` in a single transaction and returns the rows affected by each
/// `TxStep::Exec`, in order. Any error (including a failed guard) rolls back.
pub async fn execute_transaction(pool: &DbPool, steps: &[TxStep]) -> Result<Vec<u64>, String> {
    match pool {
        DbPool::Postgres(p) => run_tx!(p, steps),
        DbPool::MySql(p) => run_tx!(p, steps),
        DbPool::Sqlite(p) => run_tx!(p, steps),
    }
}


// ==========================================
// Streaming import executor
// ==========================================

/// One statement handed to the import executor.
///
/// `rows` is how many source rows the statement carries, so a multi-row INSERT
/// reports 500 rows imported rather than 1 statement run.
#[derive(Debug, Clone)]
pub struct BatchItem {
    pub sql: String,
    pub rows: u64,
    /// Source line, when the format has one (SQL scripts do, CSV rows do too).
    pub line: Option<u64>,
    /// 1-based sequence number, used to point the user at the failure.
    pub index: u64,
}

/// Feeds the executor without ever holding the whole file in memory.
///
/// `next_batch` is deliberately synchronous: the readers are buffered file I/O,
/// and keeping them sync is what lets a single transaction stay open across
/// batches without fighting `Transaction`'s lifetime.
pub trait BatchSource: Send {
    fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String>;
    fn bytes_read(&self) -> u64;
    fn total_bytes(&self) -> u64;
    /// Rows the source rejected while building the batch — a value that could
    /// not be coerced never becomes SQL, so the executor would never see it.
    /// Drained once per batch.
    fn take_failures(&mut self) -> Vec<ImportFailure> {
        Vec::new()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ImportExecOptions {
    pub tx_mode: TxMode,
    pub on_error: OnError,
    pub max_errors: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct ImportTick {
    pub bytes_read: u64,
    pub total_bytes: u64,
    pub statements_run: u64,
    pub rows_imported: u64,
    pub errors: u64,
}

#[derive(Debug, Default)]
pub struct ImportOutcome {
    pub statements_run: u64,
    pub rows_imported: u64,
    pub failures: Vec<ImportFailure>,
    pub failures_truncated: bool,
    pub cancelled: bool,
}

macro_rules! run_import {
    ($pool:expr, $src:expr, $opts:expr, $cancel:expr, $tick:expr) => {{
        let mut out = ImportOutcome::default();

        // Replaying a script is one session, not a series of unrelated
        // statements: `USE db`, `SET`, `LOCK TABLES` and Postgres' `search_path`
        // all apply only to the connection that ran them. Taking a fresh
        // connection per statement makes a mysqldump fail with "no database
        // selected" as soon as the pool hands out a different one, so the whole
        // import is pinned to one connection.
        //
        // `SingleTransaction` gets its connection by owning a transaction for
        // the whole file; the other modes hold the connection directly. They are
        // separate bindings so neither borrows the other.
        let mut outer_tx = match $opts.tx_mode {
            TxMode::SingleTransaction => Some($pool.begin().await.map_err(|e| e.to_string())?),
            _ => None,
        };
        let mut pinned = match $opts.tx_mode {
            TxMode::SingleTransaction => None,
            _ => Some($pool.acquire().await.map_err(|e| e.to_string())?),
        };

        'outer: loop {
            if $cancel.load(Ordering::Relaxed) {
                out.cancelled = true;
                break 'outer;
            }

            let batch = match $src.next_batch() {
                Ok(Some(b)) => b,
                Ok(None) => {
                    // The source can reject the last thing it read and then
                    // report end-of-file; those failures still have to surface.
                    for f in $src.take_failures() {
                        if out.failures.len() < $opts.max_errors {
                            out.failures.push(f);
                        } else {
                            out.failures_truncated = true;
                        }
                    }
                    break 'outer;
                }
                Err(e) => {
                    if let Some(tx) = outer_tx.take() {
                        let _ = tx.rollback().await;
                    }
                    return Err(e);
                }
            };
            for f in $src.take_failures() {
                if out.failures.len() < $opts.max_errors {
                    out.failures.push(f);
                } else {
                    out.failures_truncated = true;
                }
            }
            if !out.failures.is_empty()
                && (matches!($opts.on_error, OnError::Abort) || out.failures_truncated)
            {
                break 'outer;
            }

            if batch.is_empty() {
                continue;
            }

            match $opts.tx_mode {
                TxMode::SingleTransaction => {
                    for item in &batch {
                        let tx = outer_tx.as_mut().expect("outer transaction is open");
                        match sqlx::query(&item.sql).execute(&mut **tx).await {
                            Ok(_) => {
                                out.statements_run += 1;
                                out.rows_imported += item.rows;
                            }
                            Err(e) => {
                                // The transaction is poisoned, so there is no
                                // "skip this row and continue" here: the only
                                // honest outcome is to roll the whole file back.
                                let tx = outer_tx.take().expect("outer transaction is open");
                                let _ = tx.rollback().await;
                                out.failures.push(ImportFailure::new(
                                    item.index,
                                    item.line,
                                    &item.sql,
                                    format!("{}\nThe whole import was rolled back.", e),
                                ));
                                // The transaction is gone, so the post-loop
                                // cleanup will not reset these for us.
                                out.statements_run = 0;
                                out.rows_imported = 0;
                                break 'outer;
                            }
                        }
                    }
                }

                TxMode::AtomicBatch => {
                    let conn = pinned.as_mut().expect("a connection is pinned");
                    let mut tx = conn.begin().await.map_err(|e| e.to_string())?;
                    let mut failed: Option<(&BatchItem, String)> = None;
                    for item in &batch {
                        if let Err(e) = sqlx::query(&item.sql).execute(&mut *tx).await {
                            failed = Some((item, e.to_string()));
                            break;
                        }
                    }
                    match failed {
                        None => {
                            tx.commit().await.map_err(|e| e.to_string())?;
                            for item in &batch {
                                out.statements_run += 1;
                                out.rows_imported += item.rows;
                            }
                        }
                        Some((item, msg)) => {
                            let _ = tx.rollback().await;
                            if out.failures.len() < $opts.max_errors {
                                out.failures.push(ImportFailure::new(
                                    item.index,
                                    item.line,
                                    &item.sql,
                                    msg,
                                ));
                            } else {
                                out.failures_truncated = true;
                            }
                            if matches!($opts.on_error, OnError::Abort) || out.failures_truncated {
                                break 'outer;
                            }
                        }
                    }
                }

                TxMode::PerStatement => {
                    let conn = pinned.as_mut().expect("a connection is pinned");
                    for item in &batch {
                        match sqlx::query(&item.sql).execute(&mut **conn).await {
                            Ok(_) => {
                                out.statements_run += 1;
                                out.rows_imported += item.rows;
                            }
                            Err(e) => {
                                if out.failures.len() < $opts.max_errors {
                                    out.failures.push(ImportFailure::new(
                                        item.index,
                                        item.line,
                                        &item.sql,
                                        e.to_string(),
                                    ));
                                } else {
                                    out.failures_truncated = true;
                                }
                                if matches!($opts.on_error, OnError::Abort)
                                    || out.failures_truncated
                                {
                                    break 'outer;
                                }
                            }
                        }
                    }
                }
            }

            $tick(ImportTick {
                bytes_read: $src.bytes_read(),
                total_bytes: $src.total_bytes(),
                statements_run: out.statements_run,
                rows_imported: out.rows_imported,
                errors: out.failures.len() as u64,
            });
        }

        if let Some(tx) = outer_tx.take() {
            if out.cancelled || !out.failures.is_empty() {
                let _ = tx.rollback().await;
                out.statements_run = 0;
                out.rows_imported = 0;
            } else {
                tx.commit().await.map_err(|e| e.to_string())?;
            }
        }

        Ok(out)
    }};
}

/// Drains `src` into `pool`, reporting progress through `tick`.
///
/// Returns `Err` only for something that stopped the run outright (a read
/// error, a transaction that would not begin). Statement-level failures come
/// back inside `ImportOutcome::failures` so the UI can show a report instead of
/// a single string.
pub async fn execute_import_stream(
    pool: &DbPool,
    src: &mut dyn BatchSource,
    opts: ImportExecOptions,
    cancel: &AtomicBool,
    tick: &mut (dyn FnMut(ImportTick) + Send),
) -> Result<ImportOutcome, String> {
    match pool {
        DbPool::Postgres(p) => run_import!(p, src, opts, cancel, tick),
        DbPool::MySql(p) => run_import!(p, src, opts, cancel, tick),
        DbPool::Sqlite(p) => run_import!(p, src, opts, cancel, tick),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn sqlite_pool() -> DbPool {
        // One connection so the in-memory database is shared across the test.
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, tag TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t (id, name, tag) VALUES (1, 'a', 'x'), (2, 'b', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        DbPool::Sqlite(pool)
    }

    async fn name_of(pool: &DbPool, id: i64) -> Option<String> {
        let DbPool::Sqlite(p) = pool else { unreachable!() };
        sqlx::query_scalar::<_, Option<String>>("SELECT name FROM t WHERE id = ?")
            .bind(id)
            .fetch_optional(p)
            .await
            .unwrap()
            .flatten()
    }

    /// Guards the decode order in `execute_query`: sqlx treats `bool` as
    /// compatible with every integer type, so without `is_boolean_column` an
    /// integer primary key (MySQL `BIGINT(20) AUTO_INCREMENT`, SQLite
    /// `INTEGER PRIMARY KEY`) came back as `true` instead of its value.
    #[tokio::test]
    async fn integer_columns_decode_as_numbers_not_booleans() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query(
            "CREATE TABLE nums (id INTEGER PRIMARY KEY AUTOINCREMENT, big BIGINT, small TINYINT, zero INT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO nums (big, small, zero) VALUES (9007199254740993, 7, 0)")
            .execute(&pool)
            .await
            .unwrap();

        let pool = DbPool::Sqlite(pool);
        let rows = execute_query(&pool, "SELECT id, big, small, zero FROM nums").await.unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row["id"], serde_json::json!(1));
        assert_eq!(row["big"], serde_json::json!(9007199254740993i64));
        assert_eq!(row["small"], serde_json::json!(7));
        assert_eq!(row["zero"], serde_json::json!(0));

        // Aggregates are integers too - `COUNT(*)` used to render as `true`.
        let rows = execute_query(&pool, "SELECT COUNT(*) AS c FROM nums").await.unwrap();
        assert_eq!(rows[0]["c"], serde_json::json!(1));
    }

    /// The other half of the same rule: a column the driver really does call a
    /// boolean must still arrive as a JSON boolean.
    #[tokio::test]
    async fn declared_boolean_columns_still_decode_as_booleans() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        sqlx::query("CREATE TABLE flags (on_flag BOOLEAN, off_flag BOOL, n INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO flags (on_flag, off_flag, n) VALUES (1, 0, 5)")
            .execute(&pool)
            .await
            .unwrap();

        let rows = execute_query(&DbPool::Sqlite(pool), "SELECT on_flag, off_flag, n FROM flags")
            .await
            .unwrap();
        assert_eq!(rows[0]["on_flag"], serde_json::json!(true));
        assert_eq!(rows[0]["off_flag"], serde_json::json!(false));
        assert_eq!(rows[0]["n"], serde_json::json!(5));
    }

    #[tokio::test]
    async fn guarded_update_applies_and_reports_affected_rows() {
        let pool = sqlite_pool().await;
        let steps = vec![
            TxStep::RequireOne { sql: "SELECT COUNT(*) FROM t WHERE id = 1".into(), label: "UPDATE on t".into() },
            TxStep::Exec("UPDATE t SET name = 'updated' WHERE id = 1".into()),
        ];
        let affected = execute_transaction(&pool, &steps).await.unwrap();
        assert_eq!(affected, vec![1]);
        assert_eq!(name_of(&pool, 1).await.as_deref(), Some("updated"));
    }

    #[tokio::test]
    async fn zero_match_guard_rolls_back_the_whole_transaction() {
        let pool = sqlite_pool().await;
        let steps = vec![
            TxStep::Exec("UPDATE t SET name = 'first' WHERE id = 1".into()),
            TxStep::RequireOne { sql: "SELECT COUNT(*) FROM t WHERE id = 999".into(), label: "UPDATE on t".into() },
            TxStep::Exec("UPDATE t SET name = 'never' WHERE id = 999".into()),
        ];
        let err = execute_transaction(&pool, &steps).await.unwrap_err();
        assert!(err.contains("matched 0 rows"), "unexpected error: {err}");
        // The earlier statement in the same transaction must be undone.
        assert_eq!(name_of(&pool, 1).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn non_unique_key_is_rejected_before_writing() {
        let pool = sqlite_pool().await;
        let steps = vec![
            TxStep::RequireOne { sql: "SELECT COUNT(*) FROM t WHERE tag = 'x'".into(), label: "UPDATE on t".into() },
            TxStep::Exec("UPDATE t SET name = 'clobbered' WHERE tag = 'x'".into()),
        ];
        let err = execute_transaction(&pool, &steps).await.unwrap_err();
        assert!(err.contains("matched 2 rows"), "unexpected error: {err}");
        assert_eq!(name_of(&pool, 1).await.as_deref(), Some("a"));
        assert_eq!(name_of(&pool, 2).await.as_deref(), Some("b"));
    }

    #[tokio::test]
    async fn failing_statement_reports_the_sql_and_rolls_back() {
        let pool = sqlite_pool().await;
        let steps = vec![
            TxStep::Exec("UPDATE t SET name = 'first' WHERE id = 1".into()),
            TxStep::Exec("UPDATE t SET nope = 1 WHERE id = 1".into()),
        ];
        let err = execute_transaction(&pool, &steps).await.unwrap_err();
        assert!(err.contains("SQL: UPDATE t SET nope"), "unexpected error: {err}");
        assert_eq!(name_of(&pool, 1).await.as_deref(), Some("a"));
    }

    #[test]
    fn a_profile_that_stores_no_password_still_resolves_with_one() {
        let dir = std::env::temp_dir().join("dodb-test-runtime-pw");
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("DODB_DATA_DIR", &dir);

        let profile = ConnectionProfile {
            id: "runtime-pw-profile".to_string(),
            name: "no-store".to_string(),
            r#type: SupportedDB::Postgres,
            host: "127.0.0.1".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "typed-at-connect".to_string(),
            database: "postgres".to_string(),
            save_password: false,
            ..Default::default()
        };
        crate::profiles::save_profiles(&mut vec![profile.clone()]).unwrap();

        let raw = std::fs::read_to_string(dir.join("profiles.json")).unwrap();
        assert!(!raw.contains("typed-at-connect"), "password reached disk: {raw}");

        let state = DbState::default();
        // Without the runtime entry there is nothing to connect with.
        assert_eq!(resolve_profile_in(&state, &profile.id).unwrap().password, "");

        state
            .runtime_passwords
            .lock()
            .unwrap()
            .insert(profile.id.clone(), "typed-at-connect".to_string());
        let resolved = resolve_profile_in(&state, &profile.id).unwrap();
        assert_eq!(resolved.password, "typed-at-connect");
        assert!(!resolved.save_password);

        let _ = std::fs::remove_file(dir.join("profiles.json"));
    }

    #[test]
    fn unsaved_connections_resolve_from_memory() {
        let state = DbState::default();
        let profile = ConnectionProfile {
            id: format!("{}abc", SESSION_ID_PREFIX),
            name: "scratch".to_string(),
            host: "127.0.0.1".to_string(),
            ..Default::default()
        };
        state
            .session_profiles
            .lock()
            .unwrap()
            .insert(profile.id.clone(), profile.clone());

        let found = resolve_profile_in(&state, &profile.id).unwrap();
        assert_eq!(found.name, "scratch");
        assert_eq!(found.host, "127.0.0.1");
    }

    #[test]
    fn missing_connection_says_what_to_do() {
        // Point the profile store at an empty directory so this test does not
        // depend on (or read) the developer's real profiles.json.
        std::env::set_var("DODB_DATA_DIR", std::env::temp_dir().join("dodb-test-empty"));
        let state = DbState::default();
        let err = resolve_profile_in(&state, "").unwrap_err();
        assert!(err.contains("No connection was selected"), "{err}");

        let err = resolve_profile_in(&state, &format!("{}gone", SESSION_ID_PREFIX)).unwrap_err();
        assert!(err.contains("only live while the app is running"), "{err}");

        let err = resolve_profile_in(&state, "definitely-not-a-real-profile-id").unwrap_err();
        assert!(err.contains("not found"), "{err}");
    }

    /// End-to-end check of the "connect without saving" path: a profile that
    /// exists only in memory must resolve, produce a working pool, and query.
    #[tokio::test]
    async fn unsaved_connection_can_actually_query() {
        std::env::set_var("DODB_DATA_DIR", std::env::temp_dir().join("dodb-test-empty"));

        let db_path = std::env::temp_dir().join("dodb-session-e2e.db");
        let _ = std::fs::remove_file(&db_path);
        let path_str = db_path.to_string_lossy().to_string();

        // Seed the file the way an existing database would look.
        {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect(&format!("sqlite://{}?mode=rwc", path_str))
                .await
                .expect("seed pool");
            sqlx::query("CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO widgets (name) VALUES ('a')").execute(&pool).await.unwrap();
            pool.close().await;
        }

        let state = DbState::default();
        let profile = ConnectionProfile {
            id: format!("{}e2e", SESSION_ID_PREFIX),
            name: "unsaved".to_string(),
            r#type: SupportedDB::Sqlite,
            file_path: Some(path_str.clone()),
            ..Default::default()
        };
        state
            .session_profiles
            .lock()
            .unwrap()
            .insert(profile.id.clone(), profile.clone());

        // This is what every data command does: resolve by id, then get a pool.
        let resolved = resolve_profile_in(&state, &profile.id).expect("resolves without being saved");
        let pool = get_pool_in(&state, &resolved, None).await.expect("pool for unsaved connection");
        let rows = execute_query(&pool, "SELECT name FROM sqlite_master WHERE type = 'table'")
            .await
            .expect("query runs");

        let names: Vec<String> = rows
            .iter()
            .filter_map(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_string()))
            .collect();
        assert!(names.contains(&"widgets".to_string()), "got {names:?}");

        close_profile_pools_in(&state, Some(&profile.id)).await.unwrap();
        let _ = std::fs::remove_file(&db_path);
    }

    // ---------- streaming import executor ----------

    /// Hands the executor a fixed script, and can be told to reject a row
    /// before it ever becomes SQL (the coercion-failure path).
    struct FakeSource {
        batches: std::collections::VecDeque<Vec<BatchItem>>,
        failures: Vec<ImportFailure>,
        read: u64,
    }

    impl FakeSource {
        /// Each inner slice becomes one batch; every statement counts as 1 row.
        fn new(batches: &[&[&str]]) -> Self {
            let mut queue = std::collections::VecDeque::new();
            let mut index = 0u64;
            for b in batches {
                let items = b
                    .iter()
                    .map(|sql| {
                        index += 1;
                        BatchItem {
                            sql: (*sql).to_string(),
                            rows: 1,
                            line: Some(index),
                            index,
                        }
                    })
                    .collect();
                queue.push_back(items);
            }
            Self {
                batches: queue,
                failures: Vec::new(),
                read: 0,
            }
        }

        fn with_parse_failure(mut self) -> Self {
            self.failures
                .push(ImportFailure::new(1, Some(1), "bad,row", "not a number".into()));
            self
        }
    }

    impl BatchSource for FakeSource {
        fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String> {
            self.read += 1;
            Ok(self.batches.pop_front())
        }
        fn bytes_read(&self) -> u64 {
            self.read
        }
        fn total_bytes(&self) -> u64 {
            10
        }
        fn take_failures(&mut self) -> Vec<ImportFailure> {
            std::mem::take(&mut self.failures)
        }
    }

    fn exec_opts(tx_mode: TxMode, on_error: OnError) -> ImportExecOptions {
        ImportExecOptions {
            tx_mode,
            on_error,
            max_errors: 100,
        }
    }

    async fn count_rows(pool: &DbPool) -> i64 {
        let DbPool::Sqlite(p) = pool else { unreachable!() };
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM t")
            .fetch_one(p)
            .await
            .unwrap()
    }

    async fn run(
        pool: &DbPool,
        src: &mut FakeSource,
        opts: ImportExecOptions,
    ) -> Result<ImportOutcome, String> {
        let cancel = AtomicBool::new(false);
        let mut ticks = 0u32;
        let mut tick = |_: ImportTick| ticks += 1;
        execute_import_stream(pool, src, opts, &cancel, &mut tick).await
    }

    #[tokio::test]
    async fn every_batch_is_applied_and_rows_are_counted() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (3, 'c')"],
            &[
                "INSERT INTO t (id, name) VALUES (4, 'd')",
                "UPDATE t SET name = 'D' WHERE id = 4",
            ],
        ]);
        let out = run(&pool, &mut src, exec_opts(TxMode::AtomicBatch, OnError::Abort))
            .await
            .unwrap();

        assert_eq!(out.statements_run, 3);
        assert_eq!(out.rows_imported, 3);
        assert!(out.failures.is_empty(), "{:?}", out.failures);
        assert_eq!(name_of(&pool, 4).await.as_deref(), Some("D"));
    }

    /// A failing batch must take only its own rows down: the batch before it
    /// is already committed, and the one after it never runs under Abort.
    #[tokio::test]
    async fn an_atomic_batch_rolls_back_only_itself() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (3, 'c')"],
            &[
                "INSERT INTO t (id, name) VALUES (4, 'd')",
                "INSERT INTO t (id, name) VALUES (1, 'dup')",
            ],
            &["INSERT INTO t (id, name) VALUES (5, 'e')"],
        ]);
        let out = run(&pool, &mut src, exec_opts(TxMode::AtomicBatch, OnError::Abort))
            .await
            .unwrap();

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        assert_eq!(out.statements_run, 1);
        // Batch 1 stuck, batch 2 rolled back whole, batch 3 never ran.
        assert_eq!(count_rows(&pool).await, 3);
        assert!(name_of(&pool, 4).await.is_none());
        assert!(name_of(&pool, 5).await.is_none());
    }

    #[tokio::test]
    async fn skip_row_carries_on_past_a_failing_batch() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (1, 'dup')"],
            &["INSERT INTO t (id, name) VALUES (5, 'e')"],
        ]);
        let out = run(
            &pool,
            &mut src,
            exec_opts(TxMode::AtomicBatch, OnError::SkipRow),
        )
        .await
        .unwrap();

        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.statements_run, 1);
        assert_eq!(name_of(&pool, 5).await.as_deref(), Some("e"));
    }

    /// The whole point of single-transaction mode: one bad statement anywhere
    /// leaves the table exactly as it was.
    #[tokio::test]
    async fn a_single_transaction_import_is_all_or_nothing() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (3, 'c')"],
            &["INSERT INTO t (id, name) VALUES (1, 'dup')"],
        ]);
        let out = run(
            &pool,
            &mut src,
            exec_opts(TxMode::SingleTransaction, OnError::SkipRow),
        )
        .await
        .unwrap();

        assert_eq!(out.failures.len(), 1, "{:?}", out.failures);
        // Nothing is reported as written, because nothing was.
        assert_eq!(out.statements_run, 0);
        assert_eq!(out.rows_imported, 0);
        assert_eq!(count_rows(&pool).await, 2);
    }

    #[tokio::test]
    async fn per_statement_mode_keeps_the_statements_that_worked() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[&[
            "INSERT INTO t (id, name) VALUES (3, 'c')",
            "INSERT INTO t (id, name) VALUES (1, 'dup')",
            "INSERT INTO t (id, name) VALUES (4, 'd')",
        ]]);
        let out = run(
            &pool,
            &mut src,
            exec_opts(TxMode::PerStatement, OnError::SkipRow),
        )
        .await
        .unwrap();

        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.statements_run, 2);
        assert_eq!(name_of(&pool, 3).await.as_deref(), Some("c"));
        assert_eq!(name_of(&pool, 4).await.as_deref(), Some("d"));
    }

    /// A row rejected while parsing never reaches the database, so the
    /// executor has to pick it up from the source instead of from an error.
    #[tokio::test]
    async fn parse_failures_reported_by_the_source_can_abort_the_run() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (3, 'c')"],
            &["INSERT INTO t (id, name) VALUES (4, 'd')"],
        ])
        .with_parse_failure();
        let out = run(&pool, &mut src, exec_opts(TxMode::AtomicBatch, OnError::Abort))
            .await
            .unwrap();

        assert_eq!(out.failures.len(), 1);
        assert!(out.failures[0].message.contains("not a number"));
        assert_eq!(out.statements_run, 0, "the batch must not run");
        assert_eq!(count_rows(&pool).await, 2);
    }

    #[tokio::test]
    async fn a_parse_failure_is_only_recorded_when_skipping_is_allowed() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[&["INSERT INTO t (id, name) VALUES (3, 'c')"]])
            .with_parse_failure();
        let out = run(
            &pool,
            &mut src,
            exec_opts(TxMode::AtomicBatch, OnError::SkipRow),
        )
        .await
        .unwrap();

        assert_eq!(out.failures.len(), 1);
        assert_eq!(out.statements_run, 1);
        assert_eq!(name_of(&pool, 3).await.as_deref(), Some("c"));
    }

    #[tokio::test]
    async fn max_errors_stops_the_run_and_flags_the_report_as_truncated() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[
            &["INSERT INTO t (id, name) VALUES (1, 'dup')"],
            &["INSERT INTO t (id, name) VALUES (2, 'dup')"],
            &["INSERT INTO t (id, name) VALUES (9, 'ok')"],
        ]);
        let opts = ImportExecOptions {
            tx_mode: TxMode::AtomicBatch,
            on_error: OnError::SkipRow,
            max_errors: 1,
        };
        let out = run(&pool, &mut src, opts).await.unwrap();

        assert_eq!(out.failures.len(), 1);
        assert!(out.failures_truncated);
        assert!(name_of(&pool, 9).await.is_none(), "the run must stop");
    }

    #[tokio::test]
    async fn cancelling_stops_at_the_next_batch_and_keeps_committed_batches() {
        let pool = sqlite_pool().await;
        let mut src = FakeSource::new(&[&["INSERT INTO t (id, name) VALUES (3, 'c')"]]);
        let cancel = AtomicBool::new(true);
        let mut tick = |_: ImportTick| {};
        let out = execute_import_stream(
            &pool,
            &mut src,
            exec_opts(TxMode::AtomicBatch, OnError::Abort),
            &cancel,
            &mut tick,
        )
        .await
        .unwrap();

        assert!(out.cancelled);
        assert_eq!(out.statements_run, 0);
        assert_eq!(count_rows(&pool).await, 2);
    }

    #[tokio::test]
    async fn cancelling_a_single_transaction_import_writes_nothing() {
        let pool = sqlite_pool().await;
        // The first batch is applied, then the cancel flag is seen before the
        // second — but the transaction still has to roll the first one back.
        struct CancelAfterFirst<'a> {
            inner: FakeSource,
            cancel: &'a AtomicBool,
        }
        impl BatchSource for CancelAfterFirst<'_> {
            fn next_batch(&mut self) -> Result<Option<Vec<BatchItem>>, String> {
                let b = self.inner.next_batch()?;
                self.cancel.store(true, Ordering::SeqCst);
                Ok(b)
            }
            fn bytes_read(&self) -> u64 {
                self.inner.bytes_read()
            }
            fn total_bytes(&self) -> u64 {
                self.inner.total_bytes()
            }
        }

        let cancel = AtomicBool::new(false);
        let mut src = CancelAfterFirst {
            inner: FakeSource::new(&[
                &["INSERT INTO t (id, name) VALUES (3, 'c')"],
                &["INSERT INTO t (id, name) VALUES (4, 'd')"],
            ]),
            cancel: &cancel,
        };
        let mut tick = |_: ImportTick| {};
        let out = execute_import_stream(
            &pool,
            &mut src,
            exec_opts(TxMode::SingleTransaction, OnError::Abort),
            &cancel,
            &mut tick,
        )
        .await
        .unwrap();

        assert!(out.cancelled);
        assert_eq!(out.rows_imported, 0);
        assert_eq!(count_rows(&pool).await, 2);
    }

    #[tokio::test]
    async fn an_empty_batch_does_not_end_the_import_early() {
        let pool = sqlite_pool().await;
        // A tabular source emits an empty batch when every row in its window
        // failed to coerce; the file is not finished.
        let mut src = FakeSource::new(&[
            &[],
            &["INSERT INTO t (id, name) VALUES (3, 'c')"],
        ]);
        let out = run(&pool, &mut src, exec_opts(TxMode::AtomicBatch, OnError::Abort))
            .await
            .unwrap();

        assert_eq!(out.statements_run, 1);
        assert_eq!(name_of(&pool, 3).await.as_deref(), Some("c"));
    }

    #[tokio::test]
    async fn execute_query_duplicate_column_names_are_not_overwritten() {
        let pool = sqlite_pool().await;
        let rows = execute_query(&pool, "SELECT 1 AS col, 2 AS col, 3 AS col").await.unwrap();
        assert_eq!(rows.len(), 1);
        let obj = rows[0].as_object().unwrap();
        assert_eq!(obj.get("col"), Some(&serde_json::json!(1)));
        assert_eq!(obj.get("col_1"), Some(&serde_json::json!(2)));
        assert_eq!(obj.get("col_2"), Some(&serde_json::json!(3)));
    }

    #[tokio::test]
    async fn execute_query_preserves_selected_column_order() {
        let pool = sqlite_pool().await;
        // Query with columns intentionally out of alphabetical order (name_th before name_en)
        let rows = execute_query(&pool, "SELECT 'Bangkok' AS name_th, 'Bangkok' AS name_en, 1 AS z_col, 2 AS a_col").await.unwrap();
        assert_eq!(rows.len(), 1);
        let obj = rows[0].as_object().unwrap();
        let keys: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
        assert_eq!(keys, vec!["name_th", "name_en", "z_col", "a_col"]);
    }
}


