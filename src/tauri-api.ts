import { invoke } from '@tauri-apps/api/core';

export interface RecordingResult {
  audioPath: string;
  duration: number;
}

export interface TranscriptionResult {
  text: string;
}

export interface AIResponse {
  text: string;
}

export interface TTSResult {
  audioPath: string;
  audioChunks: string[];
}

// Audio Recording
export async function startRecording(): Promise<void> {
  return invoke('start_recording');
}

export async function stopRecording(): Promise<RecordingResult> {
  return invoke('stop_recording');
}

// Speech-to-Text
export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  return invoke('transcribe_audio', { audioPath });
}

// @group Types : Conversation history entry passed to all AI calls
export interface ChatMessage {
  role: string;
  content: string;
}

// AI Generation
export async function generateResponse(
  prompt: string,
  provider: string,
  apiKey: string,
  endpoint?: string,
  model?: string,
  history?: Array<{ role: string; content: string }>
): Promise<AIResponse> {
  return invoke('generate_response', { prompt, provider, apiKey, endpoint, model, history });
}

export async function generateResponseStreaming(
  prompt: string,
  provider: string,
  apiKey: string,
  endpoint?: string,
  model?: string,
  history?: Array<{ role: string; content: string }>
): Promise<string[]> {
  return invoke('generate_response_streaming', { prompt, provider, apiKey, endpoint, model, history });
}

export async function generateResponseStreamingEvents(
  prompt: string,
  provider: string,
  apiKey: string,
  endpoint?: string,
  model?: string,
  history?: Array<{ role: string; content: string }>
): Promise<void> {
  return invoke('generate_response_streaming_events', { prompt, provider, apiKey, endpoint, model, history });
}

// Text-to-Speech
export async function synthesizeSpeech(
  text: string,
  voiceSamplePath?: string,
  useFastTTS?: boolean,
  ttsProvider?: string,
  kokoroEndpoint?: string,
  kokoroVoice?: string,
): Promise<TTSResult> {
  return invoke('synthesize_speech', {
    text,
    voiceSamplePath,
    useFastTTS: !!useFastTTS,
    ttsProvider,
    kokoroEndpoint,
    kokoroVoice,
  });
}

// Voice Training
export async function trainVoice(audioPath: string): Promise<void> {
  return invoke('train_voice', { audioPath });
}

export interface VoiceStatus {
  trained: boolean;
  samplePath?: string;
}

export async function getVoiceStatus(): Promise<VoiceStatus> {
  return invoke('get_voice_status');
}

// Play Audio
export async function playAudio(audioPath: string): Promise<void> {
  return invoke('play_audio', { audioPath });
}

export async function stopAudio(): Promise<void> {
  return invoke('stop_audio');
}

// @group LMStudio : Fetch model list via Rust to bypass CORS
export async function fetchLmstudioModels(endpoint: string): Promise<string[]> {
  return invoke('fetch_lmstudio_models', { endpoint });
}

// @group DatabaseOperations : MongoDB conversation history

import type { Conversation, ConversationWithMessages } from './types';

export async function dbConnect(uri: string): Promise<void> {
  return invoke('db_connect', { uri });
}

export async function dbIsConnected(): Promise<boolean> {
  return invoke('db_is_connected');
}

export async function dbListConversations(): Promise<Conversation[]> {
  return invoke('db_list_conversations');
}

export async function dbGetConversation(id: string): Promise<ConversationWithMessages> {
  return invoke('db_get_conversation', { id });
}

export async function dbCreateConversation(title: string): Promise<string> {
  return invoke('db_create_conversation', { title });
}

export async function dbSaveMessage(conversationId: string, role: string, content: string): Promise<string> {
  return invoke('db_save_message', { conversationId, role, content });
}

export async function dbDeleteConversation(id: string): Promise<void> {
  return invoke('db_delete_conversation', { id });
}

export async function dbUpdateConversationTitle(id: string, title: string): Promise<void> {
  return invoke('db_update_conversation_title', { id, title });
}

// @group Settings : Persist and load app settings from MongoDB (replaces localStorage for sensitive data)

export interface DbAppSettings {
  provider?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  azureApiKey?: string;
  azureEndpoint?: string;
  azureModel?: string;
  ollamaEndpoint?: string;
  ollamaModel?: string;
  lmstudioEndpoint?: string;
  lmstudioModel?: string;
  voiceCloned?: boolean;
  voiceSamplePath?: string;
  useFastTts?: boolean;
  ttsProvider?: string;
  kokoroEndpoint?: string;
  kokoroVoice?: string;
  systemPrompt?: string;
}

export async function dbSaveSettings(settings: DbAppSettings): Promise<void> {
  return invoke('db_save_settings', { settings });
}

export async function dbGetSettings(): Promise<DbAppSettings | null> {
  return invoke('db_get_settings');
}

/// Push a runtime system prompt override to the Rust AI client.
export async function dbSetSystemPrompt(prompt: string | null): Promise<void> {
  return invoke('db_set_system_prompt', { prompt });
}

// @group OllamaModels : Fetch available models from Ollama via Tauri (bypasses CORS)
export async function fetchOllamaModels(endpoint: string): Promise<string[]> {
  return invoke('fetch_ollama_models', { endpoint });
}

// @group UserMemory : CRUD for persistent user memory facts (per-persona scoped)
export async function dbSaveMemory(key: string, value: string, personaId?: string): Promise<void> {
  return invoke('db_save_memory', { key, value, personaId });
}

export async function dbGetAllMemory(personaId?: string): Promise<import('./types').UserMemoryFact[]> {
  return invoke('db_get_all_memory', { personaId });
}

export async function dbDeleteMemory(key: string, personaId?: string): Promise<void> {
  return invoke('db_delete_memory', { key, personaId });
}

export async function dbClearAllMemory(personaId?: string): Promise<void> {
  return invoke('db_clear_all_memory', { personaId });
}

// @group Bookmarks : Toggle and retrieve starred messages
export async function dbToggleBookmark(messageId: string): Promise<boolean> {
  return invoke('db_toggle_bookmark', { messageId });
}

export async function dbGetBookmarkedMessages(): Promise<import('./types').BookmarkedMessage[]> {
  return invoke('db_get_bookmarked_messages');
}

// @group Search : Full-text conversation search
export async function dbSearchConversations(query: string): Promise<import('./types').Conversation[]> {
  return invoke('db_search_conversations', { query });
}

// @group Sentiment : Mood scores for a conversation
export async function dbGetConversationSentiments(conversationId: string): Promise<number[]> {
  return invoke('db_get_conversation_sentiments', { conversationId });
}

// @group Export : Write file to disk via Rust
export async function writeFile(path: string, content: string): Promise<void> {
  return invoke('write_file', { path, content });
}

// @group VAD : Configure voice activity detection
export async function setVadEnabled(enabled: boolean, silenceMs: number): Promise<void> {
  return invoke('set_vad_enabled', { enabled, silenceMs });
}

// @group VAD : Get current RMS audio level for calibration meter (0.0 – 1.0)
export async function getAudioLevel(): Promise<number> {
  return invoke('get_audio_level');
}

// @group STT : Check whether whisper.cpp binary is available on this machine
export async function checkWhisperInstalled(): Promise<boolean> {
  return invoke('check_whisper_installed');
}

// @group WeeklyReflection : Save, retrieve, and aggregate weekly data
export async function dbSaveReflection(reflection: import('./types').Reflection): Promise<string> {
  return invoke('db_save_reflection', { reflection });
}

export async function dbGetReflections(limit: number = 10): Promise<import('./types').Reflection[]> {
  return invoke('db_get_reflections', { limit });
}

export async function dbGetWeeklyData(weekStartMs: number): Promise<import('./types').WeeklyData> {
  return invoke('db_get_weekly_data', { weekStartMs });
}

// @group CheckIn : Structured daily check-in journaling
export async function dbSaveCheckIn(checkIn: import('./types').CheckIn): Promise<string> {
  return invoke('db_save_check_in', { checkIn });
}

export async function dbGetCheckIns(limit: number = 30): Promise<import('./types').CheckIn[]> {
  return invoke('db_get_check_ins', { limit });
}

// @group CheckIn : Configure daily check-in scheduler
export async function configureCheckIn(enabled: boolean, hour: number, minute: number): Promise<void> {
  return invoke('configure_check_in', { enabled, hour, minute });
}

// @group ToneMirroring : Update the AI's real-time tone context based on detected sentiment
export async function setToneContext(tone: string | null): Promise<void> {
  return invoke('set_tone_context', { tone });
}

// @group OfflineFallback : Flush locally queued offline messages to MongoDB
export async function syncOfflineQueue(): Promise<void> {
  return invoke('sync_offline_queue');
}

// @group MemoryInjection : Sync memory facts to Rust AI client
export async function setMemoryFacts(facts: string[]): Promise<void> {
  return invoke('set_memory_facts', { facts });
}
