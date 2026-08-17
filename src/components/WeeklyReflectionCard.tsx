// @group WeeklyReflectionCard : AI-generated weekly summary card with mood chart and generate/history views
import { useState, useEffect, useCallback } from 'react';
import { Sparkles, Calendar, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import { dbGetWeeklyData, dbSaveReflection, dbGetReflections } from '../tauri-api';
import type { Reflection, WeeklyData } from '../types';
import MoodChart from './MoodChart';

interface WeeklyReflectionCardProps {
  darkMode: boolean;
  onGenerateReflection: (weekData: WeeklyData) => Promise<string>;
}

// @group Utilities : Get the Monday of the current week (ISO)
function getWeekStart(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function WeeklyReflectionCard({ darkMode, onGenerateReflection }: WeeklyReflectionCardProps) {
  const [weekData, setWeekData] = useState<WeeklyData | null>(null);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [generating, setGenerating] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekStart = getWeekStart();
  const weekStartMs = weekStart.getTime();

  const loadData = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const [data, history] = await Promise.all([
        dbGetWeeklyData(weekStartMs),
        dbGetReflections(10),
      ]);
      setWeekData(data);
      setReflections(history);
    } catch (e) {
      setError('Could not load data. Is MongoDB connected?');
    } finally {
      setLoadingData(false);
    }
  }, [weekStartMs]);

  useEffect(() => { loadData(); }, [loadData]);

  // @group Handlers : Generate a new reflection for this week
  const handleGenerate = async () => {
    if (!weekData) return;
    setGenerating(true);
    setError(null);
    try {
      const summary = await onGenerateReflection(weekData);
      const reflection: Reflection = {
        weekStartDate: weekData.weekStartDate,
        generatedAt: Date.now(),
        summary,
        avgSentiment: weekData.avgSentiment,
        conversationIds: weekData.conversationIds,
        checkInCount: weekData.checkInCount,
      };
      await dbSaveReflection(reflection);
      await loadData();
    } catch (e) {
      setError('Failed to generate reflection. Check your AI provider settings.');
    } finally {
      setGenerating(false);
    }
  };

  const border = darkMode ? 'border-gray-700/40' : 'border-gray-200';
  const text = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const cardBg = darkMode ? 'bg-gray-800/50' : 'bg-gray-50';

  // Current week's reflection (most recent with matching date)
  const currentReflection = reflections.find(r => r.weekStartDate === weekData?.weekStartDate);
  const pastReflections = reflections.filter(r => r.weekStartDate !== weekData?.weekStartDate);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={`px-3 py-2.5 border-b shrink-0 ${border}`}>
        <div className="flex items-center gap-1.5">
          <Sparkles size={12} className="text-amber-400" />
          <span className={`text-xs font-semibold ${text}`}>Weekly Reflection</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loadingData && (
          <div className={`flex items-center justify-center py-8 ${subtext}`}>
            <Loader size={16} className="animate-spin" />
          </div>
        )}

        {error && (
          <div className={`text-xs px-3 py-2 rounded-lg border ${darkMode ? 'bg-red-900/20 border-red-800/40 text-red-300' : 'bg-red-50 border-red-200 text-red-600'}`}>
            {error}
          </div>
        )}

        {!loadingData && weekData && (
          <>
            {/* @group WeekStats : Current week at a glance */}
            <div className={`p-3 rounded-xl border ${cardBg} ${border}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar size={10} className={subtext} />
                <span className={`text-xs font-medium ${subtext}`}>
                  Week of {new Date(weekStartMs).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center mb-2">
                {[
                  { label: 'Messages', value: weekData.messageCount },
                  { label: 'Sessions', value: weekData.conversationCount },
                  { label: 'Check-ins', value: weekData.checkInCount },
                ].map(({ label, value }) => (
                  <div key={label} className={`rounded-lg p-1.5 ${darkMode ? 'bg-gray-700/50' : 'bg-white border border-gray-200'}`}>
                    <p className={`text-base font-bold ${text}`}>{value}</p>
                    <p className={`text-xs ${subtext}`}>{label}</p>
                  </div>
                ))}
              </div>
              {weekData.messageCount >= 2 && (
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${subtext}`}>Mood</span>
                  <MoodChart
                    scores={Array(weekData.messageCount).fill(weekData.avgSentiment)}
                    width={80}
                    height={16}
                    darkMode={darkMode}
                  />
                </div>
              )}
            </div>

            {/* @group CurrentReflection : This week's AI reflection or generate prompt */}
            {currentReflection ? (
              <div className={`p-3 rounded-xl border ${darkMode ? 'bg-amber-900/15 border-amber-800/30' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={10} className="text-amber-400" />
                  <span className={`text-xs font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>This Week's Reflection</span>
                </div>
                <p className={`text-xs leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{currentReflection.summary}</p>
                <p className={`text-xs mt-2 ${subtext}`}>
                  {new Date(currentReflection.generatedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={generating || weekData.messageCount === 0}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-medium transition-all ${
                  generating || weekData.messageCount === 0
                    ? darkMode ? 'border-gray-700/40 text-gray-600 cursor-not-allowed' : 'border-gray-200 text-gray-400 cursor-not-allowed'
                    : darkMode ? 'border-amber-700/40 bg-amber-900/10 hover:bg-amber-900/20 text-amber-400' : 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700'
                }`}
              >
                {generating
                  ? <><Loader size={12} className="animate-spin" /> Generating…</>
                  : weekData.messageCount === 0
                  ? 'No conversations this week yet'
                  : <><Sparkles size={12} /> Generate this week's reflection</>
                }
              </button>
            )}

            {/* @group PastReflections : Collapsible history */}
            {pastReflections.length > 0 && (
              <div>
                <button
                  onClick={() => setShowHistory(h => !h)}
                  className={`flex items-center gap-1 text-xs ${subtext} hover:${text} transition-colors`}
                >
                  {showHistory ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  Past reflections ({pastReflections.length})
                </button>
                {showHistory && (
                  <div className="mt-2 space-y-2">
                    {pastReflections.map((r) => (
                      <div key={r.id ?? r.weekStartDate} className={`p-2.5 rounded-lg border ${darkMode ? 'bg-gray-800/40 border-gray-700/40' : 'bg-gray-50 border-gray-200'}`}>
                        <p className={`text-xs font-medium mb-1 ${subtext}`}>Week of {r.weekStartDate}</p>
                        <p className={`text-xs leading-relaxed ${text}`}>{r.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
