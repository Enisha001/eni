import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { AppState, Settings, Persona } from './types';

// @group Personas : Built-in AI personas
export const BUILT_IN_PERSONAS: Persona[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Standard conversational assistant',
    systemPrompt: '',
  },
  {
    id: 'coach',
    name: 'Life Coach',
    description: 'Motivational and goal-focused',
    systemPrompt: 'You are a supportive and energetic life coach. Help the user clarify their goals, identify obstacles, build action plans, and stay accountable. Ask powerful questions. Be direct, encouraging, and practical.',
  },
  {
    id: 'socratic',
    name: 'Socratic Mentor',
    description: 'Helps you think by asking questions',
    systemPrompt: 'You are a Socratic mentor. Rather than giving answers, guide the user to their own insights through thoughtful, probing questions. Never lecture. Reflect their statements back as questions. Help them discover their own wisdom.',
  },
  {
    id: 'devil',
    name: "Devil's Advocate",
    description: 'Challenges your ideas constructively',
    systemPrompt: "You are a thoughtful devil's advocate. Respectfully but firmly challenge the user's assumptions, point out blind spots, and offer counter-arguments to strengthen their thinking. Be intellectually rigorous without being dismissive.",
  },
  {
    id: 'therapist',
    name: 'Reflective Listener',
    description: 'Empathetic and non-judgmental',
    systemPrompt: 'You are a warm, empathetic listener using reflective listening techniques. Acknowledge feelings, validate experiences, and help the user explore their emotions without judgment. Never advise unless asked. Create a safe space to be heard.',
  },
];

const defaultSettings: Settings = {
  provider: 'anthropic',
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4o',
  azureModel: 'gpt-4',
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3',
  lmstudioEndpoint: 'http://localhost:1234',
  lmstudioModel: '',
  voiceCloned: false,
  useFastTTS: false,
  ttsProvider: 'coqui',
  kokoroEndpoint: 'http://localhost:8880',
  kokoroVoice: 'af_sky',
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      messages: [],
      settings: defaultSettings,
      isRecording: false,
      isProcessing: false,
      isSpeaking: false,
      statusText: 'Ready',
      darkMode: false,
      conversations: [],
      activeConversationId: null,

      addMessage: (message) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              ...message,
              id: crypto.randomUUID(),
              timestamp: new Date(),
            },
          ],
        })),

      updateMessage: (id, updates) =>
        set((state) => ({
          messages: state.messages.map((m) => m.id === id ? { ...m, ...updates } : m),
        })),

      updateSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      setRecording: (isRecording) => set({ isRecording }),
      setProcessing: (isProcessing) => set({ isProcessing }),
      setSpeaking: (isSpeaking) => set({ isSpeaking }),
      setStatusText: (statusText) => set({ statusText }),
      clearMessages: () => set({ messages: [] }),
      setDarkMode: (darkMode) => set({ darkMode }),
      setConversations: (conversations) => set({ conversations }),
      setActiveConversationId: (activeConversationId) => set({ activeConversationId }),
    }),
    {      name: 'antarman-storage',
      storage: createJSONStorage(() => localStorage),
      // @group Migration : Only mongoUri (for auto-connect) and darkMode (UI pref) live in localStorage.
      // All other settings and messages are stored in MongoDB.
      partialize: (state) => ({
        mongoUri: state.settings.mongoUri,
        darkMode: state.darkMode,
      }),
      // Custom merge: re-map the flattened persisted shape back into the store structure.
      merge: (persisted: unknown, current: AppState): AppState => {
        const p = persisted as { mongoUri?: string; darkMode?: boolean };
        return {
          ...current,
          darkMode: p.darkMode ?? false,
          settings: {
            ...current.settings,
            mongoUri: p.mongoUri ?? current.settings.mongoUri,
          },
        };
      },
    }
  )
);
