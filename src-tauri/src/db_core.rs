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
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }
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
                        let s = String::from_utf8_lossy(&v).into_owned();
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
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
                        let s = String::from_utf8_lossy(&v).into_owned();
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
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
                        let s = String::from_utf8_lossy(&v).into_owned();
                        map.insert(column.name().to_string(), serde_json::Value::String(s));
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

pub async fn execute_transaction(pool: &DbPool, queries: &[String]) -> Result<(), String> {
    match pool {
        DbPool::Postgres(p) => {
            let mut tx = p.begin().await.map_err(|e| e.to_string())?;
            for query in queries {
                if let Err(e) = sqlx::query(query).execute(&mut *tx).await {
                    let _ = tx.rollback().await;
                    return Err(e.to_string());
                }
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        DbPool::MySql(p) => {
            let mut tx = p.begin().await.map_err(|e| e.to_string())?;
            for query in queries {
                if let Err(e) = sqlx::query(query).execute(&mut *tx).await {
                    let _ = tx.rollback().await;
                    return Err(e.to_string());
                }
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
        DbPool::Sqlite(p) => {
            let mut tx = p.begin().await.map_err(|e| e.to_string())?;
            for query in queries {
                if let Err(e) = sqlx::query(query).execute(&mut *tx).await {
                    let _ = tx.rollback().await;
                    return Err(e.to_string());
                }
            }
            tx.commit().await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
