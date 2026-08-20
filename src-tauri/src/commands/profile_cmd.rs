use tauri::{command, State};
use crate::models::ConnectionProfile;
use crate::db_core::{close_profile_pools, test_connection_standalone, DbState, SESSION_ID_PREFIX};
use crate::profiles;

#[command]
pub async fn get_profiles() -> Result<Vec<ConnectionProfile>, String> {
    profiles::load_profiles()
}

/// Registers a connection the user does not want to save. It gets an id so the
/// data commands can address it exactly like a saved profile, but it is kept in
/// memory only - nothing is written to profiles.json.
#[command]
pub async fn register_session_profile(mut profile: ConnectionProfile, state: State<'_, DbState>) -> Result<ConnectionProfile, String> {
    if profile.id.is_empty() || !profile.id.starts_with(SESSION_ID_PREFIX) {
        profile.id = format!("{}{}", SESSION_ID_PREFIX, uuid::Uuid::new_v4());
    } else {
        // Re-registering the same session id (e.g. the user edited the form and
        // reconnected): drop its pools so the new settings take effect.
        let _ = close_profile_pools(&state, Some(&profile.id)).await;
    }
    let mut sessions = state.session_profiles.lock().map_err(|e| e.to_string())?;
    sessions.insert(profile.id.clone(), profile.clone());
    Ok(profile)
}

/// Forgets an unsaved connection and releases its pooled connections.
#[command]
pub async fn unregister_session_profile(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let _ = close_profile_pools(&state, Some(&id)).await;
    let mut sessions = state.session_profiles.lock().map_err(|e| e.to_string())?;
    sessions.remove(&id);
    Ok(())
}

#[command]
pub async fn save_profile(mut profile: ConnectionProfile, state: State<'_, DbState>) -> Result<ConnectionProfile, String> {
    let mut all_profiles = profiles::load_profiles()?;

    // Saving a session connection promotes it to a real profile: it gets a
    // persistent id, and the in-memory entry (and its pools) are dropped.
    if profile.id.starts_with(SESSION_ID_PREFIX) {
        let session_id = std::mem::take(&mut profile.id);
        let _ = close_profile_pools(&state, Some(&session_id)).await;
        if let Ok(mut sessions) = state.session_profiles.lock() {
            sessions.remove(&session_id);
        }
    }

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

