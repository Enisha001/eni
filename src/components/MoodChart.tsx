// @group MoodChart : SVG sparkline rendering sentiment scores for a conversation

interface MoodChartProps {
  scores: number[];  // values in -1.0 to 1.0
  width?: number;
  height?: number;
  darkMode?: boolean;
}

// @group Utilities : Map a -1..1 score to a y coordinate within the chart height
function scoreToY(score: number, height: number): number {
  // -1 maps to height-1 (bottom), +1 maps to 1 (top)
  return Math.round(((1 - score) / 2) * (height - 2)) + 1;
}

// @group Utilities : Pick a stroke color based on average sentiment
function sentimentColor(scores: number[], darkMode: boolean): string {
  if (scores.length === 0) return darkMode ? '#4b5563' : '#d1d5db';
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg > 0.15) return '#34d399';   // green
  if (avg < -0.15) return '#f87171';  // red
  return '#60a5fa';                   // neutral blue
}

export default function MoodChart({ scores, width = 48, height = 18, darkMode = true }: MoodChartProps) {
  if (scores.length < 2) {
    // Not enough data — show a flat neutral line
    const y = Math.round(height / 2);
    return (
      <svg width={width} height={height} className="opacity-40">
        <line x1={0} y1={y} x2={width} y2={y} stroke={darkMode ? '#4b5563' : '#d1d5db'} strokeWidth={1} />
      </svg>
    );
  }

  const step = (width - 2) / (scores.length - 1);
  const points = scores.map((s, i) => `${1 + i * step},${scoreToY(s, height)}`).join(' ');
  const color = sentimentColor(scores, darkMode);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.85}
      />
      {/* Last data point dot */}
      <circle
        cx={1 + (scores.length - 1) * step}
        cy={scoreToY(scores[scores.length - 1], height)}
        r={2}
        fill={color}
      />
    </svg>
  );
}
