use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use dirs::home_dir;
use hex;
use hkdf::Hkdf;
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use sha2::Sha256;
use std::env;
use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const SALT: &[u8] = b"dodb-per-device-salt-v2";
const LEGACY_SALT: &[u8] = b"dodb-salt-salt-v1";
const HKDF_SALT: &[u8] = b"dodb-hkdf-salt-v3";
const HKDF_INFO: &[u8] = b"dodb-profile-password-v2";
const ITERATIONS: u32 = 100_000;
const KEY_LENGTH: usize = 32;
const TAG_LENGTH: usize = 16;
const IV_LENGTH: usize = 12;

const KEYCHAIN_SERVICE_NAME: &str = "com.thutil.dodb";
#[cfg(any(target_os = "macos", target_os = "windows"))]
const KEYCHAIN_SERVICE: &str = KEYCHAIN_SERVICE_NAME;
#[cfg(any(target_os = "macos", target_os = "windows"))]
const KEYCHAIN_ACCOUNT: &str = "master-key";

pub const KEY_UNAVAILABLE_MARKER: &str = "KEY_UNAVAILABLE";

#[derive(Debug)]
pub enum CryptoError {
    KeyUnavailable(String),
    Cipher(String),
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CryptoError::KeyUnavailable(m) => write!(f, "{KEY_UNAVAILABLE_MARKER}: {m}"),
            CryptoError::Cipher(m) => write!(f, "CIPHER_FAILED: {m}"),
        }
    }
}

impl std::error::Error for CryptoError {}

impl From<CryptoError> for String {
    fn from(err: CryptoError) -> Self {
        err.to_string()
    }
}

fn unavailable(message: impl fmt::Display) -> CryptoError {
    CryptoError::KeyUnavailable(message.to_string())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Backend {
    Keychain,
    File,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SecretSource {
    Env,
    Store,
}

struct MasterSecret {
    value: String,
    source: SecretSource,
}

static SECRET: OnceLock<MasterSecret> = OnceLock::new();
static V2_KEY: OnceLock<[u8; KEY_LENGTH]> = OnceLock::new();
static V1_KEY: OnceLock<[u8; KEY_LENGTH]> = OnceLock::new();
static LEGACY_KEY: OnceLock<[u8; KEY_LENGTH]> = OnceLock::new();

fn master_key_path() -> PathBuf {
    if let Ok(dir) = env::var("DODB_DATA_DIR") {
        PathBuf::from(dir).join(".master_key")
    } else {
        home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".dodb")
            .join(".master_key")
    }
}

#[cfg(target_os = "windows")]
fn default_backend() -> Backend {
    Backend::Keychain
}

// Not macOS: an app that is not signed with a certificate cannot read the login keychain
// without a consent prompt on *every* launch - "Always Allow" has no stable code identity
// to record for an ad-hoc signature. See docs/MASTER_KEY.md.
#[cfg(not(target_os = "windows"))]
fn default_backend() -> Backend {
    Backend::File
}

fn resolve_backend() -> Backend {
    match env::var("DODB_KEY_BACKEND") {
        Ok(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "file" => Backend::File,
            "keychain" => Backend::Keychain,
            "" => default_backend(),
            other => {
                log::warn!("unknown DODB_KEY_BACKEND '{other}', using the default backend");
                default_backend()
            }
        },
        Err(_) => default_backend(),
    }
}

fn env_secret() -> Option<String> {
    for name in ["DODB_ENCRYPTION_KEY", "ENCRYPTION_KEY"] {
        if let Ok(value) = env::var(name) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn new_secret() -> String {
    let mut raw = [0u8; KEY_LENGTH];
    rand::rng().fill(&mut raw);
    hex::encode(raw)
}

fn read_key_file() -> Option<String> {
    let content = fs::read_to_string(master_key_path()).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn write_key_file(secret: &str) -> Result<(), CryptoError> {
    let path = master_key_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| unavailable(format!("could not create {}: {e}", parent.display())))?;
    }
    fs::write(&path, secret)
        .map_err(|e| unavailable(format!("could not write {}: {e}", path.display())))?;

    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(&path) {
        let mut perms = metadata.permissions();
        perms.set_mode(0o600);
        let _ = fs::set_permissions(&path, perms);
    }

    if read_key_file().as_deref() != Some(secret) {
        return Err(unavailable(format!("{} did not read back as written", path.display())));
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum FileAction {
    Use(String),
    Rescue(String),
    Generate,
}

fn decide_file_action(
    file: Option<String>,
    keychain: Result<Option<String>, String>,
) -> Result<FileAction, CryptoError> {
    if let Some(existing) = file {
        return Ok(FileAction::Use(existing));
    }
    match keychain {
        Ok(Some(stored)) => Ok(FileAction::Rescue(stored)),
        Ok(None) => Ok(FileAction::Generate),
        Err(e) => Err(unavailable(format!(
            "a master key is stored in the keychain but could not be read ({e}); allow access and reopen dodb, or delete the {KEYCHAIN_SERVICE_NAME} item from Keychain Access to start over"
        ))),
    }
}

fn file_secret() -> Result<String, CryptoError> {
    match decide_file_action(read_key_file(), keychain_lookup())? {
        FileAction::Use(existing) => Ok(existing),
        FileAction::Rescue(stored) => {
            write_key_file(&stored)?;
            log::info!("master key moved out of the keychain into {}", master_key_path().display());
            forget_keychain_entry();
            Ok(stored)
        }
        FileAction::Generate => {
            let secret = new_secret();
            write_key_file(&secret)?;
            Ok(secret)
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn keychain_lookup() -> Result<Option<String>, String> {
    use keyring::{Entry, Error as KeyringError};

    let entry = match Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        Ok(entry) => entry,
        Err(KeyringError::NoDefaultStore) => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    match entry.get_password() {
        Ok(stored) if !stored.trim().is_empty() => Ok(Some(stored.trim().to_string())),
        Ok(_) | Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn keychain_lookup() -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "macos")]
fn forget_keychain_entry() {
    let outcome = std::process::Command::new("/usr/bin/security")
        .args([
            "delete-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
        ])
        .output();
    match outcome {
        Ok(out) if out.status.success() => {}
        Ok(out) => log::warn!(
            "the master key is now in a file but the keychain item remains: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ),
        Err(e) => log::warn!("could not run security(1) to drop the keychain item: {e}"),
    }
}

#[cfg(target_os = "windows")]
fn forget_keychain_entry() {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
        if let Err(e) = entry.delete_credential() {
            log::warn!("the master key is now in a file but the credential remains: {e}");
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn forget_keychain_entry() {}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn keychain_secret() -> Result<String, CryptoError> {
    use keyring::{Entry, Error as KeyringError};

    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(unavailable)?;
    match entry.get_password() {
        Ok(stored) if !stored.trim().is_empty() => Ok(stored.trim().to_string()),
        Ok(_) | Err(KeyringError::NoEntry) => adopt_or_generate(&entry),
        Err(e) => Err(unavailable(e)),
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn adopt_or_generate(entry: &keyring::Entry) -> Result<String, CryptoError> {
    let path = master_key_path();
    let from_file = read_key_file();
    let secret = from_file.clone().unwrap_or_else(new_secret);

    entry.set_password(&secret).map_err(unavailable)?;

    let verified = match entry.get_password() {
        Ok(read_back) => read_back.trim() == secret,
        Err(e) => {
            return match from_file {
                Some(existing) => {
                    log::warn!("keychain write could not be read back ({e}); keeping {}", path.display());
                    Ok(existing)
                }
                None => Err(unavailable(e)),
            }
        }
    };

    match (verified, from_file) {
        (true, Some(_)) => {
            match fs::remove_file(&path) {
                Ok(()) => log::info!("master key moved into the OS keychain, removed {}", path.display()),
                Err(e) => log::warn!("master key is in the keychain but {} remains: {e}", path.display()),
            }
            Ok(secret)
        }
        (true, None) => Ok(secret),
        (false, Some(existing)) => {
            log::warn!("keychain returned a different master key; keeping {}", path.display());
            Ok(existing)
        }
        (false, None) => Err(unavailable("the keychain returned a different master key than the one just written")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn keychain_secret() -> Result<String, CryptoError> {
    Err(unavailable(
        "this build has no OS keychain support; unset DODB_KEY_BACKEND to use the key file",
    ))
}

fn load_secret() -> Result<MasterSecret, CryptoError> {
    if let Some(value) = env_secret() {
        return Ok(MasterSecret { value, source: SecretSource::Env });
    }
    let value = match resolve_backend() {
        Backend::Keychain => keychain_secret()?,
        Backend::File => file_secret()?,
    };
    Ok(MasterSecret { value, source: SecretSource::Store })
}

fn secret() -> Result<&'static MasterSecret, CryptoError> {
    if let Some(cached) = SECRET.get() {
        return Ok(cached);
    }
    let loaded = load_secret()?;
    Ok(SECRET.get_or_init(|| loaded))
}

fn pbkdf2_key(secret: &str, salt: &[u8]) -> [u8; KEY_LENGTH] {
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, ITERATIONS, &mut key);
    key
}

fn v2_key() -> Result<[u8; KEY_LENGTH], CryptoError> {
    if let Some(cached) = V2_KEY.get() {
        return Ok(*cached);
    }
    let secret = secret()?;

    let ikm = match secret.source {
        SecretSource::Env => pbkdf2_key(&secret.value, SALT).to_vec(),
        SecretSource::Store => secret.value.as_bytes().to_vec(),
    };

    let mut key = [0u8; KEY_LENGTH];
    Hkdf::<Sha256>::new(Some(HKDF_SALT), &ikm)
        .expand(HKDF_INFO, &mut key)
        .map_err(|e| CryptoError::Cipher(format!("HKDF expand failed: {e}")))?;
    Ok(*V2_KEY.get_or_init(|| key))
}

fn v1_key() -> Result<[u8; KEY_LENGTH], CryptoError> {
    if let Some(cached) = V1_KEY.get() {
        return Ok(*cached);
    }
    let key = pbkdf2_key(&secret()?.value, SALT);
    Ok(*V1_KEY.get_or_init(|| key))
}

fn legacy_key() -> [u8; KEY_LENGTH] {
    *LEGACY_KEY.get_or_init(|| pbkdf2_key("dodb-mac-secure-master-key-v1", LEGACY_SALT))
}

pub fn init() -> Result<(), CryptoError> {
    v2_key().map(|_| ())
}

pub fn encrypt_password(plain_text: &str) -> Result<String, CryptoError> {
    if plain_text.is_empty() || plain_text.starts_with("enc:") {
        return Ok(plain_text.to_string());
    }

    let key = v2_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| CryptoError::Cipher(format!("invalid AES key: {e}")))?;

    let mut iv = [0u8; IV_LENGTH];
    rand::rng().fill(&mut iv);

    let sealed = cipher
        .encrypt(Nonce::from_slice(&iv), plain_text.as_bytes())
        .map_err(|e| CryptoError::Cipher(format!("AES-GCM encryption failed: {e}")))?;
    if sealed.len() < TAG_LENGTH {
        return Err(CryptoError::Cipher("AES-GCM output is missing its auth tag".into()));
    }

    let (cipher_text, auth_tag) = sealed.split_at(sealed.len() - TAG_LENGTH);
    Ok(format!(
        "enc:v2:{}:{}:{}",
        hex::encode(iv),
        hex::encode(auth_tag),
        hex::encode(cipher_text)
    ))
}

pub fn decrypt_password(cipher_text: &str) -> Result<Option<String>, CryptoError> {
    if cipher_text.is_empty() || !cipher_text.starts_with("enc:") {
        return Ok(Some(cipher_text.to_string()));
    }

    let parts: Vec<&str> = cipher_text.split(':').collect();
    match parts.as_slice() {
        ["enc", "v2", iv, tag, body] => Ok(open(iv, tag, body, &v2_key()?)),
        ["enc", iv, tag, body] => {
            if let Some(plain) = open(iv, tag, body, &v1_key()?) {
                return Ok(Some(plain));
            }
            Ok(open(iv, tag, body, &legacy_key()))
        }
        _ => Ok(None),
    }
}

fn open(iv_hex: &str, tag_hex: &str, body_hex: &str, key: &[u8; KEY_LENGTH]) -> Option<String> {
    let iv = hex::decode(iv_hex).ok()?;
    let tag = hex::decode(tag_hex).ok()?;
    let mut blob = hex::decode(body_hex).ok()?;
    if iv.len() != IV_LENGTH || tag.len() != TAG_LENGTH {
        return None;
    }
    blob.extend_from_slice(&tag);

    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let plain = cipher.decrypt(Nonce::from_slice(&iv), blob.as_ref()).ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
const TEST_SECRET: &str = "9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0";

/// keychain (CI runs `cargo test` on a macOS runner).
#[cfg(test)]
pub(crate) fn seed_test_secret() {
    let _ = SECRET.set(MasterSecret {
        value: TEST_SECRET.to_string(),
        source: SecretSource::Store,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seal_with(key: &[u8; KEY_LENGTH], plain: &str, versioned: bool) -> String {
        let cipher = Aes256Gcm::new_from_slice(key).unwrap();
        let mut iv = [0u8; IV_LENGTH];
        rand::rng().fill(&mut iv);
        let sealed = cipher.encrypt(Nonce::from_slice(&iv), plain.as_bytes()).unwrap();
        let (body, tag) = sealed.split_at(sealed.len() - TAG_LENGTH);
        let tail = format!("{}:{}:{}", hex::encode(iv), hex::encode(tag), hex::encode(body));
        if versioned {
            format!("enc:v2:{tail}")
        } else {
            format!("enc:{tail}")
        }
    }

    #[test]
    fn roundtrip_writes_the_versioned_format() {
        seed_test_secret();
        let encrypted = encrypt_password("MySuperSecretPassword#2026").unwrap();
        assert!(encrypted.starts_with("enc:v2:"), "{encrypted}");
        assert_eq!(encrypted.split(':').count(), 5, "{encrypted}");
        assert_eq!(
            decrypt_password(&encrypted).unwrap().as_deref(),
            Some("MySuperSecretPassword#2026")
        );
    }

    #[test]
    fn empty_and_plaintext_pass_through() {
        seed_test_secret();
        assert_eq!(encrypt_password("").unwrap(), "");
        assert_eq!(decrypt_password("").unwrap().as_deref(), Some(""));
        assert_eq!(
            decrypt_password("plain_password_not_enc").unwrap().as_deref(),
            Some("plain_password_not_enc")
        );
    }

    #[test]
    fn pre_v2_blobs_still_decrypt() {
        seed_test_secret();
        let blob = seal_with(&v1_key().unwrap(), "OldDevicePassword123", false);
        assert_eq!(decrypt_password(&blob).unwrap().as_deref(), Some("OldDevicePassword123"));
    }

    #[test]
    fn legacy_static_key_blobs_still_decrypt() {
        seed_test_secret();
        let blob = seal_with(&legacy_key(), "OldLegacyPassword123", false);
        assert_eq!(decrypt_password(&blob).unwrap().as_deref(), Some("OldLegacyPassword123"));
    }

    #[test]
    fn a_tampered_blob_reports_failure_instead_of_echoing_itself() {
        seed_test_secret();
        let mut blob = encrypt_password("secret").unwrap();
        let last = blob.pop().unwrap();
        blob.push(if last == 'a' { 'b' } else { 'a' });
        assert_eq!(decrypt_password(&blob).unwrap(), None);
        assert_eq!(decrypt_password("enc:v2:zz:zz:zz").unwrap(), None);
        assert_eq!(decrypt_password("enc:only:three").unwrap(), None);
    }

    #[test]
    fn backend_override_is_honoured() {
        // Env vars are process-wide; this test owns DODB_KEY_BACKEND and restores it.
        let previous = env::var("DODB_KEY_BACKEND").ok();
        env::set_var("DODB_KEY_BACKEND", "file");
        assert_eq!(resolve_backend(), Backend::File);
        env::set_var("DODB_KEY_BACKEND", "KeyChain");
        assert_eq!(resolve_backend(), Backend::Keychain);
        env::set_var("DODB_KEY_BACKEND", "nonsense");
        assert_eq!(resolve_backend(), default_backend());
        match previous {
            Some(value) => env::set_var("DODB_KEY_BACKEND", value),
            None => env::remove_var("DODB_KEY_BACKEND"),
        }
    }

    #[test]
    fn the_keychain_is_the_default_only_where_apps_can_read_it_without_prompting() {
        #[cfg(target_os = "windows")]
        assert_eq!(default_backend(), Backend::Keychain);
        #[cfg(not(target_os = "windows"))]
        assert_eq!(default_backend(), Backend::File);
    }

    #[test]
    fn an_existing_key_file_wins() {
        let file = Some("aa".to_string());
        assert_eq!(
            decide_file_action(file.clone(), Ok(None)).unwrap(),
            FileAction::Use("aa".to_string())
        );
        assert_eq!(
            decide_file_action(file, Ok(Some("bb".to_string()))).unwrap(),
            FileAction::Use("aa".to_string())
        );
    }

    #[test]
    fn a_key_left_in_the_keychain_is_rescued_not_replaced() {
        assert_eq!(
            decide_file_action(None, Ok(Some("bb".to_string()))).unwrap(),
            FileAction::Rescue("bb".to_string())
        );
    }

    #[test]
    fn nothing_stored_anywhere_mints_a_new_key() {
        assert_eq!(decide_file_action(None, Ok(None)).unwrap(), FileAction::Generate);
    }

    #[test]
    fn an_unreadable_keychain_key_is_an_error_not_a_fresh_start() {
        let err = decide_file_action(None, Err("User denied access".to_string())).unwrap_err();
        assert!(matches!(err, CryptoError::KeyUnavailable(_)));
        assert!(err.to_string().contains(KEYCHAIN_SERVICE_NAME), "{err}");
    }
}
