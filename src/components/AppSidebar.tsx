// @group AppSidebar : Sidebar with tabbed navigation (Conversations / Bookmarks / Reflections) and settings button
import { useState } from 'react';
import { Settings, MessageSquare, Star, Sparkles } from 'lucide-react';
import ConversationSidebar from './ConversationSidebar';
import BookmarksPane from './BookmarksPane';
import WeeklyReflectionCard from './WeeklyReflectionCard';
import type { Message, WeeklyData } from '../types';

type SidebarTab = 'conversations' | 'bookmarks' | 'reflections';

interface AppSidebarProps {
  darkMode: boolean;
  onLoadMessages: (messages: Message[]) => void;
  onLoadConversation: (convId: string) => void;
  onSettingsClick: () => void;
  settingsOpen: boolean;
  onGenerateReflection: (weekData: WeeklyData) => Promise<string>;
}

export default function AppSidebar({ darkMode, onLoadMessages, onLoadConversation, onSettingsClick, settingsOpen, onGenerateReflection }: AppSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('conversations');

  const tabs: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
    { id: 'conversations', icon: <MessageSquare size={12} />, label: 'Chats' },
    { id: 'bookmarks',     icon: <Star size={12} fill={activeTab === 'bookmarks' ? 'currentColor' : 'none'} />, label: 'Saved' },
    { id: 'reflections',  icon: <Sparkles size={12} />, label: 'Reflect' },
  ];

  return (
    <aside className={`w-56 flex flex-col border-r shrink-0 ${darkMode ? 'bg-[#1a1115]/80 border-[#382228]' : 'bg-[rgba(255,255,255,0.68)] border-[#f1e2e6] backdrop-blur-xl'}`}>

      {/* @group TabBar : Three-tab switcher */}
      <div className={`shrink-0 flex border-b px-2 pt-2 pb-1 ${darkMode ? 'border-[#402a31]' : 'border-[#f1e2e6]'}`}>
        {tabs.map(({ id, icon, label }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-medium tracking-[0.12em] uppercase transition-all rounded-t-xl border-b-2 ${
                isActive
                  ? darkMode ? 'border-[#d8879a] text-[#f7dce3]' : 'border-[#7c2d3a] text-[#7c2d3a]'
                  : darkMode ? 'border-transparent text-gray-400 hover:text-[#f7dce3]' : 'border-transparent text-[#8a6971] hover:text-[#5b1f2e]'
              }`}
            >
              {icon}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab content fills available space */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'conversations' && <ConversationSidebar darkMode={darkMode} onLoadMessages={onLoadMessages} />}
        {activeTab === 'bookmarks' && <BookmarksPane darkMode={darkMode} onLoadConversation={onLoadConversation} />}
        {activeTab === 'reflections' && <WeeklyReflectionCard darkMode={darkMode} onGenerateReflection={onGenerateReflection} />}
      </div>

      {/* Settings button pinned to bottom */}
      <div className={`shrink-0 border-t px-3 py-2.5 ${darkMode ? 'border-[#402a31]' : 'border-[#f1e2e6]'}`}>
        <button
          onClick={onSettingsClick}
          className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all shadow-sm ${
            settingsOpen
              ? darkMode
                ? 'bg-[linear-gradient(135deg,#4b2431_0%,#2d1d24_100%)] text-[#f7dce3] shadow-[0_10px_25px_rgba(124,45,58,0.18)]'
                : 'bg-[linear-gradient(135deg,#f7edf1_0%,#f1dfe5_100%)] text-[#5b1f2e] shadow-[0_8px_22px_rgba(124,45,58,0.08)]'
              : darkMode
              ? 'text-gray-300 hover:bg-[#2b1b22] hover:text-white'
              : 'text-[#7f5863] hover:bg-[#f8edf0] hover:text-[#5b1f2e]'
          }`}
        >
          <Settings size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
}
