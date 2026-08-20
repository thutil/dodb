pub mod crypto;
pub mod models;
pub mod db_core;
pub mod profiles;
pub mod commands;

use db_core::DbState;
use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(DbState::default())
    .invoke_handler(tauri::generate_handler![
        // Profile Management
        get_profiles,
        save_profile,
        save_all_profiles,
        delete_profile,
        test_connection,
        // Database & Table Operations
        get_databases,
        get_tables,
        get_columns,
        get_rows,
        execute_command,
        commit_changes,
        get_table_constraints,
        execute_ddl,
        disconnect_database,
        // ER Diagram Discovery
        get_schema_diagram,
        // File Dialog
        select_file,
        // Server Administration
        admin_get_users,
        admin_get_processes,
        admin_create_database,
        admin_drop_database,
        admin_create_user,
        admin_drop_user,
        admin_kill_process
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
