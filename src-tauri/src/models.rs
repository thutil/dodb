use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SupportedDB {
    #[default]
    Sqlite,
    Mariadb,
    Postgres,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub r#type: SupportedDB,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub database: String,
    pub file_path: Option<String>,
    pub group: Option<String>,
    /// Keep the pool warm, reconnect when it drops, and connect on app launch.
    #[serde(default)]
    pub keep_alive: bool,
    #[serde(default = "default_true")]
    pub save_password: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

impl Default for ConnectionProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            r#type: SupportedDB::default(),
            host: String::new(),
            port: 0,
            user: String::new(),
            password: String::new(),
            database: String::new(),
            file_path: None,
            group: None,
            keep_alive: false,
            save_password: true,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }
}
