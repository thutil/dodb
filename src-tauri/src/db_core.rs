use crate::models::{ConnectionProfile, SupportedDB};
use sqlx::any::AnyPoolOptions;
use sqlx::{AnyPool, AnyConnection, Connection, Executor, Row, Column};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

pub struct DbState {
    pub pools: Mutex<HashMap<String, AnyPool>>,
}

impl Default for DbState {
    fn default() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }
}

pub async fn get_pool(state: &State<'_, DbState>, profile: &ConnectionProfile) -> Result<AnyPool, String> {
    {
        let pools = state.pools.lock().map_err(|e| e.to_string())?;
        if let Some(pool) = pools.get(&profile.id) {
            return Ok(pool.clone());
        }
    }
    let url = match profile.r#type {
        SupportedDB::Sqlite => {
            let path = profile.file_path.as_deref().unwrap_or(":memory:");
            format!("sqlite://{}", path)
        }
        SupportedDB::Postgres => {
            format!(
                "postgres://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, profile.database
            )
        }
        SupportedDB::Mariadb => {
            format!(
                "mysql://{}:{}@{}:{}/{}",
                profile.user, profile.password, profile.host, profile.port, profile.database
            )
        }
    };

    sqlx::any::install_default_drivers();
    let pool = AnyPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| format!("Failed to connect to database: {}", e))?;
        
    let mut pools = state.pools.lock().map_err(|e| e.to_string())?;
    pools.insert(profile.id.clone(), pool.clone());
    
    Ok(pool)
}

pub async fn execute_query(pool: &AnyPool, query: &str) -> Result<Vec<serde_json::Value>, String> {
    let rows = sqlx::query(query).fetch_all(pool).await.map_err(|e| e.to_string())?;
    
    let mut result = Vec::new();
    for row in rows {
        let mut map = serde_json::Map::new();
        for (i, column) in row.columns().iter().enumerate() {
            use sqlx::ValueRef;
            
            let raw_res = row.try_get_raw(i);
            if let Ok(raw) = raw_res {
                if raw.is_null() {
                    map.insert(column.name().to_string(), serde_json::Value::Null);
                    continue;
                }
            } else {
                map.insert(column.name().to_string(), serde_json::Value::String("[Unsupported Type]".to_string()));
                continue;
            }

            if let Ok(s) = row.try_get::<String, _>(i) {
                map.insert(column.name().to_string(), serde_json::Value::String(s));
            } else if let Ok(b) = row.try_get::<bool, _>(i) {
                map.insert(column.name().to_string(), serde_json::Value::Bool(b));
            } else if let Ok(n) = row.try_get::<i64, _>(i) {
                map.insert(column.name().to_string(), serde_json::Value::Number(n.into()));
            } else if let Ok(n) = row.try_get::<i32, _>(i) {
                map.insert(column.name().to_string(), serde_json::Value::Number(n.into()));
            } else if let Ok(f) = row.try_get::<f64, _>(i) {
                if let Some(num) = serde_json::Number::from_f64(f) {
                    map.insert(column.name().to_string(), serde_json::Value::Number(num));
                } else {
                    map.insert(column.name().to_string(), serde_json::Value::Null);
                }
            } else if let Ok(f) = row.try_get::<f32, _>(i) {
                if let Some(num) = serde_json::Number::from_f64(f as f64) {
                    map.insert(column.name().to_string(), serde_json::Value::Number(num));
                } else {
                    map.insert(column.name().to_string(), serde_json::Value::Null);
                }
            } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(i) {
                let text = String::from_utf8_lossy(&bytes).into_owned();
                map.insert(column.name().to_string(), serde_json::Value::String(text));
            } else {
                map.insert(column.name().to_string(), serde_json::Value::String("[Unsupported Type]".to_string()));
            }
        }
        result.push(serde_json::Value::Object(map));
    }
    
    Ok(result)
}

pub async fn execute_transaction(pool: &AnyPool, queries: &[String]) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for query in queries {
        if let Err(e) = tx.execute(query.as_str()).await {
            let _ = tx.rollback().await;
            return Err(e.to_string());
        }
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}
