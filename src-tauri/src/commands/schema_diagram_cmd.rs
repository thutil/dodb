use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{get_pool, execute_query, resolve_profile, DbState};

#[command]
pub async fn get_schema_diagram(id: String, database: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;

    match profile.r#type {
        SupportedDB::Postgres => {
            // 1. Get all user tables across all non-system schemas (e.g. public, reporting, etc.)
            let tbl_query = "
                SELECT 
                    CASE 
                        WHEN schemaname = 'public' THEN tablename::text 
                        ELSE (schemaname || '.' || tablename)::text 
                    END AS name,
                    schemaname::text AS schema_name,
                    tablename::text AS table_name
                FROM pg_tables 
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY (schemaname = 'public') DESC, tablename ASC;
            ";
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

            // 2. Get all columns with accurate primary key information across all schemas
            let col_query = "
                SELECT 
                    CASE 
                        WHEN c.table_schema = 'public' THEN c.table_name::text 
                        ELSE (c.table_schema || '.' || c.table_name)::text 
                    END AS table_name,
                    c.column_name::text AS column_name,
                    CASE 
                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name::text 
                        ELSE c.data_type::text 
                    END AS data_type,
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
                WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY c.table_schema, c.table_name, c.ordinal_position;
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

            // 3. Get all foreign keys via pg_catalog (100% accurate, handles all schemas & composite FKs)
            let fk_query = "
                SELECT
                    CASE WHEN n_src.nspname = 'public' THEN src.relname::text ELSE (n_src.nspname || '.' || src.relname)::text END AS from_table,
                    a_src.attname::text AS from_column,
                    CASE WHEN n_tgt.nspname = 'public' THEN tgt.relname::text ELSE (n_tgt.nspname || '.' || tgt.relname)::text END AS to_table,
                    a_tgt.attname::text AS to_column
                FROM (
                    SELECT 
                        conrelid, 
                        confrelid, 
                        unnest(conkey) AS conkey_attnum, 
                        unnest(confkey) AS confkey_attnum,
                        connamespace
                    FROM pg_constraint 
                    WHERE contype = 'f'
                ) fk
                JOIN pg_class src ON src.oid = fk.conrelid
                JOIN pg_namespace n_src ON n_src.oid = src.relnamespace
                JOIN pg_attribute a_src ON a_src.attrelid = fk.conrelid AND a_src.attnum = fk.conkey_attnum
                JOIN pg_class tgt ON tgt.oid = fk.confrelid
                JOIN pg_namespace n_tgt ON n_tgt.oid = tgt.relnamespace
                JOIN pg_attribute a_tgt ON a_tgt.attrelid = fk.confrelid AND a_tgt.attnum = fk.confkey_attnum
                WHERE n_src.nspname NOT IN ('pg_catalog', 'information_schema')
                  AND n_tgt.nspname NOT IN ('pg_catalog', 'information_schema');
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
            // 1. Get all tables in database
            let tbl_query = "
                SELECT TABLE_NAME AS name 
                FROM information_schema.TABLES 
                WHERE TABLE_SCHEMA = DATABASE() 
                ORDER BY TABLE_NAME;
            ";
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

            // 2. Get all columns
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

            // 3. Get all foreign keys
            let fk_query = "
                SELECT 
                    TABLE_NAME AS from_table,
                    COLUMN_NAME AS from_column,
                    REFERENCED_TABLE_NAME AS to_table,
                    REFERENCED_COLUMN_NAME AS to_column
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY TABLE_NAME, ORDINAL_POSITION;
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

        SupportedDB::Sqlite => {
            let tbl_query = "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
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
