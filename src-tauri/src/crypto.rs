use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use hex;
use pbkdf2::pbkdf2_hmac;
use rand::Rng;
use sha2::Sha256;
use std::env;

#[allow(dead_code)]
const ALGORITHM: &str = "aes-256-gcm";
const SALT: &[u8] = b"dodb-salt-salt-v1";
const ITERATIONS: u32 = 100000;
const KEY_LENGTH: usize = 32;

fn get_secret() -> String {
    env::var("ENCRYPTION_KEY").unwrap_or_else(|_| "dodb-mac-secure-master-key-v1".to_string())
}

fn get_key() -> [u8; KEY_LENGTH] {
    let secret = get_secret();
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), SALT, ITERATIONS, &mut key);
    key
}

pub fn encrypt_password(plain_text: &str) -> String {
    if plain_text.is_empty() {
        return "".to_string();
    }
    if plain_text.starts_with("enc:") {
        return plain_text.to_string();
    }

    let key = get_key();
    let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key length");

    let mut iv = [0u8; 12];
    rand::rng().fill(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    match cipher.encrypt(nonce, plain_text.as_bytes()) {
        Ok(encrypted) => {
            // aes-gcm appends the auth tag to the end of the ciphertext.
            let auth_tag_len = 16;
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

pub fn decrypt_password(cipher_text: &str) -> String {
    if cipher_text.is_empty() {
        return "".to_string();
    }
    if !cipher_text.starts_with("enc:") {
        return cipher_text.to_string();
    }

    let parts: Vec<&str> = cipher_text.split(':').collect();
    if parts.len() != 4 {
        return cipher_text.to_string();
    }

    let iv_hex = parts[1];
    let auth_tag_hex = parts[2];
    let encrypted_hex = parts[3];

    let iv = match hex::decode(iv_hex) {
        Ok(v) => v,
        Err(_) => return cipher_text.to_string(),
    };
    let mut auth_tag = match hex::decode(auth_tag_hex) {
        Ok(v) => v,
        Err(_) => return cipher_text.to_string(),
    };
    let mut encrypted_data = match hex::decode(encrypted_hex) {
        Ok(v) => v,
        Err(_) => return cipher_text.to_string(),
    };

    let key = get_key();
    let cipher = Aes256Gcm::new_from_slice(&key).expect("Invalid key length");
    let nonce = Nonce::from_slice(&iv);

    // Recombine ciphertext and auth tag for decryption
    encrypted_data.append(&mut auth_tag);

    match cipher.decrypt(nonce, encrypted_data.as_ref()) {
        Ok(decrypted) => String::from_utf8(decrypted).unwrap_or_else(|_| cipher_text.to_string()),
        Err(_) => cipher_text.to_string(),
    }
}
