"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";

/**
 * Native-style bottom tab bar, shown only on phones/small tablets (the desktop pill nav takes
 * over at the lg breakpoint). Anchored to the bottom of the app shell's card, with safe-area
 * padding so it clears the home indicator on notched phones.
 */
export function MobileNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <nav
      className="glass absolute inset-x-0 bottom-0 grid grid-cols-6 border-t border-line lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {NAV.map(({ href, label, icon: Icon }) => {
        const isActive = active(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] transition active:scale-95 ${isActive ? "text-ink" : "text-muted"}`}
          >
            <span className={`grid h-7 w-7 place-items-center rounded-full ${isActive ? "bg-accent text-accent-ink" : ""}`}>
              <Icon size={17} />
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
