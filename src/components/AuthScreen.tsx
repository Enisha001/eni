import { useMemo, useState } from 'react';
import { ArrowRight, Lock, Mail, Sparkles, UserPlus, ShieldCheck, KeyRound, CheckCircle2 } from 'lucide-react';

export type AuthMode = 'login' | 'register' | 'forgot';

interface AuthUser {
  name: string;
  email: string;
}

interface AuthScreenProps {
  darkMode: boolean;
  onAuthenticated: (user: AuthUser) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthScreen({ darkMode, onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');

  const modeTitle = useMemo(() => {
    if (mode === 'register') return 'Create your account';
    if (mode === 'forgot') return 'Reset your password';
    return 'Welcome back';
  }, [mode]);

  const handleSubmit = () => {
    setError('');
    setSuccessMessage('');

    if (mode === 'forgot') {
      if (!EMAIL_RE.test(email)) {
        setError('Please enter a valid email address.');
        return;
      }
      setSuccessMessage('Password reset link sent to your email.');
      return;
    }

    if (mode === 'register') {
      if (!name.trim() || !EMAIL_RE.test(email) || password.length < 6) {
        setError('Name, valid email, and a password with at least 6 characters are required.');
        return;
      }
      onAuthenticated({ name: name.trim(), email: email.trim() });
      return;
    }

    if (!EMAIL_RE.test(email) || password.length < 6) {
      setError('Please enter a valid email and a password with at least 6 characters.');
      return;
    }

    onAuthenticated({ name: name.trim() || 'User', email: email.trim() });
  };

  const shellClass = darkMode
    ? 'bg-[#120b0d] text-gray-100'
    : 'bg-[radial-gradient(circle_at_top,#fffdfd_0%,#f8f0f3_32%,#f4ebee_100%)] text-[#2d151b]';

  const cardClass = darkMode
    ? 'border-[#3c2a32] bg-[#181113]/80 shadow-[0_18px_50px_rgba(0,0,0,0.26)]'
    : 'border-[#f0dfe4] bg-white/80 shadow-[0_18px_50px_rgba(124,45,58,0.08)]';

  const fieldClass = darkMode
    ? 'border-[#3d2a32] bg-[#22181d] text-gray-100 placeholder:text-gray-500 focus:border-[#d8879a]'
    : 'border-[#f1dfe5] bg-white text-[#2d151b] placeholder:text-gray-400 focus:border-[#7c2d3a]';

  return (
    <div className={`min-h-screen flex items-center justify-center p-6 ${shellClass}`}>
      <div className={`relative w-full max-w-6xl overflow-hidden rounded-[28px] border ${cardClass} backdrop-blur-xl`}>
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
          <div className={`relative hidden lg:flex flex-col justify-between overflow-hidden border-r ${darkMode ? 'border-[#382228] bg-[radial-gradient(circle_at_top,#3a1d27_0%,#1a1013_42%,#120b0d_100%)]' : 'border-[#f1e2e6] bg-[radial-gradient(circle_at_top,#fff7f8_0%,#f6edf0_34%,#f0e8eb_100%)]'}`}>
            <div className="p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#d8879a]/30 bg-[#7c2d3a]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#d8879a]">
                <Sparkles size={12} /> Antarman
              </div>

              <div className="mt-10 max-w-md">
                <h1 className={`text-4xl font-semibold tracking-[-0.06em] ${darkMode ? 'text-white' : 'text-[#2d151b]'}`}>
                  Your private inner voice, reimagined.
                </h1>
                <p className={`mt-4 text-base leading-7 ${darkMode ? 'text-gray-300' : 'text-[#6a4a52]'}`}>
                  Speak, think, reflect, and act with a calm AI companion designed for focus, memory, and meaningful conversations.
                </p>
              </div>

              <div className="mt-12 grid gap-4">
                {[
                  ['Voice-first AI', 'Natural conversation with local speech and TTS'],
                  ['Smart memory', 'Remember the moments, facts, and patterns that matter'],
                  ['Executive workflow', 'Clean dashboards and polished daily planning'],
                ].map(([title, text]) => (
                  <div key={title} className={`rounded-2xl border p-4 ${darkMode ? 'border-[#3d2a32] bg-[#1d1115]' : 'border-[#f2dfe5] bg-white/60'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] text-white">
                        <CheckCircle2 size={16} />
                      </div>
                      <div>
                        <div className={`text-sm font-semibold ${darkMode ? 'text-white' : 'text-[#2d151b]'}`}>{title}</div>
                        <div className={`text-xs ${darkMode ? 'text-gray-400' : 'text-[#755a62]'}`}>{text}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`border-t px-8 py-5 text-xs ${darkMode ? 'border-[#382228] text-gray-400' : 'border-[#f1e2e6] text-[#7d5d66]'}`}>
              Built for reflection, productivity, and premium personal AI experiences.
            </div>
          </div>

          <div className="p-6 sm:p-8 lg:p-10">
            <div className="mb-8 flex items-center justify-between gap-3">
              <div>
                <div className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${darkMode ? 'text-[#f3bfd1]' : 'text-[#7c2d3a]'}`}>
                  Secure access
                </div>
                <h2 className={`mt-2 text-2xl font-semibold tracking-[-0.04em] ${darkMode ? 'text-white' : 'text-[#2d151b]'}`}>
                  {modeTitle}
                </h2>
              </div>
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] text-white shadow-[0_10px_25px_rgba(124,45,58,0.22)]`}>
                <ShieldCheck size={20} />
              </div>
            </div>

            <div className="space-y-4">
              {mode === 'register' && (
                <label className="block">
                  <span className={`mb-1.5 block text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-[#5d4049]'}`}>Full name</span>
                  <div className="relative">
                    <UserPlus size={15} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-[#8d6a72]'}`} />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={`w-full rounded-2xl border py-3 pl-10 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-[#d8879a]/30 ${fieldClass}`}
                      placeholder="Alex Johnson"
                    />
                  </div>
                </label>
              )}

              <label className="block">
                <span className={`mb-1.5 block text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-[#5d4049]'}`}>Email</span>
                <div className="relative">
                  <Mail size={15} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-[#8d6a72]'}`} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`w-full rounded-2xl border py-3 pl-10 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-[#d8879a]/30 ${fieldClass}`}
                    placeholder="you@example.com"
                  />
                </div>
              </label>

              {mode !== 'forgot' && (
                <label className="block">
                  <span className={`mb-1.5 block text-xs font-medium ${darkMode ? 'text-gray-300' : 'text-[#5d4049]'}`}>Password</span>
                  <div className="relative">
                    <Lock size={15} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${darkMode ? 'text-gray-500' : 'text-[#8d6a72]'}`} />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`w-full rounded-2xl border py-3 pl-10 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-[#d8879a]/30 ${fieldClass}`}
                      placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter password'}
                    />
                  </div>
                </label>
              )}

              {error && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                  {successMessage}
                </div>
              )}

              <button
                onClick={handleSubmit}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#8b2f42_0%,#5b1f2e_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(124,45,58,0.2)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(124,45,58,0.26)]"
              >
                {mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
                <ArrowRight size={15} />
              </button>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 text-xs">
              <button
                onClick={() => {
                  setMode('login');
                  setError('');
                  setSuccessMessage('');
                }}
                className={darkMode ? 'text-gray-400 hover:text-white' : 'text-[#7f5863] hover:text-[#5b1f2e]'}
              >
                Login
              </button>
              <button
                onClick={() => {
                  setMode('register');
                  setError('');
                  setSuccessMessage('');
                }}
                className={darkMode ? 'text-gray-400 hover:text-white' : 'text-[#7f5863] hover:text-[#5b1f2e]'}
              >
                Register
              </button>
              <button
                onClick={() => {
                  setMode('forgot');
                  setError('');
                  setSuccessMessage('');
                }}
                className={darkMode ? 'text-gray-400 hover:text-white' : 'text-[#7f5863] hover:text-[#5b1f2e]'}
              >
                Forgot password
              </button>
            </div>

            <div className={`mt-8 rounded-2xl border p-3 text-xs ${darkMode ? 'border-[#3d2a32] bg-[#151013] text-gray-400' : 'border-[#f1dfe5] bg-[#fff8fa] text-[#6b4c57]'}`}>
              <div className="flex items-center gap-2 font-medium text-[#7c2d3a]">
                <KeyRound size={14} /> Demo access
              </div>
              <div className="mt-2">Use any valid email and a password of 6+ characters to continue.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
