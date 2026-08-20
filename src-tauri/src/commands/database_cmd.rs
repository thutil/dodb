use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{get_pool, execute_query, execute_command_raw, execute_transaction, escape_sql_literal, resolve_profile, DbState, TxStep};

// ==========================================
// Dialect Helpers (Postgres / MariaDB / SQLite)
// ==========================================

fn quote_table_ident(db_type: SupportedDB, table: &str) -> String {
    match db_type {
        SupportedDB::Postgres => {
            if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                format!("\"{}\".\"{}\"", parts[0].replace('"', ""), parts[1].replace('"', ""))
            } else {
                format!("\"{}\"", table.replace('"', ""))
            }
        },
        SupportedDB::Mariadb => {
            if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                format!("`{}`.`{}`", parts[0].replace('`', ""), parts[1].replace('`', ""))
            } else {
                format!("`{}`", table.replace('`', ""))
            }
        },
        SupportedDB::Sqlite => format!("\"{}\"", table.replace('"', "")),
    }
}

fn quote_column_ident(db_type: SupportedDB, col: &str) -> String {
    match db_type {
        SupportedDB::Postgres | SupportedDB::Sqlite => format!("\"{}\"", col.replace('"', "")),
        SupportedDB::Mariadb => format!("`{}`", col.replace('`', "")),
    }
}

fn format_sql_value(db_type: SupportedDB, val: &serde_json::Value) -> String {
    if val.is_null() {
        "NULL".to_string()
    } else if let Some(n) = val.as_number() {
        n.to_string()
    } else if let Some(b) = val.as_bool() {
        match db_type {
            SupportedDB::Sqlite => if b { "1".to_string() } else { "0".to_string() },
            SupportedDB::Mariadb | SupportedDB::Postgres => if b { "TRUE".to_string() } else { "FALSE".to_string() },
        }
    } else if let Some(s) = val.as_str() {
        format!("'{}'", escape_sql_literal(db_type, s))
    } else {
        format!("'{}'", escape_sql_literal(db_type, &val.to_string()))
    }
}

/// Builds one `WHERE` clause for a grid filter.
///
/// Returns `Err` for anything it cannot express: a filter that is silently
/// dropped shows the user unfiltered data that looks filtered (the COUNT query
/// uses the same clause list, so even the total agrees with the wrong rows).
fn build_filter_clause(
    db_type: SupportedDB,
    col: &str,
    op: &str,
    val: &serde_json::Value,
) -> Result<String, String> {
    if col.trim().is_empty() {
        return Err(format!("Filter with operator '{}' has no column selected.", op));
    }
    let col_ident = quote_column_ident(db_type, col);

    // Comparisons against NULL never match, so spell them out instead.
    if val.is_null() {
        return match op {
            "equals" | "isNull" => Ok(format!("{} IS NULL", col_ident)),
            "neq" | "isNotNull" => Ok(format!("{} IS NOT NULL", col_ident)),
            _ => Err(format!("Operator '{}' cannot be used with an empty value on {}.", op, col)),
        };
    }

    let clause = match op {
        "equals" => format!("{} = {}", col_ident, format_sql_value(db_type, val)),
        "neq" => format!("{} <> {}", col_ident, format_sql_value(db_type, val)),
        "gt" => format!("{} > {}", col_ident, format_sql_value(db_type, val)),
        "gte" => format!("{} >= {}", col_ident, format_sql_value(db_type, val)),
        "lt" => format!("{} < {}", col_ident, format_sql_value(db_type, val)),
        "lte" => format!("{} <= {}", col_ident, format_sql_value(db_type, val)),
        "contains" => like_clause(db_type, &col_ident, val, true, true)?,
        "startsWith" => like_clause(db_type, &col_ident, val, false, true)?,
        "endsWith" => like_clause(db_type, &col_ident, val, true, false)?,
        "isNull" => format!("{} IS NULL", col_ident),
        "isNotNull" => format!("{} IS NOT NULL", col_ident),
        other => return Err(format!("Unsupported filter operator '{}' on column {}.", other, col)),
    };
    Ok(clause)
}

fn like_clause(
    db_type: SupportedDB,
    col_ident: &str,
    val: &serde_json::Value,
    lead: bool,
    trail: bool,
) -> Result<String, String> {
    let raw = match val {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        _ => return Err("LIKE filters need a text value.".to_string()),
    };

    let mut pattern = String::with_capacity(raw.len() + 2);
    if lead { pattern.push('%'); }
    for ch in raw.chars() {
        if ch == '%' || ch == '_' || ch == LIKE_ESCAPE {
            pattern.push(LIKE_ESCAPE);
        }
        pattern.push(ch);
    }
    if trail { pattern.push('%'); }

    Ok(format!(
        "{} LIKE '{}' ESCAPE '{}'",
        col_ident,
        escape_sql_literal(db_type, &pattern),
        escape_sql_literal(db_type, &LIKE_ESCAPE.to_string())
    ))
}

const LIKE_ESCAPE: char = '\\';

fn statement_returns_rows(sql: &str) -> bool {
    let mut body = String::new();
    for line in sql.lines() {
        let line = line.trim_start();
        if line.starts_with("--") || line.starts_with('#') {
            continue;
        }
        body.push_str(line);
        body.push(' ');
    }
    while let (Some(open), Some(close)) = (body.find("/*"), body.find("*/")) {
        if close < open { break; }
        body.replace_range(open..close + 2, " ");
    }
    let lowered = body.trim().to_lowercase();
    if lowered.contains(" returning ") || lowered.ends_with(" returning") {
        return true;
    }
    let first = lowered
        .split(|c: char| c.is_whitespace() || c == '(' || c == ';')
        .find(|w| !w.is_empty())
        .unwrap_or("");
    matches!(
        first,
        "select" | "with" | "show" | "explain" | "describe" | "desc" | "pragma" | "values" | "table" | "analyze"
    )
}

// ==========================================
// Database Commands
// ==========================================

#[command]
pub async fn get_databases(id: String, state: State<'_, DbState>) -> Result<Vec<String>, String> {
    let profile = &resolve_profile(&state, &id)?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT datname::text as name FROM pg_database WHERE datistemplate = false ORDER BY datname",
        SupportedDB::Mariadb => "SHOW DATABASES",
        SupportedDB::Sqlite => "SELECT name FROM pragma_database_list",
    };
    
    let pool = get_pool(&state, profile, None).await?;
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
pub async fn get_tables(id: String, database: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "
            SELECT 
                CASE 
                    WHEN schemaname = 'public' THEN tablename::text 
                    ELSE (schemaname || '.' || tablename)::text 
                END AS name 
            FROM pg_tables 
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
            ORDER BY (schemaname = 'public') DESC, tablename ASC
        ",
        SupportedDB::Mariadb => "SHOW TABLES",
        SupportedDB::Sqlite => "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    };
    
    let pool = get_pool(&state, profile, Some(&database)).await?;
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
pub async fn get_columns(id: String, database: String, table: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => {
            let (schema_part, table_part, qualified) = if table.contains('.') {
                let parts: Vec<&str> = table.splitn(2, '.').collect();
                (parts[0].replace('\'', "''"), parts[1].replace('\'', "''"), true)
            } else {
                ("public".to_string(), table.replace('\'', "''"), false)
            };

            // A qualified name must resolve inside its own schema only. Falling back to
            // `public`/CURRENT_SCHEMA() there mixes in the columns of a same-named table
            // from another schema, which corrupts primary-key detection in the grid.
            let schema_filter = if qualified {
                "(c.table_schema = '{0}' OR LOWER(c.table_schema) = LOWER('{0}'))"
            } else {
                "(c.table_schema = '{0}' OR LOWER(c.table_schema) = LOWER('{0}') OR c.table_schema = CURRENT_SCHEMA())"
            };
            
            format!("
                SELECT 
                    c.column_name::text AS name, 
                    CASE 
                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name::text 
                        ELSE c.data_type::text 
                    END AS type,
                    (c.is_nullable = 'YES') AS nullable,
                    c.column_default::text AS default_value,
                    EXISTS (
                        SELECT 1 
                        FROM information_schema.table_constraints tc 
                        JOIN information_schema.key_column_usage kcu 
                          ON tc.constraint_name = kcu.constraint_name 
                          AND tc.table_schema = kcu.table_schema 
                        WHERE tc.constraint_type = 'PRIMARY KEY' 
                          AND (tc.table_name = c.table_name OR LOWER(tc.table_name) = LOWER(c.table_name))
                          AND (tc.table_schema = c.table_schema OR LOWER(tc.table_schema) = LOWER(c.table_schema))
                          AND kcu.column_name = c.column_name
                    ) AS primary_key
                FROM information_schema.columns c
                WHERE {0}
                  AND (c.table_name = '{1}' OR LOWER(c.table_name) = LOWER('{1}'))
                ORDER BY c.ordinal_position
            ", schema_filter.replace("{0}", &schema_part), table_part)
        },
        SupportedDB::Mariadb => format!("SHOW FULL COLUMNS FROM `{}`", table.replace('`', "")),
        SupportedDB::Sqlite => format!("PRAGMA table_info(\"{}\")", table.replace('"', "")),
    };
    
    let pool = get_pool(&state, profile, Some(&database)).await?;
    let rows = execute_query(&pool, &query).await?;
    
    let mut columns = Vec::new();
    for row in rows {
        if let Some(obj) = row.as_object() {
            let mut col_info = serde_json::Map::new();
            
            match profile.r#type {
                SupportedDB::Sqlite => {
                    let name = obj.get("name").cloned().unwrap_or_default();
                    let col_type = obj.get("type").cloned().unwrap_or_default();
                    col_info.insert("name".to_string(), name);
                    col_info.insert("type".to_string(), col_type.clone());
                    
                    let notnull_val = obj.get("notnull").unwrap_or(&serde_json::Value::Null);
                    let is_not_null = notnull_val.as_i64().map(|v| v != 0).unwrap_or_else(|| notnull_val.as_str() == Some("1"));
                    col_info.insert("nullable".to_string(), serde_json::Value::Bool(!is_not_null));
                    
                    let pk_val = obj.get("pk").unwrap_or(&serde_json::Value::Null);
                    let is_pk = pk_val.as_i64().map(|v| v != 0).unwrap_or_else(|| pk_val.as_str() == Some("1"));
                    col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
                    col_info.insert("default".to_string(), obj.get("dflt_value").cloned().unwrap_or(serde_json::Value::Null));

                    let is_auto = is_pk && col_type.as_str().map(|t| t.to_lowercase().contains("int")).unwrap_or(false);
                    col_info.insert("autoIncrement".to_string(), serde_json::Value::Bool(is_auto));
                },
                SupportedDB::Mariadb => {
                    col_info.insert("name".to_string(), obj.get("Field").cloned().unwrap_or_default());
                    col_info.insert("type".to_string(), obj.get("Type").cloned().unwrap_or_default());
                    
                    let is_nullable = obj.get("Null").and_then(|v| v.as_str()).unwrap_or("NO") == "YES";
                    col_info.insert("nullable".to_string(), serde_json::Value::Bool(is_nullable));
                    
                    let is_pk = obj.get("Key").and_then(|v| v.as_str()).unwrap_or("") == "PRI";
                    col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
                    col_info.insert("default".to_string(), obj.get("Default").cloned().unwrap_or(serde_json::Value::Null));

                    let extra_val = obj.get("Extra").and_then(|v| v.as_str()).unwrap_or("");
                    let is_auto = extra_val.to_lowercase().contains("auto_increment");
                    col_info.insert("autoIncrement".to_string(), serde_json::Value::Bool(is_auto));
                    col_info.insert("extra".to_string(), serde_json::Value::String(extra_val.to_string()));
                },
                SupportedDB::Postgres => {
                    col_info.insert("name".to_string(), obj.get("name").cloned().unwrap_or_default());
                    col_info.insert("type".to_string(), obj.get("type").cloned().unwrap_or_default());
                    
                    let nullable_val = obj.get("nullable").unwrap_or(&serde_json::Value::Null);
                    let is_nullable = nullable_val.as_bool().unwrap_or_else(|| nullable_val.as_str() == Some("true") || nullable_val.as_str() == Some("1") || nullable_val.as_i64() == Some(1));
                    col_info.insert("nullable".to_string(), serde_json::Value::Bool(is_nullable));
                    
                    let pk_val = obj.get("primary_key").unwrap_or(&serde_json::Value::Null);
                    let is_pk = pk_val.as_bool().unwrap_or_else(|| pk_val.as_str() == Some("true") || pk_val.as_str() == Some("1") || pk_val.as_i64() == Some(1));
                    col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(is_pk));
                    let def_val = obj.get("default_value").cloned().unwrap_or(serde_json::Value::Null);
                    col_info.insert("default".to_string(), def_val.clone());

                    let def_str = def_val.as_str().unwrap_or("");
                    let is_auto = def_str.contains("nextval") || def_str.contains("identity");
                    col_info.insert("autoIncrement".to_string(), serde_json::Value::Bool(is_auto));
                },
            }
            columns.push(serde_json::Value::Object(col_info));
        }
    }
    
    // Fallback: If information_schema / catalog returned empty, probe columns dynamically
    if columns.is_empty() {
        let fallback_query = match profile.r#type {
            SupportedDB::Postgres => {
                if table.contains('.') {
                    let parts: Vec<&str> = table.splitn(2, '.').collect();
                    format!("SELECT * FROM \"{}\".\"{}\" LIMIT 1", parts[0].replace('"', ""), parts[1].replace('"', ""))
                } else {
                    format!("SELECT * FROM \"{}\" LIMIT 1", table.replace('"', ""))
                }
            },
            SupportedDB::Mariadb => format!("SELECT * FROM `{}` LIMIT 1", table.replace('`', "")),
            SupportedDB::Sqlite => format!("SELECT * FROM \"{}\" LIMIT 1", table.replace('"', "")),
        };
        let dummy_rows = execute_query(&pool, &fallback_query)
            .await
            .map_err(|e| format!("Could not read the columns of {}: {}", table, e))?;
        if let Some(obj) = dummy_rows.first().and_then(|r| r.as_object()) {
            for key in obj.keys() {
                let mut col_info = serde_json::Map::new();
                col_info.insert("name".to_string(), serde_json::Value::String(key.clone()));
                col_info.insert("type".to_string(), serde_json::Value::String("text".to_string()));
                col_info.insert("nullable".to_string(), serde_json::Value::Bool(true));
                col_info.insert("primaryKey".to_string(), serde_json::Value::Bool(key.to_lowercase() == "id"));
                col_info.insert("default".to_string(), serde_json::Value::Null);
                col_info.insert("autoIncrement".to_string(), serde_json::Value::Bool(key.to_lowercase() == "id"));
                columns.push(serde_json::Value::Object(col_info));
            }
        }

        if columns.is_empty() {
            return Err(format!(
                "Could not determine the columns of {}: the catalog lookup returned nothing and the table has no rows to probe.",
                table
            ));
        }
    }
    
    Ok(serde_json::json!({ "columns": columns }))
}

#[command]
pub async fn get_rows(
    id: String, 
    database: String, 
    table: String, 
    limit: u32, 
    offset: u32,
    sort_column: Option<String>,
    sort_order: Option<String>,
    _search_query: Option<String>,
    filters: Option<Vec<serde_json::Value>>,
    state: State<'_, DbState>
) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    
    let table_ident = quote_table_ident(profile.r#type, &table);
    
    // Build WHERE clause using dialect-specific column quoting and escaping
    let mut where_clauses = Vec::new();
    if let Some(flts) = filters {
        for f in flts {
            let obj = f.as_object().ok_or("Malformed filter")?;
            let col = obj.get("column").and_then(|v| v.as_str()).unwrap_or("");
            let op = obj.get("operator").and_then(|v| v.as_str()).unwrap_or("");
            let val = obj.get("value").cloned().unwrap_or(serde_json::Value::Null);

            where_clauses.push(build_filter_clause(profile.r#type, col, op, &val)?);
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
            let col_ident = quote_column_ident(profile.r#type, &col);
            let dir = sort_order.unwrap_or_else(|| "ASC".to_string()).to_uppercase();
            let dir = if dir == "DESC" { "DESC" } else { "ASC" };
            format!("ORDER BY {} {}", col_ident, dir)
        }
    } else {
        "".to_string()
    };
    
    let query = format!("SELECT * FROM {} {} {} LIMIT {} OFFSET {}", table_ident, where_sql, order_sql, limit, offset);
    let count_query = format!("SELECT COUNT(*) AS total FROM {} {}", table_ident, where_sql);
    
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    // Try querying with quoted identifier first; fallback to unquoted if identifier casing mismatch occurs (e.g. Postgres lowercase tables)
    let (rows, count_rows) = match tokio::join!(
        execute_query(&pool, &query),
        execute_query(&pool, &count_query)
    ) {
        (Ok(r), Ok(c)) => (r, c),
        (first_rows, first_count) => {
            // Retry unquoted for the casing-mismatch case, but report the ORIGINAL
            // error if that fails too: the retry's error is usually about the bare
            // identifier and hides the real cause (a bad filter, permissions, ...).
            let unquoted_query = format!("SELECT * FROM {} {} {} LIMIT {} OFFSET {}", table, where_sql, order_sql, limit, offset);
            let unquoted_count = format!("SELECT COUNT(*) AS total FROM {} {}", table, where_sql);
            let (r2, c2) = tokio::join!(
                execute_query(&pool, &unquoted_query),
                execute_query(&pool, &unquoted_count)
            );
            match (r2, c2) {
                (Ok(r), Ok(c)) => (r, c),
                _ => {
                    let original = first_rows.err().or_else(|| first_count.err());
                    return Err(original.unwrap_or_else(|| "Failed to read table rows".to_string()));
                }
            }
        }
    };
    
    let mut total = 0;
    if let Some(first) = count_rows.first() {
        if let Some(obj) = first.as_object() {
            if let Some(val) = obj.get("total").or_else(|| obj.values().next()) {
                if let Some(n) = val.as_i64() {
                    total = n as u32;
                } else if let Some(n) = val.as_u64() {
                    total = n as u32;
                } else if let Some(s) = val.as_str() {
                    total = s.parse::<u32>().unwrap_or(0);
                }
            }
        }
    }
    
    Ok(serde_json::json!({ "rows": rows, "total": total }))
}

#[command]
pub async fn execute_command(id: String, database: String, command: String, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    // Row-returning statements go through fetch_all; everything else through
    // execute(), which is the only call that reports rows_affected. Retrying a
    // failed statement with the other call would re-run side effects, so we
    // don't: the classification decides once.
    if statement_returns_rows(&command) {
        let rows = execute_query(&pool, &command).await?;
        let returned = rows.len();
        Ok(serde_json::json!({
            "rows": rows,
            "rowsReturned": returned,
            "affectedRows": serde_json::Value::Null
        }))
    } else {
        let affected = execute_command_raw(&pool, &command).await?;
        Ok(serde_json::json!({
            "rows": Vec::<serde_json::Value>::new(),
            "rowsReturned": 0,
            "affectedRows": affected
        }))
    }
}

/// `COUNT(*)` expression that decodes as a signed 64-bit integer on every
/// dialect (MySQL's COUNT is BIGINT UNSIGNED, which sqlx will not hand back as i64).
fn count_star_expr(db_type: SupportedDB) -> &'static str {
    match db_type {
        SupportedDB::Postgres => "COUNT(*)::bigint",
        SupportedDB::Mariadb => "CAST(COUNT(*) AS SIGNED)",
        SupportedDB::Sqlite => "COUNT(*)",
    }
}

/// Builds a `WHERE` clause from the original values of a row's key columns.
/// NULL keys become `IS NULL` (a `= NULL` comparison never matches).
fn build_row_where(db_type: SupportedDB, keys: &serde_json::Map<String, serde_json::Value>) -> Result<String, String> {
    if keys.is_empty() {
        return Err("Cannot identify the row to change: no key columns were provided.".to_string());
    }
    let clauses: Vec<String> = keys
        .iter()
        .map(|(col, val)| {
            let col_ident = quote_column_ident(db_type, col);
            if val.is_null() {
                format!("{} IS NULL", col_ident)
            } else {
                format!("{} = {}", col_ident, format_sql_value(db_type, val))
            }
        })
        .collect();
    Ok(clauses.join(" AND "))
}

fn row_keys<'a>(obj: &'a serde_json::Map<String, serde_json::Value>) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    obj.get("keys")
        .and_then(|v| v.as_object())
        .filter(|m| !m.is_empty())
        .ok_or_else(|| "Cannot identify the row to change: the table has no primary key and no key values were sent.".to_string())
}

/// Turns the grid's pending changes into transaction steps.
///
/// Every update and delete is preceded by a `RequireOne` guard on the same
/// `WHERE` clause, so a key that no longer matches exactly one row aborts the
/// transaction instead of committing a statement that touches nothing.
/// Returns `(steps, dml)` where `dml` is the statements only, in the same order
/// as the affected-row counts reported back to the UI.
fn build_commit_steps(
    db_type: SupportedDB,
    table: &str,
    changes: &serde_json::Value,
) -> Result<(Vec<TxStep>, Vec<String>), String> {
    let table_ident = quote_table_ident(db_type, table);
    let mut steps: Vec<TxStep> = Vec::new();
    let mut dml: Vec<String> = Vec::new();

    // 1. Inserts
    if let Some(inserts) = changes.get("inserts").and_then(|v| v.as_array()) {
        for row in inserts {
            if let Some(obj) = row.as_object() {
                if obj.is_empty() { continue; }

                let mut cols = Vec::new();
                let mut vals = Vec::new();

                for (k, v) in obj {
                    cols.push(quote_column_ident(db_type, k));
                    vals.push(format_sql_value(db_type, v));
                }

                let sql = format!("INSERT INTO {} ({}) VALUES ({})", table_ident, cols.join(", "), vals.join(", "));
                dml.push(sql.clone());
                steps.push(TxStep::Exec(sql));
            }
        }
    }

    // 2. Updates
    if let Some(updates) = changes.get("updates").and_then(|v| v.as_array()) {
        for row in updates {
            let obj = row.as_object().ok_or("Malformed update payload")?;
            let keys = row_keys(obj)?;
            let where_sql = build_row_where(db_type, keys)?;

            let data = obj
                .get("data")
                .and_then(|v| v.as_object())
                .filter(|m| !m.is_empty())
                .ok_or("Update contains no changed columns")?;

            let sets: Vec<String> = data
                .iter()
                .map(|(k, v)| format!("{} = {}", quote_column_ident(db_type, k), format_sql_value(db_type, v)))
                .collect();

            steps.push(TxStep::RequireOne {
                sql: format!("SELECT {} FROM {} WHERE {}", count_star_expr(db_type), table_ident, where_sql),
                label: format!("UPDATE on {}", table),
            });
            let sql = format!("UPDATE {} SET {} WHERE {}", table_ident, sets.join(", "), where_sql);
            dml.push(sql.clone());
            steps.push(TxStep::Exec(sql));
        }
    }

    // 3. Deletes
    if let Some(deletes) = changes.get("deletes").and_then(|v| v.as_array()) {
        for row in deletes {
            let obj = row.as_object().ok_or("Malformed delete payload")?;
            let keys = row_keys(obj)?;
            let where_sql = build_row_where(db_type, keys)?;

            steps.push(TxStep::RequireOne {
                sql: format!("SELECT {} FROM {} WHERE {}", count_star_expr(db_type), table_ident, where_sql),
                label: format!("DELETE on {}", table),
            });
            let sql = format!("DELETE FROM {} WHERE {}", table_ident, where_sql);
            dml.push(sql.clone());
            steps.push(TxStep::Exec(sql));
        }
    }

    if dml.is_empty() {
        return Err("Nothing to commit: no statements were generated from the pending changes.".to_string());
    }

    Ok((steps, dml))
}

#[command]
pub async fn commit_changes(id: String, database: String, table: String, changes: serde_json::Value, state: State<'_, DbState>) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;

    let (steps, queries) = build_commit_steps(profile.r#type, &table, &changes)?;

    let pool = get_pool(&state, profile, Some(&database)).await?;
    let affected = execute_transaction(&pool, &steps).await?;
    let total_affected: u64 = affected.iter().sum();

    Ok(serde_json::json!({
        "success": true,
        "queries": queries,
        "affected": affected,
        "totalAffected": total_affected
    }))
}

#[command]
pub async fn disconnect_database(id: Option<String>, state: State<'_, DbState>) -> Result<bool, String> {
    crate::db_core::close_profile_pools(&state, id.as_deref()).await?;
    Ok(true)
}



#[cfg(test)]
mod tests {
    use super::*;

    fn keys(pairs: &[(&str, serde_json::Value)]) -> serde_json::Map<String, serde_json::Value> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    #[test]
    fn where_clause_uses_all_key_columns() {
        let k = keys(&[("id", serde_json::json!(7)), ("tenant", serde_json::json!("acme"))]);
        let sql = build_row_where(SupportedDB::Postgres, &k).unwrap();
        assert!(sql.contains("\"id\" = 7"), "{sql}");
        assert!(sql.contains("\"tenant\" = 'acme'"), "{sql}");
        assert!(sql.contains(" AND "), "{sql}");
    }

    #[test]
    fn null_key_uses_is_null_not_equals() {
        let k = keys(&[("note", serde_json::Value::Null)]);
        assert_eq!(build_row_where(SupportedDB::Mariadb, &k).unwrap(), "`note` IS NULL");
    }

    #[test]
    fn empty_keys_are_refused() {
        assert!(build_row_where(SupportedDB::Sqlite, &keys(&[])).is_err());
    }

    #[test]
    fn mariadb_escapes_backslash_as_well_as_quote() {
        assert_eq!(escape_sql_literal(SupportedDB::Mariadb, r"a\b'c"), r"a\\b''c");
        assert_eq!(escape_sql_literal(SupportedDB::Postgres, r"a\b'c"), r"a\b''c");
    }

    #[test]
    fn dotted_names_are_quoted_per_part() {
        assert_eq!(quote_table_ident(SupportedDB::Postgres, "sales.orders"), "\"sales\".\"orders\"");
        assert_eq!(quote_table_ident(SupportedDB::Mariadb, "shop.orders"), "`shop`.`orders`");
    }

    fn dml_of(db: SupportedDB, table: &str, changes: serde_json::Value) -> Vec<String> {
        build_commit_steps(db, table, &changes).unwrap().1
    }

    #[test]
    fn update_is_addressed_by_original_key_values_and_guarded() {
        let changes = serde_json::json!({
            "updates": [{ "keys": { "id": 7 }, "data": { "name": "new" } }]
        });
        let (steps, dml) = build_commit_steps(SupportedDB::Postgres, "users", &changes).unwrap();
        assert_eq!(dml, vec![r#"UPDATE "users" SET "name" = 'new' WHERE "id" = 7"#]);
        assert_eq!(steps.len(), 2, "each update must be preceded by a guard");
        match &steps[0] {
            TxStep::RequireOne { sql, label } => {
                assert_eq!(sql, r#"SELECT COUNT(*)::bigint FROM "users" WHERE "id" = 7"#);
                assert_eq!(label, "UPDATE on users");
            }
            _ => panic!("expected a guard first"),
        }
    }

    #[test]
    fn composite_keys_constrain_every_column() {
        let changes = serde_json::json!({
            "updates": [{ "keys": { "order_id": 1, "line_no": 2 }, "data": { "qty": 5 } }]
        });
        let sql = dml_of(SupportedDB::Mariadb, "order_lines", changes).remove(0);
        assert!(sql.contains("`line_no` = 2"), "{sql}");
        assert!(sql.contains("`order_id` = 1"), "{sql}");
        assert!(sql.contains("SET `qty` = 5"), "{sql}");
    }

    #[test]
    fn update_without_keys_is_an_error_not_a_silent_skip() {
        let changes = serde_json::json!({ "updates": [{ "data": { "name": "x" } }] });
        let err = build_commit_steps(SupportedDB::Postgres, "users", &changes).unwrap_err();
        assert!(err.contains("Cannot identify the row"), "{err}");
    }

    #[test]
    fn empty_payload_is_an_error_not_an_empty_transaction() {
        let changes = serde_json::json!({ "inserts": [], "updates": [], "deletes": [] });
        assert!(build_commit_steps(SupportedDB::Sqlite, "t", &changes).is_err());
    }

    #[test]
    fn delete_is_guarded_too() {
        let changes = serde_json::json!({ "deletes": [{ "keys": { "id": 3 } }] });
        let (steps, dml) = build_commit_steps(SupportedDB::Sqlite, "t", &changes).unwrap();
        assert_eq!(dml, vec![r#"DELETE FROM "t" WHERE "id" = 3"#]);
        assert!(matches!(steps[0], TxStep::RequireOne { .. }));
    }

    #[test]
    fn filter_values_keep_their_type() {
        let v = serde_json::json!(5);
        assert_eq!(build_filter_clause(SupportedDB::Postgres, "age", "gt", &v).unwrap(), "\"age\" > 5");
        let b = serde_json::json!(true);
        assert_eq!(build_filter_clause(SupportedDB::Mariadb, "ok", "equals", &b).unwrap(), "`ok` = TRUE");
    }

    #[test]
    fn like_filters_escape_user_wildcards() {
        let v = serde_json::json!("50%_x");
        let sql = build_filter_clause(SupportedDB::Postgres, "note", "contains", &v).unwrap();
        assert_eq!(sql, r#""note" LIKE '%50\%\_x%' ESCAPE '\'"#);
    }

    #[test]
    fn like_filters_double_backslashes_on_mariadb() {
        let v = serde_json::json!(r"a\b");
        let sql = build_filter_clause(SupportedDB::Mariadb, "note", "startsWith", &v).unwrap();
        // One backslash escapes the next in a MySQL literal, so both the escape
        // marker and the user's own backslash are doubled.
        assert_eq!(sql, r"`note` LIKE 'a\\\\b%' ESCAPE '\\'");
    }

    #[test]
    fn unknown_operator_is_an_error_not_a_dropped_filter() {
        let v = serde_json::json!("x");
        let err = build_filter_clause(SupportedDB::Postgres, "c", "between", &v).unwrap_err();
        assert!(err.contains("Unsupported filter operator"), "{err}");
        let err = build_filter_clause(SupportedDB::Postgres, "", "equals", &v).unwrap_err();
        assert!(err.contains("no column selected"), "{err}");
    }

    #[test]
    fn null_filter_value_becomes_is_null() {
        let v = serde_json::Value::Null;
        assert_eq!(build_filter_clause(SupportedDB::Sqlite, "c", "equals", &v).unwrap(), "\"c\" IS NULL");
        assert_eq!(build_filter_clause(SupportedDB::Sqlite, "c", "neq", &v).unwrap(), "\"c\" IS NOT NULL");
    }

    #[test]
    fn row_returning_statements_are_classified_correctly() {
        for sql in [
            "SELECT 1",
            "  select * from t",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "-- comment\nSELECT 1",
            "/* hi */ SELECT 1",
            "UPDATE t SET a = 1 RETURNING id",
            "SHOW TABLES",
            "EXPLAIN SELECT 1",
            "PRAGMA table_info(\"t\")",
        ] {
            assert!(statement_returns_rows(sql), "should return rows: {sql}");
        }
        for sql in [
            "UPDATE t SET a = 1",
            "INSERT INTO t VALUES (1)",
            "DELETE FROM t",
            "CREATE TABLE t (id int)",
            "  alter table t add column b int",
            "TRUNCATE TABLE t",
        ] {
            assert!(!statement_returns_rows(sql), "should not return rows: {sql}");
        }
    }
}
