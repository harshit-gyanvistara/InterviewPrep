"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useAuth } from "@/lib/db";
import { resolveAttributes } from "@/lib/memberAttributes";
import type { StudentField } from "@/lib/orgSettings";
import { PENDING_JOIN_KEY } from "@/lib/pages";
import { SHARE_LEVELS, SHARE_LEVEL_TEXT, shareAllows, type ShareLevel } from "@/lib/permissions";

// Accepting an invite link or join code (plans/m2-org.md O.2, O.3). Signed out: keep the invite and
// send the person to sign in; the Shell brings them back here. Signed in: show the organisation,
// let the member choose what it may see (D11), then join.

type Preview =
  | { status: "ok"; orgName: string; role: string; defaultShareLevel: ShareLevel; minShareLevel: ShareLevel; alreadyMember: boolean; studentFields: StudentField[]; lockedAttributes: Record<string, string> }
  | { status: "invalid" | "expired" | "used_up" | "wrong_email" };

const PROBLEM: Record<Exclude<Preview["status"], "ok">, string> = {
  invalid: "This invite link isn't valid. Ask your organisation for a new one.",
  expired: "This invite has expired. Ask your organisation for a new one.",
  used_up: "This invite has already been used.",
  wrong_email: "This invite was sent to a different email address. Sign out, then sign in with the address it was sent to.",
};

const forget = () => {
  try {
    localStorage.removeItem(PENDING_JOIN_KEY);
  } catch {}
};

export default function Join() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data: auth } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [share, setShare] = useState<ShareLevel>("scores");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signedIn = auth?.mode === "supabase" && !!auth.user;

  useEffect(() => {
    if (!auth) return;
    if (auth.mode === "supabase" && !auth.user) {
      try {
        localStorage.setItem(PENDING_JOIN_KEY, token);
      } catch {}
      return;
    }
    if (!signedIn) return;
    (async () => {
      const res = await fetch(`/api/join/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        forget();
        setError(json.error || "Couldn't open this invite.");
        return;
      }
      const p = json as Preview;
      if (p.status !== "ok") forget();
      else setShare(shareAllows(p.defaultShareLevel, p.minShareLevel) ? p.defaultShareLevel : p.minShareLevel);
      setPreview(p);
    })();
  }, [auth, signedIn, token]);

  const join = async () => {
    if (preview?.status === "ok") {
      const check = resolveAttributes(preview.studentFields, preview.lockedAttributes, details);
      if (!check.ok) {
        setError(`Fill in: ${check.missing.map((f) => f.label).join(", ")}.`);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/join/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shareLevel: share, attributes: details }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't join.");
      forget();
      router.replace(`/org/${json.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join.");
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!auth) body = <p className="text-muted">Loading…</p>;
  else if (auth.mode === "off") body = <p className="text-muted">Organisations need sign-in, which is turned off on this server.</p>;
  else if (!auth.user)
    body = (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;ve been invited to Offerly</h1>
        <p className="text-muted">An organisation has invited you to practise interviews with Offerly. Sign in, or create your account, with the email address the invite was sent to. You&apos;ll come straight back here.</p>
        <Link href="/sign-in" className="btn btn-primary w-full justify-center">Sign in to accept</Link>
      </>
    );
  else if (error && !preview) body = <><h1 className="text-xl font-semibold">Couldn&apos;t use this invite</h1><p className="text-muted">{error}</p><Link href="/" className="btn btn-ghost">Go to Offerly</Link></>;
  else if (!preview) body = <p className="text-muted">Opening your invite…</p>;
  else if (preview.status !== "ok") body = <><h1 className="text-xl font-semibold">Couldn&apos;t use this invite</h1><p className="text-muted">{PROBLEM[preview.status]}</p><Link href="/" className="btn btn-ghost">Go to Offerly</Link></>;
  else if (preview.alreadyMember) {
    forget();
    body = <><h1 className="text-xl font-semibold">You&apos;re already in {preview.orgName}</h1><Link href="/" className="btn btn-primary">Continue</Link></>;
  } else
    body = (
      <>
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent"><Building2 size={20} /></span>
          <div>
            <div className="text-sm text-muted">Join as {preview.role === "member" ? "a member" : `${preview.role === "admin" ? "an" : "a"} ${preview.role}`}</div>
            <h1 className="text-2xl font-semibold tracking-tight">{preview.orgName}</h1>
          </div>
        </div>
        {preview.studentFields.length > 0 && (
          <div className="grid gap-3">
            <h2 className="text-sm font-medium">About you</h2>
            {preview.studentFields.map((f) => {
              const locked = preview.lockedAttributes[f.key];
              return (
                <label key={f.key} className="grid gap-1.5 text-sm">
                  <span className="text-muted">{f.label}{f.required ? "" : " (optional)"}</span>
                  <input
                    className="input"
                    value={locked ?? details[f.key] ?? ""}
                    readOnly={!!locked}
                    maxLength={80}
                    onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                  />
                  {locked && <span className="text-xs text-muted">Set by {preview.orgName}.</span>}
                </label>
              );
            })}
          </div>
        )}
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">What may {preview.orgName} see of your practice?</legend>
          {SHARE_LEVELS.map((l) => {
            const allowed = shareAllows(l, preview.minShareLevel);
            return (
            <label key={l} className={`flex gap-3 rounded-xl border p-3 ${allowed ? "cursor-pointer" : "cursor-not-allowed opacity-50"} ${share === l ? "border-accent bg-accent-soft" : "border-line"}`}>
              <input type="radio" name="share" className="mt-1" checked={share === l} disabled={!allowed} onChange={() => setShare(l)} />
              <span>
                <span className="block text-sm font-medium">{SHARE_LEVEL_TEXT[l].title}</span>
                <span className="block text-sm text-muted">{SHARE_LEVEL_TEXT[l].body}</span>
              </span>
            </label>
            );
          })}
          {preview.minShareLevel !== "activity" && <p className="text-xs text-muted">{preview.orgName} needs at least &quot;{SHARE_LEVEL_TEXT[preview.minShareLevel].title}&quot; for the practice you do for it. Practice you do as yourself stays private.</p>}
        </fieldset>
        <p className="text-xs text-muted">Your practice stays yours. You can change this or leave the organisation any time in Settings, and it loses access from that moment.</p>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <button className="btn btn-primary w-full justify-center" onClick={join} disabled={busy}>{busy ? "Joining…" : `Join ${preview.orgName}`}</button>
      </>
    );

  return (
    <main className="grid min-h-full place-items-center px-4 py-10">
      <div className="grid w-full max-w-md gap-5">
        <div className="grid gap-4 rounded-2xl border border-line bg-card p-6 shadow-float">{body}</div>
      </div>
    </main>
  );
}
