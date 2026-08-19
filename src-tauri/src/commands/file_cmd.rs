use tauri::command;

#[command]
pub async fn select_file() -> Result<Option<String>, String> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("SQLite Database", &["db", "sqlite", "sqlite3", "sql"])
        .add_filter("All Files", &["*"])
        .set_title("Select SQLite Database File")
        .pick_file()
        .await;

    Ok(file.map(|f| f.path().to_string_lossy().to_string()))
}
