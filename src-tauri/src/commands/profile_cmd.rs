use tauri::{command, State};
use crate::models::ConnectionProfile;
use crate::db_core::{test_connection_standalone, close_profile_pools, DbState};
use crate::profiles;

#[command]
pub async fn get_profiles() -> Result<Vec<ConnectionProfile>, String> {
    profiles::load_profiles()
}

#[command]
pub async fn save_profile(mut profile: ConnectionProfile, state: State<'_, DbState>) -> Result<ConnectionProfile, String> {
    let mut all_profiles = profiles::load_profiles()?;
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
        all_profiles.push(profile.clone());
    } else {
        let _ = close_profile_pools(&state, Some(&profile.id)).await;
        if let Some(existing) = all_profiles.iter_mut().find(|p| p.id == profile.id) {
            *existing = profile.clone();
        } else {
            all_profiles.push(profile.clone());
        }
    }
    profiles::save_profiles(&mut all_profiles)?;
    Ok(profile)
}

#[command]
pub async fn save_all_profiles(mut profiles: Vec<ConnectionProfile>, state: State<'_, DbState>) -> Result<Vec<ConnectionProfile>, String> {
    for p in &profiles {
        let _ = close_profile_pools(&state, Some(&p.id)).await;
    }
    profiles::save_profiles(&mut profiles)?;
    Ok(profiles)
}

#[command]
pub async fn delete_profile(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let _ = close_profile_pools(&state, Some(&id)).await;
    let mut all_profiles = profiles::load_profiles()?;
    all_profiles.retain(|p| p.id != id);
    profiles::save_profiles(&mut all_profiles)?;
    Ok(())
}

#[command]
pub async fn test_connection(profile: ConnectionProfile) -> Result<bool, String> {
    test_connection_standalone(&profile).await
}

