// @group MessageList : Conversation message display with auto-scroll, live streaming bubble, and replay controls
import { useEffect, useRef } from 'react';
import { User, Bot, Volume2, Square, Star, TrendingUp } from 'lucide-react';
import { Message } from '../types';
import MoodChart from './MoodChart';

interface MessageListProps {
  messages: Message[];
  darkMode?: boolean;
  // @group StreamingState : Live sentence-by-sentence text as TTS plays
  streamingMessage?: string;
  speakingText?: string | null;
  // @group ReplayControls : Replay a stored assistant message
  playingMessageId?: string | null;
  onPlayMessage?: (id: string, text: string) => void;
  onStopMessage?: () => void;
  // @group Bookmarks : Toggle bookmark on a message
  onToggleBookmark?: (messageId: string, dbId: string) => void;
  // @group Sentiment : Mood scores for the current conversation
  sentimentScores?: number[];
}

export default function MessageList({
  messages,
  darkMode = true,
  streamingMessage,
  speakingText,
  playingMessageId,
  onPlayMessage,
  onStopMessage,
  onToggleBookmark,
  sentimentScores,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage]);

  // @group Sentiment : Derive mood label from average score
  const moodLabel = (() => {
    if (!sentimentScores || sentimentScores.length < 2) return null;
    const avg = sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length;
    if (avg > 0.15) return 'Positive';
    if (avg < -0.15) return 'Low';
    return 'Neutral';
  })();

  if (messages.length === 0 && !streamingMessage) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
        <div className={`w-11 h-11 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
          <Bot size={20} className="opacity-50" />
        </div>
        <div className="text-center">
          <p className="text-xs font-medium">No messages yet</p>
          <p className="text-xs mt-0.5 opacity-60">Start recording or type to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden rounded-[22px]">
      {/* @group Sentiment : Mood header strip — shown when a conversation has 2+ scored messages */}
      {sentimentScores && sentimentScores.length >= 2 && (
        <div className={`shrink-0 flex items-center gap-2.5 px-4 py-1.5 border-b ${
          darkMode ? 'bg-[#1a1115]/80 border-[#402a31]' : 'bg-[#fff8f7] border-[#f1e2e6]'
        }`}>
          <TrendingUp size={11} className={darkMode ? 'text-gray-500' : 'text-gray-400'} />
          <MoodChart scores={sentimentScores} width={72} height={18} darkMode={darkMode} />
          <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-[#7f5863]'}`}>
            Mood — <span className={
              moodLabel === 'Positive' ? 'text-[#7b3650]' :
              moodLabel === 'Low' ? 'text-[#a34b5d]' : (darkMode ? 'text-[#f4bfd1]' : 'text-[#7c2d3a]')
            }>{moodLabel}</span>
          </span>
          <span className={`ml-auto text-xs ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {sentimentScores.length} data pt{sentimentScores.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`flex gap-2.5 items-start ${message.role === 'user' ? 'justify-end' : 'justify-start'} group px-0.5`}
        >
          {message.role === 'assistant' && (
            <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm mt-0.5 ${
              playingMessageId === message.id
                ? 'bg-[#7c2d3a] ring-2 ring-[#d9a4af]/70 ring-offset-1 ring-offset-transparent animate-pulse'
                : darkMode ? 'bg-[#7c2d3a]' : 'bg-[#7c2d3a]'
            }`}>
              <Bot size={14} className="text-white" />
            </div>
          )}

          <div className={`max-w-[72%] rounded-[18px] px-3.5 py-2.5 shadow-[0_10px_24px_rgba(71,30,38,0.06)] ${
            message.role === 'user'
              ? 'bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] text-white rounded-tr-sm'
              : darkMode
              ? 'bg-[#2a1a1f] text-[#f9edf0] rounded-tl-sm border border-[#4b2d35]'
              : 'bg-white text-[#2d151b] rounded-tl-sm border border-[#f1dfe5] shadow-[0_12px_28px_rgba(124,45,58,0.08)]'
          }`}>
            {/* @group TextHighlight : Highlight the sentence currently being spoken */}
            {message.role === 'assistant' && speakingText && playingMessageId === message.id
              ? <SentenceHighlight text={message.content} speakingText={speakingText} darkMode={darkMode} />
              : <p className="text-sm leading-relaxed">{message.content}</p>
            }
            <p className={`text-xs mt-1.5 ${message.role === 'user' ? 'text-[#f4dfe6]' : darkMode ? 'text-gray-400' : 'text-[#8d6a72]'}`}>
              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          {/* @group ReplayButton : Play / stop button shown on hover for assistant messages */}
          {message.role === 'assistant' && (
            <button
              onClick={() =>
                playingMessageId === message.id
                  ? onStopMessage?.()
                  : onPlayMessage?.(message.id, message.content)
              }
              title={playingMessageId === message.id ? 'Stop' : 'Replay'}
              className={`self-center shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150
                opacity-0 group-hover:opacity-100
                ${playingMessageId === message.id
                  ? darkMode
                    ? 'opacity-100 bg-[#7c2d3a]/90 hover:bg-[#a04b5d]/90 text-white'
                    : 'opacity-100 bg-[#7c2d3a]/90 hover:bg-[#a04b5d]/90 text-white'
                  : darkMode
                    ? 'bg-[#2d1d24] hover:bg-[#7c2d3a]/80 text-gray-300 hover:text-white'
                    : 'bg-[#f7edf0] hover:bg-[#f3dfe5] text-[#7f5863] hover:text-[#5b1f2e]'
                }`}
            >
              {playingMessageId === message.id
                ? <Square size={9} fill="currentColor" />
                : <Volume2 size={10} />
              }
            </button>
          )}

          {/* @group BookmarkButton : Star button — visible on hover, filled when bookmarked */}
          {message.dbId && onToggleBookmark && (
            <button
              onClick={() => onToggleBookmark(message.id, message.dbId!)}
              title={message.bookmarked ? 'Remove bookmark' : 'Bookmark'}
              className={`self-center shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-150
                ${message.bookmarked
                  ? 'opacity-100'
                  : 'opacity-0 group-hover:opacity-100'
                }
                ${message.bookmarked
                  ? 'text-[#d27b8a]'
                  : darkMode
                    ? 'bg-[#2d1d24] hover:bg-[#3a1f29] text-gray-400 hover:text-[#f2b6c5]'
                    : 'bg-[#f7edf0] hover:bg-[#f1dfe5] text-[#8d6a72] hover:text-[#7c2d3a]'
                }`}
            >
              <Star size={10} fill={message.bookmarked ? 'currentColor' : 'none'} />
            </button>
          )}

          {message.role === 'user' && (
            <div className="shrink-0 w-7 h-7 rounded-full bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] flex items-center justify-center shadow-sm mt-0.5">
              <User size={14} className="text-white" />
            </div>
          )}
        </div>
      ))}

      {/* @group StreamingBubble : Live growing assistant message while TTS plays */}
      {streamingMessage && (
        <div className="flex gap-2.5 justify-start items-start">
          <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center shadow-sm mt-0.5 ${darkMode ? 'bg-[#7c2d3a]' : 'bg-[#7c2d3a]'}`}>
            <Bot size={14} className="text-white" />
          </div>
          <div className={`max-w-[72%] rounded-[18px] rounded-tl-sm px-3.5 py-2.5 shadow-[0_10px_24px_rgba(71,30,38,0.06)] border ${
            darkMode ? 'bg-[#2a1a1f] text-[#f9edf0] border-[#4b2d35]' : 'bg-[#fffaf9] text-[#2d151b] border-[#f1dfe5] shadow-[0_12px_28px_rgba(124,45,58,0.08)]'
          }`}>
            <p className="text-sm leading-relaxed">
              {streamingMessage}
              <span className={`inline-block w-1.5 h-3.5 ml-0.5 rounded-sm align-middle animate-pulse ${darkMode ? 'bg-blue-400' : 'bg-blue-500'}`} />
            </p>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
    </div>
  );
}

// @group TextHighlight : Splits message content and highlights the currently playing sentence
function SentenceHighlight({ text, speakingText, darkMode }: { text: string; speakingText: string; darkMode: boolean }) {
  const idx = text.indexOf(speakingText);
  if (idx === -1) {
    return <p className="text-sm leading-relaxed">{text}</p>;
  }
  const before = text.slice(0, idx);
  const after = text.slice(idx + speakingText.length);
  return (
    <p className="text-sm leading-relaxed">
      {before}
      <mark className={`rounded px-0.5 ${darkMode ? 'bg-[#d8879a]/25 text-[#f3bfd1]' : 'bg-[#f4dfe5] text-[#5b1f2e]'}`}>
        {speakingText}
      </mark>
      {after}
    </p>
  );
}
