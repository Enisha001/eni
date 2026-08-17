// @group MemorySuggestionBanner : Non-intrusive inline banner suggesting an auto-detected memory fact
import { Brain, Check, X } from 'lucide-react';

export interface MemorySuggestion {
  key: string;
  value: string;
}

interface MemorySuggestionBannerProps {
  suggestion: MemorySuggestion;
  darkMode: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}

export default function MemorySuggestionBanner({ suggestion, darkMode, onAccept, onDismiss }: MemorySuggestionBannerProps) {
  return (
    <div className={`mx-4 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs transition-all ${
      darkMode
        ? 'bg-violet-900/20 border-violet-700/40 text-violet-200'
        : 'bg-violet-50 border-violet-200 text-violet-800'
    }`}>
      <Brain size={13} className={darkMode ? 'text-violet-400 shrink-0' : 'text-violet-500 shrink-0'} />
      <span className="flex-1 truncate">
        <span className={darkMode ? 'text-violet-400' : 'text-violet-600'}>Remember: </span>
        <strong>{suggestion.key}</strong> — {suggestion.value}
      </span>
      <button
        onClick={onAccept}
        title="Save to memory"
        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors ${
          darkMode ? 'bg-violet-700/40 hover:bg-violet-600/50 text-violet-200' : 'bg-violet-200 hover:bg-violet-300 text-violet-800'
        }`}
      >
        <Check size={10} /> Save
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        className={`p-0.5 rounded transition-colors ${darkMode ? 'text-violet-500 hover:text-violet-300' : 'text-violet-400 hover:text-violet-600'}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}
