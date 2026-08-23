pub mod crypto;
pub mod models;
pub mod db_core;
pub mod import;
pub mod profiles;
pub mod commands;

use commands::import_cmd::ImportState;
use commands::*;
use db_core::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(DbState::default())
    .manage(ImportState::default())
    .invoke_handler(tauri::generate_handler![
        // Profile Management
        get_profiles,
        save_profile,
        save_all_profiles,
        register_session_profile,
        unregister_session_profile,
        delete_profile,
        test_connection,
        set_runtime_password,
        clear_runtime_password,
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
        ping_database,
        // ER Diagram Discovery
        get_schema_diagram,
        // File Dialog
        select_file,
        // Data Import
        pick_import_file,
        describe_import_file,
        preview_import_file,
        run_import,
        cancel_import,
        // Server Administration
        admin_get_users,
        admin_get_processes,
        admin_create_database,
        admin_drop_database,
        admin_create_user,
        admin_drop_user,
        admin_kill_process
    ])
    .on_window_event(|window, event| {
      #[cfg(target_os = "macos")]
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
      }
    })
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
    .build(tauri::generate_context!())
    .expect("error while running tauri application");

  app.run(|app_handle, event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { .. } = event {
      if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
      }
    }
  });
}
