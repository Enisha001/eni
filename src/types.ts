export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  audioUrl?: string;
  // @group NewFeatures : DB-assigned ID and metadata
  dbId?: string;
  bookmarked?: boolean;
  sentiment?: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;  // Unix ms
  updatedAt: number;  // Unix ms
  messageCount: number;
}

export interface ConversationWithMessages {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<{ role: string; content: string; timestamp: number }>;
}

export type AIProvider = 'anthropic' | 'openai' | 'azure' | 'ollama' | 'lmstudio';

// @group Personas : Built-in AI personas with distinct system prompts
export interface Persona {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

// @group UserMemory : A single remembered fact about the user
export interface UserMemoryFact {
  key: string;
  value: string;
  updatedAt: number;
}

// @group Bookmarks : A bookmarked message with conversation context
export interface BookmarkedMessage {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  content: string;
  timestamp: number;
}

// @group WeeklyReflection : AI-generated weekly summary
export interface Reflection {
  id?: string;
  weekStartDate: string;
  generatedAt: number;
  summary: string;
  avgSentiment: number;
  conversationIds: string[];
  checkInCount: number;
}

export interface WeeklyData {
  weekStartDate: string;
  messageCount: number;
  avgSentiment: number;
  conversationCount: number;
  checkInCount: number;
  conversationIds: string[];
  checkInSummaries: string[];
}

// @group CheckIn : Structured daily check-in entry
export interface CheckInResponse {
  question: string;
  answer: string;
}

export interface CheckIn {
  id?: string;
  timestamp: number;
  date: string;
  responses: CheckInResponse[];
  aiReflection: string;
  sentimentScore: number;
}

export interface Settings {
  provider: AIProvider;
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
  voiceCloned: boolean;
  voiceSamplePath?: string;
  useFastTTS?: boolean;
  // @group TTSProvider : TTS backend selection
  ttsProvider?: 'coqui' | 'kokoro';
  kokoroEndpoint?: string;
  kokoroVoice?: string;
  mongoUri?: string;
  // @group SystemPrompt : User-configurable voice assistant persona
  systemPrompt?: string;
  // @group NewFeatures : Offline mode, VAD, check-in, personas, memory
  offlineMode?: boolean;
  offlineProvider?: 'ollama' | 'lmstudio';
  vadEnabled?: boolean;
  vadSilenceMs?: number;
  checkInEnabled?: boolean;
  checkInHour?: number;
  checkInMinute?: number;
  activePersonaId?: string;
  memoryEnabled?: boolean;
}

export interface AppState {
  messages: Message[];
  settings: Settings;
  isRecording: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  statusText: string;

  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  updateSettings: (settings: Partial<Settings>) => void;
  setRecording: (isRecording: boolean) => void;
  setProcessing: (isProcessing: boolean) => void;
  setSpeaking: (isSpeaking: boolean) => void;
  setStatusText: (statusText: string) => void;
  clearMessages: () => void;
  darkMode: boolean;
  setDarkMode: (dark: boolean) => void;

  // Conversation sidebar
  conversations: Conversation[];
  activeConversationId: string | null;
  setConversations: (convs: Conversation[]) => void;
  setActiveConversationId: (id: string | null) => void;
}
