// @group VoiceVisualizer : Animated orb that doubles as the voice record/stop button
import { Mic, Loader2 } from 'lucide-react';

interface VoiceVisualizerProps {
  isRecording: boolean;
  isProcessing: boolean;
  isSpeaking: boolean;
  darkMode?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

// @group WaveformIcon : Animated bars shown during audio playback
function WaveformIcon() {
  const bars = [
    { delay: '0ms',   height: [40, 80, 30, 60, 40] },
    { delay: '80ms',  height: [60, 30, 80, 40, 70] },
    { delay: '160ms', height: [80, 60, 40, 80, 30] },
    { delay: '240ms', height: [30, 80, 60, 30, 80] },
    { delay: '320ms', height: [60, 40, 80, 60, 40] },
  ];

  return (
    <div className="flex items-end justify-center gap-[3px] h-7 w-8">
      {bars.map((bar, i) => (
        <span
          key={i}
          className="w-1 rounded-full bg-white"
          style={{
            animation: `waveBar 0.8s ease-in-out ${bar.delay} infinite alternate`,
            height: '40%',
          }}
        />
      ))}
      <style>{`
        @keyframes waveBar {
          0%   { height: 25%; }
          25%  { height: 80%; }
          50%  { height: 40%; }
          75%  { height: 90%; }
          100% { height: 30%; }
        }
        @keyframes waveBar1 { 0% { height: 40%; } 50% { height: 80%; } 100% { height: 30%; } }
      `}</style>
    </div>
  );
}

export default function VoiceVisualizer({
  isRecording,
  isProcessing,
  isSpeaking,
  darkMode = true,
  onClick,
  disabled = false,
}: VoiceVisualizerProps) {
  const gradient = isRecording
    ? 'from-[#a33d52] to-[#7c2d3a]'
    : isProcessing
    ? 'from-[#cf7b8f] to-[#a33d52]'
    : isSpeaking
    ? 'from-[#c45d73] to-[#7c2d3a]'
    : 'from-[#f4dfe5] to-[#d8879a]';

  const active = isRecording || isProcessing || isSpeaking;

  const icon = isProcessing
    ? <Loader2 className="animate-spin text-white" size={26} />
    : isSpeaking
    ? <WaveformIcon />
    : <Mic className={`text-white ${isRecording ? 'animate-pulse' : ''}`} size={26} />;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative group focus:outline-none ${disabled ? 'opacity-60 cursor-not-allowed' : onClick ? 'cursor-pointer' : 'cursor-default'}`}
      title={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {/* Animated ripple ring when active */}
      {active && (
        <span className={`absolute -inset-2.5 rounded-full bg-linear-to-r ${gradient} opacity-10 animate-ping pointer-events-none`} />
      )}
      {active && (
        <span className={`absolute -inset-1 rounded-full bg-linear-to-r ${gradient} opacity-15 animate-pulse pointer-events-none`} />
      )}

      {/* Main orb */}
      <div className={`relative w-20 h-20 rounded-full bg-linear-to-br ${gradient} shadow-[0_12px_30px_rgba(124,45,58,0.18)] flex items-center justify-center transition-transform duration-150 ${!disabled && onClick ? 'group-hover:scale-105 group-active:scale-95' : ''}`}>
        {/* Glass inner circle */}
        <div className={`w-15 h-15 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-900/60' : 'bg-white/60'} backdrop-blur-sm`}>
          {icon}
        </div>
      </div>

      {/* Status label — in normal flow, not absolute */}
      <div className={`mt-2 text-center whitespace-nowrap text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {isRecording ? 'Recording...' : isProcessing ? 'Processing...' : isSpeaking ? 'Speaking...' : onClick ? 'Tap to speak' : 'Ready'}
      </div>
    </button>
  );
}
