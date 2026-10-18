import Link from "next/link";

/** What a section shows before it has anything: what will appear here, and the one action that fills it. */
export function EmptyState({
  icon,
  title,
  text,
  action,
  className = "",
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
}) {
  return (
    <div className={`grid justify-items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center ${className}`}>
      <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">{icon}</span>
      <h3 className="mt-1 font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted">{text}</p>
      {action &&
        (action.href ? (
          <Link href={action.href} className="btn btn-primary mt-2">{action.label}</Link>
        ) : (
          <button onClick={action.onClick} className="btn btn-primary mt-2">{action.label}</button>
        ))}
    </div>
  );
}
