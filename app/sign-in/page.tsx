"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";
import { Card } from "@/components/Shell";
import { resetSession, useAuth } from "@/lib/db";
import { isInApp } from "@/lib/inApp";

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return null;
    return ((await r.json().catch(() => ({}))) as { error?: string }).error || "Something went wrong. Try again.";
  } catch {
    return "Couldn't reach the server. Check your connection.";
  }
}

/**
 * Email one-time code everywhere; Google on the web only, since Google blocks its sign-in inside
 * the mobile app's WebView (plans/auth.md A1–A3). The server routes set the session cookies.
 */
export default function SignIn() {
  const router = useRouter();
  const { data: auth } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `auth` is only set in the browser, after hydration, so reading window here can't cause a mismatch.
  const showGoogle = !!auth?.google && !isInApp();
  const callbackError = auth ? new URLSearchParams(window.location.search).get("error") : null;
  const callbackFailed = callbackError === "callback" || callbackError === "beta";

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const err = await post("/api/auth/otp", { email });
    setBusy(false);
    if (err) return setError(err);
    setCode("");
    setStep("code");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await post("/api/auth/verify", { email, code });
    if (err) {
      setBusy(false);
      return setError(err);
    }
    resetSession();
    router.replace("/");
  };

  return (
    <div className="mx-auto max-w-md pt-4 sm:pt-10">
      <Card>
        {step === "email" ? (
          <form onSubmit={sendCode} className="grid gap-4">
            <div>
              <h1 className="text-3xl font-light">Sign in to Offerly</h1>
              <p className="mt-2 text-sm text-muted">We&apos;ll email you a code. No password needed, and a new account is created the first time.</p>
            </div>
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted">Email</span>
              <input autoFocus type="email" inputMode="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </label>
            <button className="btn btn-primary" disabled={busy || !email.trim()}>
              <Mail size={16} /> {busy ? "Sending…" : "Email me a code"}
            </button>
            {showGoogle && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
                <a href="/auth/google" className="btn btn-ghost">Continue with Google</a>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={verify} className="grid gap-4">
            <div>
              <h1 className="text-3xl font-light">Check your email</h1>
              <p className="mt-2 text-sm text-muted">Enter the code we sent to <b className="text-ink">{email}</b>, or open the link in that email on this device.</p>
            </div>
            <input
              autoFocus
              className="input text-center text-2xl tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              aria-label="Code from the email"
            />
            <button className="btn btn-primary" disabled={busy || code.length < 6}>{busy ? "Checking…" : "Sign in"}</button>
            <div className="flex justify-between text-sm">
              <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink" onClick={() => setStep("email")}><ArrowLeft size={14} /> Different email</button>
              <button type="button" className="text-muted hover:text-ink" disabled={busy} onClick={() => sendCode()}>Send a new code</button>
            </div>
          </form>
        )}
        {(error || (callbackFailed && step === "email")) && (
          <p className="mt-4 text-sm text-danger">{error ??
            (callbackError === "beta"
              ? "Offerly is in private beta. Ask the team for an invite."
              : "Sign-in didn’t finish. Links only work once, in the browser where you asked for them. Try again.")}</p>
        )}
        <p className="mt-6 text-xs text-muted">
          By continuing you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </Card>
    </div>
  );
}
