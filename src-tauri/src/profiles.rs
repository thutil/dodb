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

    // Encrypt passwords before saving
    let mut encrypted_profiles = profiles.clone();
    for p in encrypted_profiles.iter_mut() {
        if !p.password.is_empty() {
            p.password = encrypt_password(&p.password);
        }
    }

    let raw = serde_json::to_string_pretty(&encrypted_profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    
    let path = get_profile_path();
    fs::write(path, raw).map_err(|e| format!("Failed to write profiles: {}", e))?;

    Ok(())
}
