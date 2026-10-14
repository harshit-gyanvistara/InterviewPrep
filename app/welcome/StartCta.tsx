"use client";

import Link from "next/link";
import { useAuth } from "@/lib/db";

/** "Start free": sign-in first when accounts are on, straight to onboarding with AUTH_MODE=off. */
export function StartCta() {
  const { data: auth } = useAuth();
  const accounts = auth?.mode !== "off";
  return (
    <>
      <div className="mt-8 flex justify-center gap-3">
        <Link href={accounts ? "/sign-in" : "/onboarding"} className="btn btn-primary !px-7 !py-3">Start free</Link>
      </div>
      <p className="mt-3 text-xs text-muted">
        {accounts ? "Sign in with just your email. Your practice follows you to any device." : "No account needed. Your data stays in this browser."}
      </p>
    </>
  );
}
