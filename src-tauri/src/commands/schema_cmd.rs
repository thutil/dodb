use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{escape_sql_literal, execute_command_raw, execute_query, get_pool, resolve_profile, DbState};

// ==========================================
// Local dialect helpers
//
// Kept local rather than shared with database_cmd.rs so this module stays
// self-contained; the metadata queries below need the schema/table split that
// Postgres schema-qualified names ("reporting.events") introduce.
// ==========================================

/// Split a possibly schema-qualified name into (schema, table).
fn split_schema_table(table: &str) -> (String, String) {
    match table.find('.') {
        Some(i) if i > 0 => (table[..i].to_string(), table[i + 1..].to_string()),
        _ => ("public".to_string(), table.to_string()),
    }
}

fn sql_str_for(db_type: SupportedDB, v: &str) -> String {
    escape_sql_literal(db_type, v)
}

fn as_flag(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> bool {
    match obj.get(key) {
        Some(v) => v
            .as_bool()
            .or_else(|| v.as_i64().map(|n| n != 0))
            .or_else(|| match v.as_str() {
                Some("1") | Some("true") | Some("TRUE") | Some("YES") => Some(true),
                Some("0") | Some("false") | Some("FALSE") | Some("NO") => Some(false),
                _ => None,
            })
            .unwrap_or(false),
        None => false,
    }
}

fn as_text(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> String {
    obj.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Map a Postgres pg_constraint action code to its SQL spelling.
fn pg_action(code: &str) -> &'static str {
    match code {
        "r" => "RESTRICT",
        "c" => "CASCADE",
        "n" => "SET NULL",
        "d" => "SET DEFAULT",
        _ => "NO ACTION",
    }
}

/// Normalize a MariaDB referential rule to the same vocabulary.
fn my_action(rule: &str) -> &'static str {
    match rule.to_uppercase().as_str() {
        "RESTRICT" => "RESTRICT",
        "CASCADE" => "CASCADE",
        "SET NULL" => "SET NULL",
        "SET DEFAULT" => "SET DEFAULT",
        _ => "NO ACTION",
    }
}

// ==========================================
// Accumulators
//
// Both indexes and foreign keys come back one row per column, so they are
// grouped by name while preserving first-seen order.
// ==========================================

struct IndexAcc {
    name: String,
    unique: bool,
    primary: bool,
    columns: Vec<(i64, String)>,
}

struct FkAcc {
    name: String,
    ref_table: String,
    on_delete: String,
    on_update: String,
    columns: Vec<(i64, String)>,
    ref_columns: Vec<(i64, String)>,
}

fn seq_of(obj: &serde_json::Map<String, serde_json::Value>, key: &str) -> i64 {
    obj.get(key)
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .unwrap_or(0)
}

fn finish_indexes(accs: Vec<IndexAcc>) -> (Vec<serde_json::Value>, Option<String>) {
    let mut primary_key_name = None;
    let mut out = Vec::new();

    for mut acc in accs {
        acc.columns.sort_by_key(|(seq, _)| *seq);
        let cols: Vec<serde_json::Value> = acc
            .columns
            .into_iter()
            .map(|(_, c)| serde_json::Value::String(c))
            .collect();

        if acc.primary {
            // The PK is edited through the columns tab, not the index tab, but
            // Postgres needs its constraint name to drop it.
            primary_key_name = Some(acc.name);
            continue;
        }

        out.push(serde_json::json!({
            "name": acc.name,
            "unique": acc.unique,
            "columns": cols,
        }));
    }

    (out, primary_key_name)
}

fn finish_fks(accs: Vec<FkAcc>) -> Vec<serde_json::Value> {
    accs.into_iter()
        .map(|mut acc| {
            acc.columns.sort_by_key(|(seq, _)| *seq);
            acc.ref_columns.sort_by_key(|(seq, _)| *seq);
            serde_json::json!({
                "name": acc.name,
                "columns": acc.columns.into_iter().map(|(_, c)| c).collect::<Vec<String>>(),
                "refTable": acc.ref_table,
                "refColumns": acc.ref_columns.into_iter().map(|(_, c)| c).collect::<Vec<String>>(),
                "onDelete": acc.on_delete,
                "onUpdate": acc.on_update,
            })
        })
        .collect()
}

// ==========================================
// get_table_constraints
// ==========================================

/// Indexes and foreign keys for a single table, normalized to one shape across
/// dialects (the same approach `get_columns` takes for columns).
#[command]
pub async fn get_table_constraints(
    id: String,
    database: String,
    table: String,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;

    let (schema, tbl) = split_schema_table(&table);

    let mut index_accs: Vec<IndexAcc> = Vec::new();
    let mut fk_accs: Vec<FkAcc> = Vec::new();

    match &profile.r#type {
        SupportedDB::Sqlite => {
            // Structure editing is disabled for SQLite; nothing to report.
            return Ok(serde_json::json!({
                "indexes": Vec::<serde_json::Value>::new(),
                "foreignKeys": Vec::<serde_json::Value>::new(),
                "primaryKeyName": serde_json::Value::Null,
            }));
        }

        SupportedDB::Postgres => {
            let idx_query = format!(
                "
                SELECT
                    i.relname::text AS index_name,
                    ix.indisunique AS is_unique,
                    ix.indisprimary AS is_primary,
                    pg_get_indexdef(ix.indexrelid, s.n::int, true) AS column_name,
                    s.n::int AS seq
                FROM pg_index ix
                JOIN pg_class i ON i.oid = ix.indexrelid
                JOIN pg_class t ON t.oid = ix.indrelid
                JOIN pg_namespace ns ON ns.oid = t.relnamespace
                CROSS JOIN generate_series(1, ix.indnkeyatts) AS s(n)
                WHERE t.relname = '{0}' AND ns.nspname = '{1}'
                ORDER BY i.relname, s.n
                ",
                sql_str_for(profile.r#type, &tbl),
                sql_str_for(profile.r#type, &schema)
            );

            for row in execute_query(&pool, &idx_query).await.map_err(|e| format!("Could not read the indexes of this table: {}", e))? {
                if let Some(obj) = row.as_object() {
                    let name = as_text(obj, "index_name");
                    let col = as_text(obj, "column_name");
                    if name.is_empty() || col.is_empty() {
                        continue;
                    }
                    let seq = seq_of(obj, "seq");
                    match index_accs.iter_mut().find(|a| a.name == name) {
                        Some(acc) => acc.columns.push((seq, col)),
                        None => index_accs.push(IndexAcc {
                            name,
                            unique: as_flag(obj, "is_unique"),
                            primary: as_flag(obj, "is_primary"),
                            columns: vec![(seq, col)],
                        }),
                    }
                }
            }

            let fk_query = format!(
                "
                SELECT
                    con.conname::text AS fk_name,
                    att.attname::text AS column_name,
                    CASE WHEN rn.nspname = 'public'
                         THEN rt.relname::text
                         ELSE (rn.nspname || '.' || rt.relname)::text
                    END AS ref_table,
                    ratt.attname::text AS ref_column,
                    con.confdeltype::text AS on_delete,
                    con.confupdtype::text AS on_update,
                    k.ord::int AS seq
                FROM pg_constraint con
                JOIN pg_class t ON t.oid = con.conrelid
                JOIN pg_namespace ns ON ns.oid = t.relnamespace
                JOIN pg_class rt ON rt.oid = con.confrelid
                JOIN pg_namespace rn ON rn.oid = rt.relnamespace
                CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
                CROSS JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS rk(attnum, ord)
                JOIN pg_attribute ratt ON ratt.attrelid = con.confrelid AND ratt.attnum = rk.attnum
                WHERE con.contype = 'f'
                  AND t.relname = '{0}'
                  AND ns.nspname = '{1}'
                  AND rk.ord = k.ord
                ORDER BY con.conname, k.ord
                ",
                sql_str_for(profile.r#type, &tbl),
                sql_str_for(profile.r#type, &schema)
            );

            for row in execute_query(&pool, &fk_query).await.map_err(|e| format!("Could not read the foreign keys of this table: {}", e))? {
                if let Some(obj) = row.as_object() {
                    let name = as_text(obj, "fk_name");
                    if name.is_empty() {
                        continue;
                    }
                    let seq = seq_of(obj, "seq");
                    let col = as_text(obj, "column_name");
                    let ref_col = as_text(obj, "ref_column");
                    match fk_accs.iter_mut().find(|a| a.name == name) {
                        Some(acc) => {
                            acc.columns.push((seq, col));
                            acc.ref_columns.push((seq, ref_col));
                        }
                        None => fk_accs.push(FkAcc {
                            name,
                            ref_table: as_text(obj, "ref_table"),
                            on_delete: pg_action(&as_text(obj, "on_delete")).to_string(),
                            on_update: pg_action(&as_text(obj, "on_update")).to_string(),
                            columns: vec![(seq, col)],
                            ref_columns: vec![(seq, ref_col)],
                        }),
                    }
                }
            }
        }

        SupportedDB::Mariadb => {
            let idx_query = format!("SHOW INDEX FROM `{}`", tbl.replace('`', ""));

            for row in execute_query(&pool, &idx_query).await.map_err(|e| format!("Could not read the indexes of this table: {}", e))? {
                if let Some(obj) = row.as_object() {
                    let name = as_text(obj, "Key_name");
                    let col = as_text(obj, "Column_name");
                    if name.is_empty() || col.is_empty() {
                        continue;
                    }
                    let seq = seq_of(obj, "Seq_in_index");
                    // SHOW INDEX reports uniqueness inverted.
                    let unique = !as_flag(obj, "Non_unique");
                    let primary = name == "PRIMARY";
                    match index_accs.iter_mut().find(|a| a.name == name) {
                        Some(acc) => acc.columns.push((seq, col)),
                        None => index_accs.push(IndexAcc {
                            name,
                            unique,
                            primary,
                            columns: vec![(seq, col)],
                        }),
                    }
                }
            }

            let fk_query = format!(
                "
                SELECT
                    k.CONSTRAINT_NAME AS fk_name,
                    k.COLUMN_NAME AS column_name,
                    k.REFERENCED_TABLE_NAME AS ref_table,
                    k.REFERENCED_COLUMN_NAME AS ref_column,
                    r.DELETE_RULE AS on_delete,
                    r.UPDATE_RULE AS on_update,
                    k.ORDINAL_POSITION AS seq
                FROM information_schema.KEY_COLUMN_USAGE k
                JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                  ON r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
                 AND r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                WHERE k.TABLE_SCHEMA = DATABASE()
                  AND k.TABLE_NAME = '{0}'
                  AND k.REFERENCED_TABLE_NAME IS NOT NULL
                ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
                ",
                sql_str_for(profile.r#type, &tbl)
            );

            for row in execute_query(&pool, &fk_query).await.map_err(|e| format!("Could not read the foreign keys of this table: {}", e))? {
                if let Some(obj) = row.as_object() {
                    let name = as_text(obj, "fk_name");
                    if name.is_empty() {
                        continue;
                    }
                    let seq = seq_of(obj, "seq");
                    let col = as_text(obj, "column_name");
                    let ref_col = as_text(obj, "ref_column");
                    match fk_accs.iter_mut().find(|a| a.name == name) {
                        Some(acc) => {
                            acc.columns.push((seq, col));
                            acc.ref_columns.push((seq, ref_col));
                        }
                        None => fk_accs.push(FkAcc {
                            name,
                            ref_table: as_text(obj, "ref_table"),
                            on_delete: my_action(&as_text(obj, "on_delete")).to_string(),
                            on_update: my_action(&as_text(obj, "on_update")).to_string(),
                            columns: vec![(seq, col)],
                            ref_columns: vec![(seq, ref_col)],
                        }),
                    }
                }
            }
        }
    }

    let (indexes, primary_key_name) = finish_indexes(index_accs);
    let foreign_keys = finish_fks(fk_accs);

    Ok(serde_json::json!({
        "indexes": indexes,
        "foreignKeys": foreign_keys,
        "primaryKeyName": primary_key_name,
    }))
}

// ==========================================
// execute_ddl
// ==========================================

/// Run DDL statements in order.
///
/// Unlike `execute_command`, this goes straight to `execute_command_raw`: that
/// command tries `fetch_all` first and falls back to a raw execute on error,
/// which would re-run a statement that ran and *then* failed.
///
/// Deliberately not wrapped in a transaction. MariaDB issues an implicit commit
/// per DDL statement, so a transaction would imply an atomicity it cannot
/// deliver. Partial application is reported honestly instead: on failure the
/// caller learns how many statements landed and which one broke.
#[command]
pub async fn execute_ddl(
    id: String,
    database: String,
    statements: Vec<String>,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;

    let runnable: Vec<String> = statements
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if runnable.is_empty() {
        return Err("No statements to execute".to_string());
    }

    let mut executed = 0usize;

    for (i, stmt) in runnable.iter().enumerate() {
        match execute_command_raw(&pool, stmt).await {
            Ok(_) => executed += 1,
            Err(e) => {
                return Ok(serde_json::json!({
                    "success": false,
                    "executed": executed,
                    "total": runnable.len(),
                    "failedIndex": i,
                    "failedStatement": stmt,
                    "error": e,
                }));
            }
        }
    }

    Ok(serde_json::json!({
        "success": true,
        "executed": executed,
        "total": runnable.len(),
    }))
}
