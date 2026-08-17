// @group OfflineFallback : SQLite local database for offline write queuing
// Stores conversations and messages when MongoDB is unreachable.
// All rows carry a `synced` flag; sync.rs drains them to MongoDB on reconnect.

use rusqlite::{Connection, params};
use std::path::PathBuf;
use anyhow::{Result, Context};
use std::sync::Mutex;

// @group Configuration : Single shared SQLite connection
lazy_static::lazy_static! {
    static ref SQLITE: Mutex<Option<Connection>> = Mutex::new(None);
}

fn db_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push("antarman_offline.db");
    p
}

/// Initialize the SQLite database and create tables if needed.
pub fn init() -> Result<()> {
    let conn = Connection::open(db_path())
        .context("Failed to open SQLite offline database")?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS conversations (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            synced      INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            timestamp       INTEGER NOT NULL,
            synced          INTEGER NOT NULL DEFAULT 0
        );
    ").context("Failed to create SQLite tables")?;
    *SQLITE.lock().unwrap() = Some(conn);
    Ok(())
}

// @group DatabaseOperations : Save a message locally when offline
pub fn save_message_local(
    conversation_id: &str,
    conversation_title: &str,
    role: &str,
    content: &str,
) -> Result<()> {
    let mut guard = SQLITE.lock().unwrap();
    if guard.is_none() { init()?; *guard = None; init().ok(); return Ok(()); }
    let conn = guard.as_ref().unwrap();
    let now = chrono::Utc::now().timestamp_millis();
    let msg_id = format!("local-{}", now);

    // Upsert conversation
    conn.execute(
        "INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at, synced) VALUES (?1, ?2, ?3, ?3, 0)",
        params![conversation_id, conversation_title, now],
    ).ok();
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![now, conversation_id],
    ).ok();

    // Insert message
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, timestamp, synced) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        params![msg_id, conversation_id, role, content, now],
    ).context("SQLite insert failed")?;

    Ok(())
}

// @group Sync : Retrieve all unsynced rows for sync.rs to push to MongoDB
pub struct PendingMessage {
    pub id: String,
    pub conversation_id: String,
    pub conversation_title: String,
    pub role: String,
    pub content: String,
    pub _timestamp: i64,
}

pub fn get_pending_sync() -> Result<Vec<PendingMessage>> {
    let guard = SQLITE.lock().unwrap();
    let conn = match guard.as_ref() {
        Some(c) => c,
        None => return Ok(vec![]),
    };

    let mut stmt = conn.prepare(
        "SELECT m.id, m.conversation_id, c.title, m.role, m.content, m.timestamp
         FROM messages m
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE m.synced = 0
         ORDER BY m.timestamp ASC"
    ).context("SQLite prepare failed")?;

    let rows = stmt.query_map([], |row| {
        Ok(PendingMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            conversation_title: row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "Offline".to_string()),
            role: row.get(3)?,
            content: row.get(4)?,
            _timestamp: row.get(5)?,
        })
    }).context("SQLite query failed")?;

    Ok(rows.flatten().collect())
}

/// Mark a local message as synced after it has been pushed to MongoDB.
pub fn mark_synced(local_id: &str) -> Result<()> {
    let guard = SQLITE.lock().unwrap();
    if let Some(conn) = guard.as_ref() {
        conn.execute("UPDATE messages SET synced = 1 WHERE id = ?1", params![local_id])
            .context("SQLite mark_synced failed")?;
    }
    Ok(())
}
