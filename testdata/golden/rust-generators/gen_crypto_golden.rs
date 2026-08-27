//! Emits golden ciphertext for the Go port of `crypto.rs` to verify against.
//!
//! Run as `cargo run --example gen_crypto_golden -- <env|store>`.
//!
//! The two modes matter because the master secret reaches the HKDF as different
//! input keying material depending on where it came from:
//!
//!   env   -> PBKDF2-HMAC-SHA256(secret, SALT, 100_000) is the IKM
//!   store -> the secret's own ASCII bytes are the IKM (NOT the decoded hex)
//!
//! v2 ciphertext comes from the real `encrypt_password`, so it is the actual
//! shipping code path. v1 and legacy ciphertext is built here from the same
//! primitives and then handed back to the real `decrypt_password`: if Rust
//! accepts it, the format is right and Go must accept the identical bytes.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use app_lib::crypto::{decrypt_password, encrypt_password};
use hkdf::Hkdf;
use pbkdf2::pbkdf2_hmac;
use sha2::Sha256;
use std::env;

const SALT: &[u8] = b"dodb-per-device-salt-v2";
const LEGACY_SALT: &[u8] = b"dodb-salt-salt-v1";
const HKDF_SALT: &[u8] = b"dodb-hkdf-salt-v3";
const HKDF_INFO: &[u8] = b"dodb-profile-password-v2";
const LEGACY_SECRET: &str = "dodb-mac-secure-master-key-v1";
const ITERATIONS: u32 = 100_000;
const IV_LENGTH: usize = 12;
const TAG_LENGTH: usize = 16;

// Fixed IVs: goldens must be byte-stable across runs, and GCM confidentiality
// is irrelevant for a test vector. Never do this in the app itself.
const IVS: [&str; 3] = [
    "000102030405060708090a0b",
    "0b0a09080706050403020100",
    "ffffffffffffffffffffffff",
];

const PLAINTEXTS: [&str; 6] = [
    "hunter2",
    "",
    "รหัสผ่านภาษาไทย",
    "p@ss:with:colons",
    "a-very-long-password-that-exceeds-one-aes-block-so-the-ciphertext-spans-several",
    "\u{0}\u{1}binary-ish\u{7f}",
];

fn pbkdf2_key(secret: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(secret.as_bytes(), salt, ITERATIONS, &mut key);
    key
}

fn hkdf_key(ikm: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(HKDF_SALT), ikm)
        .expand(HKDF_INFO, &mut key)
        .expect("hkdf expand");
    key
}

/// Seals with the split-tag layout `crypto.rs` uses: the GCM tag is stored as
/// its own hex field, not appended to the ciphertext the way Go's Seal does it.
fn seal(key: &[u8; 32], iv_hex: &str, plain: &str, versioned: bool) -> String {
    let iv = hex::decode(iv_hex).unwrap();
    let cipher = Aes256Gcm::new_from_slice(key).unwrap();
    let sealed = cipher
        .encrypt(Nonce::from_slice(&iv), plain.as_bytes())
        .expect("seal");
    let (body, tag) = sealed.split_at(sealed.len() - TAG_LENGTH);
    assert_eq!(iv.len(), IV_LENGTH);
    if versioned {
        format!("enc:v2:{}:{}:{}", iv_hex, hex::encode(tag), hex::encode(body))
    } else {
        format!("enc:{}:{}:{}", iv_hex, hex::encode(tag), hex::encode(body))
    }
}

fn esc(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

fn main() {
    let mode = env::args().nth(1).unwrap_or_else(|| "env".into());

    let secret = match mode.as_str() {
        "env" => env::var("DODB_ENCRYPTION_KEY").expect("DODB_ENCRYPTION_KEY must be set"),
        "store" => {
            // profiles read the file themselves; mirror what file_secret() returns
            let dir = env::var("DODB_DATA_DIR").expect("DODB_DATA_DIR must be set");
            std::fs::read_to_string(std::path::Path::new(&dir).join(".master_key"))
                .expect("read .master_key")
                .trim()
                .to_string()
        }
        other => panic!("unknown mode {other}"),
    };

    let ikm: Vec<u8> = match mode.as_str() {
        "env" => pbkdf2_key(&secret, SALT).to_vec(),
        _ => secret.as_bytes().to_vec(),
    };
    let v2 = hkdf_key(&ikm);
    let v1 = pbkdf2_key(&secret, SALT);
    let legacy = pbkdf2_key(LEGACY_SECRET, LEGACY_SALT);

    let mut out = Vec::new();

    // v2 through the real shipping encrypt path
    for (i, plain) in PLAINTEXTS.iter().enumerate() {
        let cipher = encrypt_password(plain).expect("encrypt");
        // encrypt_password short-circuits on empty input; keep the record honest
        let produced_ciphertext = cipher.starts_with("enc:");
        let round = decrypt_password(&cipher).expect("decrypt").expect("plaintext");
        assert_eq!(&round, plain, "real encrypt/decrypt round trip failed");
        out.push(format!(
            r#"{{"gen":"v2-live","idx":{i},"plain":{},"cipher":{},"encrypted":{}}}"#,
            esc(plain),
            esc(&cipher),
            produced_ciphertext
        ));
    }

    // deterministic vectors for all three key generations, each verified by the
    // real decrypt before being written out
    for (gen, key, versioned) in [("v2", &v2, true), ("v1", &v1, false), ("legacy", &legacy, false)] {
        for (i, plain) in PLAINTEXTS.iter().enumerate() {
            if plain.is_empty() {
                continue; // encrypt_password never emits a blob for empty input
            }
            let iv_hex = IVS[i % IVS.len()];
            let cipher = seal(key, iv_hex, plain, versioned);
            let round = decrypt_password(&cipher)
                .expect("decrypt call")
                .unwrap_or_else(|| panic!("rust rejected its own {gen} vector: {cipher}"));
            assert_eq!(&round, plain, "{gen} vector did not round trip");
            out.push(format!(
                r#"{{"gen":{},"idx":{i},"plain":{},"cipher":{},"encrypted":true}}"#,
                esc(gen),
                esc(plain),
                esc(&cipher)
            ));
        }
    }

    // a malformed blob: Rust returns Ok(None), and Go must not panic either
    for bad in [
        "enc:v2:zz:zz:zz",
        "enc:v2:000102030405060708090a0b:00000000000000000000000000000000:00",
        "enc:only:three",
        "enc:v9:000102030405060708090a0b:00000000000000000000000000000000:00",
    ] {
        let got = decrypt_password(bad).expect("decrypt call");
        out.push(format!(
            r#"{{"gen":"malformed","plain":null,"cipher":{},"opensTo":{}}}"#,
            esc(bad),
            match got {
                Some(v) => esc(&v),
                None => "null".to_string(),
            }
        ));
    }

    println!("{{");
    println!(r#"  "mode": {},"#, esc(&mode));
    println!(r#"  "secret": {},"#, esc(&secret));
    println!(r#"  "v2KeyHex": {},"#, esc(&hex::encode(v2)));
    println!(r#"  "v1KeyHex": {},"#, esc(&hex::encode(v1)));
    println!(r#"  "legacyKeyHex": {},"#, esc(&hex::encode(legacy)));
    println!(r#"  "cases": ["#);
    for (i, line) in out.iter().enumerate() {
        println!("    {}{}", line, if i + 1 == out.len() { "" } else { "," });
    }
    println!("  ]");
    println!("}}");
}
