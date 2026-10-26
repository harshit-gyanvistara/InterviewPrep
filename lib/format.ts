// One way to show dates across the app, so the same moment never reads three different ways.
// Accepts epoch ms (local data) or ISO strings (org and admin APIs).

/** "18 Oct" */
export const shortDate = (at: number | string) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** "18 Oct, 12:46 am" */
export const dateTime = (at: number | string) => new Date(at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** "18 Oct 2026": for dates that may be in another year (invite expiry, audit history). */
export const fullDate = (at: number | string) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
