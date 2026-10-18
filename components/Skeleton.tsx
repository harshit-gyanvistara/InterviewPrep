/** A grey placeholder block shown while data loads, instead of a blank screen. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-soft motion-reduce:animate-none ${className}`} />;
}

/** Generic page placeholder: a title, a hero card and a row of cards. Used by the shell and by pages while their data loads. */
export function PageSkeleton() {
  return (
    <div className="grid gap-5" role="status" aria-label="Loading">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="grid gap-3 rounded-xl border border-line bg-card p-6">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-3 rounded-xl border border-line bg-card p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}
