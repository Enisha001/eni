import { useState, useEffect, useRef } from 'react';
import { Mic, Send, MessageSquare, Square, Moon, Sun, Minus, Maximize2, Minimize2, X } from 'lucide-react';
import { useStore, BUILT_IN_PERSONAS } from './store';
import {
  startRecording,
  stopRecording,
  transcribeAudio,
  generateResponseStreamingEvents,
  generateResponse,
  synthesizeSpeech,
  playAudio,
  stopAudio,
  dbConnect,
  dbIsConnected,
  dbListConversations,
  dbGetConversation,
  dbCreateConversation,
  dbSaveMessage,
  dbGetSettings,
  dbSaveSettings,
  dbSetSystemPrompt,
  dbGetAllMemory,
  dbToggleBookmark,
  dbGetConversationSentiments,
  dbSaveMemory,
  setMemoryFacts,
  setToneContext,
  configureCheckIn,
  setVadEnabled,
  checkWhisperInstalled,
  syncOfflineQueue,
  type ChatMessage,
  type DbAppSettings,
} from './tauri-api';
import { listen } from '@tauri-apps/api/event';
import AppSidebar from './components/AppSidebar';
import MessageList from './components/MessageList';
import VoiceVisualizer from './components/VoiceVisualizer';
import SettingsPanel from './components/SettingsPanel';
import CheckInBanner from './components/CheckInBanner';
import WhisperSetupWizard from './components/WhisperSetupWizard';
import MemorySuggestionBanner, { type MemorySuggestion } from './components/MemorySuggestionBanner';
import AuthScreen from './components/AuthScreen';
import { getCurrentWindow } from '@tauri-apps/api/window';

function App() {
  const {
    messages,
    settings,
    isRecording,
    isProcessing,
    isSpeaking,
    darkMode,
    activeConversationId,
    addMessage,
    updateMessage,
    updateSettings,
    setRecording,
    setProcessing,
    setSpeaking,
    setStatusText,
    clearMessages,
    setDarkMode,
    setConversations,
    setActiveConversationId,
  } = useStore();

  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [useTextMode, setUseTextMode] = useState(false);
  const [authedUser, setAuthedUser] = useState<{ name: string; email: string } | null>(null);
  // cancelRequestedRef used in async closures to avoid stale state reads
  const cancelRequestedRef = useRef(false);
  // ttsSessionRef increments each time a new TTS session starts — stale sessions compare and bail out
  const ttsSessionRef = useRef(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // @group SpeakingState : Track what the TTS is reading right now
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  // @group CheckIn : Daily check-in banner visibility
  const [showCheckIn, setShowCheckIn] = useState(false);
  // @group WhisperWizard : Show setup wizard when whisper.cpp is not found on first run
  const [showWhisperWizard, setShowWhisperWizard] = useState(false);
  // @group OfflineFallback : Show offline indicator when writes are being queued locally
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);
  // @group Sentiment : Mood scores for the active conversation
  const [sentimentScores, setSentimentScores] = useState<number[]>([]);
  // @group AutoMemory : Suggested memory fact detected from conversation
  const [memorySuggestion, setMemorySuggestion] = useState<MemorySuggestion | null>(null);

  // @group Effects : Window chrome
  useEffect(() => {
    const appWindow = getCurrentWindow();
    appWindow.isMaximized().then(setIsMaximized);
    let unlisten: (() => void) | undefined;
    appWindow.listen('tauri://resize', async () => {
      setIsMaximized(await appWindow.isMaximized());
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // @group Effects : Auto-connect MongoDB, migrate settings, and load conversations on startup
  useEffect(() => {
    const init = async () => {
      if (!settings.mongoUri?.trim()) return;
      try {
        const already = await dbIsConnected();
        if (!already) await dbConnect(settings.mongoUri);

        // @group OfflineFallback : Flush any offline-queued writes now that we're connected
        syncOfflineQueue().then(() => setIsOfflineQueued(false)).catch(() => {});

        // @group Migration : Load settings from DB, or save current in-memory ones (first run)
        const dbSettings = await dbGetSettings();
        if (dbSettings) {
          // DB has settings — merge into store (overwrites any localStorage remnants)
          const mapped: Partial<typeof settings> = {
            provider: dbSettings.provider as typeof settings.provider ?? settings.provider,
            anthropicApiKey: dbSettings.anthropicApiKey,
            anthropicModel: dbSettings.anthropicModel,
            openaiApiKey: dbSettings.openaiApiKey,
            openaiModel: dbSettings.openaiModel,
            azureApiKey: dbSettings.azureApiKey,
            azureEndpoint: dbSettings.azureEndpoint,
            azureModel: dbSettings.azureModel,
            ollamaEndpoint: dbSettings.ollamaEndpoint,
            ollamaModel: dbSettings.ollamaModel,
            lmstudioEndpoint: dbSettings.lmstudioEndpoint,
            lmstudioModel: dbSettings.lmstudioModel,
            voiceCloned: dbSettings.voiceCloned ?? false,
            voiceSamplePath: dbSettings.voiceSamplePath,
            useFastTTS: dbSettings.useFastTts,
            ttsProvider: dbSettings.ttsProvider as typeof settings.ttsProvider,
            kokoroEndpoint: dbSettings.kokoroEndpoint,
            kokoroVoice: dbSettings.kokoroVoice,
            systemPrompt: dbSettings.systemPrompt,
          };
          updateSettings(mapped);
          // Push system prompt to Rust runtime
          if (dbSettings.systemPrompt) await dbSetSystemPrompt(dbSettings.systemPrompt);
        } else {
          // No settings in DB yet — this is the first run after migration.
          // Save current in-memory settings (which may be hydrated from old localStorage) to DB.
          const toMigrate: DbAppSettings = {
            provider: settings.provider,
            anthropicApiKey: settings.anthropicApiKey,
            anthropicModel: settings.anthropicModel,
            openaiApiKey: settings.openaiApiKey,
            openaiModel: settings.openaiModel,
            azureApiKey: settings.azureApiKey,
            azureEndpoint: settings.azureEndpoint,
            azureModel: settings.azureModel,
            ollamaEndpoint: settings.ollamaEndpoint,
            ollamaModel: settings.ollamaModel,
            lmstudioEndpoint: settings.lmstudioEndpoint,
            lmstudioModel: settings.lmstudioModel,
            voiceCloned: settings.voiceCloned,
            voiceSamplePath: settings.voiceSamplePath,
            useFastTts: settings.useFastTTS,
            ttsProvider: settings.ttsProvider,
            kokoroEndpoint: settings.kokoroEndpoint,
            kokoroVoice: settings.kokoroVoice,
            systemPrompt: settings.systemPrompt,
          };
          await dbSaveSettings(toMigrate);
          if (settings.systemPrompt) await dbSetSystemPrompt(settings.systemPrompt);
          // Sanitize localStorage: overwrite with new minimal format so sensitive keys are gone.
          const minimalState = JSON.stringify({ mongoUri: settings.mongoUri, darkMode });
          window.localStorage.setItem('antarman-storage', minimalState);
        }

        const convs = await dbListConversations();
        setConversations(convs);

        // @group MemoryInit : Load user memory facts (scoped to active persona)
        try {
          const personaId = settings.activePersonaId ?? 'default';
          const facts = await dbGetAllMemory(personaId);
          await setMemoryFacts(facts.map(f => `${f.key}: ${f.value}`));
        } catch { /* memory collection may not exist yet */ }

      } catch (e) {
        console.warn('[DB] Auto-connect failed:', e);
      }

      // @group WhisperWizard : Check whisper on startup — show wizard if not found
      const whisperOk = await checkWhisperInstalled().catch(() => false);
      const dismissed = sessionStorage.getItem('whisper-wizard-dismissed') === '1';
      if (!whisperOk && !dismissed) setShowWhisperWizard(true);
    };
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // @group GlobalShortcut : Listen for Ctrl+Shift+Space push-to-talk event from Rust
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('global-shortcut-record', async () => {
      const focused = await getCurrentWindow().isFocused();
      if (!focused) return;
      handleVoiceInput();
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecording, isProcessing, isSpeaking]);

  // @group CheckInTrigger : Show daily check-in banner when backend fires the event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('check-in-trigger', () => {
      setShowCheckIn(true);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // @group OfflineFallback : Show offline badge when backend queues a write to SQLite
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('offline-write-queued', () => {
      setIsOfflineQueued(true);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // @group VADSync : Push VAD settings to Rust whenever they change
  useEffect(() => {
    setVadEnabled(settings.vadEnabled ?? false, settings.vadSilenceMs ?? 1500).catch(() => {});
  }, [settings.vadEnabled, settings.vadSilenceMs]);

  // @group CheckInSync : Push check-in schedule to Rust whenever settings change
  useEffect(() => {
    configureCheckIn(
      settings.checkInEnabled ?? false,
      settings.checkInHour ?? 9,
      settings.checkInMinute ?? 0,
    ).catch(() => {});
  }, [settings.checkInEnabled, settings.checkInHour, settings.checkInMinute]);

  // @group Sentiment : Reload mood scores whenever the active conversation changes
  useEffect(() => {
    if (!activeConversationId) { setSentimentScores([]); return; }
    dbGetConversationSentiments(activeConversationId)
      .then(setSentimentScores)
      .catch(() => setSentimentScores([]));
  }, [activeConversationId]);

  // @group PersonaSync : Push persona system prompt to Rust — generates handoff summary if mid-conversation
  const prevPersonaIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const personaId = settings.activePersonaId ?? 'default';
    const persona = BUILT_IN_PERSONAS.find(p => p.id === personaId);
    const prompt = persona && persona.systemPrompt ? persona.systemPrompt : (settings.systemPrompt ?? null);

    const prevId = prevPersonaIdRef.current;
    prevPersonaIdRef.current = personaId;

    // Handoff summary: only when persona actually changed and there are messages to summarise
    if (prevId !== undefined && prevId !== personaId && messages.length > 0) {
      const prevPersona = BUILT_IN_PERSONAS.find(p => p.id === prevId);
      const snippetMsgs = messages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
      const handoffPrompt = `Summarise this conversation in one brief sentence so the next assistant can pick up context:\n\n${snippetMsgs}`;
      const effectiveProvider = (settings.offlineMode && settings.offlineProvider) ? settings.offlineProvider : settings.provider;
      const apiKey = effectiveProvider === 'anthropic' ? (settings.anthropicApiKey ?? '') : effectiveProvider === 'openai' ? (settings.openaiApiKey ?? '') : (settings.azureApiKey ?? '');
      const model = effectiveProvider === 'anthropic' ? settings.anthropicModel : effectiveProvider === 'openai' ? settings.openaiModel : settings.azureModel;
      generateResponse(handoffPrompt, effectiveProvider, apiKey, undefined, model)
        .then((res) => {
          const label = prevPersona ? prevPersona.name : 'Previous persona';
          return addAndPersist('assistant', `[Handoff from ${label}] ${res.text}`);
        })
        .catch(() => {/* non-critical */});
    }

    dbSetSystemPrompt(prompt).catch(() => {});

    // Reload persona-scoped memory facts for the new persona
    dbGetAllMemory(personaId)
      .then((facts) => setMemoryFacts(facts.map(f => `${f.key}: ${f.value}`)))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.activePersonaId]);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  // @group DatabaseOperations : Ensure an active conversation exists before saving
  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    const id = await dbCreateConversation('New Conversation');
    setActiveConversationId(id);
    const convs = await dbListConversations();
    setConversations(convs);
    return id;
  };

  // Fix 12: surfaces DB errors as a brief dismissible banner instead of silently swallowing them
  const addAndPersist = async (role: 'user' | 'assistant', content: string, audioUrl?: string) => {
    const localMsg = { role, content, ...(audioUrl ? { audioUrl } : {}) };
    addMessage(localMsg);
    // Grab the ID the store just assigned (last in the messages array)
    try {
      const convId = await ensureConversation();
      const dbId = await dbSaveMessage(convId, role, content);
      // Associate the DB-assigned id with the in-memory message (using content match)
      const state = useStore.getState();
      const match = [...state.messages].reverse().find(m => m.role === role && m.content === content);
      if (match && dbId) updateMessage(match.id, { dbId });
      const convs = await dbListConversations();
      setConversations(convs);
      // Refresh sentiment chart and update tone context after each user message
      if (role === 'user') {
        dbGetConversationSentiments(convId).then((scores) => {
          setSentimentScores(scores);
          // @group ToneMirroring : Map latest sentiment to a tone instruction for the AI
          if (scores.length > 0) {
            const latest = scores[scores.length - 1];
            const tone = latest < -0.2
              ? 'The user seems to be going through a difficult time. Respond with extra empathy, warmth, and gentleness.'
              : latest > 0.2
              ? 'The user seems upbeat and positive. Match their energy with warmth and enthusiasm.'
              : null;
            setToneContext(tone).catch(() => {});
          }
        }).catch(() => {});
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[DB] Failed to persist message:', msg);
      setError(`Warning: message not saved to database — ${msg}`);
      setTimeout(() => setError(prev => prev?.startsWith('Warning:') ? null : prev), 6000);
    }
  };

  // @group AutoMemory : After each assistant response, probe AI for a memorable fact about the user
  const probeForMemory = (recentMessages: { role: string; content: string }[]) => {
    if (!settings.memoryEnabled) return;
    const snippet = recentMessages.slice(-6).map(m => `${m.role}: ${m.content}`).join('\n');
    const effectiveProvider = (settings.offlineMode && settings.offlineProvider) ? settings.offlineProvider : settings.provider;
    const apiKey = effectiveProvider === 'anthropic' ? (settings.anthropicApiKey ?? '') : effectiveProvider === 'openai' ? (settings.openaiApiKey ?? '') : (settings.azureApiKey ?? '');
    const model = effectiveProvider === 'anthropic' ? settings.anthropicModel : effectiveProvider === 'openai' ? settings.openaiModel : settings.azureModel;
    generateResponse(
      `Analyse this conversation snippet. If there is ONE concrete, specific, memorable fact about the user (their preferences, life situation, name, goals, etc.) that would be worth remembering for future conversations, return it as: key: value\n\nOtherwise return exactly: none\n\nConversation:\n${snippet}`,
      effectiveProvider, apiKey, undefined, model,
    ).then((res) => {
      const raw = res.text.trim();
      if (raw === 'none' || !raw.includes(':')) return;
      const colonIdx = raw.indexOf(':');
      const key = raw.slice(0, colonIdx).trim();
      const value = raw.slice(colonIdx + 1).trim();
      if (key && value) setMemorySuggestion({ key, value });
    }).catch(() => {/* non-critical */});
  };

  // @group AIGeneration : Build history snapshot from current messages for multi-turn context
  // Fix 1: history is now sent with every AI call
  const buildHistory = (): ChatMessage[] =>
    messages.map(m => ({ role: m.role as string, content: m.content }));

  // @group AIGeneration : Shared streaming TTS pipeline
  // Fix 1 (history passed), Fix 2 (ai-complete used for totalSentences), Fix 8 (voice uses same pipeline)
  const processMessage = async (userMessage: string, history: ChatMessage[]) => {
    // Cancel any previously running TTS session (stale playNext / runTtsWorker callbacks will see mismatched ID and bail)
    const sessionId = ++ttsSessionRef.current;
    try { await stopAudio(); } catch { /* ignore */ }

    // @group OfflineMode : Override provider when offline mode is on
    const effectiveProvider = (settings.offlineMode && settings.offlineProvider)
      ? settings.offlineProvider
      : settings.provider;

    const apiKey =
      effectiveProvider === 'anthropic' ? settings.anthropicApiKey :
      effectiveProvider === 'openai'    ? settings.openaiApiKey :
      effectiveProvider === 'ollama'    ? '' :
      effectiveProvider === 'lmstudio'  ? '' :
      settings.azureApiKey;

    const endpoint =
      effectiveProvider === 'azure'     ? settings.azureEndpoint :
      effectiveProvider === 'ollama'    ? (settings.ollamaEndpoint || 'http://localhost:11434') :
      effectiveProvider === 'lmstudio'  ? (settings.lmstudioEndpoint || 'http://localhost:1234') :
      undefined;

    const model =
      effectiveProvider === 'anthropic' ? settings.anthropicModel :
      effectiveProvider === 'openai'    ? settings.openaiModel :
      effectiveProvider === 'azure'     ? settings.azureModel :
      effectiveProvider === 'ollama'    ? settings.ollamaModel :
      effectiveProvider === 'lmstudio'  ? settings.lmstudioModel :
      undefined;

    if (effectiveProvider !== 'ollama' && effectiveProvider !== 'lmstudio' && !apiKey) {
      throw new Error(`Please configure ${effectiveProvider} API key in settings`);
    }

    setStatusText('Getting AI response (streaming with TTS)...');

    const isFast = settings.useFastTTS;
    // When Kokoro is selected, voice cloning path is irrelevant — pass undefined
    const ttsProvider = settings.ttsProvider ?? 'coqui';
    const voicePathToUse = (ttsProvider === 'kokoro' || isFast) ? undefined : settings.voiceSamplePath;
    const kokoroEndpoint = settings.kokoroEndpoint;
    const kokoroVoice = settings.kokoroVoice;

    const audioQueue: { index: number; audioPaths: string[]; sentence: string }[] = [];
    let nextToPlay = 0;
    let isPlaying = false;
    let totalSentences = 0;    // Fix 2: set by ai-complete event, not is_final
    let streamComplete = false;
    const fullTextParts: string[] = [];

    setSpeaking(true);
    setStreamingMessage('');

    // @group AudioPlayback : Play queued sentences in order — bail if session is superseded
    const playNext = async () => {
      if (ttsSessionRef.current !== sessionId || cancelRequestedRef.current) {
        setSpeaking(false);
        setProcessing(false);
        setSpeakingText(null);
        setStatusText('Stopped');
        return;
      }
      if (isPlaying) return;

      const nextAudio = audioQueue.find(item => item.index === nextToPlay);
      if (nextAudio) {
        isPlaying = true;
        setSpeakingText(nextAudio.sentence);
        setStatusText(`Playing part ${nextToPlay + 1}${totalSentences ? `/${totalSentences}` : ''}...`);
        for (const path of nextAudio.audioPaths) {
          if (cancelRequestedRef.current || ttsSessionRef.current !== sessionId) break;
          try {
            await playAudio(path);
          } catch (playErr) {
            console.error(`[AUDIO] Playback failed for sentence ${nextToPlay}:`, playErr);
          }
        }
        nextToPlay++;
        isPlaying = false;
        playNext();
      }
    };

    // @group TTSProcessing : Serial TTS worker — synthesises one sentence at a time
    const ttsPendingQueue: { sentence: string; index: number }[] = [];
    let ttsWorkerRunning = false;

    const runTtsWorker = async () => {
      if (ttsWorkerRunning) return;
      ttsWorkerRunning = true;
      while (ttsPendingQueue.length > 0 && !cancelRequestedRef.current && ttsSessionRef.current === sessionId) {
        const item = ttsPendingQueue.shift()!;
        setStatusText(`Generating voice for part ${item.index + 1}...`);
        try {
          const result = await synthesizeSpeech(item.sentence, voicePathToUse, isFast, ttsProvider, kokoroEndpoint, kokoroVoice);
          if (!cancelRequestedRef.current && ttsSessionRef.current === sessionId) {
            const allPaths = [result.audioPath, ...(result.audioChunks ?? [])];
            audioQueue.push({ index: item.index, audioPaths: allPaths, sentence: item.sentence });
            audioQueue.sort((a, b) => a.index - b.index);
            playNext();
          }
        } catch (ttsErr) {
          console.error(`[STREAM] TTS failed for sentence ${item.index}:`, ttsErr);
        }
      }
      ttsWorkerRunning = false;
    };

    const sentenceUnlisten = await listen<{ sentence: string; index: number; is_final: boolean }>(
      'ai-sentence',
      async (event) => {
        const { sentence, index } = event.payload;
        fullTextParts[index] = sentence;
        // Build live streaming bubble sentence by sentence
        setStreamingMessage(fullTextParts.filter(Boolean).join(' '));
        if (cancelRequestedRef.current) return;
        ttsPendingQueue.push({ sentence, index });
        runTtsWorker();
      }
    );

    // Fix 2: ai-complete carries total_sentences — this is the authoritative signal that all
    // sentences have been emitted, regardless of whether the last one had is_final=true.
    const completeUnlisten = await listen<{ total_sentences: number }>(
      'ai-complete',
      (event) => {
        totalSentences = event.payload.total_sentences;
        streamComplete = true;
        playNext(); // trigger in case playNext was waiting for this info
      }
    );

    try {
      await generateResponseStreamingEvents(
        userMessage,
        effectiveProvider,
        apiKey || '',
        endpoint,
        model,
        history,  // Fix 1: conversation history
      );

      // Wait until stream is acknowledged complete AND all audio has finished playing
      const TIMEOUT_MS = 120_000;
      const started = Date.now();
      while (!cancelRequestedRef.current) {
        if (streamComplete && nextToPlay >= totalSentences && !isPlaying) break;
        if (Date.now() - started > TIMEOUT_MS) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      const fullText = fullTextParts.join(' ');
      if (fullText.trim()) {
        await addAndPersist('assistant', fullText);
        // Background memory probe — does not block response
        probeForMemory([...useStore.getState().messages]);
      }
    } finally {
      sentenceUnlisten();
      completeUnlisten();
      setSpeakingText(null);
      setStreamingMessage('');
      setSpeaking(false);
      setProcessing(false);
      setStatusText('Ready');
    }
  };

  // @group InputHandling : Voice mode — record → transcribe → streaming pipeline
  // Fix 8: voice mode now uses processMessage (same streaming TTS pipeline as text mode)
  const handleVoiceInput = async () => {
    try {
      setError(null);
      cancelRequestedRef.current = false;

      if (isRecording) {
        setRecording(false);
        setProcessing(true);

        const recordingResult = await stopRecording();
        const transcription = await transcribeAudio(recordingResult.audioPath);

        // Snapshot history BEFORE adding the new user message so we don't include it in context
        const history = buildHistory();
        await addAndPersist('user', transcription.text, recordingResult.audioPath);

        await processMessage(transcription.text, history);
      } else {
        await startRecording();
        setRecording(true);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const whisperInstallIssue = /whisper (executable|binary|model) not found|whisper\.cpp is not installed/i.test(errorMsg);
      if (whisperInstallIssue) {
        setError('Speech-to-text is not ready yet. Whisper.cpp or its model is missing on this machine. Use text input mode for now.');
        setUseTextMode(true);
      } else if (errorMsg.toLowerCase().includes('whisper')) {
        setError(`Speech-to-text failed: ${errorMsg}`);
        setUseTextMode(true);
      } else {
        setError(errorMsg);
      }
      setRecording(false);
      setProcessing(false);
      setSpeaking(false);
    }
  };

  // @group InputHandling : Text mode — type → streaming pipeline
  const handleTextSubmit = async () => {
    if (!textInput.trim() || isProcessing) return;
    try {
      setError(null);
      setProcessing(true);
      cancelRequestedRef.current = false;
      setStatusText('Sending...');

      // Snapshot history BEFORE adding the new user message
      const history = buildHistory();
      await addAndPersist('user', textInput);
      const userMessage = textInput;
      setTextInput('');

      await processMessage(userMessage, history);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProcessing(false);
      setSpeaking(false);
      setStatusText('Ready');
    }
  };

  const handleStop = async () => {
    cancelRequestedRef.current = true;
    try { await stopAudio(); } catch { /* ignore */ }
    setRecording(false);
    setSpeaking(false);
    setProcessing(false);
    setSpeakingText(null);
    setPlayingMessageId(null);
    setStatusText('Stopped');
    setError(null);
  };

  // @group AudioPlayback : Replay a previously completed assistant message — serial TTS then play
  const handlePlayMessage = async (id: string, text: string) => {
    if (isProcessing) return;

    const sessionId = ++ttsSessionRef.current;
    cancelRequestedRef.current = false;
    try { await stopAudio(); } catch { /* ignore */ }
    setSpeaking(false);
    setSpeakingText(null);
    setPlayingMessageId(null);

    setPlayingMessageId(id);
    setSpeaking(true);
    setStatusText('Replaying...');

    const ttsProvider = settings.ttsProvider ?? 'coqui';
    const isFast = settings.useFastTTS;
    const voicePath = (ttsProvider === 'kokoro' || isFast) ? undefined : settings.voiceSamplePath;
    const kokoroEndpoint = settings.kokoroEndpoint;
    const kokoroVoice = settings.kokoroVoice;
    const sentences = splitIntoSentences(text);

    try {
      // Synthesise then immediately play each sentence in order (no parallel blasting the TTS server)
      for (let index = 0; index < sentences.length; index++) {
        if (cancelRequestedRef.current || ttsSessionRef.current !== sessionId) break;
        const sentence = sentences[index];
        setStatusText(`Generating voice for part ${index + 1}/${sentences.length}...`);
        try {
          const result = await synthesizeSpeech(sentence, voicePath, isFast, ttsProvider, kokoroEndpoint, kokoroVoice);
          if (cancelRequestedRef.current || ttsSessionRef.current !== sessionId) break;
          setSpeakingText(sentence);
          for (const path of [result.audioPath, ...(result.audioChunks ?? [])]) {
            if (cancelRequestedRef.current || ttsSessionRef.current !== sessionId) break;
            try { await playAudio(path); } catch (playErr) {
              console.error(`[REPLAY] Playback failed for sentence ${index}:`, playErr);
            }
          }
        } catch (err) {
          console.error(`[REPLAY] TTS failed for sentence ${index}:`, err);
        }
      }
    } finally {
      setSpeakingText(null);
      setPlayingMessageId(null);
      setSpeaking(false);
      setStatusText('Ready');
    }
  };

  // @group Utilities : Split text into TTS-sized sentences on the frontend
  const splitIntoSentences = (text: string): string[] => {
    const results: string[] = [];
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      buf += text[i];
      const ch = text[i];
      const next = text[i + 1];
      if ((ch === '.' || ch === '!' || ch === '?') &&
          (!next || next === ' ' || next === '"' || next === '\n' || next === '\r')) {
        const s = buf.trim();
        if (s.length > 5) results.push(s);
        buf = '';
      }
    }
    const remaining = buf.trim();
    if (remaining.length > 0) results.push(remaining);
    return results.length > 0 ? results : [text.trim()];
  };

  // @group Bookmarks : Toggle a message bookmark in DB and update in-memory state
  const handleToggleBookmark = async (messageId: string, dbId: string) => {
    try {
      const nowBookmarked = await dbToggleBookmark(dbId);
      updateMessage(messageId, { bookmarked: nowBookmarked });
    } catch (e) {
      console.warn('[DB] Bookmark toggle failed:', e);
    }
  };

  // @group Bookmarks : Load a conversation by ID (used from BookmarksPane)
  const handleLoadConversation = async (convId: string) => {
    try {
      const full = await dbGetConversation(convId);
      setShowSettings(false);
      clearMessages();
      setActiveConversationId(convId);
      full.messages.forEach((m) => addMessage({ role: m.role as 'user' | 'assistant', content: m.content }));
    } catch (e) {
      console.warn('[App] handleLoadConversation failed:', e);
    }
  };

  const isDisabled = isProcessing || isSpeaking;

  if (!authedUser) {
    return <AuthScreen darkMode={darkMode} onAuthenticated={setAuthedUser} />;
  }

  return (
    <div className={`h-screen p-2.5 ${darkMode ? 'bg-[radial-gradient(circle_at_top,#331d25_0%,#1a1013_38%,#110b0d_100%)] text-gray-100' : 'bg-[radial-gradient(circle_at_top,#fffdfd_0%,#f8f1f3_32%,#f1e8ea_100%)] text-[#2d151b]'}`}>
      <div className={`relative h-full overflow-hidden rounded-[22px] border shadow-[0_18px_50px_rgba(64,29,37,0.10)] backdrop-blur-xl ${darkMode ? 'border-[#3a252d] bg-[#171113]/85' : 'border-[#f0dfe4] bg-[rgba(255,255,255,0.74)]'}`}>

      {/* @group WhisperWizard : First-run STT setup overlay */}
      {showWhisperWizard && (
        <WhisperSetupWizard
          darkMode={darkMode}
          onDismiss={() => {
            sessionStorage.setItem('whisper-wizard-dismissed', '1');
            setShowWhisperWizard(false);
          }}
        />
      )}

      {/* @group CheckInOverlay : Daily check-in banner */}
      {showCheckIn && (
        <CheckInBanner
          darkMode={darkMode}
          onDismiss={() => setShowCheckIn(false)}
          onStart={() => {
            setShowCheckIn(false);
            handleVoiceInput();
          }}
          onGenerateReflection={async (answersText: string) => {
            const effectiveProvider = (settings.offlineMode && settings.offlineProvider) ? settings.offlineProvider : settings.provider;
            const apiKey = effectiveProvider === 'anthropic' ? (settings.anthropicApiKey ?? '') : effectiveProvider === 'openai' ? (settings.openaiApiKey ?? '') : (settings.azureApiKey ?? '');
            const model = effectiveProvider === 'anthropic' ? settings.anthropicModel : effectiveProvider === 'openai' ? settings.openaiModel : settings.azureModel;
            const res = await generateResponse(
              `You are a compassionate journaling assistant. The user has completed their daily check-in. Write a warm, brief (2-3 sentence) personal reflection based on their answers. Do not use lists or headers.\n\n${answersText}`,
              effectiveProvider, apiKey, undefined, model,
            );
            return res.text;
          }}
        />
      )}

      {/* @group Titlebar : Custom Windows titlebar */}
      <header className={`relative flex items-center h-11 border-b select-none shrink-0 px-2.5 ${darkMode ? 'border-[#362329] bg-[#1a1115]/80' : 'border-[#f0dde2] bg-white/70'}`}>
        <div data-tauri-drag-region className="flex-1 h-full flex items-center px-3 cursor-default gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[linear-gradient(135deg,#d8879a_0%,#7c2d3a_100%)] shadow-sm shrink-0" />
          <span className={`text-[11px] font-semibold tracking-[0.16em] uppercase ${darkMode ? 'text-gray-200' : 'text-[#5b1f2e]'}`}>Antarman</span>
          {/* @group OfflineFallback : Offline indicator badge */}
          {isOfflineQueued && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${darkMode ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-700/40' : 'bg-yellow-100 text-yellow-700 border border-yellow-300'}`}>
              Offline
            </span>
          )}
        </div>

        {/* @group AudioWaveform : Centered waveform indicator while TTS is playing */}
        {isSpeaking && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
            <div className="flex items-end gap-[3px] h-4">
              {[0, 1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className={`wavebar ${darkMode ? 'bg-blue-400' : 'bg-blue-500'}`}
                  style={{ height: '100%', animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center h-full">
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`px-2.5 h-full flex items-center rounded-md transition-colors ${darkMode ? 'hover:bg-[#2d1d24] text-gray-400 hover:text-white' : 'hover:bg-[#f7edf0] text-[#7f5863] hover:text-[#5b1f2e]'}`}
            title={darkMode ? 'Light mode' : 'Dark mode'}
          >
            {darkMode ? <Sun size={12} /> : <Moon size={12} />}
          </button>
          <div className={`w-px h-3.5 ${darkMode ? 'bg-[#3a1d27]' : 'bg-[#eadfe3]'}`} />
          <button onClick={handleMinimize} className={`w-8 h-8 my-auto flex items-center justify-center rounded-md transition-colors ${darkMode ? 'hover:bg-[#2d1d24] text-gray-400 hover:text-white' : 'hover:bg-[#f7edf0] text-[#7f5863] hover:text-[#5b1f2e]'}`} title="Minimize"><Minus size={12} /></button>
          <button onClick={handleMaximize} className={`w-8 h-8 my-auto flex items-center justify-center rounded-md transition-colors ${darkMode ? 'hover:bg-[#2d1d24] text-gray-400 hover:text-white' : 'hover:bg-[#f7edf0] text-[#7f5863] hover:text-[#5b1f2e]'}`} title={isMaximized ? 'Restore' : 'Maximize'}>{isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
          <button onClick={handleClose} className={`w-8 h-8 my-auto flex items-center justify-center rounded-md transition-colors hover:bg-[#8f2d43] hover:text-white ${darkMode ? 'text-gray-400' : 'text-[#7f5863]'}`} title="Close"><X size={12} /></button>
        </div>
      </header>

      {/* @group MainLayout : Sidebar + Chat area */}
      <div className="flex-1 flex overflow-hidden p-1.5 pb-0">

        <AppSidebar
          darkMode={darkMode}
          settingsOpen={showSettings}
          onSettingsClick={() => setShowSettings(s => !s)}
          onLoadMessages={(msgs) => {
            setShowSettings(false);
            clearMessages();
            msgs.forEach((m) => addMessage({ role: m.role, content: m.content }));
          }}
          onLoadConversation={handleLoadConversation}
          onGenerateReflection={async (weekData) => {
            const effectiveProvider = (settings.offlineMode && settings.offlineProvider) ? settings.offlineProvider : settings.provider;
            const apiKey = effectiveProvider === 'anthropic' ? (settings.anthropicApiKey ?? '') : effectiveProvider === 'openai' ? (settings.openaiApiKey ?? '') : (settings.azureApiKey ?? '');
            const model = effectiveProvider === 'anthropic' ? settings.anthropicModel : effectiveProvider === 'openai' ? settings.openaiModel : settings.azureModel;
            const prompt = `You are a compassionate journal assistant. Write a warm, personal weekly reflection (3–4 sentences) for someone based on their activity this week.\n\nStats: ${weekData.conversationCount} conversations, ${weekData.messageCount} messages, ${weekData.checkInCount} check-ins. Average mood score: ${weekData.avgSentiment.toFixed(2)} (scale -1 to 1).\n\n${weekData.checkInSummaries.length > 0 ? 'Check-in highlights:\n' + weekData.checkInSummaries.slice(0, 3).join('\n') : 'No check-ins this week.'}\n\nWrite a brief, encouraging reflection. No lists, no headers.`;
            const res = await generateResponse(prompt, effectiveProvider, apiKey, undefined, model);
            return res.text;
          }}
        />

        {showSettings ? (
          <div className={`flex-1 overflow-y-auto ${darkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
            <SettingsPanel darkMode={darkMode} />
          </div>
        ) : (
        <div className="flex-1 flex flex-col overflow-hidden">

          <MessageList
            messages={messages}
            darkMode={darkMode}
            streamingMessage={streamingMessage || undefined}
            speakingText={speakingText}
            playingMessageId={playingMessageId}
            onPlayMessage={handlePlayMessage}
            onStopMessage={handleStop}
            onToggleBookmark={handleToggleBookmark}
            sentimentScores={sentimentScores}
          />

          {/* @group AutoMemory : Memory suggestion banner above input */}
          {memorySuggestion && (
            <MemorySuggestionBanner
              suggestion={memorySuggestion}
              darkMode={darkMode}
              onAccept={async () => {
                const pid = settings.activePersonaId ?? 'default';
                await dbSaveMemory(memorySuggestion.key, memorySuggestion.value, pid).catch(() => {});
                // Refresh memory facts in AI context
                const facts = await dbGetAllMemory(pid).catch(() => []);
                await setMemoryFacts(facts.map(f => `${f.key}: ${f.value}`)).catch(() => {});
                setMemorySuggestion(null);
              }}
              onDismiss={() => setMemorySuggestion(null)}
            />
          )}

          {/* @group InputArea : Voice orb or text input + mode toggle */}
          <div className={`shrink-0 border-t px-5 pt-4 pb-5 ${darkMode ? 'border-[#402a31] bg-[#171113]/90' : 'border-[#f1e2e6] bg-[rgba(255,255,255,0.62)] backdrop-blur-xl'}`}>

            {/* Error / warning banner */}
            {error && (
              <div className={`mb-3 px-3 py-2 rounded-lg text-xs border flex items-center justify-between gap-2 ${
                error.startsWith('Warning:')
                  ? darkMode ? 'bg-yellow-900/20 border-yellow-800/50 text-yellow-300' : 'bg-yellow-50 border-yellow-200 text-yellow-700'
                  : darkMode ? 'bg-red-900/20 border-red-800/50 text-red-300' : 'bg-red-50 border-red-200 text-red-600'
              }`}>
                <span>{error}</span>
                <button onClick={() => setError(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
              </div>
            )}

            {/* @group SpeakingCaption : Current TTS sentence displayed as subtitle */}
            {speakingText && (
              <div className="caption-enter mb-2 px-4 text-center">
                <span className={`text-xs italic leading-relaxed ${darkMode ? 'text-[#f3bfd1]' : 'text-[#7c2d3a]'}`}>
                  &ldquo;{speakingText}&rdquo;
                </span>
              </div>
            )}

            {!useTextMode && (
              <div className="flex flex-col items-center gap-3 mb-3">
                <VoiceVisualizer
                  isRecording={isRecording}
                  isProcessing={isProcessing}
                  isSpeaking={isSpeaking}
                  darkMode={darkMode}
                  onClick={handleVoiceInput}
                  disabled={isDisabled}
                />
                {(isRecording || isProcessing || isSpeaking) && (
                  <button
                    onClick={handleStop}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      isSpeaking
                        ? darkMode
                          ? 'bg-emerald-900/40 hover:bg-red-900/50 text-emerald-400 hover:text-red-400 border border-emerald-700/50 hover:border-red-700/50'
                          : 'bg-emerald-50 hover:bg-red-50 text-emerald-700 hover:text-red-600 border border-emerald-200 hover:border-red-200'
                        : darkMode
                        ? 'bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/40'
                        : 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200'
                    }`}
                  >
                    <Square size={10} fill="currentColor" />
                    {isSpeaking ? 'Stop playback' : 'Stop'}
                  </button>
                )}
              </div>
            )}

            {useTextMode && (
              <div className="flex gap-2.5 mb-3 items-center">
                <input
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isProcessing && handleTextSubmit()}
                  placeholder="Type your message..."
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-3 rounded-2xl text-sm shadow-inner transition-all focus:outline-none focus:ring-2 focus:ring-[#d8879a]/60 disabled:opacity-50 border ${darkMode ? 'bg-[#22181d] text-gray-100 border-[#3d2a32] placeholder-gray-500' : 'bg-white/90 text-gray-900 border-[#f0dfe6] placeholder-gray-400 shadow-[inset_0_1px_0_rgba(124,45,58,0.04)]'}`}
                />
                <button
                  onClick={handleTextSubmit}
                  disabled={isProcessing || !textInput.trim()}
                  className="h-11 w-11 rounded-2xl bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] hover:bg-[linear-gradient(135deg,#9d3a4e_0%,#632336_100%)] text-white shadow-[0_10px_25px_rgba(124,45,58,0.24)] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150 hover:-translate-y-0.5"
                >
                  <Send size={16} className="mx-auto" />
                </button>
                {(isProcessing || isSpeaking) && (
                  <button onClick={handleStop} className="h-11 w-11 rounded-2xl bg-[linear-gradient(135deg,#c25659_0%,#9b2d3d_100%)] hover:bg-[linear-gradient(135deg,#d66068_0%,#a63348_100%)] text-white shadow-[0_10px_25px_rgba(155,45,61,0.22)] transition-all duration-150 hover:-translate-y-0.5">
                    <Square size={14} fill="white" className="mx-auto" />
                  </button>
                )}
              </div>
            )}

            <div className="flex justify-center">
              <button
                onClick={() => setUseTextMode(!useTextMode)}
                className={`flex items-center gap-1.5 text-xs transition-colors ${darkMode ? 'text-gray-600 hover:text-gray-400' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {useTextMode ? <Mic size={11} /> : <MessageSquare size={11} />}
                {useTextMode ? 'Switch to voice' : 'Switch to text'}
              </button>
            </div>

          </div>
        </div>
        )}
      </div>
      </div>
    </div>
  );
}

export default App;
