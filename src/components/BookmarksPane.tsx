// @group BookmarksPane : Sidebar panel showing all bookmarked messages with jump-to-conversation
import { useEffect, useState } from 'react';
import { Star, MessageSquare } from 'lucide-react';
import { dbGetBookmarkedMessages } from '../tauri-api';
import type { BookmarkedMessage } from '../types';

interface BookmarksPaneProps {
  darkMode: boolean;
  onLoadConversation: (convId: string) => void;
}

export default function BookmarksPane({ darkMode, onLoadConversation }: BookmarksPaneProps) {
  const [bookmarks, setBookmarks] = useState<BookmarkedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dbGetBookmarkedMessages()
      .then(setBookmarks)
      .catch(() => setBookmarks([]))
      .finally(() => setLoading(false));
  }, []);

  // @group Utilities : Format timestamp
  const formatDate = (ms: number) => {
    const d = new Date(ms);
    const diff = Date.now() - ms;
    if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`px-3 py-2.5 border-b shrink-0 ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
        <div className="flex items-center gap-1.5">
          <Star size={12} className="text-yellow-400" fill="currentColor" />
          <span className={`text-xs font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Bookmarks</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {loading && (
          <div className={`text-center py-6 text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>Loading...</div>
        )}
        {!loading && bookmarks.length === 0 && (
          <div className={`px-2 py-8 text-center ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            <Star size={20} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No bookmarks yet.</p>
            <p className="text-xs mt-0.5 opacity-60">Star a message to save it here.</p>
          </div>
        )}
        {!loading && bookmarks.map((bm) => (
          <button
            key={bm.messageId}
            onClick={() => onLoadConversation(bm.conversationId)}
            className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
              darkMode ? 'hover:bg-gray-800/70' : 'hover:bg-gray-100'
            }`}
          >
            {/* @group BookmarkItem : Conversation context label */}
            <div className="flex items-center gap-1 mb-1">
              <MessageSquare size={9} className={darkMode ? 'text-gray-600' : 'text-gray-400'} />
              <span className={`text-xs truncate font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {bm.conversationTitle}
              </span>
              <span className={`ml-auto shrink-0 text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                {formatDate(bm.timestamp)}
              </span>
            </div>
            {/* @group BookmarkItem : Message content preview */}
            <p className={`text-xs leading-relaxed line-clamp-3 ${
              bm.role === 'user'
                ? 'text-[#7c2d3a]'
                : darkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
              {bm.content}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
