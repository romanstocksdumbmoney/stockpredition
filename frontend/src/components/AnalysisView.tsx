import type { AnalysisResult } from "../lib/types";
import { ConfidenceGauge } from "./ConfidenceGauge";
import { PriceChart } from "./PriceChart";

type Props = {
  analysis: AnalysisResult;
};

function caseColumn(title: string, points: string[], theme: "bull" | "bear") {
  const border = theme === "bull" ? "border-bull/50" : "border-bear/50";
  const bullet = theme === "bull" ? "text-bull" : "text-bear";
  return (
    <div className={`rounded-xl border ${border} bg-slate-900 p-4`}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">{title}</h3>
      <ul className="space-y-2 text-sm text-slate-200">
        {points.map((point, idx) => (
          <li key={`${title}-${idx}`} className="flex gap-2">
            <span className={`${bullet}`}>•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisView({ analysis }: Props) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-700 bg-slate-900/70 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Ticker</p>
          <h2 className="text-2xl font-bold text-slate-100">{analysis.ticker}</h2>
          <p className="mt-1 text-sm text-slate-300">{analysis.summary}</p>
        </div>
        <ConfidenceGauge confidence={analysis.confidence_pct} direction={analysis.confidence_direction} />
      </div>

      <PriceChart
        data={analysis.chart.ohlcv}
        supportLevels={analysis.chart.support_levels}
        resistanceLevels={analysis.chart.resistance_levels}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {caseColumn("Bull case", analysis.bull_case, "bull")}
        {caseColumn("Bear case", analysis.bear_case, "bear")}
      </div>

      <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-amber-200">Risk flags</p>
        <div className="flex flex-wrap gap-2">
          {analysis.risk_flags.map((flag, idx) => (
            <span key={`risk-${idx}`} className="rounded-full bg-amber-400/20 px-3 py-1 text-xs text-amber-100">
              {flag}
            </span>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <p className="text-xs uppercase tracking-wide text-slate-400">Pattern summary</p>
        <p className="mt-1 text-sm text-slate-200">{analysis.pattern_summary}</p>
        {analysis.key_flow_signal && (
          <>
            <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Options flow</p>
            <p className="mt-1 text-sm text-slate-200">{analysis.key_flow_signal}</p>
          </>
        )}
      </div>
    </section>
  );
}
