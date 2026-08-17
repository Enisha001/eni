// @group Crypto : AES-256-GCM field-level encryption for sensitive MongoDB fields
// Key is derived from a machine-specific seed and stored in-process.
// Format: base64(nonce[12] || ciphertext)

use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, AeadCore, KeyInit, OsRng}};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use anyhow::{anyhow, Result};
use sha2::{Sha256, Digest};
use once_cell::sync::Lazy;

// @group Configuration : Derive a deterministic 32-byte key from a machine-unique seed
// In production, this would be stored in the OS keychain. For now we use a file-based seed.
static ENCRYPTION_KEY: Lazy<[u8; 32]> = Lazy::new(|| {
    // Seed from a fixed app secret + machine hostname for basic uniqueness
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "antarman".to_string());
    let seed = format!("antarman-v1-{}", hostname);
    let mut hasher = Sha256::new();
    hasher.update(seed.as_bytes());
    hasher.finalize().into()
});

/// Encrypt a plaintext string → base64(nonce || ciphertext).
/// Returns the original string unchanged if encryption fails (fail-open for non-critical fields).
pub fn encrypt(plaintext: &str) -> String {
    match try_encrypt(plaintext) {
        Ok(ct) => ct,
        Err(e) => {
            eprintln!("[Crypto] Encrypt failed: {}", e);
            plaintext.to_string()
        }
    }
}

fn try_encrypt(plaintext: &str) -> Result<String> {
    let key = Key::<Aes256Gcm>::from_slice(&*ENCRYPTION_KEY);
    let cipher = Aes256Gcm::new(key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| anyhow!("Encryption failed: {}", e))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

/// Decrypt a base64(nonce || ciphertext) string → plaintext.
/// Returns the original string unchanged if decryption fails (handles unencrypted legacy values).
pub fn decrypt(ciphertext: &str) -> String {
    match try_decrypt(ciphertext) {
        Ok(pt) => pt,
        Err(_) => ciphertext.to_string(), // Legacy unencrypted value — pass through
    }
}

fn try_decrypt(ciphertext: &str) -> Result<String> {
    let combined = B64.decode(ciphertext)
        .map_err(|e| anyhow!("Base64 decode failed: {}", e))?;
    if combined.len() < 12 {
        return Err(anyhow!("Ciphertext too short"));
    }
    let (nonce_bytes, ct) = combined.split_at(12);
    let key = Key::<Aes256Gcm>::from_slice(&*ENCRYPTION_KEY);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ct)
        .map_err(|e| anyhow!("Decryption failed: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| anyhow!("UTF-8 decode failed: {}", e))
}
