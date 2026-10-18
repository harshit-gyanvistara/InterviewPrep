"use client";

import { useUsage } from "@/lib/db";

/** "3 of 5 mocks left today" from the user's package (plans/usage-limits.md). Renders nothing when unlimited or unknown. */
export function MocksLeft({ className = "" }: { className?: string }) {
  const { data } = useUsage();
  const m = data?.meters.find((x) => x.meter === "mocks");
  if (!m || m.limit === null) return null;
  if (m.limit === 0) return <p className={`text-xs text-danger ${className}`}>Mock interviews aren&apos;t included in your plan.</p>;
  const left = Math.max(0, m.limit - m.used);
  const reset = m.resetsAt
    ? new Date(m.resetsAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })
    : null;
  return (
    <p className={`text-xs ${left === 0 ? "text-danger" : "text-muted"} ${className}`}>
      {left === 0
        ? `You've used all ${m.limit} mocks for today${reset ? `. More at ${reset} IST.` : "."}`
        : `${left} of ${m.limit} mocks left today.`}
    </p>
  );
}

/** True when the user has no mocks left this period (false while loading or when unlimited). */
export function useOutOfMocks(): boolean {
  const { data } = useUsage();
  const m = data?.meters.find((x) => x.meter === "mocks");
  return !!m && m.limit !== null && m.used >= m.limit;
}
