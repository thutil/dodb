mod crypto;
pub mod models;
mod db_core;
mod profiles;

use tauri::{command, State};
use crate::models::{ConnectionProfile, SupportedDB};
use crate::db_core::{get_pool, execute_query, DbState, execute_transaction};

#[command]
async fn get_profiles() -> Result<Vec<ConnectionProfile>, String> {
    profiles::load_profiles()
}

#[command]
async fn save_profile(mut profile: ConnectionProfile) -> Result<ConnectionProfile, String> {
    let mut all_profiles = profiles::load_profiles()?;
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
        all_profiles.push(profile.clone());
    } else {
        if let Some(existing) = all_profiles.iter_mut().find(|p| p.id == profile.id) {
            *existing = profile.clone();
        } else {
            all_profiles.push(profile.clone());
        }
    }
    profiles::save_profiles(&mut all_profiles)?;
    Ok(profile)
}

#[command]
async fn delete_profile(id: String) -> Result<(), String> {
    let mut all_profiles = profiles::load_profiles()?;
    all_profiles.retain(|p| p.id != id);
    profiles::save_profiles(&mut all_profiles)?;
    Ok(())
}

#[command]
async fn test_connection(id: String, state: State<'_, DbState>) -> Result<bool, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    get_pool(&state, profile).await.map(|_| true)
}

#[command]
async fn get_databases(id: String, state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT datname::text as name FROM pg_database WHERE datistemplate = false",
        SupportedDB::Mariadb => "SHOW DATABASES",
        SupportedDB::Sqlite => "SELECT name FROM pragma_database_list",
    };
    
    let pool = get_pool(&state, profile).await?;
    let rows = execute_query(&pool, query).await?;
    
    let mut dbs = Vec::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            if let Some(val) = obj.values().next() {
                if let Some(s) = val.as_str() {
                    dbs.push(s.to_string());
                }
            }
        }
    }
    Ok(dbs)
}

#[command]
async fn get_tables(id: String, _database: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT tablename::text as name FROM pg_tables WHERE schemaname = 'public'",
        SupportedDB::Mariadb => "SHOW TABLES",
        SupportedDB::Sqlite => "SELECT name FROM sqlite_master WHERE type='table'",
    };
    
    let pool = get_pool(&state, profile).await?;
    let rows = execute_query(&pool, query).await?;
    
    let mut tables = Vec::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            if let Some(val) = obj.values().next() {
                if let Some(s) = val.as_str() {
                    tables.push(s.to_string());
                }
            }
        }
    }
    Ok(serde_json::json!({ "tables": tables }))
}

#[command]
async fn get_columns(id: String, _database: String, table: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => format!("
            SELECT 
                a.attname::text AS name,
                format_type(a.atttypid, a.atttypmod) AS type,
                (a.attnotnull = false) AS nullable,
                COALESCE((
                    SELECT true
                    FROM pg_index i
                    WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)
                ), false) AS primary_key
            FROM pg_attribute a
            JOIN pg_class c ON a.attrelid = c.oid
            WHERE c.relname = '{}' AND a.attnum > 0 AND NOT a.attisdropped
        ", table),
        SupportedDB::Mariadb => format!("SHOW COLUMNS FROM `{}`", table),
        SupportedDB::Sqlite => format!("PRAGMA table_info(\"{}\")", table),
    };
    
    let pool = get_pool(&state, profile).await?;
    let rows = execute_query(&pool, &query).await?;
    
    let mut columns = Vec::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            let mut col_info = serde_json::Map::new();
            
            if profile.r#type == SupportedDB::Sqlite {
                col_info.insert("name".to_string(), obj.get("name").cloned().unwrap_or_default());
                col_info.insert("type".to_string(), obj.get("type").cloned().unwrap_or_default());
                
                let notnull_val = obj.get("notnull").unwrap_or(&serde_json::Value::Null);
                let is_not_null = notnull_val.as_i64().map(|v| v != 0).unwrap_or_else(|| notnull_val.as_str() == Some("1"));
                col_info.insert("nullable".to_string(), serde_json::Value::Bool(!is_not_null));
                
                let pk_val = obj.get("pk").unwrap_or(&serde_json::Value::Null);
                let is_pk = pk_val.as_i64().map(|v| v != 0).unwrap_or_else(|| pk_val.as_str() == Some("1"));
                col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
            } else if profile.r#type == SupportedDB::Mariadb {
                col_info.insert("name".to_string(), obj.get("Field").cloned().unwrap_or_default());
                col_info.insert("type".to_string(), obj.get("Type").cloned().unwrap_or_default());
                
                let is_nullable = obj.get("Null").and_then(|v| v.as_str()).unwrap_or("NO") == "YES";
                col_info.insert("nullable".to_string(), serde_json::Value::Bool(is_nullable));
                
                let is_pk = obj.get("Key").and_then(|v| v.as_str()).unwrap_or("") == "PRI";
                col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
            } else {
                // Postgres
                col_info.insert("name".to_string(), obj.get("name").cloned().unwrap_or_default());
                col_info.insert("type".to_string(), obj.get("type").cloned().unwrap_or_default());
                
                let nullable_val = obj.get("nullable").unwrap_or(&serde_json::Value::Null);
                let is_nullable = nullable_val.as_bool().unwrap_or_else(|| nullable_val.as_str() == Some("true") || nullable_val.as_str() == Some("1") || nullable_val.as_i64() == Some(1));
                col_info.insert("nullable".to_string(), serde_json::Value::Bool(is_nullable));
                
                let pk_val = obj.get("primary_key").unwrap_or(&serde_json::Value::Null);
                let is_pk = pk_val.as_bool().unwrap_or_else(|| pk_val.as_str() == Some("true") || pk_val.as_str() == Some("1") || pk_val.as_i64() == Some(1));
                col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
            }
            columns.push(serde_json::Value::Object(col_info));
        }
    }
    Ok(serde_json::json!({ "columns": columns }))
}

#[command]
async fn get_rows(
    id: String, 
    _database: String, 
    table: String, 
    limit: u32, 
    offset: u32,
    sort_column: Option<String>,
    sort_order: Option<String>,
    search_query: Option<String>,
    filters: Option<Vec<serde_json::Value>>,
    state: State<'_, DbState>
) -> Result<serde_json::Value, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    
    // Identifier quoting depends on SQL dialect
    let table_ident = match profile.r#type {
        SupportedDB::Postgres => format!("\"{}\"", table),
        SupportedDB::Mariadb => format!("`{}`", table),
        SupportedDB::Sqlite => format!("\"{}\"", table),
    };
    
    // Build WHERE clause
    let mut where_clauses = Vec::new();
    
    if let Some(flts) = filters {
        for f in flts {
            if let Some(obj) = f.as_object() {
                let col = obj.get("column").and_then(|v| v.as_str()).unwrap_or("");
                let op = obj.get("operator").and_then(|v| v.as_str()).unwrap_or("");
                let val = obj.get("value").and_then(|v| v.as_str()).unwrap_or("");
                
                if col.is_empty() { continue; }
                
                let col_ident = match profile.r#type {
                    SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", col),
                    SupportedDB::Mariadb => format!("`{}`", col),
                };
                
                let val_escaped = val.replace("'", "''"); // very basic escaping
                
                let clause = match op {
                    "equals" => format!("{} = '{}'", col_ident, val_escaped),
                    "contains" => format!("{} LIKE '%{}%'", col_ident, val_escaped),
                    "startsWith" => format!("{} LIKE '{}%'", col_ident, val_escaped),
                    "endsWith" => format!("{} LIKE '%{}'", col_ident, val_escaped),
                    "gt" => format!("{} > '{}'", col_ident, val_escaped),
                    "gte" => format!("{} >= '{}'", col_ident, val_escaped),
                    "lt" => format!("{} < '{}'", col_ident, val_escaped),
                    "lte" => format!("{} <= '{}'", col_ident, val_escaped),
                    "neq" => format!("{} != '{}'", col_ident, val_escaped),
                    "isNull" => format!("{} IS NULL", col_ident),
                    "isNotNull" => format!("{} IS NOT NULL", col_ident),
                    _ => continue,
                };
                where_clauses.push(clause);
            }
        }
    }
    
    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };
    
    // Build ORDER BY clause
    let order_sql = if let Some(col) = sort_column {
        if col.is_empty() {
            "".to_string()
        } else {
            let col_ident = match profile.r#type {
                SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", col),
                SupportedDB::Mariadb => format!("`{}`", col),
            };
            let dir = sort_order.unwrap_or_else(|| "ASC".to_string()).to_uppercase();
            let dir = if dir == "DESC" { "DESC" } else { "ASC" };
            format!("ORDER BY {} {}", col_ident, dir)
        }
    } else {
        "".to_string()
    };
    
    let query = format!("SELECT * FROM {} {} {} LIMIT {} OFFSET {}", table_ident, where_sql, order_sql, limit, offset);
    let count_query = format!("SELECT COUNT(*) FROM {} {}", table_ident, where_sql);
    
    let pool = get_pool(&state, profile).await?;
    
    // Run both queries concurrently
    let (rows_res, count_res) = tokio::join!(
        execute_query(&pool, &query),
        execute_query(&pool, &count_query)
    );
    
    let rows = rows_res?;
    let count_rows = count_res?;
    
    let mut total = 0;
    if let Some(first) = count_rows.first() {
        if let Some(obj) = first.as_object() {
            if let Some(val) = obj.values().next() {
                if let Some(s) = val.as_str() {
                    total = s.parse::<u32>().unwrap_or(0);
                } else if let Some(n) = val.as_u64() {
                    total = n as u32;
                }
            }
        }
    }
    
    Ok(serde_json::json!({ "rows": rows, "total": total }))
}

// Helper to get connection and execute query ad-hoc
async fn run_adhoc_query(id: &str, query: &str, state: &State<'_, DbState>) -> Result<Vec<serde_json::Value>, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(state, profile).await?;
    execute_query(&pool, query).await
}

#[command]
async fn execute_command(id: String, _database: String, command: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let rows = run_adhoc_query(&id, &command, &state).await?;
    Ok(serde_json::json!({ "rows": rows, "affectedRows": 0 })) // sqlx Any doesn't easily expose rows_affected
}

#[command]
async fn commit_changes(id: String, _database: String, table: String, changes: serde_json::Value, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    
    let table_ident = match profile.r#type {
        SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", table),
        SupportedDB::Mariadb => format!("`{}`", table),
    };
    
    let mut queries = Vec::new();
    
    // Inserts
    if let Some(inserts) = changes.get("inserts").and_then(|v| v.as_array()) {
        for row in inserts {
            if let Some(obj) = row.as_object() {
                if obj.is_empty() { continue; }
                
                let mut cols = Vec::new();
                let mut vals = Vec::new();
                
                for (k, v) in obj {
                    let col_ident = match profile.r#type {
                        SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", k),
                        SupportedDB::Mariadb => format!("`{}`", k),
                    };
                    cols.push(col_ident);
                    
                    if v.is_null() {
                        vals.push("NULL".to_string());
                    } else if let Some(n) = v.as_number() {
                        vals.push(n.to_string());
                    } else if let Some(b) = v.as_bool() {
                        vals.push(if b { "true".to_string() } else { "false".to_string() });
                    } else if let Some(s) = v.as_str() {
                        vals.push(format!("'{}'", s.replace("'", "''")));
                    } else {
                        vals.push(format!("'{}'", v.to_string().replace("'", "''")));
                    }
                }
                
                queries.push(format!("INSERT INTO {} ({}) VALUES ({})", table_ident, cols.join(", "), vals.join(", ")));
            }
        }
    }
    
    // Updates
    if let Some(updates) = changes.get("updates").and_then(|v| v.as_array()) {
        for row in updates {
            if let Some(obj) = row.as_object() {
                let pk_col = obj.get("pkColumn").and_then(|v| v.as_str()).unwrap_or("");
                let pk_val = obj.get("pkValue").unwrap_or(&serde_json::Value::Null);
                
                if pk_col.is_empty() || pk_val.is_null() { continue; }
                
                let pk_col_ident = match profile.r#type {
                    SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", pk_col),
                    SupportedDB::Mariadb => format!("`{}`", pk_col),
                };
                
                let pk_val_str = if let Some(n) = pk_val.as_number() {
                    n.to_string()
                } else if let Some(s) = pk_val.as_str() {
                    format!("'{}'", s.replace("'", "''"))
                } else {
                    format!("'{}'", pk_val.to_string().replace("'", "''"))
                };
                
                if let Some(data) = obj.get("data").and_then(|v| v.as_object()) {
                    let mut sets = Vec::new();
                    for (k, v) in data {
                        let col_ident = match profile.r#type {
                            SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", k),
                            SupportedDB::Mariadb => format!("`{}`", k),
                        };
                        
                        if v.is_null() {
                            sets.push(format!("{} = NULL", col_ident));
                        } else if let Some(n) = v.as_number() {
                            sets.push(format!("{} = {}", col_ident, n));
                        } else if let Some(b) = v.as_bool() {
                            sets.push(format!("{} = {}", col_ident, if b { "true" } else { "false" }));
                        } else if let Some(s) = v.as_str() {
                            sets.push(format!("{} = '{}'", col_ident, s.replace("'", "''")));
                        } else {
                            sets.push(format!("{} = '{}'", col_ident, v.to_string().replace("'", "''")));
                        }
                    }
                    
                    if !sets.is_empty() {
                        queries.push(format!("UPDATE {} SET {} WHERE {} = {}", table_ident, sets.join(", "), pk_col_ident, pk_val_str));
                    }
                }
            }
        }
    }
    
    // Deletes
    if let Some(deletes) = changes.get("deletes").and_then(|v| v.as_array()) {
        for row in deletes {
            if let Some(obj) = row.as_object() {
                let pk_col = obj.get("pkColumn").and_then(|v| v.as_str()).unwrap_or("");
                let pk_val = obj.get("pkValue").unwrap_or(&serde_json::Value::Null);
                
                if pk_col.is_empty() || pk_val.is_null() { continue; }
                
                let pk_col_ident = match profile.r#type {
                    SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", pk_col),
                    SupportedDB::Mariadb => format!("`{}`", pk_col),
                };
                
                let pk_val_str = if let Some(n) = pk_val.as_number() {
                    n.to_string()
                } else if let Some(s) = pk_val.as_str() {
                    format!("'{}'", s.replace("'", "''"))
                } else {
                    format!("'{}'", pk_val.to_string().replace("'", "''"))
                };
                
                queries.push(format!("DELETE FROM {} WHERE {} = {}", table_ident, pk_col_ident, pk_val_str));
            }
        }
    }
    
    let pool = get_pool(&state, profile).await?;
    execute_transaction(&pool, &queries).await?;
    
    Ok(serde_json::json!({ "success": true, "queries": queries }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(DbState::default())
    .invoke_handler(tauri::generate_handler![
        get_profiles,
        save_profile,
        delete_profile,
        test_connection,
        get_databases,
        get_tables,
        get_columns,
        get_rows,
        execute_command,
        commit_changes
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
