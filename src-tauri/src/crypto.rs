use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hex;
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use sha2::Sha256;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use dirs::home_dir;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const SALT: &[u8] = b"dodb-per-device-salt-v2";
const LEGACY_SALT: &[u8] = b"dodb-salt-salt-v1";
const ITERATIONS: u32 = 100000;
const KEY_LENGTH: usize = 32;

static CACHED_SECRET: OnceLock<String> = OnceLock::new();
static CACHED_CURRENT_KEY: OnceLock<[u8; KEY_LENGTH]> = OnceLock::new();
static CACHED_LEGACY_KEY: OnceLock<[u8; KEY_LENGTH]> = OnceLock::new();

/// Resolves the storage path for the per-device master key
fn get_master_key_path() -> PathBuf {
    if let Ok(dir) = env::var("DODB_DATA_DIR") {
        PathBuf::from(dir).join(".master_key")
    } else {
        home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".dodb").join(".master_key")
    }
}

/// Retrieves or securely generates a unique per-device 256-bit master secret key.
/// Cached in memory via OnceLock for thread-safety, speed, and consistency.
fn get_secret() -> String {
    CACHED_SECRET
        .get_or_init(|| {
            // 1. Check if an environment variable override is set (useful for CI / tests / custom deployments)
            if let Ok(env_key) = env::var("DODB_ENCRYPTION_KEY") {
                if !env_key.trim().is_empty() {
                    return env_key.trim().to_string();
                }
            }
            if let Ok(env_key) = env::var("ENCRYPTION_KEY") {
                if !env_key.trim().is_empty() {
                    return env_key.trim().to_string();
                }
            }

            // 2. Read existing per-device master key file
            let key_path = get_master_key_path();
            if key_path.exists() {
                if let Ok(content) = fs::read_to_string(&key_path) {
                    let trimmed = content.trim();
                    if !trimmed.is_empty() {
                        return trimmed.to_string();
                    }
                }
            }

            // 3. Generate a new high-entropy 256-bit cryptographically secure random key
            let mut raw_bytes = [0u8; 32];
            rand::rng().fill(&mut raw_bytes);
            let new_key_hex = hex::encode(raw_bytes);

            // Ensure parent directory exists (~/.dodb)
            if let Some(parent) = key_path.parent() {
                let _ = fs::create_dir_all(parent);
            }

            // Write key file
            if let Ok(()) = fs::write(&key_path, &new_key_hex) {
                // Set strict file permissions (chmod 600 - Owner Read/Write only) on macOS/Linux
                #[cfg(unix)]
                {
                    if let Ok(metadata) = fs::metadata(&key_path) {
                        let mut perms = metadata.permissions();
                        perms.set_mode(0o600);
                        let _ = fs::set_permissions(&key_path, perms);
                    }
                }
            }

            new_key_hex
        })
        .clone()
}

/// Derives a 32-byte AES-256 key from a secret string and salt using PBKDF2-HMAC-SHA256
fn derive_key(secret: &str, salt: &[u8]) -> [u8; KEY_LENGTH] {
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, ITERATIONS, &mut key);
    key
}

/// Derives the current device's active encryption key (cached in memory)
fn get_current_key() -> [u8; KEY_LENGTH] {
    *CACHED_CURRENT_KEY.get_or_init(|| {
        let secret = get_secret();
        derive_key(&secret, SALT)
    })
}

/// Derives the legacy static key for backward-compatibility auto-migration (cached in memory)
fn get_legacy_key() -> [u8; KEY_LENGTH] {
    *CACHED_LEGACY_KEY.get_or_init(|| {
        derive_key("dodb-mac-secure-master-key-v1", LEGACY_SALT)
    })
}

/// Encrypts plain text password using AES-256-GCM with a unique 12-byte CSPRNG IV
pub fn encrypt_password(plain_text: &str) -> String {
    if plain_text.is_empty() {
        return "".to_string();
    }
    if plain_text.starts_with("enc:") {
        return plain_text.to_string();
    }

    let key = get_current_key();
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(c) => c,
        Err(_) => return plain_text.to_string(),
    };

    let mut iv = [0u8; 12];
    rand::rng().fill(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    match cipher.encrypt(nonce, plain_text.as_bytes()) {
        Ok(encrypted) => {
            // aes-gcm appends the 16-byte auth tag to the end of the ciphertext.
            let auth_tag_len = 16;
            if encrypted.len() < auth_tag_len {
                return plain_text.to_string();
            }
            let ct_len = encrypted.len() - auth_tag_len;
            let cipher_text = &encrypted[..ct_len];
            let auth_tag = &encrypted[ct_len..];

            let iv_hex = hex::encode(iv);
            let auth_tag_hex = hex::encode(auth_tag);
            let cipher_text_hex = hex::encode(cipher_text);

            format!("enc:{}:{}:{}", iv_hex, auth_tag_hex, cipher_text_hex)
        }
        Err(_) => plain_text.to_string(),
    }
}

/// Internal decryption helper with a specific derived AES-256 key
fn try_decrypt_with_key(cipher_text: &str, key: &[u8; KEY_LENGTH]) -> Option<String> {
    let parts: Vec<&str> = cipher_text.split(':').collect();
    if parts.len() != 4 || parts[0] != "enc" {
        return None;
    }

    let iv = hex::decode(parts[1]).ok()?;
    let mut auth_tag = hex::decode(parts[2]).ok()?;
    let mut encrypted_data = hex::decode(parts[3]).ok()?;

    if iv.len() != 12 || auth_tag.len() != 16 {
        return None;
    }

    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(&iv);

    // Recombine ciphertext and auth tag for AES-GCM decryption
    encrypted_data.append(&mut auth_tag);

    match cipher.decrypt(nonce, encrypted_data.as_ref()) {
        Ok(decrypted) => String::from_utf8(decrypted).ok(),
        Err(_) => None,
    }
}

/// Decrypts a password string.
/// Tries the per-device unique key first; if that fails, transparently falls back to
/// legacy static key to allow seamless auto-migration for existing saved connections.
pub fn decrypt_password(cipher_text: &str) -> String {
    if cipher_text.is_empty() {
        return "".to_string();
    }
    if !cipher_text.starts_with("enc:") {
        return cipher_text.to_string();
    }

    // 1. Try decrypting with the secure per-device unique key
    let current_key = get_current_key();
    if let Some(decrypted) = try_decrypt_with_key(cipher_text, &current_key) {
        return decrypted;
    }

    // 2. Fallback: Try decrypting with the legacy static key for backward compatibility
    let legacy_key = get_legacy_key();
    if let Some(decrypted) = try_decrypt_with_key(cipher_text, &legacy_key) {
        return decrypted;
    }

    // If both fail (tampered or invalid), return original string safely
    cipher_text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let password = "MySuperSecretPassword#2026";
        let encrypted = encrypt_password(password);
        assert!(encrypted.starts_with("enc:"));
        assert_ne!(encrypted, password);

        let decrypted = decrypt_password(&encrypted);
        assert_eq!(decrypted, password);
    }

    #[test]
    fn test_empty_and_passthrough() {
        assert_eq!(encrypt_password(""), "");
        assert_eq!(decrypt_password(""), "");
        assert_eq!(decrypt_password("plain_password_not_enc"), "plain_password_not_enc");
    }

    #[test]
    fn test_legacy_key_backward_compatibility() {
        // Encrypt with legacy key manually
        let legacy_key = get_legacy_key();
        let cipher = Aes256Gcm::new_from_slice(&legacy_key).unwrap();
        let mut iv = [0u8; 12];
        rand::rng().fill(&mut iv);
        let nonce = Nonce::from_slice(&iv);
        let plain = "OldLegacyPassword123";
        let encrypted = cipher.encrypt(nonce, plain.as_bytes()).unwrap();

        let auth_tag_len = 16;
        let ct_len = encrypted.len() - auth_tag_len;
        let cipher_text = &encrypted[..ct_len];
        let auth_tag = &encrypted[ct_len..];

        let legacy_enc_str = format!("enc:{}:{}:{}", hex::encode(iv), hex::encode(auth_tag), hex::encode(cipher_text));

        // Decrypt using the new system - should fall back and succeed seamlessly!
        let decrypted = decrypt_password(&legacy_enc_str);
        assert_eq!(decrypted, plain);
    }
}
