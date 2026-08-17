// @group SettingsPanel : Full-page settings with section nav and styled cards
import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, Check, Mic, Square, Database, Key, Zap, Bot, Cpu, Wifi, Lock, ChevronRight, Circle, Volume2, RefreshCw, BrainCircuit, Download, Star, Plus, Trash2 } from 'lucide-react';
import { useStore, BUILT_IN_PERSONAS } from '../store';
import { AIProvider } from '../types';
import { trainVoice, getVoiceStatus, startRecording, stopRecording, dbConnect, dbIsConnected, fetchLmstudioModels, fetchOllamaModels as tauriFetchOllamaModels, dbSaveSettings, dbSetSystemPrompt, dbGetAllMemory, dbSaveMemory, dbDeleteMemory, dbClearAllMemory, setMemoryFacts, dbGetBookmarkedMessages, writeFile, getAudioLevel } from '../tauri-api';
import { open, save } from '@tauri-apps/plugin-dialog';
import type { UserMemoryFact, BookmarkedMessage } from '../types';

interface SettingsPanelProps {
  darkMode: boolean;
}

type Section = 'ai' | 'voice' | 'database' | 'personas' | 'memory' | 'schedule';

// @group SectionNav : Sidebar nav item
function NavItem({ label, icon, desc, active, darkMode, onClick }: {
  id: Section; label: string; icon: React.ReactNode; desc: string;
  active: boolean; darkMode: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all group ${
        active
          ? darkMode ? 'bg-[#2d1d24] border-r-2 border-[#d8879a]' : 'bg-[#f9edf0] border-r-2 border-[#7c2d3a]'
          : darkMode ? 'hover:bg-[#22161a]' : 'hover:bg-[#f9edf0]'
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
        active
          ? 'bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] text-white shadow-lg shadow-[#7c2d3a]/20'
          : darkMode ? 'bg-[#2d1d24] text-gray-400 group-hover:text-[#f7dce3]' : 'bg-[#f9edf0] text-[#8a6971] group-hover:text-[#5b1f2e]'
      }`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-medium ${active ? darkMode ? 'text-[#f7dce3]' : 'text-[#5b1f2e]' : darkMode ? 'text-gray-300' : 'text-[#4b2d35]'}`}>{label}</div>
        <div className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>{desc}</div>
      </div>
      {active && <ChevronRight size={14} className={`ml-auto ${darkMode ? 'text-blue-400' : 'text-blue-500'}`} />}
    </button>
  );
}

// @group FormField : Labeled input wrapper
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

// @group Card : Settings content card
function Card({ children, darkMode }: { children: React.ReactNode; darkMode: boolean }) {
  return (
    <div className={`rounded-xl border p-4 space-y-4 ${darkMode ? 'bg-gray-800/40 border-gray-700/50' : 'bg-white border-gray-200 shadow-sm'}`}>
      {children}
    </div>
  );
}

export default function SettingsPanel({ darkMode }: SettingsPanelProps) {
  const { settings, updateSettings } = useStore();
  const [section, setSection] = useState<Section>('ai');
  const [isTraining, setIsTraining] = useState(false);
  const [trainSuccess, setTrainSuccess] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingInterval, setRecordingInterval] = useState<number | null>(null);
  const [dbStatus, setDbStatus] = useState<'idle' | 'connecting' | 'ok' | 'error'>('idle');
  const [dbError, setDbError] = useState('');

  // @group MemoryState : User memory facts and bookmarked messages
  const [memoryFacts, setMemoryFactsState] = useState<UserMemoryFact[]>([]);
  const [bookmarkedMessages, setBookmarkedMessages] = useState<BookmarkedMessage[]>([]);
  const [newMemKey, setNewMemKey] = useState('');
  const [newMemValue, setNewMemValue] = useState('');
  const [memorySaved, setMemorySaved] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  // @group VADCalibration : Mic level meter state
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const micTestIntervalRef = useRef<number | null>(null);

  const loadMemoryAndBookmarks = useCallback(async () => {
    try {
      const facts = await dbGetAllMemory();
      setMemoryFactsState(facts);
      const bookmarks = await dbGetBookmarkedMessages();
      setBookmarkedMessages(bookmarks);
    } catch { /* not connected */ }
  }, []);

  // @group VADCalibration : Start mic test — poll RMS every 50ms
  const handleStartMicTest = async () => {
    try {
      await startRecording();
      setIsMicTesting(true);
      setMicLevel(0);
      micTestIntervalRef.current = window.setInterval(async () => {
        const level = await getAudioLevel();
        setMicLevel(level);
      }, 50);
    } catch (e) { console.warn('[MicTest] Start failed:', e); }
  };

  // @group VADCalibration : Stop mic test
  const handleStopMicTest = async () => {
    if (micTestIntervalRef.current !== null) {
      clearInterval(micTestIntervalRef.current);
      micTestIntervalRef.current = null;
    }
    setIsMicTesting(false);
    setMicLevel(0);
    try { await stopRecording(); } catch { /* ignore */ }
  };

  const handleAddMemory = async () => {
    if (!newMemKey.trim() || !newMemValue.trim()) return;
    try {
      await dbSaveMemory(newMemKey.trim(), newMemValue.trim());
      setNewMemKey(''); setNewMemValue('');
      setMemorySaved(true); setTimeout(() => setMemorySaved(false), 2000);
      const updated = await dbGetAllMemory();
      setMemoryFactsState(updated);
      await setMemoryFacts(updated.map(f => `${f.key}: ${f.value}`));
    } catch { /* not connected */ }
  };

  const handleDeleteMemory = async (key: string) => {
    try {
      await dbDeleteMemory(key);
      const updated = await dbGetAllMemory();
      setMemoryFactsState(updated);
      await setMemoryFacts(updated.map(f => `${f.key}: ${f.value}`));
    } catch { /* not connected */ }
  };

  const handleClearAllMemory = async () => {
    try {
      await dbClearAllMemory();
      setMemoryFactsState([]);
      await setMemoryFacts([]);
    } catch { /* not connected */ }
  };

  const handleExportBookmarks = async () => {
    try {
      setExportStatus('saving');
      const filePath = await save({ filters: [{ name: 'JSON', extensions: ['json'] }], defaultPath: 'bookmarks.json' });
      if (filePath) {
        await writeFile(filePath, JSON.stringify(bookmarkedMessages, null, 2));
        setExportStatus('done'); setTimeout(() => setExportStatus('idle'), 2500);
      } else {
        setExportStatus('idle');
      }
    } catch { setExportStatus('error'); setTimeout(() => setExportStatus('idle'), 2500); }
  };
  // @group OllamaModels : Live model list fetched from Ollama endpoint
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaFetchStatus, setOllamaFetchStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // @group LMStudioModels : Live model list fetched from LM Studio endpoint
  const [lmstudioModels, setLmstudioModels] = useState<string[]>([]);
  const [lmstudioFetchStatus, setLmstudioFetchStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');

  // @group LMStudioModels : Fetch available models via Tauri backend (bypasses CORS)
  const fetchLmstudioModelsFromServer = useCallback(async (endpoint?: string) => {
    const base = (endpoint ?? settings.lmstudioEndpoint ?? 'http://localhost:1234').trim().replace(/\/$/, '');
    setLmstudioFetchStatus('loading');
    try {
      const names = await fetchLmstudioModels(base);
      setLmstudioModels(names);
      setLmstudioFetchStatus('ok');
      if (names.length > 0 && !names.includes(settings.lmstudioModel || '')) {
        updateSettings({ lmstudioModel: names[0] });
      }
    } catch {
      setLmstudioModels([]);
      setLmstudioFetchStatus('error');
    }
  }, [settings.lmstudioEndpoint, settings.lmstudioModel, updateSettings]);

  // Fetch models when the LM Studio provider tab is visible
  useEffect(() => {
    if (section === 'ai' && settings.provider === 'lmstudio') {
      fetchLmstudioModelsFromServer();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, settings.provider]);

  // @group OllamaModels : Fetch available models from the running Ollama server via Tauri (bypasses CORS)
  const fetchOllamaModels = useCallback(async (endpoint?: string) => {
    const base = (endpoint ?? settings.ollamaEndpoint ?? 'http://localhost:11434').trim().replace(/\/$/, '');
    setOllamaFetchStatus('loading');
    try {
      const names = await tauriFetchOllamaModels(base);
      setOllamaModels(names);
      setOllamaFetchStatus('ok');
      // Auto-select first model if current selection is gone
      if (names.length > 0 && !names.includes(settings.ollamaModel || '')) {
        updateSettings({ ollamaModel: names[0] });
      }
    } catch {
      setOllamaModels([]);
      setOllamaFetchStatus('error');
    }
  }, [settings.ollamaEndpoint, settings.ollamaModel, updateSettings]);

  // Fetch models when the Ollama provider tab is visible
  useEffect(() => {
    if (section === 'ai' && settings.provider === 'ollama') {
      fetchOllamaModels();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, settings.provider]);

  // @group SettingsPersistence : Auto-save settings to MongoDB 500ms after any change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Skip saving on the first render (settings are being loaded, not changed by user)
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await dbSaveSettings({
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
        });
      } catch {
        // DB may not be connected yet — changes will be migrated on next successful connect
      }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // @group SystemPromptSync : Push systemPrompt to Rust runtime whenever it changes
  useEffect(() => {
    if (isFirstRender.current) return;
    dbSetSystemPrompt(settings.systemPrompt || null).catch(() => { /* not connected */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.systemPrompt]);


  const inputClass = `w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 border transition-colors ${
    darkMode
      ? 'bg-gray-900/60 text-gray-100 placeholder-gray-600 border-gray-700 focus:border-blue-500/50'
      : 'bg-gray-50 text-gray-900 placeholder-gray-400 border-gray-200 focus:border-blue-400'
  }`;

  const selectClass = `${inputClass} cursor-pointer`;

  // @group DatabaseOperations : MongoDB connect
  const handleDbConnect = async () => {
    const uri = settings.mongoUri?.trim();
    if (!uri) return;
    setDbStatus('connecting');
    setDbError('');
    try {
      await dbConnect(uri);
      await dbIsConnected();
      setDbStatus('ok');
    } catch (e) {
      setDbStatus('error');
      setDbError(e instanceof Error ? e.message : String(e));
    }
  };

  // @group VoiceCloning : Record + train voice
  const stopRecordingAndTrain = async () => {
    if (recordingInterval) { clearInterval(recordingInterval); setRecordingInterval(null); }
    setIsRecordingVoice(false);
    setIsTraining(true);
    setTrainSuccess(false);
    try {
      const result = await stopRecording();
      await trainVoice(result.audioPath);
      const status = await getVoiceStatus();
      updateSettings({ voiceCloned: status.trained, voiceSamplePath: status.samplePath });
      setTrainSuccess(true);
      setRecordingTime(0);
      setTimeout(() => setTrainSuccess(false), 3000);
    } catch (e) {
      console.error('Voice training failed:', e);
    } finally {
      setIsTraining(false);
    }
  };

  const handleRecordVoice = async () => {
    if (isRecordingVoice) { await stopRecordingAndTrain(); return; }
    try {
      await startRecording();
      setIsRecordingVoice(true);
      setRecordingTime(0);
      const interval = window.setInterval(() => {
        setRecordingTime(prev => {
          if (prev + 1 >= 30) stopRecordingAndTrain();
          return prev + 1;
        });
      }, 1000);
      setRecordingInterval(interval);
    } catch (e) {
      console.error('Record voice failed:', e);
      setIsRecordingVoice(false);
    }
  };

  const handleVoiceUpload = async () => {
    try {
      setIsTraining(true);
      const selected = await open({ multiple: false, filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'm4a'] }] });
      if (selected && typeof selected === 'string') {
        await trainVoice(selected);
        const status = await getVoiceStatus();
        updateSettings({ voiceCloned: status.trained, voiceSamplePath: status.samplePath });
        setTrainSuccess(true);
        setTimeout(() => setTrainSuccess(false), 3000);
      }
    } catch (e) { console.error('Voice upload failed:', e); }
    finally { setIsTraining(false); }
  };

  // @group ProviderConfig : Per-provider fields
  const providerFields = () => {
    if (settings.provider === 'anthropic') return (
      <>
        <Field label="API Key">
          <div className="relative">
            <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input type="password" value={settings.anthropicApiKey || ''} onChange={e => updateSettings({ anthropicApiKey: e.target.value })} className={`${inputClass} pl-8`} placeholder="sk-ant-..." />
          </div>
        </Field>
        <Field label="Model">
          <select value={settings.anthropicModel || 'claude-sonnet-4-6'} onChange={e => updateSettings({ anthropicModel: e.target.value })} className={selectClass}>
            <optgroup label="Claude 4 (Latest)">
              <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
              <option value="claude-opus-4-6">claude-opus-4-6 (powerful)</option>
              <option value="claude-haiku-4-5">claude-haiku-4-5 (fast)</option>
            </optgroup>
            <optgroup label="Claude 3.5">
              <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</option>
              <option value="claude-3-5-haiku-20241022">claude-3-5-haiku</option>
            </optgroup>
          </select>
        </Field>
      </>
    );
    if (settings.provider === 'openai') return (
      <>
        <Field label="API Key">
          <div className="relative">
            <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input type="password" value={settings.openaiApiKey || ''} onChange={e => updateSettings({ openaiApiKey: e.target.value })} className={`${inputClass} pl-8`} placeholder="sk-..." />
          </div>
        </Field>
        <Field label="Model">
          <select value={settings.openaiModel || 'gpt-4o'} onChange={e => updateSettings({ openaiModel: e.target.value })} className={selectClass}>
            <option value="gpt-4o">gpt-4o (recommended)</option>
            <option value="gpt-4o-mini">gpt-4o-mini (fast)</option>
            <option value="gpt-4-turbo">gpt-4-turbo</option>
            <option value="gpt-4">gpt-4</option>
            <option value="gpt-3.5-turbo">gpt-3.5-turbo (cheapest)</option>
          </select>
        </Field>
      </>
    );
    if (settings.provider === 'azure') return (
      <>
        <Field label="API Key">
          <div className="relative">
            <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input type="password" value={settings.azureApiKey || ''} onChange={e => updateSettings({ azureApiKey: e.target.value })} className={`${inputClass} pl-8`} placeholder="Your Azure key" />
          </div>
        </Field>
        <Field label="Endpoint">
          <input type="text" value={settings.azureEndpoint || ''} onChange={e => updateSettings({ azureEndpoint: e.target.value })} className={inputClass} placeholder="https://your-resource.openai.azure.com" />
        </Field>
        <Field label="Deployment Name">
          <input type="text" value={settings.azureModel || 'gpt-4'} onChange={e => updateSettings({ azureModel: e.target.value })} className={inputClass} placeholder="gpt-4" />
        </Field>
      </>
    );
    if (settings.provider === 'lmstudio') return (
      <>
        <Field label="Endpoint" hint="LM Studio server URL (enable in LM Studio → Local Server)">
          <div className="relative">
            <Wifi size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={settings.lmstudioEndpoint || 'http://localhost:1234'}
              onChange={e => {
                updateSettings({ lmstudioEndpoint: e.target.value });
                setLmstudioFetchStatus('idle');
              }}
              onBlur={e => fetchLmstudioModelsFromServer(e.target.value)}
              className={`${inputClass} pl-8`}
              placeholder="http://localhost:1234"
            />
          </div>
        </Field>
        <Field label="Model">
          <div className="flex gap-2">
            {lmstudioModels.length > 0 ? (
              <select
                value={settings.lmstudioModel || ''}
                onChange={e => updateSettings({ lmstudioModel: e.target.value })}
                className={`${selectClass} flex-1`}
              >
                {lmstudioModels.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={settings.lmstudioModel || ''}
                onChange={e => updateSettings({ lmstudioModel: e.target.value })}
                className={`${inputClass} flex-1`}
                placeholder={lmstudioFetchStatus === 'error' ? 'Could not reach LM Studio — type model name' : 'local-model'}
              />
            )}
            <button
              onClick={() => fetchLmstudioModelsFromServer()}
              title="Refresh model list"
              className={`shrink-0 px-2.5 rounded-lg border transition-colors ${
                lmstudioFetchStatus === 'loading'
                  ? darkMode ? 'border-gray-700 bg-gray-800 text-gray-500' : 'border-gray-200 bg-gray-100 text-gray-400'
                  : lmstudioFetchStatus === 'error'
                  ? darkMode ? 'border-red-800/50 bg-red-900/20 text-red-400' : 'border-red-200 bg-red-50 text-red-500'
                  : darkMode ? 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              <RefreshCw size={13} className={lmstudioFetchStatus === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>
          {lmstudioFetchStatus === 'error' && (
            <p className="text-[11px] text-red-400 mt-1">LM Studio not reachable. Enable the local server in LM Studio settings.</p>
          )}
          {lmstudioFetchStatus === 'ok' && lmstudioModels.length === 0 && (
            <p className="text-[11px] text-yellow-400 mt-1">No models loaded. Load a model in LM Studio first.</p>
          )}
        </Field>
      </>
    );
    if (settings.provider === 'ollama') return (
      <>
        <Field label="Endpoint">
          <div className="relative">
            <Wifi size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              type="text"
              value={settings.ollamaEndpoint || 'http://localhost:11434'}
              onChange={e => {
                updateSettings({ ollamaEndpoint: e.target.value });
                setOllamaFetchStatus('idle');
              }}
              onBlur={e => fetchOllamaModels(e.target.value)}
              className={`${inputClass} pl-8`}
              placeholder="http://localhost:11434"
            />
          </div>
        </Field>
        <Field label="Model">
          <div className="flex gap-2">
            {ollamaModels.length > 0 ? (
              <select
                value={settings.ollamaModel || ''}
                onChange={e => updateSettings({ ollamaModel: e.target.value })}
                className={`${selectClass} flex-1`}
              >
                {ollamaModels.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={settings.ollamaModel || ''}
                onChange={e => updateSettings({ ollamaModel: e.target.value })}
                className={`${inputClass} flex-1`}
                placeholder={ollamaFetchStatus === 'error' ? 'Could not reach Ollama — type model name' : 'llama3'}
              />
            )}
            <button
              onClick={() => fetchOllamaModels()}
              title="Refresh model list"
              className={`shrink-0 px-2.5 rounded-lg border transition-colors ${
                ollamaFetchStatus === 'loading'
                  ? darkMode ? 'border-gray-700 bg-gray-800 text-gray-500' : 'border-gray-200 bg-gray-100 text-gray-400'
                  : ollamaFetchStatus === 'error'
                  ? darkMode ? 'border-red-800/50 bg-red-900/20 text-red-400' : 'border-red-200 bg-red-50 text-red-500'
                  : darkMode ? 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-gray-700'
              }`}
            >
              <RefreshCw size={13} className={ollamaFetchStatus === 'loading' ? 'animate-spin' : ''} />
            </button>
          </div>
          {ollamaFetchStatus === 'error' && (
            <p className="text-[11px] text-red-400 mt-1">Ollama not reachable at the endpoint above.</p>
          )}
          {ollamaFetchStatus === 'ok' && ollamaModels.length === 0 && (
            <p className="text-[11px] text-yellow-400 mt-1">No models found. Run <code>ollama pull &lt;model&gt;</code> first.</p>
          )}
        </Field>
      </>
    );
  };

  const providers: { id: AIProvider; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
    { id: 'anthropic', label: 'Anthropic', desc: 'Claude models',  icon: <Bot size={15} />, color: 'orange' },
    { id: 'openai',    label: 'OpenAI',    desc: 'GPT models',     icon: <Cpu size={15} />, color: 'green'  },
    { id: 'azure',     label: 'Azure',     desc: 'Azure OpenAI',   icon: <Key size={15} />, color: 'blue'   },
    { id: 'ollama',    label: 'Ollama',    desc: 'Local models',   icon: <Zap size={15} />, color: 'violet' },
    { id: 'lmstudio',  label: 'LM Studio', desc: 'Local server',   icon: <Wifi size={15} />, color: 'teal'  },
  ];

  const colorMap: Record<string, { active: string; inactive: string; icon: string }> = {
    orange: {
      active: darkMode ? 'border-orange-500/60 bg-orange-500/10' : 'border-orange-400 bg-orange-50',
      inactive: darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
      icon: darkMode ? 'bg-orange-500/20 text-orange-400' : 'bg-orange-100 text-orange-600',
    },
    green: {
      active: darkMode ? 'border-green-500/60 bg-green-500/10' : 'border-green-400 bg-green-50',
      inactive: darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
      icon: darkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-600',
    },
    blue: {
      active: darkMode ? 'border-blue-500/60 bg-blue-500/10' : 'border-blue-400 bg-blue-50',
      inactive: darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
      icon: darkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600',
    },
    violet: {
      active: darkMode ? 'border-violet-500/60 bg-violet-500/10' : 'border-violet-400 bg-violet-50',
      inactive: darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
      icon: darkMode ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-100 text-violet-600',
    },
    teal: {
      active: darkMode ? 'border-teal-500/60 bg-teal-500/10' : 'border-teal-400 bg-teal-50',
      inactive: darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
      icon: darkMode ? 'bg-teal-500/20 text-teal-400' : 'bg-teal-100 text-teal-600',
    },
  };

  return (
    <div className={`flex h-full ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>

      {/* @group SectionNav : Left nav rail */}
      <div className={`w-48 shrink-0 border-r flex flex-col ${darkMode ? 'border-gray-700/60 bg-gray-900' : 'border-gray-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
          <h2 className={`text-sm font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Settings</h2>
          <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Configure Antarman</p>
        </div>
        <nav className="flex-1 py-2">
          <NavItem id="ai"       label="AI"       icon={<Bot size={15} />}      desc="Provider & models"  active={section === 'ai'}       darkMode={darkMode} onClick={() => setSection('ai')} />
          <NavItem id="voice"    label="Voice"    icon={<Mic size={15} />}      desc="Cloning & TTS"      active={section === 'voice'}    darkMode={darkMode} onClick={() => setSection('voice')} />
          <NavItem id="database" label="Database" icon={<Database size={15} />} desc="MongoDB history"    active={section === 'database'} darkMode={darkMode} onClick={() => setSection('database')} />
          <NavItem id="personas" label="Personas" icon={<BrainCircuit size={15} />} desc="AI personalities" active={section === 'personas'} darkMode={darkMode} onClick={() => setSection('personas')} />
          <NavItem id="memory"   label="Memory"   icon={<Star size={15} />}     desc="Bookmarks & memory" active={section === 'memory'}   darkMode={darkMode} onClick={() => { setSection('memory'); loadMemoryAndBookmarks(); }} />
          <NavItem id="schedule" label="Schedule" icon={<Zap size={15} />}      desc="Check-in & VAD"     active={section === 'schedule'} darkMode={darkMode} onClick={() => setSection('schedule')} />
        </nav>
      </div>

      {/* @group Content : Right content panel */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl p-6 space-y-5">

          {/* @group AISection */}
          {section === 'ai' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>AI Provider</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Choose the AI backend to use for responses.</p>
              </div>

              {/* Provider cards */}
              <div className="grid grid-cols-2 gap-2.5">
                {providers.map(p => {
                  const active = settings.provider === p.id;
                  const colors = colorMap[p.color];
                  return (
                    <button
                      key={p.id}
                      onClick={() => updateSettings({ provider: p.id })}
                      className={`relative flex flex-col items-start gap-2 p-3.5 rounded-xl border-2 text-left transition-all ${active ? colors.active : colors.inactive}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors.icon}`}>{p.icon}</div>
                      <div>
                        <div className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{p.label}</div>
                        <div className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>{p.desc}</div>
                      </div>
                      {active && (
                        <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-blue-500" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Provider-specific fields */}
              <Card darkMode={darkMode}>
                {providerFields()}
              </Card>
            </>
          )}

          {/* @group VoiceSection */}
          {section === 'voice' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Voice Cloning</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Train Antarman to speak in your voice.</p>
              </div>

              {/* Status badge */}
              <div className={`flex items-center gap-3 p-4 rounded-xl border ${darkMode ? 'bg-gray-800/40 border-gray-700/50' : 'bg-white border-gray-200 shadow-sm'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${settings.voiceCloned ? 'bg-green-500/15' : 'bg-yellow-500/15'}`}>
                  {settings.voiceCloned ? <Check size={18} className="text-green-400" /> : <Circle size={18} className="text-yellow-400" />}
                </div>
                <div>
                  <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                    {settings.voiceCloned ? 'Voice trained' : 'No voice sample'}
                  </p>
                  <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  </p>
                </div>
              </div>

              {/* Record / Upload */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleRecordVoice}
                  disabled={isTraining}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isRecordingVoice
                      ? 'border-red-500/60 bg-red-500/10 animate-pulse'
                      : darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-blue-500/40 hover:bg-blue-500/5' : 'border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isRecordingVoice ? 'bg-red-500/20' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    {isRecordingVoice ? <Square size={16} className="text-red-400" /> : <Mic size={16} className={darkMode ? 'text-gray-300' : 'text-gray-600'} />}
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{isRecordingVoice ? 'Stop' : 'Record'}</p>
                    <p className={`text-xs ${isRecordingVoice ? 'text-red-400' : darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      {isRecordingVoice ? `${recordingTime}s / 30s` : 'Live sample'}
                    </p>
                  </div>
                </button>

                <button
                  onClick={handleVoiceUpload}
                  disabled={isTraining || isRecordingVoice}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    trainSuccess
                      ? 'border-green-500/60 bg-green-500/10'
                      : darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-violet-500/40 hover:bg-violet-500/5' : 'border-gray-200 bg-gray-50 hover:border-violet-300 hover:bg-violet-50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${trainSuccess ? 'bg-green-500/20' : darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                    {trainSuccess ? <Check size={16} className="text-green-400" /> : <Upload size={16} className={darkMode ? 'text-gray-300' : 'text-gray-600'} />}
                  </div>
                  <div className="text-center">
                    <p className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{trainSuccess ? 'Trained!' : isTraining ? 'Training...' : 'Upload'}</p>
                    <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>WAV / MP3 / M4A</p>
                  </div>
                </button>
              </div>

              {/* @group TTSProvider : TTS backend selector */}
              <div>
                <h3 className={`text-sm font-semibold mb-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>TTS Engine</h3>
                <div className="grid grid-cols-2 gap-2.5 mb-3">
                  {([
                    { id: 'coqui',  label: 'Coqui TTS',    desc: 'Local Python server', color: 'violet' },
                    { id: 'kokoro', label: 'Kokoro',        desc: 'Docker on port 8880', color: 'blue'   },
                  ] as const).map(p => {
                    const active = (settings.ttsProvider ?? 'coqui') === p.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => updateSettings({ ttsProvider: p.id })}
                        className={`flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all ${
                          active
                            ? p.color === 'violet'
                              ? darkMode ? 'border-violet-500/60 bg-violet-500/10' : 'border-violet-400 bg-violet-50'
                              : darkMode ? 'border-blue-500/60 bg-blue-500/10'     : 'border-blue-400 bg-blue-50'
                            : darkMode ? 'border-gray-700/50 bg-gray-800/30 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          active
                            ? p.color === 'violet'
                              ? darkMode ? 'bg-violet-500/20 text-violet-400' : 'bg-violet-100 text-violet-600'
                              : darkMode ? 'bg-blue-500/20 text-blue-400'     : 'bg-blue-100 text-blue-600'
                            : darkMode ? 'bg-gray-700 text-gray-500' : 'bg-gray-200 text-gray-400'
                        }`}>
                          <Volume2 size={15} />
                        </div>
                        <div>
                          <p className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{p.label}</p>
                          <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>{p.desc}</p>
                        </div>
                        {active && <span className="ml-auto w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                {/* Kokoro-specific settings */}
                {(settings.ttsProvider ?? 'coqui') === 'kokoro' && (
                  <Card darkMode={darkMode}>
                    <Field label="Kokoro Endpoint" hint="Base URL of your Kokoro Docker container">
                      <div className="relative">
                        <Wifi size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                        <input
                          type="text"
                          value={settings.kokoroEndpoint || 'http://localhost:8880'}
                          onChange={e => updateSettings({ kokoroEndpoint: e.target.value })}
                          className={`${inputClass} pl-8`}
                          placeholder="http://localhost:8880"
                        />
                      </div>
                    </Field>
                    <Field label="Voice" hint="Kokoro voice preset to use">
                      <select
                        value={settings.kokoroVoice || 'af_sky'}
                        onChange={e => updateSettings({ kokoroVoice: e.target.value })}
                        className={selectClass}
                      >
                        <optgroup label="American Female">
                          <option value="af_sky">af_sky (Sky)</option>
                          <option value="af_bella">af_bella (Bella)</option>
                          <option value="af_sarah">af_sarah (Sarah)</option>
                          <option value="af_nicole">af_nicole (Nicole)</option>
                        </optgroup>
                        <optgroup label="American Male">
                          <option value="am_adam">am_adam (Adam)</option>
                          <option value="am_michael">am_michael (Michael)</option>
                        </optgroup>
                        <optgroup label="British Female">
                          <option value="bf_emma">bf_emma (Emma)</option>
                          <option value="bf_isabella">bf_isabella (Isabella)</option>
                        </optgroup>
                        <optgroup label="British Male">
                          <option value="bm_george">bm_george (George)</option>
                          <option value="bm_lewis">bm_lewis (Lewis)</option>
                        </optgroup>
                      </select>
                    </Field>
                  </Card>
                )}
              </div>

              {/* Fast TTS toggle — only relevant for Coqui */}
              {(settings.ttsProvider ?? 'coqui') === 'coqui' && (
              <Card darkMode={darkMode}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${darkMode ? 'bg-amber-500/15' : 'bg-amber-100'}`}>
                      <Zap size={16} className={darkMode ? 'text-amber-400' : 'text-amber-600'} />
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Fast Mode</p>
                      <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>System voice, ~2s latency</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={settings.useFastTTS || false} onChange={e => updateSettings({ useFastTTS: e.target.checked })} className="sr-only peer" />
                    <div className={`w-10 h-6 rounded-full peer transition-colors peer-checked:bg-blue-600 ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4`} />
                  </label>
                </div>
              </Card>
              )}

              {/* @group SystemPrompt : Custom voice assistant persona prompt */}
              <div>
                <h3 className={`text-sm font-semibold mb-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>System Prompt</h3>
                <p className={`text-xs mb-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Override the default voice assistant persona. Leave blank to use the built-in prompt.
                </p>
                <textarea
                  value={settings.systemPrompt || ''}
                  onChange={e => updateSettings({ systemPrompt: e.target.value })}
                  rows={6}
                  placeholder="You are a helpful voice assistant..."
                  className={`w-full px-3 py-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 border transition-colors resize-y ${
                    darkMode
                      ? 'bg-gray-900/60 text-gray-100 placeholder-gray-600 border-gray-700 focus:border-blue-500/50'
                      : 'bg-white text-gray-800 placeholder-gray-300 border-gray-200 focus:border-blue-400'
                  }`}
                />
              </div>
            </>
          )}

          {/* @group DatabaseSection */}
          {section === 'database' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Database</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Connect MongoDB to persist conversation history.</p>
              </div>

              <Card darkMode={darkMode}>
                <Field label="MongoDB URI" hint="Include the database name — e.g. mongodb://localhost:27017/antarman">
                  <div className="relative">
                    <Database size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                    <input
                      type="text"
                      value={settings.mongoUri || ''}
                      onChange={e => updateSettings({ mongoUri: e.target.value })}
                      className={`${inputClass} pl-8`}
                      placeholder="mongodb://localhost:27017/antarman"
                    />
                  </div>
                </Field>

                <button
                  onClick={handleDbConnect}
                  disabled={dbStatus === 'connecting' || !settings.mongoUri?.trim()}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    dbStatus === 'ok'
                      ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                      : 'bg-blue-600 hover:bg-blue-700 text-white'
                  }`}
                >
                  {dbStatus === 'connecting'
                    ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Connecting...</>
                    : dbStatus === 'ok'
                    ? <><Check size={15} /> Connected</>
                    : <><Database size={15} /> Connect</>
                  }
                </button>

                {dbStatus === 'error' && (
                  <div className={`px-3 py-2 rounded-lg text-xs ${darkMode ? 'bg-red-900/20 border border-red-800/40 text-red-400' : 'bg-red-50 border border-red-200 text-red-600'}`}>
                    {dbError}
                  </div>
                )}
              </Card>
            </>
          )}

          {/* @group PersonasSection */}
          {section === 'personas' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>AI Personas</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Choose how Antarman approaches conversations.</p>
              </div>
              <Card darkMode={darkMode}>
                <div className="space-y-2">
                  {BUILT_IN_PERSONAS.map(persona => {
                    const active = (settings.activePersonaId ?? 'default') === persona.id;
                    return (
                      <button
                        key={persona.id}
                        onClick={() => updateSettings({ activePersonaId: persona.id })}
                        className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all border ${
                          active
                            ? darkMode ? 'bg-blue-600/15 border-blue-500/50 text-blue-300' : 'bg-blue-50 border-blue-400 text-blue-700'
                            : darkMode ? 'bg-gray-800/40 border-gray-700/40 hover:border-gray-600' : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${active ? 'border-blue-500 bg-blue-500' : darkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                          {active && <div className="w-2 h-2 rounded-full bg-white" />}
                        </div>
                        <div>
                          <div className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{persona.name}</div>
                          <div className={`text-xs mt-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{persona.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Card>

              <Card darkMode={darkMode}>
                <Field label="Offline Mode">
                  <div className="flex items-center justify-between">
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Use local AI only (no internet required)</span>
                    <button
                      onClick={() => updateSettings({ offlineMode: !settings.offlineMode })}
                      className={`relative w-10 h-5.5 rounded-full transition-colors ${settings.offlineMode ? 'bg-blue-600' : darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${settings.offlineMode ? 'translate-x-4.5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                </Field>
                {settings.offlineMode && (
                  <Field label="Offline Provider">
                    <select value={settings.offlineProvider ?? 'ollama'} onChange={e => updateSettings({ offlineProvider: e.target.value as 'ollama' | 'lmstudio' })} className={selectClass}>
                      <option value="ollama">Ollama</option>
                      <option value="lmstudio">LM Studio</option>
                    </select>
                  </Field>
                )}
              </Card>
            </>
          )}

          {/* @group MemorySection */}
          {section === 'memory' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Memory & Bookmarks</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Facts Antarman remembers about you, and your starred messages.</p>
              </div>

              <Card darkMode={darkMode}>
                <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Add Memory Fact</div>
                <div className="flex gap-2">
                  <input
                    placeholder="Key (e.g. name)"
                    value={newMemKey}
                    onChange={e => setNewMemKey(e.target.value)}
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    placeholder="Value"
                    value={newMemValue}
                    onChange={e => setNewMemValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddMemory(); }}
                    className={`${inputClass} flex-1`}
                  />
                  <button
                    onClick={handleAddMemory}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${memorySaved ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                  >
                    {memorySaved ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                </div>
                {memoryFacts.length > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    {memoryFacts.map(fact => (
                      <div key={fact.key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${darkMode ? 'bg-gray-900/50 border border-gray-700/40' : 'bg-gray-50 border border-gray-200'}`}>
                        <span className={`font-medium shrink-0 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{fact.key}:</span>
                        <span className={`flex-1 min-w-0 truncate ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{fact.value}</span>
                        <button onClick={() => handleDeleteMemory(fact.key)} className="shrink-0 text-gray-500 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
                      </div>
                    ))}
                    <button onClick={handleClearAllMemory} className={`w-full mt-2 py-1.5 text-xs rounded-lg transition-colors ${darkMode ? 'text-red-400 hover:bg-red-900/20 border border-red-900/30' : 'text-red-500 hover:bg-red-50 border border-red-200'}`}>
                      Clear all memory
                    </button>
                  </div>
                ) : (
                  <p className={`mt-2 text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>No memory facts yet.</p>
                )}
              </Card>

              <Card darkMode={darkMode}>
                <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>Bookmarked Messages</div>
                {bookmarkedMessages.length > 0 ? (
                  <>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {bookmarkedMessages.map(bm => (
                        <div key={bm.messageId} className={`px-3 py-2 rounded-lg text-xs ${darkMode ? 'bg-gray-900/50 border border-gray-700/40' : 'bg-gray-50 border border-gray-200'}`}>
                          <div className={`font-medium mb-0.5 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{bm.conversationTitle} &mdash; <span className="capitalize">{bm.role}</span></div>
                          <div className={`line-clamp-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{bm.content}</div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={handleExportBookmarks}
                      disabled={exportStatus === 'saving'}
                      className={`mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                        exportStatus === 'done' ? 'bg-green-600/20 text-green-400 border border-green-600/30'
                        : exportStatus === 'error' ? 'bg-red-600/20 text-red-400 border border-red-600/30'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {exportStatus === 'saving' ? <><span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Saving...</>
                        : exportStatus === 'done' ? <><Check size={14} /> Exported</>
                        : exportStatus === 'error' ? 'Error saving'
                        : <><Download size={14} /> Export Bookmarks</>}
                    </button>
                  </>
                ) : (
                  <p className={`text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>No bookmarks yet. Star messages in conversations.</p>
                )}
              </Card>
            </>
          )}

          {/* @group ScheduleSection */}
          {section === 'schedule' && (
            <>
              <div>
                <h3 className={`text-base font-semibold mb-1 ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>Schedule & Detection</h3>
                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Daily check-in prompts and voice activity detection.</p>
              </div>

              <Card darkMode={darkMode}>
                <Field label="Daily Check-In">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Prompt a mood check-in once per day</span>
                    <button
                      onClick={() => updateSettings({ checkInEnabled: !settings.checkInEnabled })}
                      className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${settings.checkInEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.checkInEnabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {settings.checkInEnabled && (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Time</span>
                      <input
                        type="number" min={0} max={23}
                        value={settings.checkInHour ?? 9}
                        onChange={e => updateSettings({ checkInHour: Number(e.target.value) })}
                        className={`${inputClass} w-16 text-center`}
                      />
                      <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>:</span>
                      <input
                        type="number" min={0} max={59}
                        value={settings.checkInMinute ?? 0}
                        onChange={e => updateSettings({ checkInMinute: Number(e.target.value) })}
                        className={`${inputClass} w-16 text-center`}
                      />
                    </div>
                  )}
                </Field>
              </Card>

              <Card darkMode={darkMode}>
                <Field label="Voice Activity Detection (VAD)">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Auto-stop recording after silence</span>
                    <button
                      onClick={() => updateSettings({ vadEnabled: !settings.vadEnabled })}
                      className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${settings.vadEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-700' : 'bg-gray-300'}`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${settings.vadEnabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {settings.vadEnabled && (
                    <Field label="Silence duration (ms)">
                      <input
                        type="number" min={500} max={5000} step={100}
                        value={settings.vadSilenceMs ?? 1500}
                        onChange={e => updateSettings({ vadSilenceMs: Number(e.target.value) })}
                        className={inputClass}
                      />
                      <p className={`text-xs mt-1 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Stop recording after this many ms of silence. Default: 1500</p>
                    </Field>
                  )}
                  {/* @group VADCalibration : Live mic level meter */}
                  <div className={`mt-3 p-3 rounded-lg border ${darkMode ? 'bg-gray-800/60 border-gray-700/50' : 'bg-gray-50 border-gray-200'}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Mic Level Calibration</span>
                      <button
                        onClick={isMicTesting ? handleStopMicTest : handleStartMicTest}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                          isMicTesting
                            ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
                            : darkMode ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'
                        }`}
                      >
                        {isMicTesting ? <><Square size={9} fill="currentColor" /> Stop</> : <><Mic size={9} /> Test Mic</>}
                      </button>
                    </div>
                    <div className={`h-2.5 rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                      <div
                        className={`h-full rounded-full transition-all duration-75 ${
                          micLevel > 0.3 ? 'bg-emerald-400' : micLevel > 0.1 ? 'bg-yellow-400' : 'bg-gray-500'
                        }`}
                        style={{ width: `${Math.min(micLevel * 400, 100)}%` }}
                      />
                    </div>
                    <p className={`text-xs mt-1.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                      {isMicTesting
                        ? `Level: ${(micLevel * 100).toFixed(1)}% — speak normally to check detection`
                        : 'Test your mic level to calibrate the silence threshold above.'}
                    </p>
                  </div>
                </Field>
              </Card>

              <Card darkMode={darkMode}>
                <Field label="Global Hotkey">
                  <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Press <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-200 text-gray-700'}`}>Ctrl + Shift + Space</kbd> anywhere to toggle push-to-talk.
                  </p>
                </Field>
              </Card>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
