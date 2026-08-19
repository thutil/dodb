use tauri::{command, State};
use crate::models::SupportedDB;
use crate::db_core::{get_pool, execute_query, DbState};
use crate::profiles;

#[command]
pub async fn admin_get_users(id: String, database: String, state: State<'_, DbState>) -> Result<Vec<serde_json::Value>, String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT usename::text AS username, '' AS host, usesuper AS is_superuser, usecreatedb AS can_create_db FROM pg_user ORDER BY usename",
        SupportedDB::Mariadb => "SELECT user AS username, host, (super_priv = 'Y') AS is_superuser, true AS can_create_db FROM mysql.user ORDER BY user",
        SupportedDB::Sqlite => return Ok(vec![]),
    };
    
    let rows = execute_query(&pool, query).await.unwrap_or_default();
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
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let query = match profile.r#type {
        SupportedDB::Postgres => "SELECT pid::text AS pid, COALESCE(usename, '')::text AS user, COALESCE(datname, '')::text AS db, COALESCE(state, 'active')::text AS state, COALESCE(query, '<idle>')::text AS query, COALESCE(ROUND(EXTRACT(EPOCH FROM (now() - query_start)))::text, '0') AS time FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY query_start DESC NULLS LAST LIMIT 100",
        SupportedDB::Mariadb => "SELECT id::text AS pid, user, db, command AS state, COALESCE(info, '<idle>') AS query, time::text AS time FROM information_schema.processlist WHERE id <> CONNECTION_ID() ORDER BY time DESC LIMIT 100",
        SupportedDB::Sqlite => return Ok(vec![]),
    };
    
    let rows = execute_query(&pool, query).await.unwrap_or_default();
    Ok(rows)
}

#[command]
pub async fn admin_create_database(id: String, database: String, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
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
    
    execute_query(&pool, &query).await.map(|_| ())
}

#[command]
pub async fn admin_drop_database(id: String, database: String, name: String, state: State<'_, DbState>) -> Result<(), String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let clean_name = name.trim();
    if clean_name.is_empty() {
        return Err("Database name cannot be empty".to_string());
    }
    
    let query = match profile.r#type {
        SupportedDB::Postgres => format!("DROP DATABASE \"{}\"", clean_name.replace("\"", "\"\"")),
        SupportedDB::Mariadb => format!("DROP DATABASE `{}`", clean_name.replace("`", "``")),
        SupportedDB::Sqlite => return Ok(()),
    };
    
    execute_query(&pool, &query).await.map(|_| ())
}

#[command]
pub async fn admin_create_user(id: String, database: String, username: String, password: String, is_superuser: bool, state: State<'_, DbState>) -> Result<(), String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    let u = username.trim();
    let p = password.trim().replace("'", "''");
    if u.is_empty() { return Err("Username cannot be empty".to_string()); }
    
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
                let _ = execute_query(&pool, &grant_sql).await;
            }
            Ok(())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}

#[command]
pub async fn admin_drop_user(id: String, database: String, username: String, host: Option<String>, state: State<'_, DbState>) -> Result<(), String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
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
            let sql = format!("DROP USER `{}`@'{}'", u.replace("`", "``"), h.replace("'", "''"));
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}

#[command]
pub async fn admin_kill_process(id: String, database: String, pid: String, state: State<'_, DbState>) -> Result<(), String> {
    let profiles = profiles::load_profiles()?;
    let profile = profiles.iter().find(|p| p.id == id).ok_or("Profile not found")?;
    let pool = get_pool(&state, profile, Some(&database)).await?;
    
    match profile.r#type {
        SupportedDB::Postgres => {
            let sql = format!("SELECT pg_terminate_backend({})", pid);
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Mariadb => {
            let sql = format!("KILL {}", pid);
            execute_query(&pool, &sql).await.map(|_| ())
        }
        SupportedDB::Sqlite => Ok(()),
    }
}
