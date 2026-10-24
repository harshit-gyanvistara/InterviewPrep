"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/db";

/** "Start free": sign-in first when accounts are on, straight to onboarding with AUTH_MODE=off. */
export function StartCta() {
  const { data: auth } = useAuth();
  const accounts = auth?.mode !== "off";
  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
      <Link href={accounts ? "/sign-in" : "/onboarding"} className="btn btn-primary btn-lg">
        Start practising free <ArrowRight size={16} />
      </Link>
      <p className="text-sm text-muted">
        {accounts ? "Sign in with a code sent to your email." : "No account needed. Your data stays in this browser."}
      </p>
    </div>
  );
}
