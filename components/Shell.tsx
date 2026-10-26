"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Settings, Sun } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useAuth, useProfile } from "@/lib/db";
import { getTheme, setTheme as applyTheme } from "@/lib/theme";
import { NAV } from "@/lib/nav";
import { PENDING_JOIN_KEY, isBarePage, redirectFor } from "@/lib/pages";
import { MobileNav } from "@/components/MobileNav";
import { AccountMenu } from "@/components/AccountMenu";
import { PageSkeleton } from "@/components/Skeleton";
import { SyncNote } from "@/components/SyncNote";
import { PractisingFor } from "@/components/PractisingFor";

/** An invite opened while signed out (lib/pages.ts). Storage can be unavailable (private mode): then there's none. */
function pendingJoin(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(PENDING_JOIN_KEY);
  } catch {
    return null;
  }
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: auth, loading: authLoading } = useAuth();
  const { data: profile, loading: profileLoading, error: profileError } = useProfile();
  const loading = authLoading || profileLoading;
  const loadError = auth?.error ?? profileError;
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => setTheme(getTheme());
    sync();
    window.addEventListener("interviewprep:theme", sync);
    return () => window.removeEventListener("interviewprep:theme", sync);
  }, []);

  const toggleTheme = () => applyTheme(theme === "dark" ? "light" : "dark");

  const bare = isBarePage(path);
  const onboarded = !!profile?.onboarded;
  // Never guess when the server couldn't be reached: that could send an onboarded user to onboarding.
  const redirect = loading || loadError || !auth ? null : redirectFor(path, auth, onboarded, pendingJoin());

  // Route guard. proxy.ts already sends signed-out page loads to /welcome; this covers client-side navigation.
  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inInterview = path.startsWith("/interview/");
  // The bottom tab bar replaces the top nav on phones; hide it on the auth flow and during an
  // active interview, where a full-screen, distraction-free layout matters more than navigation.
  const showMobileNav = !bare && !inInterview;

  return (
    <div className="relative flex h-screen flex-col bg-bg">
      <header className="shrink-0 border-b border-line bg-card pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-15 max-w-[1120px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" aria-label="Offerly home">
            <Logo />
          </Link>

          {!bare && (
            <nav className="hidden min-w-0 flex-1 items-center gap-1 lg:flex" aria-label="Main">
              {NAV.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  aria-current={active(href) ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active(href) ? "bg-soft text-ink" : "text-muted hover:text-ink"}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            {!bare && <PractisingFor className="hidden sm:flex" />}
            {!bare && <SyncNote />}
            <button onClick={toggleTheme} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink active:scale-95">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {onboarded && (
              <>
                <Link href="/settings" aria-label="Settings" className="hidden h-9 w-9 place-items-center rounded-lg text-muted hover:bg-soft hover:text-ink sm:grid">
                  <Settings size={17} />
                </Link>
                <AccountMenu />
              </>
            )}
          </div>
        </div>
      </header>

      <main className={`min-h-0 flex-1 overflow-y-auto ${showMobileNav ? "pb-20 lg:pb-0" : ""}`}>
        <div className={`mx-auto px-4 sm:px-6 ${inInterview ? "max-w-[1280px] py-4 sm:py-6" : "max-w-[1120px] py-6 sm:py-10"}`}>
          {loadError ? (
            <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-card p-6 text-center">
              <p className="font-medium">Couldn&apos;t reach Offerly</p>
              <p className="mt-1 text-sm text-muted">{loadError}</p>
              <button className="btn btn-primary mt-4" onClick={() => window.location.reload()}>Try again</button>
            </div>
          ) : loading ? (
            bare ? null : <PageSkeleton />
          ) : redirect ? null : (
            children
          )}
        </div>
      </main>

      {showMobileNav && <MobileNav />}
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6 sm:mb-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[30px] sm:leading-9">{title}</h1>
      {sub && <p className="mt-1.5 text-muted">{sub}</p>}
    </div>
  );
}
