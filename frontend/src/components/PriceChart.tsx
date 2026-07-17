import type { OhlcvPoint } from "../lib/types";

type Props = {
  data: OhlcvPoint[];
  supportLevels: number[];
  resistanceLevels: number[];
  priceAtHighs?: boolean;
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

export function PriceChart({ data, supportLevels, resistanceLevels, priceAtHighs = false }: Props) {
  if (!data.length) {
    return <div className="terminal-panel rounded-md p-4 text-sm text-textSecondary">No chart data.</div>;
  }

  const prices = data.map((point) => point.close);
  const minPrice = Math.min(...prices) * 0.995;
  const maxPrice = Math.max(...prices) * 1.005;
  const path = toLinePath(data, minPrice, maxPrice);

  return (
    <div className="terminal-panel rounded-md p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-textMuted">
        <span className="terminal-label">Price chart</span>
        <div className="flex items-center gap-2">
          {priceAtHighs && (
            <span className="rounded-sm border border-bull px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-bull">
              AT 52-WEEK HIGHS
            </span>
          )}
          <span>{new Date(data[data.length - 1].timestamp).toLocaleString()}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-72 w-full rounded-sm border border-hairline bg-page">
        <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="transparent" />
        {supportLevels.map((level, idx) => (
          <g key={`support-${idx}`}>
            <line
              x1={PADDING}
              y1={levelY(level, minPrice, maxPrice)}
              x2={WIDTH - PADDING}
              y2={levelY(level, minPrice, maxPrice)}
              stroke="#2DD4A8"
              strokeDasharray="6 6"
              strokeOpacity="0.9"
            />
            <text x={PADDING + 4} y={levelY(level, minPrice, maxPrice) - 4} fontSize="10" fill="#2DD4A8">
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
              stroke="#E25D4B"
              strokeDasharray="6 6"
              strokeOpacity="0.9"
            />
            <text x={WIDTH - 120} y={levelY(level, minPrice, maxPrice) - 4} fontSize="10" fill="#E25D4B">
              R {level.toFixed(2)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#F2F5F9" strokeWidth="2.2" />
      </svg>
    </div>
  );
}
