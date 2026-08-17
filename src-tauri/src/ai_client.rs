use anyhow::Result;
use serde::{Deserialize, Serialize};
use reqwest::Client;
use std::sync::Mutex;
use tauri::{Emitter, Window};
use once_cell::sync::Lazy;

// @group Configuration : Shared HTTP client — reuses connection pool and TLS sessions across all AI calls
static HTTP_CLIENT: Lazy<Client> = Lazy::new(Client::new);

// @group Configuration : Runtime-configurable system prompt (default used when no override is set)
static SYSTEM_PROMPT_OVERRIDE: Mutex<Option<String>> = Mutex::new(None);
// @group MemoryInjection : Facts about the user injected into every AI call
static MEMORY_FACTS: Mutex<Vec<String>> = Mutex::new(Vec::new());
// @group ToneMirroring : Current detected emotional tone appended to the effective system prompt
static TONE_CONTEXT: Mutex<Option<String>> = Mutex::new(None);

pub fn set_system_prompt(prompt: Option<String>) {
    *SYSTEM_PROMPT_OVERRIDE.lock().unwrap() = prompt;
}

pub fn set_memory_facts(facts: Vec<String>) {
    *MEMORY_FACTS.lock().unwrap() = facts;
}

pub fn set_tone_context(tone: Option<String>) {
    *TONE_CONTEXT.lock().unwrap() = tone;
}

/// Returns the active system prompt — user override if set, otherwise the built-in default.
/// Memory facts and tone context are appended when present.
fn effective_system_prompt() -> String {
    let base = SYSTEM_PROMPT_OVERRIDE
        .lock()
        .unwrap()
        .clone()
        .unwrap_or_else(|| VOICE_SYSTEM_PROMPT.to_string());
    let facts = MEMORY_FACTS.lock().unwrap().clone();
    let tone = TONE_CONTEXT.lock().unwrap().clone();

    let mut prompt = if facts.is_empty() {
        base
    } else {
        format!(
            "{}\n\nThings I know about you:\n{}",
            base,
            facts.iter().map(|f| format!("- {}", f)).collect::<Vec<_>>().join("\n")
        )
    };

    // @group ToneMirroring : Append real-time emotional tone instruction
    if let Some(t) = tone {
        prompt.push_str(&format!("\n\n{}", t));
    }

    prompt
}

// @group Configuration : Built-in default system prompt
const VOICE_SYSTEM_PROMPT: &str = "\
You are a helpful voice assistant. \
Always respond in natural, conversational spoken English — the kind of language a person uses in a phone call or face-to-face chat, never in a written document. \
Strict rules:\
\n- No markdown whatsoever: no asterisks, no hashtags, no bullet points, no numbered lists, no underscores, no backticks, no hyphens used as list markers.\
\n- No headers or section titles.\
\n- Spell out all symbols and abbreviations in words (say \"percent\" not \"%\", \"and\" not \"&\", \"dollars\" not \"$\").\
\n- Use natural contractions (it's, you're, I'll, that's, don't, can't).\
\n- When you need to list items, weave them into sentences using words like \"first\", \"then\", \"next\", and \"finally\".\
\n- Keep sentences short and clear so they are easy to listen to.\
\n- Never open with hollow filler phrases like \"Certainly!\", \"Absolutely!\", \"Great question!\", or \"Of course!\".\
\n- Respond directly, warmly, and naturally — like a knowledgeable friend talking to you.";

#[derive(Debug, Serialize, Deserialize)]
pub struct AIResponse {
    pub text: String,
}

// @group Types : Chat message for multi-turn conversation history
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// @group Types : Tauri event payloads
#[derive(Clone, Serialize)]
struct SentenceEvent {
    sentence: String,
    index: usize,
    is_final: bool,
}

#[derive(Clone, Serialize)]
struct CompleteEvent {
    total_sentences: usize,
}

// ─────────────────────────────────────────────────────────────────────────────
// @group TextProcessing : Helpers shared by all streaming paths
// ─────────────────────────────────────────────────────────────────────────────

/// Strip residual markdown so TTS receives clean plain text even if the model slips.
fn strip_markdown_for_tts(text: &str) -> String {
    let mut out = text.to_string();
    // Bold / italic markers
    out = out.replace("**", "").replace("__", "").replace('*', "").replace('_', " ");
    // ATX headers (#, ##, ###, …)
    let lines: Vec<String> = out.lines().map(|l| {
        let trimmed = l.trim_start_matches('#').trim_start();
        trimmed.to_string()
    }).collect();
    out = lines.join(" ");
    // Horizontal rules
    out = out.replace("---", "").replace("***", "").replace("___", "");
    // Blockquotes
    out = out.replace('>', "");
    // Inline code + code fences
    out = out.replace('`', "");
    // Em-dash, en-dash → natural pause (comma)
    out = out.replace('\u{2014}', ",").replace('\u{2013}', ",");
    // Bullet list markers at start of token (- item, • item)
    let words: Vec<&str> = out.split_whitespace().collect();
    let cleaned: Vec<&str> = words.into_iter().filter(|w| *w != "-" && *w != "\u{2022}").collect();
    cleaned.join(" ")
}

/// Split text into sentences. O(n), handles multi-byte Unicode correctly.
fn split_into_sentences(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut sentences = Vec::new();
    let mut seg_start = 0;
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '.' || c == '!' || c == '?' {
            let next = chars.get(i + 1).copied();
            if next.map_or(true, |nc| nc.is_whitespace()) {
                let sentence: String = chars[seg_start..=i].iter().collect();
                let trimmed = sentence.trim().to_string();
                if trimmed.len() > 10 {
                    sentences.push(trimmed);
                    let mut ns = i + 1;
                    while ns < chars.len() && chars[ns].is_whitespace() { ns += 1; }
                    seg_start = ns;
                    i = ns;
                    continue;
                }
            }
        }
        i += 1;
    }

    if seg_start < chars.len() {
        let remaining: String = chars[seg_start..].iter().collect();
        let trimmed = remaining.trim().to_string();
        if !trimmed.is_empty() { sentences.push(trimmed); }
    }
    sentences
}

/// Scan `buffer` for complete sentence boundaries and drain them into a Vec.
/// Any incomplete trailing text stays in `buffer`.
fn extract_sentences_from_buffer(buffer: &mut String, min_len: usize) -> Vec<String> {
    let chars: Vec<char> = buffer.chars().collect();
    let mut sentences = Vec::new();
    let mut seg_start = 0;
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        if c == '.' || c == '!' || c == '?' {
            let next = chars.get(i + 1).copied();
            let at_boundary = next.map_or(false, |nc| {
                nc == ' ' || nc == '\n' || nc == '"' || nc == '\''
            });
            if at_boundary {
                let sentence: String = chars[seg_start..=i].iter().collect();
                let trimmed = sentence.trim().to_string();
                if trimmed.len() >= min_len {
                    sentences.push(trimmed);
                    let mut ns = i + 1;
                    while ns < chars.len() && (chars[ns] == ' ' || chars[ns] == '\n') { ns += 1; }
                    seg_start = ns;
                    i = ns;
                    continue;
                }
            }
        }
        i += 1;
    }

    *buffer = if seg_start < chars.len() {
        chars[seg_start..].iter().collect()
    } else {
        String::new()
    };
    sentences
}

// ─────────────────────────────────────────────────────────────────────────────
// @group AIGeneration : Non-streaming (single-shot) response
// ─────────────────────────────────────────────────────────────────────────────

pub async fn generate_response(
    prompt: &str,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    history: &[ChatMessage],
) -> Result<AIResponse> {
    match provider {
        "anthropic" => generate_anthropic_response(prompt, api_key, model.unwrap_or("claude-sonnet-4-6"), history).await,
        "openai"    => generate_openai_response(prompt, api_key, model.unwrap_or("gpt-4o"), history).await,
        "azure" => {
            let ep = endpoint.ok_or_else(|| anyhow::anyhow!("Azure endpoint required"))?;
            generate_azure_response(prompt, api_key, ep, model.unwrap_or("gpt-4"), history).await
        }
        "ollama" => {
            let ep = endpoint.unwrap_or("http://localhost:11434");
            generate_ollama_response(prompt, model.unwrap_or("llama3"), ep, history).await
        }
        "lmstudio" => {
            let ep = endpoint.unwrap_or("http://localhost:1234");
            generate_lmstudio_response(prompt, model.unwrap_or("local-model"), ep, history).await
        }
        _ => Err(anyhow::anyhow!("Unknown provider: {}", provider)),
    }
}

async fn generate_anthropic_response(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage]) -> Result<AIResponse> {
    #[derive(Serialize)]
    struct Req { model: String, max_tokens: u32, system: String, messages: Vec<Msg> }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Resp { content: Vec<Content> }
    #[derive(Deserialize)]
    struct Content { text: String }

    let mut messages: Vec<Msg> = history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }).collect();
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let response = HTTP_CLIENT
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, system: effective_system_prompt(), messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Anthropic API error: {}", response.text().await?));
    }
    let resp: Resp = response.json().await?;
    Ok(AIResponse { text: resp.content.first().map(|c| c.text.clone()).unwrap_or_default() })
}

async fn generate_openai_response(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage]) -> Result<AIResponse> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32 }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Resp { choices: Vec<Choice> }
    #[derive(Deserialize)]
    struct Choice { message: MsgContent }
    #[derive(Deserialize)]
    struct MsgContent { content: String }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let response = HTTP_CLIENT
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("OpenAI API error: {}", response.text().await?));
    }
    let resp: Resp = response.json().await?;
    Ok(AIResponse { text: resp.choices.first().map(|c| c.message.content.clone()).unwrap_or_default() })
}

async fn generate_azure_response(prompt: &str, api_key: &str, endpoint: &str, model: &str, history: &[ChatMessage]) -> Result<AIResponse> {
    #[derive(Serialize)]
    struct Req { messages: Vec<Msg>, max_tokens: u32 }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Resp { choices: Vec<Choice> }
    #[derive(Deserialize)]
    struct Choice { message: MsgContent }
    #[derive(Deserialize)]
    struct MsgContent { content: String }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/openai/deployments/{}/chat/completions?api-version=2023-05-15", endpoint.trim_end_matches('/'), model);

    let response = HTTP_CLIENT
        .post(&url)
        .header("api-key", api_key)
        .header("content-type", "application/json")
        .json(&Req { max_tokens: 4096, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Azure API error: {}", response.text().await?));
    }
    let resp: Resp = response.json().await?;
    Ok(AIResponse { text: resp.choices.first().map(|c| c.message.content.clone()).unwrap_or_default() })
}

// @group LMStudio : LM Studio local provider (OpenAI-compatible, non-streaming)
async fn generate_lmstudio_response(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage]) -> Result<AIResponse> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32 }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Resp { choices: Vec<Choice> }
    #[derive(Deserialize)]
    struct Choice { message: MsgContent }
    #[derive(Deserialize)]
    struct MsgContent { content: String }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));

    let response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, messages })
        .send().await
        .map_err(|e| anyhow::anyhow!("LM Studio request failed: {e} — is LM Studio running at {endpoint}?"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("LM Studio API error: {}", response.text().await?));
    }
    let resp: Resp = response.json().await?;
    Ok(AIResponse { text: resp.choices.first().map(|c| c.message.content.clone()).unwrap_or_default() })
}

// @group Ollama : Local Ollama provider (non-streaming)
async fn generate_ollama_response(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage]) -> Result<AIResponse> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, stream: bool }
    #[derive(Serialize, Deserialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Resp { message: Msg }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));

    let response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), messages, stream: false })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Ollama API error: {}", response.text().await?));
    }
    let resp: Resp = response.json().await?;
    Ok(AIResponse { text: resp.message.content })
}

// ─────────────────────────────────────────────────────────────────────────────
// @group AIGeneration : Batch streaming (returns Vec<String> of sentences)
// ─────────────────────────────────────────────────────────────────────────────

pub async fn generate_response_streaming(
    prompt: &str,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    history: &[ChatMessage],
) -> Result<Vec<String>> {
    match provider {
        "openai"    => generate_openai_streaming_real(prompt, api_key, model.unwrap_or("gpt-4o"), history).await,
        "anthropic" => generate_anthropic_streaming_real(prompt, api_key, model.unwrap_or("claude-sonnet-4-6"), history).await,
        "ollama" => {
            let ep = endpoint.unwrap_or("http://localhost:11434");
            let resp = generate_ollama_response(prompt, model.unwrap_or("llama3"), ep, history).await?;
            Ok(split_into_sentences(&resp.text))
        }
        "lmstudio" => {
            let ep = endpoint.unwrap_or("http://localhost:1234");
            generate_lmstudio_streaming_real(prompt, model.unwrap_or("local-model"), ep, history).await
        }
        _ => {
            let resp = generate_response(prompt, provider, api_key, endpoint, model, history).await?;
            Ok(split_into_sentences(&resp.text))
        }
    }
}

async fn generate_openai_streaming_real(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage]) -> Result<Vec<String>> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamResp { choices: Vec<StreamChoice> }
    #[derive(Deserialize)]
    struct StreamChoice { delta: Delta }
    #[derive(Deserialize)]
    struct Delta { content: Option<String> }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let mut response = HTTP_CLIENT
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, stream: true, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("OpenAI API error: {}", response.text().await?));
    }

    let mut sentences = Vec::new();
    let mut buf = String::new();

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { break; }
                if let Ok(sr) = serde_json::from_str::<StreamResp>(data) {
                    if let Some(content) = sr.choices.first().and_then(|c| c.delta.content.as_deref()) {
                        buf.push_str(content);
                        sentences.extend(extract_sentences_from_buffer(&mut buf, 10));
                    }
                }
            }
        }
    }
    if !buf.trim().is_empty() { sentences.push(buf.trim().to_string()); }
    Ok(sentences)
}

async fn generate_anthropic_streaming_real(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage]) -> Result<Vec<String>> {
    #[derive(Serialize)]
    struct Req { model: String, max_tokens: u32, system: String, messages: Vec<Msg>, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamEvent { #[serde(rename = "type")] event_type: String, delta: Option<Delta> }
    #[derive(Deserialize)]
    struct Delta { text: Option<String> }

    let mut messages: Vec<Msg> = history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }).collect();
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let mut response = HTTP_CLIENT
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, system: effective_system_prompt(), stream: true, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Anthropic API error: {}", response.text().await?));
    }

    let mut sentences = Vec::new();
    let mut buf = String::new();

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(ev) = serde_json::from_str::<StreamEvent>(data) {
                    if ev.event_type == "content_block_delta" {
                        if let Some(text) = ev.delta.and_then(|d| d.text) {
                            buf.push_str(&text);
                            sentences.extend(extract_sentences_from_buffer(&mut buf, 10));
                        }
                    }
                }
            }
        }
    }
    if !buf.trim().is_empty() { sentences.push(buf.trim().to_string()); }
    Ok(sentences)
}

// @group Ollama : Ollama batch streaming (NDJSON)
async fn generate_ollama_streaming_real(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage]) -> Result<Vec<String>> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Chunk { message: MsgContent, done: bool }
    #[derive(Deserialize)]
    struct MsgContent { content: String }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));

    let mut response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), messages, stream: true })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Ollama API error: {}", response.text().await?));
    }

    let mut sentences = Vec::new();
    let mut buf = String::new();

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<Chunk>(line) {
                buf.push_str(&parsed.message.content);
                sentences.extend(extract_sentences_from_buffer(&mut buf, 10));
                if parsed.done { break; }
            }
        }
    }
    if !buf.trim().is_empty() { sentences.push(buf.trim().to_string()); }
    Ok(sentences)
}

// @group LMStudio : LM Studio batch streaming (OpenAI SSE format)
async fn generate_lmstudio_streaming_real(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage]) -> Result<Vec<String>> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamResp { choices: Vec<StreamChoice> }
    #[derive(Deserialize)]
    struct StreamChoice { delta: Delta }
    #[derive(Deserialize)]
    struct Delta { content: Option<String> }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));

    let mut response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, stream: true, messages })
        .send().await
        .map_err(|e| anyhow::anyhow!("LM Studio request failed: {e} — is LM Studio running at {endpoint}?"))?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("LM Studio API error: {}", response.text().await?));
    }

    let mut sentences = Vec::new();
    let mut buf = String::new();

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { break; }
                if let Ok(sr) = serde_json::from_str::<StreamResp>(data) {
                    if let Some(content) = sr.choices.first().and_then(|c| c.delta.content.as_deref()) {
                        buf.push_str(content);
                        sentences.extend(extract_sentences_from_buffer(&mut buf, 10));
                    }
                }
            }
        }
    }
    if !buf.trim().is_empty() { sentences.push(buf.trim().to_string()); }
    Ok(sentences)
}

// ─────────────────────────────────────────────────────────────────────────────
// @group AIGeneration : Event-based streaming — emits sentences as they arrive
// ─────────────────────────────────────────────────────────────────────────────

pub async fn generate_response_streaming_events(
    prompt: &str,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
    model: Option<&str>,
    history: &[ChatMessage],
    window: Window,
) -> Result<()> {
    match provider {
        "openai"    => generate_openai_streaming_events(prompt, api_key, model.unwrap_or("gpt-4o"), history, window).await,
        "anthropic" => generate_anthropic_streaming_events(prompt, api_key, model.unwrap_or("claude-sonnet-4-6"), history, window).await,
        "ollama" => {
            let ep = endpoint.unwrap_or("http://localhost:11434");
            generate_ollama_streaming_events(prompt, model.unwrap_or("llama3"), ep, history, window).await
        }
        "lmstudio" => {
            let ep = endpoint.unwrap_or("http://localhost:1234");
            generate_lmstudio_streaming_events(prompt, model.unwrap_or("local-model"), ep, history, window).await
        }
        _ => {
            let resp = generate_response(prompt, provider, api_key, endpoint, model, history).await?;
            let sentences = split_into_sentences(&resp.text);
            let total = sentences.len();
            for (index, sentence) in sentences.iter().enumerate() {
                window.emit("ai-sentence", SentenceEvent {
                    sentence: strip_markdown_for_tts(sentence),
                    index,
                    is_final: index == total - 1,
                })?;
            }
            window.emit("ai-complete", CompleteEvent { total_sentences: total })?;
            Ok(())
        }
    }
}

async fn generate_openai_streaming_events(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage], window: Window) -> Result<()> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamResp { choices: Vec<StreamChoice> }
    #[derive(Deserialize)]
    struct StreamChoice { delta: Delta }
    #[derive(Deserialize)]
    struct Delta { content: Option<String> }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let mut response = HTTP_CLIENT
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, stream: true, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("OpenAI API error: {}", response.text().await?));
    }

    let mut buf = String::new();
    let mut sentence_index = 0usize;

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { break; }
                if let Ok(sr) = serde_json::from_str::<StreamResp>(data) {
                    if let Some(content) = sr.choices.first().and_then(|c| c.delta.content.as_deref()) {
                        buf.push_str(content);
                        for sentence in extract_sentences_from_buffer(&mut buf, 10) {
                            window.emit("ai-sentence", SentenceEvent {
                                sentence: strip_markdown_for_tts(&sentence),
                                index: sentence_index,
                                is_final: false,
                            })?;
                            sentence_index += 1;
                        }
                    }
                }
            }
        }
    }

    if !buf.trim().is_empty() {
        window.emit("ai-sentence", SentenceEvent {
            sentence: strip_markdown_for_tts(buf.trim()),
            index: sentence_index,
            is_final: true,
        })?;
        sentence_index += 1;
    }
    window.emit("ai-complete", CompleteEvent { total_sentences: sentence_index })?;
    Ok(())
}

async fn generate_anthropic_streaming_events(prompt: &str, api_key: &str, model: &str, history: &[ChatMessage], window: Window) -> Result<()> {
    #[derive(Serialize)]
    struct Req { model: String, max_tokens: u32, system: String, messages: Vec<Msg>, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamEvent { #[serde(rename = "type")] event_type: String, delta: Option<Delta> }
    #[derive(Deserialize)]
    struct Delta { text: Option<String> }

    let mut messages: Vec<Msg> = history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }).collect();
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let mut response = HTTP_CLIENT
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, system: effective_system_prompt(), stream: true, messages })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Anthropic API error: {}", response.text().await?));
    }

    let mut buf = String::new();
    let mut sentence_index = 0usize;

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(ev) = serde_json::from_str::<StreamEvent>(data) {
                    if ev.event_type == "content_block_delta" {
                        if let Some(text) = ev.delta.and_then(|d| d.text) {
                            buf.push_str(&text);
                            for sentence in extract_sentences_from_buffer(&mut buf, 10) {
                                window.emit("ai-sentence", SentenceEvent {
                                    sentence: strip_markdown_for_tts(&sentence),
                                    index: sentence_index,
                                    is_final: false,
                                })?;
                                sentence_index += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    if !buf.trim().is_empty() {
        window.emit("ai-sentence", SentenceEvent {
            sentence: strip_markdown_for_tts(buf.trim()),
            index: sentence_index,
            is_final: true,
        })?;
        sentence_index += 1;
    }
    window.emit("ai-complete", CompleteEvent { total_sentences: sentence_index })?;
    Ok(())
}

// @group LMStudio : LM Studio event-based streaming (OpenAI SSE format)
async fn generate_lmstudio_streaming_events(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage], window: Window) -> Result<()> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, max_tokens: u32, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct StreamResp { choices: Vec<StreamChoice> }
    #[derive(Deserialize)]
    struct StreamChoice { delta: Delta }
    #[derive(Deserialize)]
    struct Delta { content: Option<String> }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/v1/chat/completions", endpoint.trim_end_matches('/'));

    let mut response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), max_tokens: 4096, stream: true, messages })
        .send().await
        .map_err(|e| anyhow::anyhow!("LM Studio request failed: {e} — is LM Studio running at {endpoint}?"))?;;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("LM Studio API error: {}", response.text().await?));
    }

    let mut buf = String::new();
    let mut sentence_index = 0usize;

    while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { break; }
                if let Ok(sr) = serde_json::from_str::<StreamResp>(data) {
                    if let Some(content) = sr.choices.first().and_then(|c| c.delta.content.as_deref()) {
                        buf.push_str(content);
                        for sentence in extract_sentences_from_buffer(&mut buf, 10) {
                            window.emit("ai-sentence", SentenceEvent {
                                sentence: strip_markdown_for_tts(&sentence),
                                index: sentence_index,
                                is_final: false,
                            })?;
                            sentence_index += 1;
                        }
                    }
                }
            }
        }
    }

    if !buf.trim().is_empty() {
        window.emit("ai-sentence", SentenceEvent {
            sentence: strip_markdown_for_tts(buf.trim()),
            index: sentence_index,
            is_final: true,
        })?;
        sentence_index += 1;
    }
    window.emit("ai-complete", CompleteEvent { total_sentences: sentence_index })?;
    Ok(())
}

// @group Ollama : Ollama event-based streaming (NDJSON)
async fn generate_ollama_streaming_events(prompt: &str, model: &str, endpoint: &str, history: &[ChatMessage], window: Window) -> Result<()> {
    #[derive(Serialize)]
    struct Req { model: String, messages: Vec<Msg>, stream: bool }
    #[derive(Serialize)]
    struct Msg { role: String, content: String }
    #[derive(Deserialize)]
    struct Chunk { message: MsgContent, done: bool }
    #[derive(Deserialize)]
    struct MsgContent { content: String }

    let mut messages = vec![Msg { role: "system".into(), content: effective_system_prompt() }];
    messages.extend(history.iter().map(|m| Msg { role: m.role.clone(), content: m.content.clone() }));
    messages.push(Msg { role: "user".into(), content: prompt.into() });

    let url = format!("{}/api/chat", endpoint.trim_end_matches('/'));

    let mut response = HTTP_CLIENT
        .post(&url)
        .header("content-type", "application/json")
        .json(&Req { model: model.into(), messages, stream: true })
        .send().await?;

    if !response.status().is_success() {
        return Err(anyhow::anyhow!("Ollama API error: {}", response.text().await?));
    }

    let mut buf = String::new();
    let mut sentence_index = 0usize;

    'outer: while let Some(chunk) = response.chunk().await? {
        for line in String::from_utf8_lossy(&chunk).lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            if let Ok(parsed) = serde_json::from_str::<Chunk>(line) {
                buf.push_str(&parsed.message.content);
                for sentence in extract_sentences_from_buffer(&mut buf, 10) {
                    window.emit("ai-sentence", SentenceEvent {
                        sentence: strip_markdown_for_tts(&sentence),
                        index: sentence_index,
                        is_final: false,
                    })?;
                    sentence_index += 1;
                }
                if parsed.done { break 'outer; }
            }
        }
    }

    if !buf.trim().is_empty() {
        window.emit("ai-sentence", SentenceEvent {
            sentence: strip_markdown_for_tts(buf.trim()),
            index: sentence_index,
            is_final: true,
        })?;
        sentence_index += 1;
    }
    window.emit("ai-complete", CompleteEvent { total_sentences: sentence_index })?;
    Ok(())
}
