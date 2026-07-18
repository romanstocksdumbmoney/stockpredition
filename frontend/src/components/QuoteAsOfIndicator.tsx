import { useEffect, useMemo, useState } from "react";

type QuoteStatus = "idle" | "ok" | "error";

type Props = {
  asOf?: string;
  status: QuoteStatus;
  pulse: number;
};

function formatAsOf(value?: string): string {
  if (!value) return "as of --";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "as of --";
  return `as of ${date.toLocaleTimeString()}`;
}

export function QuoteAsOfIndicator({ asOf, status, pulse }: Props) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    if (pulse <= 0) return;
    setBlink(true);
    const timer = window.setTimeout(() => setBlink(false), 150);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  const dotColor = useMemo(() => {
    if (status === "error") return "bg-warn";
    if (status === "ok") return "bg-bull";
    return "bg-textMuted";
  }, [status]);

  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-textMuted mono-numeric">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor} transition-opacity duration-150 ${blink ? "opacity-35" : "opacity-100"}`} />
      {formatAsOf(asOf)}
    </span>
  );
}
