// Server-only. Sends an email through Resend's HTTP API (plans/b2b-college.md B.10). The same account
// Supabase uses for sign-in codes works here. Without RESEND_API_KEY and MAIL_FROM it sends nothing and
// says so, so reminders switch on once mail is configured and never fail a request before then.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult = { sent: true } | { sent: false; reason: "not_configured" | "failed"; detail?: string };

export type Mailer = (mail: Mail) => Promise<SendResult>;

export const sendMail: Mailer = async (mail) => {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { sent: false, reason: "not_configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { sent: false, reason: "failed", detail: `Resend answered ${res.status}` };
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: "failed", detail: e instanceof Error ? e.message : "unknown error" };
  }
};

/** The address practice links in emails point at. */
export const appUrl = () => (process.env.APP_URL ?? "https://offerly.app").replace(/\/+$/, "");
