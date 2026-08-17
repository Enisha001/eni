// @group OfflineFallback : Sync locally queued writes to MongoDB on reconnect
use anyhow::Result;
use crate::{db, sqlite_db};

/// Drain all unsynced SQLite rows into MongoDB.
/// Called after a successful MongoDB reconnect.
pub async fn sync_pending_to_mongo() -> Result<()> {
    let pending = sqlite_db::get_pending_sync()?;
    if pending.is_empty() {
        return Ok(());
    }

    eprintln!("[Sync] Syncing {} offline messages to MongoDB...", pending.len());

    for msg in pending {
        // Ensure the conversation exists in MongoDB
        let conv_id = match db::get_conversation(&msg.conversation_id).await {
            Ok(_) => msg.conversation_id.clone(),
            Err(_) => {
                // Conversation doesn't exist remotely yet — create it
                match db::create_conversation(&msg.conversation_title).await {
                    Ok(id) => id,
                    Err(e) => {
                        eprintln!("[Sync] Could not create conversation {}: {}", msg.conversation_id, e);
                        continue;
                    }
                }
            }
        };

        match db::save_message(&conv_id, &msg.role, &msg.content).await {
            Ok(_) => {
                let _ = sqlite_db::mark_synced(&msg.id);
                eprintln!("[Sync] Synced message {}", msg.id);
            }
            Err(e) => {
                eprintln!("[Sync] Failed to sync message {}: {}", msg.id, e);
            }
        }
    }

    Ok(())
}
