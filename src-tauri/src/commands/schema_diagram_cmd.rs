use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{get_pool, execute_query, resolve_profile, DbState};

#[command]
pub async fn get_schema_diagram(id: String, database: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;

    match profile.r#type {
        SupportedDB::Postgres => {
            // 1. Get all public tables first to guarantee all tables are discovered
            let tbl_query = "SELECT tablename::text AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;";
            let tbl_rows = execute_query(&pool, tbl_query).await.map_err(|e| format!("Could not read the table list: {}", e))?;

            let mut tables_map: std::collections::BTreeMap<String, Vec<serde_json::Value>> = std::collections::BTreeMap::new();
            for tr in tbl_rows {
                if let Some(obj) = tr.as_object() {
                    if let Some(tbl) = obj.get("name").and_then(|v| v.as_str()) {
                        if !tbl.is_empty() {
                            tables_map.insert(tbl.to_string(), Vec::new());
                        }
                    }
                }
            }

            // 2. Get all columns with primary key information via information_schema
            let col_query = "
                SELECT 
                    c.table_name::text AS table_name,
                    c.column_name::text AS column_name,
                    c.data_type::text AS data_type,
                    EXISTS (
                        SELECT 1 
                        FROM information_schema.table_constraints tc 
                        JOIN information_schema.key_column_usage kcu 
                          ON tc.constraint_name = kcu.constraint_name 
                          AND tc.table_schema = kcu.table_schema 
                        WHERE tc.constraint_type = 'PRIMARY KEY' 
                          AND tc.table_name = c.table_name 
                          AND tc.table_schema = c.table_schema 
                          AND kcu.column_name = c.column_name
                    ) AS is_primary_key
                FROM information_schema.columns c
                WHERE c.table_schema = 'public'
                ORDER BY c.table_name, c.ordinal_position;
            ";
            let col_rows = execute_query(&pool, col_query).await.map_err(|e| format!("Could not read column metadata: {}", e))?;

            for r in col_rows {
                if let Some(obj) = r.as_object() {
                    let tbl = obj.get("table_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let col_name = obj.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let col_type = obj.get("data_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let is_pk = obj.get("is_primary_key").and_then(|v| v.as_bool()).unwrap_or(false);

                    if !tbl.is_empty() && !col_name.is_empty() {
                        tables_map.entry(tbl).or_default().push(serde_json::json!({
                            "name": col_name,
                            "type": col_type,
                            "primaryKey": is_pk
                        }));
                    }
                }
            }

            let tables: Vec<serde_json::Value> = tables_map.into_iter().map(|(name, columns)| {
                serde_json::json!({
                    "name": name,
                    "columns": columns
                })
            }).collect();

            // 3. Get all foreign keys
            let fk_query = "
                SELECT
                    tc.table_name::text AS from_table,
                    kcu.column_name::text AS from_column,
                    ccu.table_name::text AS to_table,
                    ccu.column_name::text AS to_column
                FROM information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
            ";
            let fk_rows = execute_query(&pool, fk_query).await.map_err(|e| format!("Could not read foreign key metadata: {}", e))?;

            let mut relations = Vec::new();
            for r in fk_rows {
                if let Some(obj) = r.as_object() {
                    let from_tbl = obj.get("from_table").and_then(|v| v.as_str()).unwrap_or("");
                    let from_col = obj.get("from_column").and_then(|v| v.as_str()).unwrap_or("");
                    let to_tbl = obj.get("to_table").and_then(|v| v.as_str()).unwrap_or("");
                    let to_col = obj.get("to_column").and_then(|v| v.as_str()).unwrap_or("");

                    if !from_tbl.is_empty() && !to_tbl.is_empty() {
                        relations.push(serde_json::json!({
                            "fromTable": from_tbl,
                            "fromColumn": from_col,
                            "toTable": to_tbl,
                            "toColumn": to_col
                        }));
                    }
                }
            }

            Ok(serde_json::json!({
                "tables": tables,
                "relations": relations
            }))
        }

        SupportedDB::Mariadb => {
            let col_query = "
                SELECT 
                    TABLE_NAME AS table_name,
                    COLUMN_NAME AS column_name,
                    COLUMN_TYPE AS data_type,
                    COLUMN_KEY = 'PRI' AS is_primary_key
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                ORDER BY TABLE_NAME, ORDINAL_POSITION;
            ";
            let col_rows = execute_query(&pool, col_query).await.map_err(|e| format!("Could not read column metadata: {}", e))?;

            let fk_query = "
                SELECT 
                    TABLE_NAME AS from_table,
                    COLUMN_NAME AS from_column,
                    REFERENCED_TABLE_NAME AS to_table,
                    REFERENCED_COLUMN_NAME AS to_column
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME IS NOT NULL;
            ";
            let fk_rows = execute_query(&pool, fk_query).await.map_err(|e| format!("Could not read foreign key metadata: {}", e))?;

            let mut tables_map: std::collections::BTreeMap<String, Vec<serde_json::Value>> = std::collections::BTreeMap::new();
            for r in col_rows {
                if let Some(obj) = r.as_object() {
                    let tbl = obj.get("table_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let col_name = obj.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let col_type = obj.get("data_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let pk_val = obj.get("is_primary_key").unwrap_or(&serde_json::Value::Null);
                    let is_pk = pk_val.as_bool().unwrap_or_else(|| pk_val.as_i64() == Some(1) || pk_val.as_str() == Some("1"));

                    if !tbl.is_empty() && !col_name.is_empty() {
                        tables_map.entry(tbl).or_default().push(serde_json::json!({
                            "name": col_name,
                            "type": col_type,
                            "primaryKey": is_pk
                        }));
                    }
                }
            }

            let tables: Vec<serde_json::Value> = tables_map.into_iter().map(|(name, columns)| {
                serde_json::json!({
                    "name": name,
                    "columns": columns
                })
            }).collect();

            let mut relations = Vec::new();
            for r in fk_rows {
                if let Some(obj) = r.as_object() {
                    let from_tbl = obj.get("from_table").and_then(|v| v.as_str()).unwrap_or("");
                    let from_col = obj.get("from_column").and_then(|v| v.as_str()).unwrap_or("");
                    let to_tbl = obj.get("to_table").and_then(|v| v.as_str()).unwrap_or("");
                    let to_col = obj.get("to_column").and_then(|v| v.as_str()).unwrap_or("");

                    if !from_tbl.is_empty() && !to_tbl.is_empty() {
                        relations.push(serde_json::json!({
                            "fromTable": from_tbl,
                            "fromColumn": from_col,
                            "toTable": to_tbl,
                            "toColumn": to_col
                        }));
                    }
                }
            }

            Ok(serde_json::json!({
                "tables": tables,
                "relations": relations
            }))
        }

        SupportedDB::Sqlite => {
            let tbl_query = "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
            let tbl_rows = execute_query(&pool, tbl_query).await.map_err(|e| format!("Could not read the table list: {}", e))?;

            let mut tables = Vec::new();
            let mut relations = Vec::new();

            for tr in tbl_rows {
                let tbl_name = if let Some(obj) = tr.as_object() {
                    obj.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string()
                } else {
                    continue;
                };
                if tbl_name.is_empty() { continue; }

                let col_query = format!("PRAGMA table_info(\"{}\")", tbl_name);
                let col_rows = execute_query(&pool, &col_query).await.map_err(|e| format!("Could not read column metadata: {}", e))?;
                let mut cols = Vec::new();
                for cr in col_rows {
                    if let Some(cobj) = cr.as_object() {
                        let cname = cobj.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let ctype = cobj.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let pk_val = cobj.get("pk").unwrap_or(&serde_json::Value::Null);
                        let is_pk = pk_val.as_i64().map(|v| v != 0).unwrap_or_else(|| pk_val.as_str() == Some("1"));
                        cols.push(serde_json::json!({
                            "name": cname,
                            "type": ctype,
                            "primaryKey": is_pk
                        }));
                    }
                }

                tables.push(serde_json::json!({
                    "name": tbl_name,
                    "columns": cols
                }));

                let fk_query = format!("PRAGMA foreign_key_list(\"{}\")", tbl_name);
                let fk_rows = execute_query(&pool, &fk_query).await.map_err(|e| format!("Could not read foreign key metadata: {}", e))?;
                for fkr in fk_rows {
                    if let Some(fobj) = fkr.as_object() {
                        let to_tbl = fobj.get("table").and_then(|v| v.as_str()).unwrap_or("");
                        let from_col = fobj.get("from").and_then(|v| v.as_str()).unwrap_or("");
                        let to_col = fobj.get("to").and_then(|v| v.as_str()).unwrap_or("");

                        if !to_tbl.is_empty() {
                            relations.push(serde_json::json!({
                                "fromTable": tbl_name,
                                "fromColumn": from_col,
                                "toTable": to_tbl,
                                "toColumn": to_col
                            }));
                        }
                    }
                }
            }

            Ok(serde_json::json!({
                "tables": tables,
                "relations": relations
            }))
        }
    }
}
