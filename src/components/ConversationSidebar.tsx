// @group ConversationSidebar : Conversation history list (pure content, no outer container)

import { useEffect, useRef, useState, useCallback } from 'react';
import { MessageSquare, Plus, Trash2, Pencil, Check, X, Search, Download } from 'lucide-react';
import { useStore } from '../store';
import {
  dbListConversations,
  dbCreateConversation,
  dbDeleteConversation,
  dbUpdateConversationTitle,
  dbGetConversation,
  dbSearchConversations,
  dbGetConversationSentiments,
  writeFile,
} from '../tauri-api';
import { save } from '@tauri-apps/plugin-dialog';
import type { Conversation } from '../types';
import type { Message } from '../types';
import MoodChart from './MoodChart';

interface ConversationSidebarProps {
  darkMode: boolean;
  onLoadMessages: (messages: Message[]) => void;
}

export default function ConversationSidebar({ darkMode, onLoadMessages }: ConversationSidebarProps) {
  const {
    conversations,
    activeConversationId,
    setConversations,
    setActiveConversationId,
    clearMessages,
  } = useStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // @group Search : Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // @group MoodChart : Cache of sentiment scores by conversationId
  const [sentimentCache, setSentimentCache] = useState<Record<string, number[]>>({});

  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus();
  }, [editingId]);

  // @group Search : Debounced search handler
  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await dbSearchConversations(q.trim());
        setSearchResults(results);
      } catch { setSearchResults([]); }
    }, 350);
  }, []);

  // @group MoodChart : Lazily load sentiment scores when a conversation comes into view
  const loadSentiments = useCallback(async (convId: string) => {
    if (sentimentCache[convId] !== undefined) return;
    try {
      const scores = await dbGetConversationSentiments(convId);
      setSentimentCache(prev => ({ ...prev, [convId]: scores }));
    } catch { /* not critical */ }
  }, [sentimentCache]);

  const displayedConversations = searchResults ?? conversations;

  // @group Handlers : Conversation CRUD actions
  const handleNew = async () => {
    setSidebarError(null);
    try {
      const id = await dbCreateConversation('New Conversation');
      clearMessages();
      setActiveConversationId(id);
      onLoadMessages([]);
      setConversations(await dbListConversations());
    } catch (e) {
      // DB not available — still start a fresh in-memory conversation
      console.warn('[Sidebar] DB unavailable, starting in-memory conversation:', e);
      clearMessages();
      setActiveConversationId(null);
      onLoadMessages([]);
    }
  };

  const handleSelect = async (conv: Conversation) => {
    if (conv.id === activeConversationId) return;
    setLoading(true);
    setSidebarError(null);
    try {
      const full = await dbGetConversation(conv.id);
      setActiveConversationId(conv.id);
      onLoadMessages(full.messages.map((m) => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.timestamp),
      })));
    } catch (e) {
      // If DB lookup fails it may be an in-memory conversation — just activate it.
      // Messages for the current session are already in the store.
      setActiveConversationId(conv.id);
      console.warn('[Sidebar] dbGetConversation failed (possibly in-memory):', e);
    }
    finally { setLoading(false); }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSidebarError(null);
    try {
      await dbDeleteConversation(id);
      if (activeConversationId === id) { setActiveConversationId(null); onLoadMessages([]); }
      setConversations(await dbListConversations());
    } catch {
      setSidebarError('Failed to delete conversation. Is the database connected?');
    }
  };

  const startEdit = (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditingTitle(conv.title);
  };

  const commitEdit = async (id: string) => {
    if (!editingTitle.trim()) { setEditingId(null); return; }
    await dbUpdateConversationTitle(id, editingTitle.trim());
    setConversations(await dbListConversations());
    setEditingId(null);
  };

  // @group Export : Export a conversation to Markdown or JSON
  const handleExport = async (e: React.MouseEvent, conv: Conversation) => {
    e.stopPropagation();
    try {
      const full = await dbGetConversation(conv.id);
      const md = [
        `# ${full.title}`,
        `**Date:** ${new Date(full.createdAt).toLocaleDateString()}`,
        '',
        '---',
        '',
        ...full.messages.map((m) =>
          `**${m.role === 'user' ? 'You' : 'Antarman'}** _(${new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})_\n\n${m.content}`
        ),
      ].join('\n\n');
      const path = await save({
        defaultPath: `${conv.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (path) await writeFile(path, md);
    } catch (e) {
      console.warn('[Export] Failed:', e);
    }
  };

  // @group Utilities : Format date label
  const formatDate = (ms: number) => {
    const d = new Date(ms);
    const diff = Date.now() - ms;
    if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* New conversation button */}
      <div className="px-2 py-2 shrink-0">
        <button
          onClick={handleNew}
          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
            darkMode
              ? 'bg-[#3a1d27] hover:bg-[#4d2431] text-[#f7dce3] border border-[#6a3846]'
              : 'bg-[#f9edf0] hover:bg-[#f1dfe5] text-[#5b1f2e] border border-[#efccd5]'
          }`}
        >
          <Plus size={12} /> New Conversation
        </button>
      </div>

      {/* @group Search : Search input */}
      <div className="px-2 pb-1.5 shrink-0">
        <div className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs ${
          darkMode ? 'bg-gray-800/60 border-gray-700/50 text-gray-400' : 'bg-gray-50 border-gray-200 text-gray-500'
        }`}>
          <Search size={11} className="shrink-0 opacity-60" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="flex-1 bg-transparent outline-none placeholder-current"
          />
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults(null); }} className="opacity-60 hover:opacity-100">
              <X size={10} />
            </button>
          )}
        </div>
        {searchResults !== null && (
          <p className={`text-xs mt-1 px-1 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Inline error */}
      {sidebarError && (
        <div className={`mx-2 mb-1 px-2 py-1.5 rounded text-xs ${darkMode ? 'bg-red-900/30 text-red-400' : 'bg-red-50 text-red-600'}`}>
          {sidebarError}
        </div>
      )}

      {/* @group List : Conversation items */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && (
          <div className={`text-center py-4 text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Loading...</div>
        )}
        {!loading && displayedConversations.length === 0 && (
          <div className={`px-2 py-6 text-center text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {searchQuery ? 'No results.' : 'No conversations yet.'}
          </div>
        )}
        {!loading && displayedConversations.map((conv) => {
          const isActive = conv.id === activeConversationId;
          // Kick off sentiment loading when we first render the item
          if (!sentimentCache[conv.id]) loadSentiments(conv.id);
          const moods = sentimentCache[conv.id];
          return (
            <div
              key={conv.id}
              onClick={() => handleSelect(conv)}
              className={`group relative flex flex-col px-2.5 py-2 rounded-lg cursor-pointer transition-all text-xs ${
                isActive
                  ? darkMode ? 'bg-[#2d1d24] border-l-2 border-[#d8879a]' : 'bg-[#f9edf0] border-l-2 border-[#7c2d3a]'
                  : darkMode ? 'hover:bg-[#24181d]' : 'hover:bg-[#f9edf0]'
              }`}
            >
              {editingId === conv.id ? (
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(conv.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className={`flex-1 min-w-0 px-1.5 py-1 rounded text-xs outline-none ${
                      darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-gray-800 border border-gray-300'
                    }`}
                  />
                  <button onClick={() => commitEdit(conv.id)} className="text-green-500"><Check size={11} /></button>
                  <button onClick={() => setEditingId(null)} className="text-gray-500"><X size={11} /></button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between min-w-0 pr-8">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MessageSquare size={10} className={`shrink-0 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                      <span className={`truncate font-medium ${darkMode ? 'text-gray-200' : 'text-gray-700'}`}>{conv.title}</span>
                    </div>
                    {/* @group MoodChart : Sparkline only when we have enough data */}
                    {moods && moods.length >= 2 && (
                      <MoodChart scores={moods} width={40} height={14} darkMode={darkMode} />
                    )}
                  </div>
                  <div className={`flex justify-between mt-0.5 pl-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                    <span>{conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}</span>
                    <span>{formatDate(conv.updatedAt)}</span>
                  </div>
                  <div className="absolute right-1 top-1.5 hidden group-hover:flex gap-0.5">
                    <button onClick={(e) => startEdit(e, conv)} title="Rename" className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700 text-gray-500 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-400'}`}>
                      <Pencil size={10} />
                    </button>
                    <button onClick={(e) => handleExport(e, conv)} title="Export" className={`p-1 rounded ${darkMode ? 'hover:bg-gray-700 text-gray-500 hover:text-gray-200' : 'hover:bg-gray-200 text-gray-400'}`}>
                      <Download size={10} />
                    </button>
                    <button onClick={(e) => handleDelete(e, conv.id)} title="Delete" className="p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


