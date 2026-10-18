/** Offerly's mark (a ring with a check: an offer, landed) and wordmark. Same drawing as app/icon.svg. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-lg bg-accent text-accent-ink" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none" width={size * 0.58} height={size * 0.58}>
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2" />
        <path d="M5.6 8.2l1.7 1.7 3.2-3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Logo({ size = 28, hideWordOnMobile = false }: { size?: number; hideWordOnMobile?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`text-[17px] font-semibold tracking-tight ${hideWordOnMobile ? "hidden sm:inline" : ""}`}>Offerly</span>
    </span>
  );
}
