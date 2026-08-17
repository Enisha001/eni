// @group CheckInBanner : Multi-step guided daily check-in with AI reflection and MongoDB persistence
import { useState } from 'react';
import { ChevronRight, Check, X, Loader } from 'lucide-react';
import { dbSaveCheckIn } from '../tauri-api';
import type { CheckIn, CheckInResponse } from '../types';

interface CheckInBannerProps {
  darkMode: boolean;
  onStart: () => void;
  onDismiss: () => void;
  // @group AI : Called to generate a reflection from the answers
  onGenerateReflection?: (answers: string) => Promise<string>;
}

// @group Constants : The three guided check-in prompts
const QUESTIONS = [
  'How are you feeling right now?',
  "What's on your mind the most today?",
  'What is one thing you are grateful for?',
];

type Phase = 'intro' | 'questions' | 'reflecting' | 'reflection' | 'done';

export default function CheckInBanner({ darkMode, onDismiss, onGenerateReflection }: CheckInBannerProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [reflection, setReflection] = useState('');
  const [saving, setSaving] = useState(false);

  const bg = darkMode ? 'bg-gray-900' : 'bg-white';
  const border = darkMode ? 'border-gray-700/60' : 'border-gray-200';
  const text = darkMode ? 'text-white' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const inputClass = `w-full px-3 py-2.5 rounded-lg border text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
    darkMode ? 'bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-600' : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400'
  }`;

  // @group Handlers : Move to next question or proceed to reflection
  const handleNextQuestion = async () => {
    if (!answers[questionIndex].trim()) return;
    if (questionIndex < QUESTIONS.length - 1) {
      setQuestionIndex(i => i + 1);
    } else {
      // All answered — generate reflection
      setPhase('reflecting');
      let aiReflection = '';
      if (onGenerateReflection) {
        const answersText = QUESTIONS.map((q, i) => `${q}\n${answers[i]}`).join('\n\n');
        aiReflection = await onGenerateReflection(answersText).catch(() => '');
      }
      setReflection(aiReflection);
      setPhase('reflection');
    }
  };

  // @group Handlers : Save the completed check-in to MongoDB
  const handleSave = async () => {
    setSaving(true);
    try {
      const responses: CheckInResponse[] = QUESTIONS.map((q, i) => ({ question: q, answer: answers[i] }));
      const avgSentiment = 0; // Could compute from answers if needed
      const now = Date.now();
      const checkIn: CheckIn = {
        timestamp: now,
        date: new Date(now).toISOString().split('T')[0],
        responses,
        aiReflection: reflection,
        sentimentScore: avgSentiment,
      };
      await dbSaveCheckIn(checkIn);
    } catch (e) {
      console.warn('[CheckIn] Save failed:', e);
    } finally {
      setSaving(false);
      setPhase('done');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`relative w-full max-w-md mx-4 rounded-2xl border shadow-2xl ${bg} ${border}`}>

        {/* @group Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌅</span>
            <div>
              <h2 className={`text-sm font-semibold ${text}`}>Daily Check-In</h2>
              {phase === 'questions' && (
                <p className={`text-xs ${subtext}`}>Question {questionIndex + 1} of {QUESTIONS.length}</p>
              )}
            </div>
          </div>
          <button onClick={onDismiss} className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-800 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* @group Intro : Entry screen */}
          {phase === 'intro' && (
            <>
              <p className={`text-sm ${subtext}`}>
                Take a moment to reflect. You'll answer three short questions and receive a personal reflection.
              </p>
              <div className="flex gap-2">
                <button onClick={onDismiss} className={`flex-1 py-2 px-3 rounded-lg text-sm transition-colors border ${darkMode ? 'border-gray-700 bg-gray-800 hover:bg-gray-700 text-gray-400' : 'border-gray-200 bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>
                  Later
                </button>
                <button onClick={() => setPhase('questions')} className="flex-1 py-2 px-3 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors flex items-center justify-center gap-1.5">
                  Begin <ChevronRight size={14} />
                </button>
              </div>
            </>
          )}

          {/* @group Questions : One-at-a-time answering */}
          {phase === 'questions' && (
            <>
              {/* Progress bar */}
              <div className={`h-1 rounded-full overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${((questionIndex) / QUESTIONS.length) * 100}%` }}
                />
              </div>
              <p className={`text-sm font-medium ${text}`}>{QUESTIONS[questionIndex]}</p>
              <textarea
                rows={3}
                value={answers[questionIndex]}
                onChange={(e) => {
                  const next = [...answers];
                  next[questionIndex] = e.target.value;
                  setAnswers(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleNextQuestion();
                }}
                placeholder="Type your answer..."
                className={inputClass}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                {questionIndex > 0 && (
                  <button onClick={() => setQuestionIndex(i => i - 1)} className={`px-3 py-1.5 rounded-lg text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>Back</button>
                )}
                <button
                  onClick={handleNextQuestion}
                  disabled={!answers[questionIndex].trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium disabled:opacity-50"
                >
                  {questionIndex < QUESTIONS.length - 1 ? (<>Next <ChevronRight size={12} /></>) : (<>Reflect <ChevronRight size={12} /></>)}
                </button>
              </div>
            </>
          )}

          {/* @group Reflecting : Generating reflection */}
          {phase === 'reflecting' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader size={20} className="text-indigo-400 animate-spin" />
              <p className={`text-sm ${subtext}`}>Generating your reflection...</p>
            </div>
          )}

          {/* @group Reflection : Show AI reflection and save */}
          {phase === 'reflection' && (
            <>
              <div className={`p-3 rounded-lg border ${darkMode ? 'bg-indigo-900/15 border-indigo-800/40' : 'bg-indigo-50 border-indigo-200'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${darkMode ? 'text-indigo-400' : 'text-indigo-600'}`}>Your Reflection</p>
                <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                  {reflection || 'Thank you for taking time to check in today.'}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={onDismiss} className={`px-3 py-1.5 rounded-lg text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>Skip saving</button>
                <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium disabled:opacity-60">
                  {saving ? <Loader size={10} className="animate-spin" /> : <Check size={10} />}
                  Save to journal
                </button>
              </div>
            </>
          )}

          {/* @group Done : Saved confirmation */}
          {phase === 'done' && (
            <>
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <Check size={18} className="text-emerald-400" />
                </div>
                <p className={`text-sm font-medium ${text}`}>Check-in saved</p>
                <p className={`text-xs ${subtext}`}>You can review past check-ins in the weekly reflection view.</p>
              </div>
              <div className="flex justify-end">
                <button onClick={onDismiss} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium">Done</button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
