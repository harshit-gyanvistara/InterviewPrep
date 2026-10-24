// Client-safe, pure. When to remind people about work that's due, and what the email says
// (plans/b2b-college.md B.10). No sending here.

export type ReminderKind = "due_soon" | "overdue" | "nudge";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A reminder goes out this long before something is due. */
export const DUE_SOON_MS = 48 * HOUR;
/** An "overdue" note goes out once it has been this long since the due date... */
export const OVERDUE_AFTER_MS = 24 * HOUR;
/** ...and stops being worth sending after this long. */
export const OVERDUE_UNTIL_MS = 7 * DAY;
/** A staff member's manual nudge to the same person about the same thing is limited to this often. */
export const NUDGE_EVERY_MS = 24 * HOUR;

/** Which automatic reminder, if any, fits work due at `dueAt` as of `now`. */
export function kindFor(dueAt: number, now: number): Exclude<ReminderKind, "nudge"> | null {
  const until = dueAt - now;
  if (until > 0 && until <= DUE_SOON_MS) return "due_soon";
  const since = now - dueAt;
  if (since >= OVERDUE_AFTER_MS && since < OVERDUE_UNTIL_MS) return "overdue";
  return null;
}

/** May a staff member nudge again? `lastSentAt` is when the last nudge for this person and thing went out. */
export const canNudge = (lastSentAt: number | null, now: number) => lastSentAt === null || now - lastSentAt >= NUDGE_EVERY_MS;

export interface ReminderContext {
  orgName: string;
  title: string;
  /** ms since epoch, or null when the work has no due date (a nudge may not). */
  dueAt: number | null;
  link: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

export interface ReminderMail {
  subject: string;
  text: string;
  html: string;
}

/** The email for a reminder. Titles and org names are typed by admins, so everything is escaped in the HTML. */
export function reminderMail(kind: ReminderKind, c: ReminderContext): ReminderMail {
  const due = c.dueAt === null ? "" : dateText(c.dueAt);
  const subject =
    kind === "due_soon" ? `Due soon: ${c.title}` : kind === "overdue" ? `Overdue: ${c.title}` : `A reminder from ${c.orgName}: ${c.title}`;
  const lead =
    kind === "due_soon"
      ? `"${c.title}" from ${c.orgName} is due on ${due}.`
      : kind === "overdue"
        ? `"${c.title}" from ${c.orgName} was due on ${due} and isn't done yet.`
        : `${c.orgName} asked us to remind you about "${c.title}"${due ? ` (due ${due})` : ""}.`;
  const text = `${lead}\n\nIt takes one practice interview. Start here:\n${c.link}\n\nSent on behalf of ${c.orgName} through Offerly.`;
  const html = `<p>${esc(lead)}</p><p>It takes one practice interview. <a href="${esc(c.link)}">Start now</a></p><p style="color:#666;font-size:12px">Sent on behalf of ${esc(c.orgName)} through Offerly.</p>`;
  return { subject, text, html };
}
