"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Moon, Settings, Sun, Video } from "lucide-react";
import { useProfile } from "@/lib/db";
import { getTheme, setTheme as applyTheme } from "@/lib/theme";
import { NAV } from "@/lib/nav";
import { MobileNav } from "@/components/MobileNav";

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: profile, loading } = useProfile();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const sync = () => setTheme(getTheme());
    sync();
    window.addEventListener("interviewprep:theme", sync);
    return () => window.removeEventListener("interviewprep:theme", sync);
  }, []);

  const toggleTheme = () => applyTheme(theme === "dark" ? "light" : "dark");

  const bare = path === "/welcome" || path === "/onboarding";
  const onboarded = !!profile?.onboarded;

  // Route guard: new users go through the landing + onboarding first.
  useEffect(() => {
    if (loading) return;
    if (!onboarded && !bare) router.replace("/welcome");
    else if (onboarded && path === "/welcome") router.replace("/");
  }, [loading, onboarded, bare, path, router]);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const inInterview = path.startsWith("/interview/");
  // The bottom tab bar replaces the top nav on phones; hide it on the auth flow and during an
  // active interview, where a full-screen, distraction-free layout matters more than navigation.
  const showMobileNav = !bare && !inInterview;

  return (
    <div className="mx-auto flex h-screen max-w-[1500px] flex-col p-0 sm:p-3 lg:p-6">
      <div className="glass relative flex min-h-0 flex-1 flex-col rounded-none p-3 shadow-2xl shadow-indigo-900/10 sm:rounded-[2rem] sm:p-6">
        <header className="flex shrink-0 items-center justify-between gap-3 pt-[env(safe-area-inset-top)]">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-ink sm:h-11 sm:w-11">
              <Video size={20} />
            </span>
            <span className="hidden text-lg font-semibold tracking-tight sm:block">Offerly</span>
          </Link>

          {!bare && (
          <nav className="glass hidden items-center gap-1 rounded-full p-1.5 lg:flex">
            {NAV.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-full px-3 py-2 text-sm transition sm:px-5 ${
                  active(href) ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          )}

          <div className="glass flex items-center gap-1 rounded-full p-1.5">
            <button onClick={toggleTheme} aria-label="Toggle theme" className="grid h-9 w-9 place-items-center rounded-full hover:bg-soft active:scale-90">
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            {onboarded && (
              <>
                <Link href="/settings" aria-label="Settings" className="hidden h-9 w-9 place-items-center rounded-full hover:bg-soft sm:grid">
                  <Settings size={17} />
                </Link>
                <Link href="/settings" className="grid h-9 w-9 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-ink active:scale-90" title={profile?.name}>
                  {profile?.name?.[0]?.toUpperCase()}
                </Link>
              </>
            )}
          </div>
        </header>

        <main className={`min-h-0 flex-1 overflow-y-auto ${inInterview ? "mt-5" : "mt-6 sm:mt-8"} ${showMobileNav ? "pb-20 lg:pb-0" : ""}`}>
          {loading || (!onboarded && !bare) ? null : children}
        </main>

        {showMobileNav && <MobileNav />}
      </div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-card p-5 shadow-sm sm:p-6 ${className}`}>{children}</section>;
}

export function PageTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-3xl font-light tracking-tight sm:text-5xl">{title}</h1>
      {sub && <p className="mt-2 text-muted">{sub}</p>}
    </div>
  );
}
