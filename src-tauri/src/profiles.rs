use crate::crypto::{decrypt_password, encrypt_password};
use crate::models::ConnectionProfile;
use dirs::home_dir;
use std::fs;
use std::path::PathBuf;

fn get_data_directory() -> PathBuf {
    if let Ok(dir) = std::env::var("DODB_DATA_DIR") {
        PathBuf::from(dir)
    } else {
        home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".dodb")
    }
}

fn get_profile_path() -> PathBuf {
    get_data_directory().join("profiles.json")
}

pub fn load_profiles() -> Result<Vec<ConnectionProfile>, String> {
    let path = get_profile_path();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path).map_err(|e| format!("Failed to read profiles: {}", e))?;
    let mut profiles: Vec<ConnectionProfile> = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse profiles: {}", e))?;

    // Decrypt passwords
    for p in profiles.iter_mut() {
        if !p.password.is_empty() {
            p.password = decrypt_password(&p.password);
        }
    }

    Ok(profiles)
}

pub fn save_profiles(profiles: &mut Vec<ConnectionProfile>) -> Result<(), String> {
    let dir = get_data_directory();
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    }

    let encrypted_profiles = prepare_for_disk(profiles);

    let raw = serde_json::to_string_pretty(&encrypted_profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    
    let path = get_profile_path();
    fs::write(path, raw).map_err(|e| format!("Failed to write profiles: {}", e))?;

    Ok(())
}


fn prepare_for_disk(profiles: &[ConnectionProfile]) -> Vec<ConnectionProfile> {
    let mut out = profiles.to_vec();
    for p in out.iter_mut() {
        if !p.save_password {
            p.password.clear();
        } else if !p.password.is_empty() {
            p.password = encrypt_password(&p.password);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SupportedDB;

    fn profile(save_password: bool) -> ConnectionProfile {
        ConnectionProfile {
            id: "p1".to_string(),
            name: "test".to_string(),
            r#type: SupportedDB::Postgres,
            host: "localhost".to_string(),
            port: 5432,
            user: "postgres".to_string(),
            password: "s3cret".to_string(),
            database: "postgres".to_string(),
            save_password,
            ..Default::default()
        }
    }

    #[test]
    fn opting_out_keeps_the_password_off_disk() {
        let on_disk = prepare_for_disk(&[profile(false)]);
        assert_eq!(on_disk[0].password, "");
        let raw = serde_json::to_string(&on_disk).unwrap();
        assert!(!raw.contains("s3cret"), "{raw}");
    }

    #[test]
    fn opting_in_stores_the_password_encrypted() {
        let on_disk = prepare_for_disk(&[profile(true)]);
        assert!(on_disk[0].password.starts_with("enc:"), "{}", on_disk[0].password);
        assert_eq!(decrypt_password(&on_disk[0].password), "s3cret");
    }

    #[test]
    fn legacy_profile_json_defaults_to_saving() {
        let raw = r#"[{"id":"old","name":"Old","type":"postgres","host":"h","port":5432,"user":"u","password":"pw","database":"d"}]"#;
        let parsed: Vec<ConnectionProfile> = serde_json::from_str(raw).unwrap();
        assert!(parsed[0].save_password);
        assert!(!parsed[0].keep_alive);
        assert!(prepare_for_disk(&parsed)[0].password.starts_with("enc:"));
    }
}
