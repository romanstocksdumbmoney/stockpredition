import type { OhlcvPoint } from "../lib/types";

type Props = {
  data: OhlcvPoint[];
  supportLevels: number[];
  resistanceLevels: number[];
};

const WIDTH = 760;
const HEIGHT = 280;
const PADDING = 24;

function toLinePath(data: OhlcvPoint[], minPrice: number, maxPrice: number): string {
  if (data.length === 0 || maxPrice === minPrice) return "";
  return data
    .map((point, index) => {
      const x = PADDING + (index / Math.max(1, data.length - 1)) * (WIDTH - PADDING * 2);
      const y = PADDING + ((maxPrice - point.close) / (maxPrice - minPrice)) * (HEIGHT - PADDING * 2);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function levelY(level: number, minPrice: number, maxPrice: number): number {
  return PADDING + ((maxPrice - level) / (maxPrice - minPrice)) * (HEIGHT - PADDING * 2);
}

export function PriceChart({ data, supportLevels, resistanceLevels }: Props) {
  if (!data.length) {
    return <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-300">No chart data.</div>;
  }

  const prices = data.map((point) => point.close);
  const minPrice = Math.min(...prices) * 0.995;
  const maxPrice = Math.max(...prices) * 1.005;
  const path = toLinePath(data, minPrice, maxPrice);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>Price chart (close)</span>
        <span>{new Date(data[data.length - 1].timestamp).toLocaleString()}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-72 w-full rounded-lg bg-slate-950">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" />
        {supportLevels.map((level, idx) => (
          <g key={`support-${idx}`}>
            <line
              x1={PADDING}
              y1={levelY(level, minPrice, maxPrice)}
              x2={WIDTH - PADDING}
              y2={levelY(level, minPrice, maxPrice)}
              stroke="#22c55e"
              strokeDasharray="6 6"
              strokeOpacity="0.5"
            />
            <text x={PADDING + 4} y={levelY(level, minPrice, maxPrice) - 4} fontSize="10" fill="#22c55e">
              S {level.toFixed(2)}
            </text>
          </g>
        ))}
        {resistanceLevels.map((level, idx) => (
          <g key={`resistance-${idx}`}>
            <line
              x1={PADDING}
              y1={levelY(level, minPrice, maxPrice)}
              x2={WIDTH - PADDING}
              y2={levelY(level, minPrice, maxPrice)}
              stroke="#ef4444"
              strokeDasharray="6 6"
              strokeOpacity="0.5"
            />
            <text x={WIDTH - 120} y={levelY(level, minPrice, maxPrice) - 4} fontSize="10" fill="#ef4444">
              R {level.toFixed(2)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2.5" />
      </svg>
    </div>
  );
}
