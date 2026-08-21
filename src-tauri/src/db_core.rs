use crate::models::{ConnectionProfile, SupportedDB};
use sqlx::{Row, Column, ValueRef};
use std::collections::HashMap;
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
    /// Connections the user is using without saving them. They live only for
    /// the lifetime of the app process and are never written to profiles.json.
    pub session_profiles: Mutex<HashMap<String, ConnectionProfile>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
            session_profiles: Mutex::new(HashMap::new()),
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
    crate::profiles::load_profiles()?
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
        })
}

pub const CONNECTION_TIMEOUT_SECS: u64 = 180;

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

    let timeout = std::time::Duration::from_secs(CONNECTION_TIMEOUT_SECS);

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
            let connect_res = sqlx::postgres::PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(timeout)
                .connect_with(connect_opts.clone().ssl_mode(sqlx::postgres::PgSslMode::Prefer))
                .await;

            let p = match connect_res {
                Ok(pool) => pool,
                Err(err) => {
                    let err_msg = err.to_string();
                    if err_msg.contains("SSLRequest") || err_msg.contains("tls") || err_msg.contains("ssl") || err_msg.contains("0x5a") {
                        sqlx::postgres::PgPoolOptions::new()
                            .max_connections(5)
                            .acquire_timeout(timeout)
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
            let p = sqlx::mysql::MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(timeout)
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
            let p = sqlx::sqlite::SqlitePoolOptions::new()
                .max_connections(5)
                .acquire_timeout(timeout)
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

pub async fn execute_query(pool: &DbPool, query: &str) -> Result<Vec<serde_json::Value>, String> {
    match pool {
        DbPool::Postgres(p) => {
            let rows = sqlx::query(query).fetch_all(p).await.map_err(|e| e.to_string())?;
            let mut result = Vec::new();
            for row in rows {
                let mut map = serde_json::Map::new();
                for (i, column) in row.columns().iter().enumerate() {
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<bool, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Bool(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i16, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i8, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(column.name().to_string(), serde_json::Value::Number(num));
                        } else {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<f32, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v as f64) {
                            map.insert(column.name().to_string(), serde_json::Value::Number(num));
                        } else {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<rust_decimal::Decimal, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::FixedOffset>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<uuid::Uuid, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(column.name().to_string(), v);
                    } else if let Ok(v) = row.try_get::<Vec<String>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<i64>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<i32>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::json!(v));
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else {
                        map.insert(column.name().to_string(), serde_json::Value::Null);
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
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<bool, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Bool(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u64, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u32, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i16, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u16, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i8, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<u8, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(column.name().to_string(), serde_json::Value::Number(num));
                        } else {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<f32, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v as f64) {
                            map.insert(column.name().to_string(), serde_json::Value::Number(num));
                        } else {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<rust_decimal::Decimal, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<bigdecimal::BigDecimal, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_rfc3339()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveTime, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(column.name().to_string(), v);
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        // Same unchecked fallback as the Postgres branch: spatial and other
                        // driver-unknown types would otherwise be dropped as null.
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else {
                        map.insert(column.name().to_string(), serde_json::Value::Null);
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
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                            continue;
                        }
                    }

                    if let Ok(v) = row.try_get::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else if let Ok(v) = row.try_get::<bool, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Bool(v));
                    } else if let Ok(v) = row.try_get::<i64, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<i32, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::Number(v.into()));
                    } else if let Ok(v) = row.try_get::<f64, _>(i) {
                        if let Some(num) = serde_json::Number::from_f64(v) {
                            map.insert(column.name().to_string(), serde_json::Value::Number(num));
                        } else {
                            map.insert(column.name().to_string(), serde_json::Value::Null);
                        }
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDateTime, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<chrono::NaiveDate, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v.to_string()));
                    } else if let Ok(v) = row.try_get::<serde_json::Value, _>(i) {
                        map.insert(column.name().to_string(), v);
                    } else if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<Vec<u8>, _>(i) {
                        // Same unchecked fallback as the Postgres branch: spatial and other
                        // driver-unknown types would otherwise be dropped as null.
                        let s = decode_bytes_or_hex(&v);
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
                    } else if let Ok(v) = row.try_get_unchecked::<String, _>(i) {
                        map.insert(column.name().to_string(), serde_json::Value::String(v));
                    } else {
                        map.insert(column.name().to_string(), serde_json::Value::Null);
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
}
