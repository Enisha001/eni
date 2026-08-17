// @group WhisperSetupWizard : First-run guided setup for whisper.cpp speech-to-text
import { useState } from 'react';
import { CheckCircle, AlertCircle, Copy, Check, X, ChevronRight, Mic } from 'lucide-react';

interface WhisperSetupWizardProps {
  darkMode: boolean;
  onDismiss: () => void;
}

type Step = 'detect' | 'install' | 'model' | 'done';

// @group Constants : Whisper model options with size guidance
const WHISPER_MODELS = [
  { name: 'ggml-tiny.en.bin',  size: '75 MB',   speed: 'Fastest',  accuracy: 'Basic — good for short phrases' },
  { name: 'ggml-base.en.bin',  size: '142 MB',  speed: 'Fast',     accuracy: 'Good balance for most use' },
  { name: 'ggml-small.en.bin', size: '466 MB',  speed: 'Moderate', accuracy: 'Better accuracy, recommended' },
  { name: 'ggml-medium.en.bin',size: '1.5 GB',  speed: 'Slow',     accuracy: 'High accuracy, needs RAM' },
];

function CopyButton({ text, darkMode }: { text: string; darkMode: boolean }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-200 text-gray-500'}`}
      title="Copy to clipboard"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}

export default function WhisperSetupWizard({ darkMode, onDismiss }: WhisperSetupWizardProps) {
  const [step, setStep] = useState<Step>('detect');

  const bg = darkMode ? 'bg-gray-900' : 'bg-white';
  const border = darkMode ? 'border-gray-700/60' : 'border-gray-200';
  const text = darkMode ? 'text-gray-100' : 'text-gray-900';
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500';
  const codeBg = darkMode ? 'bg-gray-800 text-gray-200 border-gray-700' : 'bg-gray-100 text-gray-800 border-gray-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`relative w-full max-w-lg mx-4 rounded-2xl border shadow-2xl ${bg} ${border}`}>

        {/* @group Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center">
              <Mic size={15} className="text-blue-400" />
            </div>
            <div>
              <h2 className={`text-sm font-semibold ${text}`}>Whisper.cpp Setup</h2>
              <p className={`text-xs ${subtext}`}>Speech-to-text engine required for voice input</p>
            </div>
          </div>
          <button onClick={onDismiss} className={`p-1.5 rounded-lg transition-colors ${darkMode ? 'hover:bg-gray-800 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">

          {/* @group StepDetect : Not installed warning */}
          {step === 'detect' && (
            <>
              <div className={`flex items-start gap-3 p-3 rounded-lg border ${darkMode ? 'bg-red-900/15 border-red-800/40' : 'bg-red-50 border-red-200'}`}>
                <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className={`text-sm font-medium ${darkMode ? 'text-red-300' : 'text-red-700'}`}>Whisper.cpp not found</p>
                  <p className={`text-xs mt-0.5 ${darkMode ? 'text-red-400/80' : 'text-red-600'}`}>
                    The whisper binary was not found in your system PATH. Voice input will not work until it is installed.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={onDismiss} className={`px-3 py-1.5 rounded-lg text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>
                  Skip for now
                </button>
                <button onClick={() => setStep('install')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium">
                  Setup guide <ChevronRight size={12} />
                </button>
              </div>
            </>
          )}

          {/* @group StepInstall : Installation instructions */}
          {step === 'install' && (
            <>
              <p className={`text-xs font-semibold uppercase tracking-wide ${subtext}`}>Step 1 — Install whisper.cpp</p>
              <div className="space-y-3">
                <div>
                  <p className={`text-xs font-medium mb-1 ${text}`}>Windows (via winget)</p>
                  <div className={`flex items-center justify-between px-3 py-2 rounded-lg border font-mono text-xs ${codeBg}`}>
                    <span>winget install Openai.Whisper</span>
                    <CopyButton text="winget install Openai.Whisper" darkMode={darkMode} />
                  </div>
                </div>
                <div>
                  <p className={`text-xs font-medium mb-1 ${text}`}>Or build from source</p>
                  <div className={`space-y-1`}>
                    {[
                      'git clone https://github.com/ggerganov/whisper.cpp',
                      'cd whisper.cpp && cmake -B build && cmake --build build -j',
                      'copy build\\bin\\main.exe %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps\\whisper.exe',
                    ].map((cmd) => (
                      <div key={cmd} className={`flex items-center justify-between px-3 py-1.5 rounded border font-mono text-xs ${codeBg}`}>
                        <span className="truncate">{cmd}</span>
                        <CopyButton text={cmd} darkMode={darkMode} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <p className={`text-xs ${subtext}`}>After installation, restart Antarman so it can detect the binary.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setStep('detect')} className={`px-3 py-1.5 rounded-lg text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>Back</button>
                <button onClick={() => setStep('model')} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium">
                  Next — Download model <ChevronRight size={12} />
                </button>
              </div>
            </>
          )}

          {/* @group StepModel : Model download guidance */}
          {step === 'model' && (
            <>
              <p className={`text-xs font-semibold uppercase tracking-wide ${subtext}`}>Step 2 — Download a model</p>
              <p className={`text-xs ${subtext}`}>Whisper.cpp requires a model file. Place it in the same directory as the binary.</p>
              <div className="space-y-2">
                {WHISPER_MODELS.map((m) => (
                  <div key={m.name} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${darkMode ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-200 bg-gray-50'}`}>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-mono font-medium ${text}`}>{m.name}</p>
                      <p className={`text-xs mt-0.5 ${subtext}`}>{m.size} · {m.speed} · {m.accuracy}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg border font-mono text-xs ${codeBg}`}>
                <span>bash models/download-ggml-model.sh base.en</span>
                <CopyButton text="bash models/download-ggml-model.sh base.en" darkMode={darkMode} />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setStep('install')} className={`px-3 py-1.5 rounded-lg text-xs ${darkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-500 hover:text-gray-700'}`}>Back</button>
                <button onClick={() => setStep('done')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium">
                  Done <CheckCircle size={12} />
                </button>
              </div>
            </>
          )}

          {/* @group StepDone : Completion */}
          {step === 'done' && (
            <>
              <div className={`flex items-start gap-3 p-3 rounded-lg border ${darkMode ? 'bg-emerald-900/15 border-emerald-800/40' : 'bg-emerald-50 border-emerald-200'}`}>
                <CheckCircle size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p className={`text-sm font-medium ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Setup complete</p>
                  <p className={`text-xs mt-0.5 ${darkMode ? 'text-emerald-400/80' : 'text-emerald-600'}`}>
                    Restart Antarman after installation to enable voice input.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button onClick={onDismiss} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium">
                  Close
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
