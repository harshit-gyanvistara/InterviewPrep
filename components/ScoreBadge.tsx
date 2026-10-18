import { scoreTone, type Tone } from "@/lib/analysis";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

/** A score in a tinted square (dashboard, progress, report lists). `max` 10 scales dimension scores. */
export function ScoreBadge({ score, max = 100, size = 44 }: { score: number; max?: 100 | 10; size?: number }) {
  const tone = scoreTone(max === 10 ? score * 10 : score);
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[10px] font-semibold tabular-nums ${TONE[tone]}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {max === 10 ? score.toFixed(1) : Math.round(score)}
    </span>
  );
}

/** A small status pill, e.g. the verdict next to a score. */
export function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>{children}</span>;
}
