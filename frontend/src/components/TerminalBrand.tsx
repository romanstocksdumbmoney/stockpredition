type Props = {
  compact?: boolean;
};

export function TerminalBrand({ compact = false }: Props) {
  const size = compact ? 34 : 76;
  const wordmark = compact ? "text-sm" : "text-2xl";

  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        role="img"
        aria-label="TradeBot whale mark"
        className="shrink-0"
      >
        <polygon points="10,76 42,50 68,50 94,66 110,66 88,84 64,84 38,96" fill="#0E1B26" stroke="#2DD4A8" strokeWidth="2" />
        <polygon points="30,58 52,40 72,40 58,56" fill="#0E1B26" stroke="#2DD4A8" strokeWidth="2" />
        <polygon points="74,50 96,40 90,58" fill="#0E1B26" stroke="#2DD4A8" strokeWidth="2" />
        <circle cx="64" cy="60" r="2.8" fill="#2DD4A8" />
      </svg>
      <div>
        <p className={`${wordmark} font-semibold tracking-[0.34em] text-textPrimary`}>TRADEBOT</p>
      </div>
    </div>
  );
}
