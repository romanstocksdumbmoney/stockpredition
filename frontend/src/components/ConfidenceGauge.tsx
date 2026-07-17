import type { ConfidenceDirection } from "../lib/types";

type Props = {
  confidence: number;
  direction: ConfidenceDirection;
};

function directionColor(direction: ConfidenceDirection): string {
  if (direction === "bullish") return "#22c55e";
  if (direction === "bearish") return "#ef4444";
  return "#f59e0b";
}

export function ConfidenceGauge({ confidence, direction }: Props) {
  const clamped = Math.max(0, Math.min(confidence, 100));
  const color = directionColor(direction);
  const gaugeStyle = {
    background: `conic-gradient(${color} ${clamped * 3.6}deg, #1e293b 0deg)`
  };

  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
      <div className="relative h-24 w-24 rounded-full p-2" style={gaugeStyle}>
        <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-950 text-lg font-bold text-slate-100">
          {clamped}%
        </div>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-400">Confidence</p>
        <p className="text-xl font-semibold capitalize text-slate-100">{direction}</p>
        <p className="text-sm text-slate-400">Conservative scoring; markets are uncertain.</p>
      </div>
    </div>
  );
}
