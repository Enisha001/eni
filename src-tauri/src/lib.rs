mod audio;
mod ai_client;
mod stt;
mod tts;
mod db;
mod crypto;
mod sqlite_db;
mod sync;

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::SystemTime;
use chrono::Timelike;
use tauri::Emitter;

// @group CheckIn : Background scheduler state
static CHECK_IN_ENABLED: AtomicBool = AtomicBool::new(false);
static CHECK_IN_HOUR: AtomicU8 = AtomicU8::new(9);
static CHECK_IN_MINUTE: AtomicU8 = AtomicU8::new(0);

// Tauri Commands

#[tauri::command]
fn start_recording() -> Result<(), String> {
    let recorder = audio::AudioRecorder::new();
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    // Use platform-appropriate temp directory
    let temp_dir = std::env::temp_dir();
    let path = temp_dir.join(format!("antarman_recording_{}.wav", timestamp));

    recorder
        .start_recording(path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_recording() -> Result<RecordingResult, String> {
    let recorder = audio::AudioRecorder::new();
    let path = recorder.stop_recording().map_err(|e| e.to_string())?;

    // Get file metadata for duration (approximate)
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let duration = metadata.len() as f64 / (16000.0 * 2.0); // Approximate duration

    Ok(RecordingResult {
        audio_path: path.to_string_lossy().to_string(),
        duration,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
async fn transcribe_audio(audioPath: String) -> Result<stt::TranscriptionResult, String> {
    stt::transcribe_audio(&audioPath)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn generate_response(
    prompt: String,
    provider: String,
    apiKey: String,
    endpoint: Option<String>,
    model: Option<String>,
    history: Option<Vec<ai_client::ChatMessage>>,
) -> Result<ai_client::AIResponse, String> {
    ai_client::generate_response(
        &prompt,
        &provider,
        &apiKey,
        endpoint.as_deref(),
        model.as_deref(),
        history.as_deref().unwrap_or(&[]),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn generate_response_streaming(
    prompt: String,
    provider: String,
    apiKey: String,
    endpoint: Option<String>,
    model: Option<String>,
    history: Option<Vec<ai_client::ChatMessage>>,
) -> Result<Vec<String>, String> {
    ai_client::generate_response_streaming(
        &prompt,
        &provider,
        &apiKey,
        endpoint.as_deref(),
        model.as_deref(),
        history.as_deref().unwrap_or(&[]),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn generate_response_streaming_events(
    prompt: String,
    provider: String,
    apiKey: String,
    endpoint: Option<String>,
    model: Option<String>,
    history: Option<Vec<ai_client::ChatMessage>>,
    window: tauri::Window,
) -> Result<(), String> {
    ai_client::generate_response_streaming_events(
        &prompt,
        &provider,
        &apiKey,
        endpoint.as_deref(),
        model.as_deref(),
        history.as_deref().unwrap_or(&[]),
        window,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn synthesize_speech(
    text: String,
    voiceSamplePath: Option<String>,
    useFastTTS: Option<bool>,
    ttsProvider: Option<String>,
    kokoroEndpoint: Option<String>,
    kokoroVoice: Option<String>,
) -> Result<tts::TTSResult, String> {
    // @group KokoroTTS : Route to Kokoro when ttsProvider == "kokoro"
    if ttsProvider.as_deref() == Some("kokoro") {
        let endpoint = kokoroEndpoint.as_deref().unwrap_or("http://localhost:8880");
        let voice = kokoroVoice.as_deref().unwrap_or("af_sky");
        return tts::synthesize_with_kokoro(&text, endpoint, voice)
            .await
            .map_err(|e| e.to_string());
    }

    eprintln!("\n[LIB] ========== synthesize_speech (Coqui) CALLED ==========");
    eprintln!("[LIB] useFastTTS received: {:?}", useFastTTS);
    eprintln!("[LIB] voiceSamplePath received: {:?}", voiceSamplePath);

    let voice_path = if useFastTTS.unwrap_or(false) {
        eprintln!("[LIB] FAST MODE - Setting voice_path to None");
        None
    } else {
        eprintln!("[LIB] CLONE MODE - Using voice sample path");
        voiceSamplePath.as_deref()
    };

    eprintln!("[LIB] Final voice_path: {:?}", voice_path);

    tts::synthesize_speech(&text, voice_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn train_voice(audioPath: String) -> Result<String, String> {
    tts::train_voice(&audioPath)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_voice_status() -> Result<VoiceStatus, String> {
    let (trained, sample_path) = tts::get_voice_status().map_err(|e| e.to_string())?;
    Ok(VoiceStatus {
        trained,
        sample_path,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
async fn play_audio(audioPath: String) -> Result<(), String> {
    // play_audio_file blocks (rodio sleep_until_end) — run on a dedicated blocking thread
    // so we don't stall Tokio's async executor pool.
    tokio::task::spawn_blocking(move || audio::play_audio_file(&audioPath))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_audio() -> Result<(), String> {
    audio::stop_audio().map_err(|e| e.to_string())
}

// @group LMStudio : Fetch available models from LM Studio local server (bypasses CORS)
#[tauri::command]
#[allow(non_snake_case)]
async fn fetch_lmstudio_models(endpoint: String) -> Result<Vec<String>, String> {
    let base = endpoint.trim_end_matches('/').to_string();
    let url = format!("{}/v1/models", base);

    #[derive(serde::Deserialize)]
    struct ModelEntry { id: String }
    #[derive(serde::Deserialize)]
    struct ModelsResp { data: Vec<ModelEntry> }

    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Cannot reach LM Studio at {}: {}", base, e))?;

    if !resp.status().is_success() {
        return Err(format!("LM Studio returned HTTP {}", resp.status()));
    }

    let body: ModelsResp = resp.json().await
        .map_err(|e| format!("Unexpected response from LM Studio: {}", e))?;

    Ok(body.data.into_iter().map(|m| m.id).collect())
}

// @group DatabaseOperations : MongoDB conversation history commands

#[tauri::command]
async fn db_connect(uri: String) -> Result<(), String> {
    db::connect(&uri).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_is_connected() -> bool {
    db::is_connected().await
}

#[tauri::command]
async fn db_list_conversations() -> Result<Vec<db::Conversation>, String> {
    db::list_conversations().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_get_conversation(id: String) -> Result<db::ConversationWithMessages, String> {
    db::get_conversation(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_create_conversation(title: String) -> Result<String, String> {
    db::create_conversation(&title).await.map_err(|e| e.to_string())
}

// @group DatabaseOperations : MongoDB message save with SQLite offline fallback
#[tauri::command]
#[allow(non_snake_case)]
async fn db_save_message(conversationId: String, role: String, content: String, window: tauri::Window) -> Result<String, String> {
    match db::save_message(&conversationId, &role, &content).await {
        Ok(id) => Ok(id),
        Err(_) => {
            // @group OfflineFallback : MongoDB unreachable — queue locally in SQLite
            let title = "Offline Conversation";
            if let Err(e) = sqlite_db::save_message_local(&conversationId, title, &role, &content) {
                eprintln!("[Offline] SQLite fallback failed: {}", e);
            }
            let _ = window.emit("offline-write-queued", ());
            Ok(format!("local-{}", chrono::Utc::now().timestamp_millis()))
        }
    }
}

#[tauri::command]
async fn db_delete_conversation(id: String) -> Result<(), String> {
    db::delete_conversation(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_update_conversation_title(id: String, title: String) -> Result<(), String> {
    db::update_conversation_title(&id, &title)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_save_settings(settings: db::AppSettings) -> Result<(), String> {
    db::save_settings(&settings).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_get_settings() -> Result<Option<db::AppSettings>, String> {
    db::get_settings().await.map_err(|e| e.to_string())
}

/// Apply a user-defined system prompt at runtime so all subsequent AI calls use it.
#[tauri::command]
fn db_set_system_prompt(prompt: Option<String>) {
    ai_client::set_system_prompt(prompt);
}

// @group UserMemory : CRUD commands for persistent user memory facts (scoped by persona)

#[tauri::command]
#[allow(non_snake_case)]
async fn db_save_memory(key: String, value: String, personaId: Option<String>) -> Result<(), String> {
    let pid = personaId.as_deref().unwrap_or("default");
    db::save_memory(&key, &value, pid).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn db_get_all_memory(personaId: Option<String>) -> Result<Vec<db::UserMemoryFact>, String> {
    let pid = personaId.as_deref().unwrap_or("default");
    db::get_all_memory(pid).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn db_delete_memory(key: String, personaId: Option<String>) -> Result<(), String> {
    let pid = personaId.as_deref().unwrap_or("default");
    db::delete_memory(&key, pid).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn db_clear_all_memory(personaId: Option<String>) -> Result<(), String> {
    let pid = personaId.as_deref().unwrap_or("default");
    db::clear_all_memory(pid).await.map_err(|e| e.to_string())
}

// @group Bookmarks : Toggle and retrieve starred messages

#[tauri::command]
#[allow(non_snake_case)]
async fn db_toggle_bookmark(messageId: String) -> Result<bool, String> {
    db::toggle_bookmark(&messageId).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_get_bookmarked_messages() -> Result<Vec<db::BookmarkedMessage>, String> {
    db::get_bookmarked_messages().await.map_err(|e| e.to_string())
}

// @group Search : Full-text conversation search

#[tauri::command]
async fn db_search_conversations(query: String) -> Result<Vec<db::Conversation>, String> {
    db::search_conversations(&query).await.map_err(|e| e.to_string())
}

// @group Sentiment : Retrieve mood scores for a conversation

#[tauri::command]
#[allow(non_snake_case)]
async fn db_get_conversation_sentiments(conversationId: String) -> Result<Vec<f64>, String> {
    db::get_conversation_sentiments(&conversationId).await.map_err(|e| e.to_string())
}

// @group Export : Write arbitrary text content to a user-specified file path

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// @group VAD : Configure Voice Activity Detection threshold

#[tauri::command]
#[allow(non_snake_case)]
fn set_vad_enabled(enabled: bool, silenceMs: u64) {
    audio::set_vad_enabled(enabled, silenceMs);
}

// @group VAD : Return current RMS level for the calibration meter
#[tauri::command]
fn get_audio_level() -> f32 {
    audio::get_audio_level()
}

// @group STT : Detect whether whisper.cpp is installed and accessible
#[tauri::command]
fn check_whisper_installed() -> bool {
    stt::get_whisper_path().is_ok()
}

// @group CheckIn : Configure and control the daily check-in scheduler

#[tauri::command]
#[allow(non_snake_case)]
fn configure_check_in(enabled: bool, hour: u8, minute: u8) {
    CHECK_IN_ENABLED.store(enabled, Ordering::Relaxed);
    CHECK_IN_HOUR.store(hour, Ordering::Relaxed);
    CHECK_IN_MINUTE.store(minute, Ordering::Relaxed);
}

// @group WeeklyReflection : Save, retrieve, and aggregate weekly reflection data

#[tauri::command]
async fn db_save_reflection(reflection: db::Reflection) -> Result<String, String> {
    db::save_reflection(&reflection).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_get_reflections(limit: u32) -> Result<Vec<db::Reflection>, String> {
    db::get_reflections(limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
async fn db_get_weekly_data(weekStartMs: i64) -> Result<db::WeeklyData, String> {
    db::get_weekly_data(weekStartMs).await.map_err(|e| e.to_string())
}

// @group CheckIn : Save and retrieve structured daily check-in entries

#[tauri::command]
async fn db_save_check_in(checkIn: db::CheckIn) -> Result<String, String> {
    db::save_check_in(&checkIn).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn db_get_check_ins(limit: u32) -> Result<Vec<db::CheckIn>, String> {
    db::get_check_ins(limit).await.map_err(|e| e.to_string())
}

// @group OfflineFallback : Sync queued offline writes to MongoDB after reconnect
#[tauri::command]
async fn sync_offline_queue() -> Result<(), String> {
    sync::sync_pending_to_mongo().await.map_err(|e| e.to_string())
}

// @group ToneMirroring : Update real-time emotional tone context for the AI
#[tauri::command]
fn set_tone_context(tone: Option<String>) {
    ai_client::set_tone_context(tone);
}

// @group MemoryInjection : Sync loaded memory facts into the AI client's system prompt context

#[tauri::command]
fn set_memory_facts(facts: Vec<String>) {
    ai_client::set_memory_facts(facts);
}

// @group OllamaModels : Fetch available model names from a running Ollama server (bypasses CORS)
#[tauri::command]
#[allow(non_snake_case)]
async fn fetch_ollama_models(endpoint: String) -> Result<Vec<String>, String> {
    let base = endpoint.trim_end_matches('/').to_string();
    let url = format!("{}/api/tags", base);

    #[derive(serde::Deserialize)]
    struct ModelEntry { name: String }
    #[derive(serde::Deserialize)]
    struct TagsResp { models: Vec<ModelEntry> }

    let resp = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama at {}: {}", base, e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let body: TagsResp = resp.json().await
        .map_err(|e| format!("Unexpected response from Ollama: {}", e))?;

    Ok(body.models.into_iter().map(|m| m.name).collect())
}

// Response structures
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingResult {
    audio_path: String,
    duration: f64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceStatus {
    trained: bool,
    sample_path: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // @group OfflineFallback : Initialise SQLite offline queue on startup
            if let Err(e) = sqlite_db::init() {
                eprintln!("[SQLite] Init failed: {}", e);
            }

            // Start TTS server as the app launches (don't block UI startup).
            tauri::async_runtime::spawn(async {
                if let Err(err) = tts::warmup_tts_server().await {
                    eprintln!("[TTS SERVER] Failed to start on launch: {:#}", err);
                }
            });

            // @group CheckIn : Background task — fires daily check-in event at configured time
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut last_fired_minute: Option<u32> = None;
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                    if !CHECK_IN_ENABLED.load(Ordering::Relaxed) { continue; }
                    let now = chrono::Local::now();
                    let cur_h = now.hour() as u8;
                    let cur_m = now.minute() as u8;
                    let target_h = CHECK_IN_HOUR.load(Ordering::Relaxed);
                    let target_m = CHECK_IN_MINUTE.load(Ordering::Relaxed);
                    let cur_total = (cur_h as u32) * 60 + cur_m as u32;
                    let last = last_fired_minute.unwrap_or(u32::MAX);
                    if cur_h == target_h && cur_m == target_m && last != cur_total {
                        last_fired_minute = Some(cur_total);
                        let _ = app_handle.emit("check-in-trigger", ());
                    }
                }
            });

            // @group GlobalShortcut : Register Ctrl+Shift+Space to toggle recording
            use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
            let ctrl_shift_space = Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::SHIFT),
                Code::Space,
            );
            let app_handle2 = app.handle().clone();
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |_app, shortcut, event| {
                        if shortcut == &ctrl_shift_space && event.state() == ShortcutState::Pressed {
                            let _ = app_handle2.emit("global-shortcut-record", ());
                        }
                    })
                    .build(),
            )?;
            app.global_shortcut().register(ctrl_shift_space)?;

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            transcribe_audio,
            generate_response,
            stop_audio,
            generate_response_streaming,
            generate_response_streaming_events,
            synthesize_speech,
            train_voice,
            get_voice_status,
            play_audio,
            stop_audio,
            fetch_lmstudio_models,
            db_connect,
            db_is_connected,
            db_list_conversations,
            db_get_conversation,
            db_create_conversation,
            db_save_message,
            db_delete_conversation,
            db_update_conversation_title,
            db_save_settings,
            db_get_settings,
            db_set_system_prompt,
            fetch_ollama_models,
            db_save_memory,
            db_get_all_memory,
            db_delete_memory,
            db_clear_all_memory,
            db_toggle_bookmark,
            db_get_bookmarked_messages,
            db_search_conversations,
            db_get_conversation_sentiments,
            write_file,
            set_vad_enabled,
            get_audio_level,
            check_whisper_installed,
            configure_check_in,
            db_save_check_in,
            db_get_check_ins,
            db_save_reflection,
            db_get_reflections,
            db_get_weekly_data,
            set_tone_context,
            set_memory_facts,
            sync_offline_queue,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
