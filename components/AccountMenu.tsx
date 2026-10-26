"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Building2, LogOut, Settings, ShieldCheck } from "lucide-react";
import { signOut, useAuth, useMyOrgs, useProfile } from "@/lib/db";

const ITEM = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-soft focus-visible:bg-soft";

/**
 * The avatar in the header: who is signed in, and the places that belong to the account rather
 * than to practice (settings, the person's organisations, the admin console for super-admins),
 * plus sign out. Closes on outside click, Escape and navigation.
 */
export function AccountMenu() {
  const router = useRouter();
  const path = usePathname();
  const { data: auth } = useAuth();
  const { data: profile } = useProfile();
  const { data: orgs = [] } = useMyOrgs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Any navigation (a menu link, the back button) closes the menu.
  const [seenPath, setSeenPath] = useState(path);
  if (seenPath !== path) {
    setSeenPath(path);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const accounts = auth?.mode === "supabase" && !!auth.user;
  const email = auth?.user?.email;

  const handleSignOut = async () => {
    setBusy(true);
    await signOut();
    setOpen(false);
    setBusy(false);
    router.replace("/welcome");
  };

  return (
    <div ref={root} className="relative ml-1">
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent active:scale-95"
      >
        {profile?.name?.[0]?.toUpperCase() ?? "?"}
      </button>

      {open && (
        <div role="menu" aria-label="Account" className="glass absolute right-0 top-11 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl p-1.5">
          <div className="border-b border-line px-3 pb-2.5 pt-1.5">
            <div className="truncate text-sm font-medium">{profile?.name}</div>
            {email && <div className="truncate text-xs text-muted">{email}</div>}
          </div>

          <div className="grid grid-cols-1 gap-0.5 py-1.5">
            <Link role="menuitem" href="/settings" className={ITEM}>
              <Settings size={16} className="text-muted" /> Settings
            </Link>
            {orgs.map((o) => (
              <Link key={o.id} role="menuitem" href={`/org/${o.slug}`} className={ITEM}>
                <Building2 size={16} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="text-xs capitalize text-muted">{o.role}</span>
              </Link>
            ))}
            {auth?.superAdmin && (
              <Link role="menuitem" href="/admin/orgs" className={ITEM}>
                <ShieldCheck size={16} className="text-muted" /> Admin console
              </Link>
            )}
          </div>

          {accounts && (
            <div className="border-t border-line pt-1.5">
              <button role="menuitem" onClick={handleSignOut} disabled={busy} className={`${ITEM} disabled:opacity-50`}>
                <LogOut size={16} className="text-muted" /> {busy ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
