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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_then_decrypt_round_trips_to_original_plaintext() {
        let original = "the quick brown fox jumps over the lazy dog";
        let ciphertext = encrypt(original);
        assert_eq!(decrypt(&ciphertext), original);
    }

    #[test]
    fn encrypting_same_plaintext_twice_yields_different_ciphertext() {
        // Nonce is regenerated per call (AeadCore::generate_nonce), so two
        // encryptions of the same plaintext must not be identical — this is
        // what prevents ciphertext pattern analysis across stored records.
        let original = "repeat-value";
        let a = encrypt(original);
        let b = encrypt(original);
        assert_ne!(a, b, "ciphertext must differ due to random nonce reuse protection");
        assert_eq!(decrypt(&a), original);
        assert_eq!(decrypt(&b), original);
    }

    #[test]
    fn decrypting_plaintext_legacy_value_fails_open_and_returns_it_unchanged() {
        // Values stored before the encryption feature was introduced are not
        // valid base64(nonce || ciphertext), so decrypt() must fail open.
        let legacy_plaintext = "sk-legacy-api-key-stored-before-encryption";
        assert_eq!(decrypt(legacy_plaintext), legacy_plaintext);
    }

    #[test]
    fn decrypting_corrupted_ciphertext_fails_open_and_returns_it_unchanged() {
        let original = "a-real-secret-value";
        let mut ciphertext = encrypt(original);
        // Flip the last character to corrupt the base64/AEAD tag without
        // producing an empty or malformed string.
        ciphertext.pop();
        ciphertext.push(if ciphertext.ends_with('A') { 'B' } else { 'A' });
        // Corruption must not panic; it should fail open and return the
        // (now-corrupted) input string unchanged, per the documented policy.
        assert_eq!(decrypt(&ciphertext), ciphertext);
    }

    #[test]
    fn decrypting_too_short_ciphertext_fails_open() {
        let short_value = "YQ=="; // valid base64, but decodes to far fewer than 12 nonce bytes
        assert_eq!(decrypt(short_value), short_value);
    }

    #[test]
    fn encrypt_decrypt_round_trips_unicode_content() {
        let original = "नमस्ते दुनिया 🌍 — café, naïve, 日本語";
        let ciphertext = encrypt(original);
        assert_ne!(ciphertext, original);
        assert_eq!(decrypt(&ciphertext), original);
    }

    #[test]
    fn encrypt_handles_empty_string() {
        let ciphertext = encrypt("");
        assert_eq!(decrypt(&ciphertext), "");
    }
}
