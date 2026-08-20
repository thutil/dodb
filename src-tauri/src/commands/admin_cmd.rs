use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{close_profile_pools, escape_sql_literal, execute_query, get_pool, resolve_profile, DbState};

fn is_valid_host(host: &str) -> bool {
    !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '-' | ':'))
}

#[command]
pub async fn admin_get_users(id: String, database: String, state: State<'_, DbState>) -> Result<Vec<serde_json::Value>, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT usename::text AS username, '' AS host, usesuper AS is_superuser, usecreatedb AS can_create_db FROM pg_user ORDER BY usename",
        SupportedDB::Mariadb => "SELECT user AS username, host, (super_priv = 'Y') AS is_superuser, true AS can_create_db FROM mysql.user ORDER BY user",
        SupportedDB::Sqlite => return Ok(vec![]),
    };
    
    let rows = execute_query(&pool, query)
        .await
        .map_err(|e| format!("Could not list users: {}", e))?;
    let mut users = Vec::new();
    for r in rows {
        if let Some(obj) = r.as_object() {
            let u = obj.get("username").and_then(|v| v.as_str()).unwrap_or("");
            let h = obj.get("host").and_then(|v| v.as_str()).unwrap_or("%");
            let is_super = obj.get("is_superuser").and_then(|v| v.as_bool()).unwrap_or(false);
            let can_create = obj.get("can_create_db").and_then(|v| v.as_bool()).unwrap_or(false);
            if !u.is_empty() {
                users.push(serde_json::json!({
                    "username": u,
                    "host": h,
                    "isSuperuser": is_super,
                    "canCreateDb": can_create
                }));
            }
        }
    }
    Ok(users)
}

#[command]
pub async fn admin_get_processes(id: String, database: String, state: State<'_, DbState>) -> Result<Vec<serde_json::Value>, String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT pid::text AS pid, COALESCE(usename, '')::text AS user, COALESCE(datname, '')::text AS db, COALESCE(state, 'active')::text AS state, COALESCE(query, '<idle>')::text AS query, COALESCE(ROUND(EXTRACT(EPOCH FROM (now() - query_start)))::text, '0') AS time FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY query_start DESC NULLS LAST LIMIT 100",
        SupportedDB::Mariadb => "SELECT id::text AS pid, user, db, command AS state, COALESCE(info, '<idle>') AS query, time::text AS time FROM information_schema.processlist WHERE id <> CONNECTION_ID() ORDER BY time DESC LIMIT 100",
        SupportedDB::Sqlite => return Ok(vec![]),
    };
    
    let rows = execute_query(&pool, query)
        .await
        .map_err(|e| format!("Could not list processes: {}", e))?;
    Ok(rows)
}

#[command]
pub async fn admin_create_database(id: String, database: String, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Database name cannot be empty".to_string());
    }
    
    let query = match profile.r#type {
        SupportedDB::Postgres => format!("CREATE DATABASE \"{}\"", clean_name.replace("\"", "\"\"")),
        SupportedDB::Mariadb => format!("CREATE DATABASE `{}`", clean_name.replace("`", "``")),
        SupportedDB::Sqlite => return Ok(()),
    };
    
    execute_query(&pool, &query).await?;
    // The pool cache is keyed per database name; clear it so a later connect
    // to this name builds a fresh pool instead of reusing a stale entry.
    close_profile_pools(&state, Some(&profile.id)).await?;
    Ok(())
}

#[command]
pub async fn admin_drop_database(id: String, database: String, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let profile = &resolve_profile(&state, &id)?;

    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Database name cannot be empty".to_string());
    }

    let query = match profile.r#type {
        SupportedDB::Postgres => format!("DROP DATABASE \"{}\"", clean_name.replace("\"", "\"\"")),
        SupportedDB::Mariadb => format!("DROP DATABASE `{}`", clean_name.replace("`", "``")),
        SupportedDB::Sqlite => return Ok(()),
    };
    close_profile_pools(&state, Some(&profile.id)).await?;

    let pool = get_pool(&state, profile, Some(&database)).await?;
    execute_query(&pool, &query).await?;
    Ok(())
}

#[command]
pub async fn admin_create_user(id: String, database: String, username: String, password: String, is_superuser: bool, state: State<'_, DbState>) -> Result<(), String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let u = username.trim();
    if u.is_empty() { return Err("Username cannot be empty".to_string()); }
    if password.is_empty() { return Err("Password cannot be empty".to_string()); }
    // Do NOT trim the password: the account would end up with a different
    // password than the one the user typed.
    let p = escape_sql_literal(profile.r#type, &password);

    match profile.r#type {
        SupportedDB::Postgres => {
            let u_esc = u.replace("\"", "\"\"");
            let sql = if is_superuser {
                format!("CREATE USER \"{}\" WITH PASSWORD '{}' SUPERUSER", u_esc, p)
            } else {
                format!("CREATE USER \"{}\" WITH PASSWORD '{}'", u_esc, p)
            };
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Mariadb => {
            let u_esc = u.replace("`", "``");
            let sql = format!("CREATE USER `{}`@'%' IDENTIFIED BY '{}'", u_esc, p);
            execute_query(&pool, &sql).await?;
            if is_superuser {
                let grant_sql = format!("GRANT ALL PRIVILEGES ON *.* TO `{}`@'%' WITH GRANT OPTION", u_esc);
                execute_query(&pool, &grant_sql)
                    .await
                    .map_err(|e| format!("User {} was created but the privilege grant failed: {}", u, e))?;
            }
            Ok(())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}

#[command]
pub async fn admin_drop_user(id: String, database: String, username: String, host: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let u = username.trim();
    if u.is_empty() { return Err("Username cannot be empty".to_string()); }
    
    match profile.r#type {
        SupportedDB::Postgres => {
            let sql = format!("DROP USER \"{}\"", u.replace("\"", "\"\""));
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Mariadb => {
            let h = host.unwrap_or_else(|| "%".to_string());
            if !is_valid_host(&h) {
                return Err(format!("'{}' is not a valid host pattern.", h));
            }
            let sql = format!("DROP USER `{}`@'{}'", u.replace("`", "``"), h);
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}

#[command]
pub async fn admin_kill_process(id: String, database: String, pid: String, state: State<'_, DbState>) -> Result<(), String> {
    let profile = &resolve_profile(&state, &id)?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let pid_num: i64 = pid
        .trim()
        .parse()
        .map_err(|_| format!("'{}' is not a valid process id.", pid))?;

    match profile.r#type {
        SupportedDB::Postgres => {
            let sql = format!("SELECT pg_terminate_backend({})", pid_num);
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Mariadb => {
            let sql = format!("KILL {}", pid_num);
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_patterns_are_validated_not_escaped() {
        assert!(is_valid_host("%"));
        assert!(is_valid_host("localhost"));
        assert!(is_valid_host("10.0.%"));
        assert!(!is_valid_host(""));
        assert!(!is_valid_host("' OR 1=1 --"));
        assert!(!is_valid_host("host'; DROP USER x"));
    }
}
