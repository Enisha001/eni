// @group DatabaseOperations : MongoDB conversation history persistence

use anyhow::{anyhow, Result};
use bson::{doc, oid::ObjectId};
use chrono::Utc;
use mongodb::{Client, Collection, options::ClientOptions};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use crate::crypto;

// @group Types : Serializable structs for conversations and messages

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,         // MongoDB _id hex
    pub role: String,
    pub content: String,
    pub timestamp: i64,     // Unix ms
    pub bookmarked: bool,
    pub sentiment: f64,     // -1.0 (negative) to 1.0 (positive), 0.0 = neutral
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkedMessage {
    pub message_id: String,
    pub conversation_id: String,
    pub conversation_title: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

// @group UserMemory : Facts the user teaches the AI about themselves
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMemoryFact {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: i64, // Unix ms
    pub updated_at: i64, // Unix ms
    pub message_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationWithMessages {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub messages: Vec<StoredMessage>,
}

// @group Configuration : Connection management
// Mutex<Option<Client>> allows reconnection — unlike OnceCell which only accepts one write.
static DB_CLIENT: Mutex<Option<Client>> = Mutex::new(None);
static DB_NAME: Mutex<String> = Mutex::new(String::new());

fn db_name() -> String {
    DB_NAME.lock().unwrap().clone()
}

/// Clone the shared client (cheap — Client is Arc-based internally).
fn get_client_clone() -> Result<Client> {
    DB_CLIENT
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow!("MongoDB not connected. Configure a URI in Settings first."))
}

fn conversations_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("conversations"))
}

fn messages_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("messages"))
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

// @group DatabaseOperations : Public async operations

pub async fn connect(uri: &str) -> Result<()> {
    let db = extract_db_name(uri).unwrap_or_else(|| "antarman".to_string());

    let opts = ClientOptions::parse(uri).await?;
    let client = Client::with_options(opts)?;

    // Ping to validate connectivity before storing
    client.database(&db).run_command(doc! { "ping": 1 }).await?;

    *DB_NAME.lock().unwrap() = db;
    // Fix 5: replace any previous client, enabling reconnect with a new URI
    *DB_CLIENT.lock().unwrap() = Some(client);
    Ok(())
}

/// Fix 14: Lightweight presence check — no network round-trip.
/// Use connect() to validate actual connectivity.
pub async fn is_connected() -> bool {
    DB_CLIENT.lock().unwrap().is_some()
}

pub async fn list_conversations() -> Result<Vec<Conversation>> {
    use futures_util::TryStreamExt;

    let col = conversations_col()?;
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "updatedAt": -1 })
        .build();
    let mut cursor = col.find(doc! {}).with_options(opts).await?;

    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        if let Ok(conv) = doc_to_conversation(&doc) {
            result.push(conv);
        }
    }
    Ok(result)
}

pub async fn get_conversation(id: &str) -> Result<ConversationWithMessages> {
    use futures_util::TryStreamExt;

    let oid = ObjectId::parse_str(id)?;
    let conv_doc = conversations_col()?
        .find_one(doc! { "_id": oid })
        .await?
        .ok_or_else(|| anyhow!("Conversation not found"))?;

    let conv = doc_to_conversation(&conv_doc)?;

    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "timestamp": 1 })
        .build();
    let mut cursor = messages_col()?
        .find(doc! { "conversationId": id })
        .with_options(opts)
        .await?;

    let mut messages = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        if let Ok(msg) = doc_to_message(&doc) {
            messages.push(msg);
        }
    }

    Ok(ConversationWithMessages {
        id: conv.id,
        title: conv.title,
        created_at: conv.created_at,
        updated_at: conv.updated_at,
        messages,
    })
}

pub async fn create_conversation(title: &str) -> Result<String> {
    let col = conversations_col()?;
    let now = now_ms();
    let doc = doc! {
        "title": title,
        "createdAt": now,
        "updatedAt": now,
        "messageCount": 0i32,
    };
    let result = col.insert_one(doc).await?;
    let id = result
        .inserted_id
        .as_object_id()
        .ok_or_else(|| anyhow!("Invalid inserted id"))?
        .to_hex();
    Ok(id)
}

pub async fn save_message(conversation_id: &str, role: &str, content: &str) -> Result<String> {
    let now = now_ms();
    let sentiment = if role == "user" { compute_sentiment(content) } else { 0.0 };

    // Insert message
    let msg_doc = doc! {
        "conversationId": conversation_id,
        "role": role,
        "content": content,
        "timestamp": now,
        "bookmarked": false,
        "sentiment": sentiment,
    };
    let insert_result = messages_col()?.insert_one(msg_doc).await?;
    let message_id = insert_result
        .inserted_id
        .as_object_id()
        .map(|o| o.to_hex())
        .unwrap_or_default();

    // Update conversation: bump updatedAt, messageCount, and auto-title on first user message
    let oid = ObjectId::parse_str(conversation_id)?;
    let conv_doc = conversations_col()?
        .find_one(doc! { "_id": oid })
        .await?;

    let mut update = doc! {
        "$inc": { "messageCount": 1i32 },
        "$set": { "updatedAt": now },
    };

    // Auto-title from first user message
    if role == "user" {
        if let Some(ref d) = conv_doc {
            let count = d.get_i32("messageCount").unwrap_or(0);
            if count == 0 {
                let title = truncate(content, 50);
                update.get_document_mut("$set").unwrap().insert("title", title);
            }
        }
    }

    conversations_col()?
        .update_one(doc! { "_id": oid }, update)
        .await?;

    Ok(message_id)
}

pub async fn delete_conversation(id: &str) -> Result<()> {
    let oid = ObjectId::parse_str(id)?;
    conversations_col()?
        .delete_one(doc! { "_id": oid })
        .await?;
    messages_col()?
        .delete_many(doc! { "conversationId": id })
        .await?;
    Ok(())
}

pub async fn update_conversation_title(id: &str, title: &str) -> Result<()> {
    let oid = ObjectId::parse_str(id)?;
    conversations_col()?
        .update_one(doc! { "_id": oid }, doc! { "$set": { "title": title } })
        .await?;
    Ok(())
}

// @group Settings : App settings persistence as a single document in "appsettings" collection

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub provider: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub anthropic_model: Option<String>,
    pub openai_api_key: Option<String>,
    pub openai_model: Option<String>,
    pub azure_api_key: Option<String>,
    pub azure_endpoint: Option<String>,
    pub azure_model: Option<String>,
    pub ollama_endpoint: Option<String>,
    pub ollama_model: Option<String>,
    pub lmstudio_endpoint: Option<String>,
    pub lmstudio_model: Option<String>,
    pub voice_cloned: Option<bool>,
    pub voice_sample_path: Option<String>,
    pub use_fast_tts: Option<bool>,
    pub tts_provider: Option<String>,
    pub kokoro_endpoint: Option<String>,
    pub kokoro_voice: Option<String>,
    pub system_prompt: Option<String>,
    // @group NewFeatures : Extended settings for new features
    pub offline_mode: Option<bool>,
    pub offline_provider: Option<String>,
    pub check_in_enabled: Option<bool>,
    pub check_in_hour: Option<i32>,
    pub check_in_minute: Option<i32>,
    pub active_persona_id: Option<String>,
    pub memory_enabled: Option<bool>,
    pub vad_enabled: Option<bool>,
    pub vad_silence_ms: Option<i32>,
}

fn settings_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("appsettings"))
}

/// Upsert the full settings document — API keys are encrypted before storage.
pub async fn save_settings(settings: &AppSettings) -> Result<()> {
    let col = settings_col()?;
    // @group Crypto : Encrypt sensitive API key fields before persisting
    let mut encrypted = settings.clone();
    if let Some(k) = &settings.anthropic_api_key { encrypted.anthropic_api_key = Some(crypto::encrypt(k)); }
    if let Some(k) = &settings.openai_api_key    { encrypted.openai_api_key    = Some(crypto::encrypt(k)); }
    if let Some(k) = &settings.azure_api_key     { encrypted.azure_api_key     = Some(crypto::encrypt(k)); }
    let mut doc = bson::to_document(&encrypted)?;
    doc.insert("type", "appsettings");
    col.replace_one(doc! { "type": "appsettings" }, doc)
        .upsert(true)
        .await?;
    Ok(())
}

pub async fn get_settings() -> Result<Option<AppSettings>> {
    let col = settings_col()?;
    match col.find_one(doc! { "type": "appsettings" }).await? {
        None => Ok(None),
        Some(mut d) => {
            d.remove("_id");
            d.remove("type");
            let mut s: AppSettings = bson::from_document(d)?;
            // @group Crypto : Decrypt API keys on load (gracefully handles unencrypted legacy values)
            if let Some(k) = &s.anthropic_api_key { s.anthropic_api_key = Some(crypto::decrypt(k)); }
            if let Some(k) = &s.openai_api_key    { s.openai_api_key    = Some(crypto::decrypt(k)); }
            if let Some(k) = &s.azure_api_key     { s.azure_api_key     = Some(crypto::decrypt(k)); }
            Ok(Some(s))
        }
    }
}

// @group Utilities : Internal helpers

fn extract_db_name(uri: &str) -> Option<String> {
    let path = uri.split('/').last()?;
    let name = path.split('?').next()?.trim().to_string();
    if name.is_empty() { None } else { Some(name) }
}

fn truncate(s: &str, max: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= max {
        s.to_string()
    } else {
        chars[..max].iter().collect::<String>() + "..."
    }
}

fn doc_to_conversation(doc: &bson::Document) -> Result<Conversation> {
    let id = doc
        .get_object_id("_id")
        .map_err(|e| anyhow!(e.to_string()))?
        .to_hex();
    let title = doc.get_str("title").unwrap_or("Untitled").to_string();
    let created_at = doc.get_i64("createdAt").unwrap_or(0);
    let updated_at = doc.get_i64("updatedAt").unwrap_or(0);
    let message_count = doc.get_i32("messageCount").unwrap_or(0) as u32;
    Ok(Conversation { id, title, created_at, updated_at, message_count })
}

fn doc_to_message(doc: &bson::Document) -> Result<StoredMessage> {
    let id = doc.get_object_id("_id").map(|o| o.to_hex()).unwrap_or_default();
    let role = doc.get_str("role").map_err(|e| anyhow!(e.to_string()))?.to_string();
    let content = doc.get_str("content").map_err(|e| anyhow!(e.to_string()))?.to_string();
    let timestamp = doc.get_i64("timestamp").unwrap_or(0);
    let bookmarked = doc.get_bool("bookmarked").unwrap_or(false);
    let sentiment = doc.get_f64("sentiment").unwrap_or(0.0);
    Ok(StoredMessage { id, role, content, timestamp, bookmarked, sentiment })
}

// @group Sentiment : Simple keyword-based sentiment scoring for user messages
fn compute_sentiment(text: &str) -> f64 {
    let lower = text.to_lowercase();
    let positive = [
        "happy", "good", "great", "excellent", "joy", "love", "wonderful", "amazing",
        "fantastic", "excited", "grateful", "proud", "hopeful", "confident", "motivated",
        "inspired", "optimistic", "success", "bright", "delighted", "awesome", "glad",
        "calm", "peaceful", "energized", "accomplished", "thrilled", "content", "thankful",
    ];
    let negative = [
        "sad", "bad", "terrible", "awful", "hate", "angry", "frustrated", "anxious",
        "worried", "fear", "stressed", "depressed", "tired", "exhausted", "hopeless",
        "overwhelmed", "failure", "struggle", "difficult", "lost", "confused", "stuck",
        "lonely", "pain", "hurt", "upset", "nervous", "scared", "miserable", "worthless",
    ];
    let mut score: i32 = 0;
    for w in &positive { if lower.contains(w) { score += 1; } }
    for w in &negative { if lower.contains(w) { score -= 1; } }
    let word_count = text.split_whitespace().count().max(1) as f64;
    // Normalize: divide by sqrt(word_count) to reduce bias toward long messages
    (score as f64 / word_count.sqrt()).max(-1.0).min(1.0)
}

// @group UserMemory : Collection accessor and CRUD

fn memory_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("usermemory"))
}

/// persona_id: scopes memory to a specific persona; "default" for global facts.
/// Existing documents without personaId are treated as "default" for backwards compatibility.
pub async fn save_memory(key: &str, value: &str, persona_id: &str) -> Result<()> {
    let now = now_ms();
    let filter = doc! { "key": key, "personaId": persona_id };
    let doc = doc! { "key": key, "value": value, "personaId": persona_id, "updatedAt": now };
    memory_col()?
        .replace_one(filter, doc)
        .upsert(true)
        .await?;
    Ok(())
}

pub async fn get_all_memory(persona_id: &str) -> Result<Vec<UserMemoryFact>> {
    use futures_util::TryStreamExt;
    // Include both scoped facts and legacy facts without a personaId field when querying "default"
    let filter = if persona_id == "default" {
        doc! { "$or": [{ "personaId": "default" }, { "personaId": { "$exists": false } }] }
    } else {
        doc! { "personaId": persona_id }
    };
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "updatedAt": -1 })
        .build();
    let mut cursor = memory_col()?.find(filter).with_options(opts).await?;
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let key = doc.get_str("key").unwrap_or("").to_string();
        let value = doc.get_str("value").unwrap_or("").to_string();
        let updated_at = doc.get_i64("updatedAt").unwrap_or(0);
        result.push(UserMemoryFact { key, value, updated_at });
    }
    Ok(result)
}

pub async fn delete_memory(key: &str, persona_id: &str) -> Result<()> {
    memory_col()?.delete_one(doc! { "key": key, "personaId": persona_id }).await?;
    Ok(())
}

pub async fn clear_all_memory(persona_id: &str) -> Result<()> {
    let filter = if persona_id == "default" {
        doc! { "$or": [{ "personaId": "default" }, { "personaId": { "$exists": false } }] }
    } else {
        doc! { "personaId": persona_id }
    };
    memory_col()?.delete_many(filter).await?;
    Ok(())
}

// @group Bookmarks : Toggle bookmark on a message and retrieve all bookmarked messages

pub async fn toggle_bookmark(message_id: &str) -> Result<bool> {
    let oid = ObjectId::parse_str(message_id)?;
    let col = messages_col()?;
    let doc = col.find_one(doc! { "_id": oid }).await?
        .ok_or_else(|| anyhow!("Message not found"))?;
    let current = doc.get_bool("bookmarked").unwrap_or(false);
    let new_state = !current;
    col.update_one(
        doc! { "_id": oid },
        doc! { "$set": { "bookmarked": new_state } },
    ).await?;
    Ok(new_state)
}

pub async fn get_bookmarked_messages() -> Result<Vec<BookmarkedMessage>> {
    use futures_util::TryStreamExt;
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "timestamp": -1 })
        .build();
    let mut cursor = messages_col()?
        .find(doc! { "bookmarked": true })
        .with_options(opts)
        .await?;
    let conv_col = conversations_col()?;
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let message_id = doc.get_object_id("_id").map(|o| o.to_hex()).unwrap_or_default();
        let conversation_id = doc.get_str("conversationId").unwrap_or("").to_string();
        let role = doc.get_str("role").unwrap_or("").to_string();
        let content = doc.get_str("content").unwrap_or("").to_string();
        let timestamp = doc.get_i64("timestamp").unwrap_or(0);
        // Look up conversation title
        let conversation_title = if let Ok(oid) = ObjectId::parse_str(&conversation_id) {
            conv_col.find_one(doc! { "_id": oid }).await?
                .and_then(|d| d.get_str("title").ok().map(String::from))
                .unwrap_or_else(|| "Untitled".to_string())
        } else {
            "Untitled".to_string()
        };
        result.push(BookmarkedMessage { message_id, conversation_id, conversation_title, role, content, timestamp });
    }
    Ok(result)
}

// @group Search : Full-text search across conversation titles and message content

pub async fn search_conversations(query: &str) -> Result<Vec<Conversation>> {
    use futures_util::TryStreamExt;
    if query.trim().is_empty() {
        return list_conversations().await;
    }
    // Search titles
    let conv_col = conversations_col()?;
    let regex = bson::Regex { pattern: regex::escape(query), options: "i".to_string() };
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "updatedAt": -1 })
        .build();
    let mut cursor = conv_col
        .find(doc! { "title": { "$regex": regex } })
        .with_options(opts)
        .await?;
    let mut seen_ids = std::collections::HashSet::new();
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        if let Ok(conv) = doc_to_conversation(&doc) {
            seen_ids.insert(conv.id.clone());
            result.push(conv);
        }
    }
    // Also search message content and add their parent conversations
    let regex2 = bson::Regex { pattern: regex::escape(query), options: "i".to_string() };
    let mut msg_cursor = messages_col()?
        .find(doc! { "content": { "$regex": regex2 } })
        .await?;
    let mut conv_ids_to_fetch = Vec::new();
    while let Some(doc) = msg_cursor.try_next().await? {
        let cid = doc.get_str("conversationId").unwrap_or("").to_string();
        if !cid.is_empty() && !seen_ids.contains(&cid) {
            seen_ids.insert(cid.clone());
            conv_ids_to_fetch.push(cid);
        }
    }
    for cid in conv_ids_to_fetch {
        if let Ok(oid) = ObjectId::parse_str(&cid) {
            if let Ok(Some(doc)) = conv_col.find_one(doc! { "_id": oid }).await {
                if let Ok(conv) = doc_to_conversation(&doc) {
                    result.push(conv);
                }
            }
        }
    }
    Ok(result)
}

// @group Sentiment : Retrieve sentiment scores for all messages in a conversation (in order)

pub async fn get_conversation_sentiments(conversation_id: &str) -> Result<Vec<f64>> {
    use futures_util::TryStreamExt;
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "timestamp": 1 })
        .build();
    let mut cursor = messages_col()?
        .find(doc! { "conversationId": conversation_id, "role": "user" })
        .with_options(opts)
        .await?;
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let s = doc.get_f64("sentiment").unwrap_or(0.0);
        result.push(s);
    }
    Ok(result)
}

// @group WeeklyReflection : Weekly AI-generated summaries

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reflection {
    pub id: Option<String>,
    pub week_start_date: String,   // "2026-04-28"
    pub generated_at: i64,
    pub summary: String,
    pub avg_sentiment: f64,
    pub conversation_ids: Vec<String>,
    pub check_in_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyData {
    pub week_start_date: String,
    pub message_count: i32,
    pub avg_sentiment: f64,
    pub conversation_count: i32,
    pub check_in_count: i32,
    pub conversation_ids: Vec<String>,
    pub check_in_summaries: Vec<String>,
}

fn reflections_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("reflections"))
}

pub async fn save_reflection(reflection: &Reflection) -> Result<String> {
    let conv_ids_bson: Vec<bson::Bson> = reflection.conversation_ids.iter()
        .map(|id| bson::Bson::String(id.clone()))
        .collect();
    let doc = doc! {
        "weekStartDate": &reflection.week_start_date,
        "generatedAt": reflection.generated_at,
        "summary": &reflection.summary,
        "avgSentiment": reflection.avg_sentiment,
        "conversationIds": conv_ids_bson,
        "checkInCount": reflection.check_in_count,
    };
    let result = reflections_col()?.insert_one(doc).await?;
    Ok(result.inserted_id.as_object_id().map(|o| o.to_hex()).unwrap_or_default())
}

pub async fn get_reflections(limit: u32) -> Result<Vec<Reflection>> {
    use futures_util::TryStreamExt;
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "generatedAt": -1 })
        .limit(limit as i64)
        .build();
    let mut cursor = reflections_col()?.find(doc! {}).with_options(opts).await?;
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let id = doc.get_object_id("_id").map(|o| o.to_hex()).ok();
        let week_start_date = doc.get_str("weekStartDate").unwrap_or("").to_string();
        let generated_at = doc.get_i64("generatedAt").unwrap_or(0);
        let summary = doc.get_str("summary").unwrap_or("").to_string();
        let avg_sentiment = doc.get_f64("avgSentiment").unwrap_or(0.0);
        let check_in_count = doc.get_i32("checkInCount").unwrap_or(0);
        let conversation_ids = doc.get_array("conversationIds")
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        result.push(Reflection { id, week_start_date, generated_at, summary, avg_sentiment, conversation_ids, check_in_count });
    }
    Ok(result)
}

/// Aggregate conversation and check-in data for the 7-day window starting at week_start_ms.
pub async fn get_weekly_data(week_start_ms: i64) -> Result<WeeklyData> {
    use futures_util::TryStreamExt;

    let week_end_ms = week_start_ms + 7 * 24 * 60 * 60 * 1000;

    // Conversations updated this week
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "updatedAt": -1 })
        .build();
    let mut conv_cursor = conversations_col()?
        .find(doc! { "updatedAt": { "$gte": week_start_ms, "$lt": week_end_ms } })
        .with_options(opts)
        .await?;
    let mut conversation_ids = Vec::new();
    while let Some(doc) = conv_cursor.try_next().await? {
        if let Ok(id) = doc.get_object_id("_id").map(|o| o.to_hex()) {
            conversation_ids.push(id);
        }
    }

    // Sentiment + message count from user messages this week
    let mut msg_cursor = messages_col()?
        .find(doc! { "timestamp": { "$gte": week_start_ms, "$lt": week_end_ms }, "role": "user" })
        .await?;
    let mut sentiments = Vec::new();
    while let Some(doc) = msg_cursor.try_next().await? {
        sentiments.push(doc.get_f64("sentiment").unwrap_or(0.0));
    }
    let message_count = sentiments.len() as i32;
    let avg_sentiment = if sentiments.is_empty() { 0.0 } else {
        sentiments.iter().sum::<f64>() / sentiments.len() as f64
    };

    // Check-ins this week
    let mut ci_cursor = checkins_col()?
        .find(doc! { "timestamp": { "$gte": week_start_ms, "$lt": week_end_ms } })
        .await?;
    let mut check_in_summaries = Vec::new();
    while let Some(doc) = ci_cursor.try_next().await? {
        let date = doc.get_str("date").unwrap_or("").to_string();
        let reflection = doc.get_str("aiReflection").unwrap_or("").to_string();
        if !reflection.is_empty() {
            check_in_summaries.push(format!("{}: {}", date, reflection));
        }
    }
    let check_in_count = check_in_summaries.len() as i32;

    // Week start date string
    let week_start_date = {
        let d = chrono::DateTime::from_timestamp_millis(week_start_ms)
            .unwrap_or_else(|| chrono::DateTime::UNIX_EPOCH.into());
        d.format("%Y-%m-%d").to_string()
    };

    Ok(WeeklyData {
        week_start_date,
        message_count,
        avg_sentiment,
        conversation_count: conversation_ids.len() as i32,
        check_in_count,
        conversation_ids,
        check_in_summaries,
    })
}

// @group CheckIn : Structured daily check-in journaling

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInResponse {
    pub question: String,
    pub answer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckIn {
    pub id: Option<String>,
    pub timestamp: i64,
    pub date: String,
    pub responses: Vec<CheckInResponse>,
    pub ai_reflection: String,
    pub sentiment_score: f64,
}

fn checkins_col() -> Result<Collection<bson::Document>> {
    Ok(get_client_clone()?.database(&db_name()).collection("checkins"))
}

pub async fn save_check_in(check_in: &CheckIn) -> Result<String> {
    let responses_bson: Vec<bson::Document> = check_in.responses.iter().map(|r| {
        doc! { "question": &r.question, "answer": &r.answer }
    }).collect();

    let doc = doc! {
        "timestamp": check_in.timestamp,
        "date": &check_in.date,
        "responses": responses_bson,
        "aiReflection": &check_in.ai_reflection,
        "sentimentScore": check_in.sentiment_score,
    };
    let result = checkins_col()?.insert_one(doc).await?;
    Ok(result.inserted_id.as_object_id().map(|o| o.to_hex()).unwrap_or_default())
}

pub async fn get_check_ins(limit: u32) -> Result<Vec<CheckIn>> {
    use futures_util::TryStreamExt;
    let opts = mongodb::options::FindOptions::builder()
        .sort(doc! { "timestamp": -1 })
        .limit(limit as i64)
        .build();
    let mut cursor = checkins_col()?.find(doc! {}).with_options(opts).await?;
    let mut result = Vec::new();
    while let Some(doc) = cursor.try_next().await? {
        let id = doc.get_object_id("_id").map(|o| o.to_hex()).ok();
        let timestamp = doc.get_i64("timestamp").unwrap_or(0);
        let date = doc.get_str("date").unwrap_or("").to_string();
        let ai_reflection = doc.get_str("aiReflection").unwrap_or("").to_string();
        let sentiment_score = doc.get_f64("sentimentScore").unwrap_or(0.0);
        let responses = doc.get_array("responses").unwrap_or(&bson::Array::new()).iter().filter_map(|v| {
            let d = v.as_document()?;
            Some(CheckInResponse {
                question: d.get_str("question").unwrap_or("").to_string(),
                answer: d.get_str("answer").unwrap_or("").to_string(),
            })
        }).collect();
        result.push(CheckIn { id, timestamp, date, responses, ai_reflection, sentiment_score });
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- compute_sentiment: positive / negative / neutral / mixed / empty ---

    #[test]
    fn compute_sentiment_scores_positive_message_above_zero() {
        let score = compute_sentiment("I feel happy and grateful and excited today");
        assert!(score > 0.0, "expected positive score, got {score}");
    }

    #[test]
    fn compute_sentiment_scores_negative_message_below_zero() {
        let score = compute_sentiment("I feel anxious and stressed and hopeless right now");
        assert!(score < 0.0, "expected negative score, got {score}");
    }

    #[test]
    fn compute_sentiment_scores_neutral_message_as_zero() {
        let score = compute_sentiment("The meeting is scheduled for three o'clock tomorrow");
        assert_eq!(score, 0.0);
    }

    #[test]
    fn compute_sentiment_scores_mixed_message_toward_center() {
        // Equal positive and negative keyword hits should roughly cancel out.
        let score = compute_sentiment("I am happy about the result but sad about the delay");
        assert!(score.abs() < 0.5, "expected mixed message near zero, got {score}");
    }

    #[test]
    fn compute_sentiment_handles_empty_string_without_panicking() {
        let score = compute_sentiment("");
        assert_eq!(score, 0.0);
    }

    #[test]
    fn compute_sentiment_is_case_insensitive() {
        let lower = compute_sentiment("this is a great and wonderful day");
        let upper = compute_sentiment("THIS IS A GREAT AND WONDERFUL DAY");
        assert_eq!(lower, upper);
    }

    #[test]
    fn compute_sentiment_stays_within_bounds() {
        let very_positive = compute_sentiment(
            "happy good great excellent joy love wonderful amazing fantastic excited",
        );
        let very_negative = compute_sentiment(
            "sad bad terrible awful hate angry frustrated anxious worried fear",
        );
        assert!(very_positive <= 1.0);
        assert!(very_negative >= -1.0);
    }

    // --- length normalisation: sqrt(word_count) division ---

    #[test]
    fn compute_sentiment_normalizes_by_message_length() {
        // One positive keyword in a short message should score higher than the
        // same single keyword diluted inside a much longer neutral message.
        let short = compute_sentiment("happy");
        let long = compute_sentiment(
            "happy and then there were many other neutral words filling out this message",
        );
        assert!(short > long, "short={short}, long={long}");
    }

    // --- extract_db_name: MongoDB URI parsing ---

    #[test]
    fn extract_db_name_parses_standard_srv_uri() {
        let uri = "mongodb+srv://user:pass@cluster0.mongodb.net/antarman?retryWrites=true";
        assert_eq!(extract_db_name(uri), Some("antarman".to_string()));
    }

    #[test]
    fn extract_db_name_parses_uri_without_query_string() {
        let uri = "mongodb://localhost:27017/antarman_dev";
        assert_eq!(extract_db_name(uri), Some("antarman_dev".to_string()));
    }

    #[test]
    fn extract_db_name_returns_none_when_no_database_segment_present() {
        let uri = "mongodb+srv://user:pass@cluster0.mongodb.net/";
        assert_eq!(extract_db_name(uri), None);
    }

    // --- truncate: multibyte-safe string truncation ---

    #[test]
    fn truncate_leaves_short_strings_unchanged() {
        assert_eq!(truncate("hello", 10), "hello");
    }

    #[test]
    fn truncate_is_multibyte_safe_and_does_not_panic_mid_character() {
        // Each of these characters is multi-byte in UTF-8; truncating by byte
        // index instead of char index would panic or split a character.
        let text = "日本語のテキストです";
        let result = truncate(text, 3);
        assert_eq!(result, "日本語...");
    }
}
