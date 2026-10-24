import { describe, expect, it } from "vitest";
import { DUE_SOON_MS, NUDGE_EVERY_MS, OVERDUE_AFTER_MS, OVERDUE_UNTIL_MS, canNudge, kindFor, reminderMail } from "./reminders";

const NOW = Date.UTC(2026, 10, 10, 4, 0, 0);

describe("kindFor", () => {
  it("is due_soon in the 48 hours before, and nothing earlier", () => {
    expect(kindFor(NOW + DUE_SOON_MS, NOW)).toBe("due_soon");
    expect(kindFor(NOW + 1, NOW)).toBe("due_soon");
    expect(kindFor(NOW + DUE_SOON_MS + 1, NOW)).toBeNull();
  });

  it("is overdue from a day after the due date for a week, not before or after", () => {
    expect(kindFor(NOW, NOW)).toBeNull();
    expect(kindFor(NOW - OVERDUE_AFTER_MS + 1, NOW)).toBeNull();
    expect(kindFor(NOW - OVERDUE_AFTER_MS, NOW)).toBe("overdue");
    expect(kindFor(NOW - OVERDUE_UNTIL_MS + 1, NOW)).toBe("overdue");
    expect(kindFor(NOW - OVERDUE_UNTIL_MS, NOW)).toBeNull();
  });
});

describe("canNudge", () => {
  it("allows a first nudge and then one a day", () => {
    expect(canNudge(null, NOW)).toBe(true);
    expect(canNudge(NOW - NUDGE_EVERY_MS + 1, NOW)).toBe(false);
    expect(canNudge(NOW - NUDGE_EVERY_MS, NOW)).toBe(true);
  });
});

describe("reminderMail", () => {
  const c = { orgName: "Sunrise College", title: "Week 1 · Mock", dueAt: Date.UTC(2026, 10, 12), link: "https://offerly.app/practice?pack=x" };

  it("says what is due and when, and links to it", () => {
    const due = reminderMail("due_soon", c);
    expect(due.subject).toBe("Due soon: Week 1 · Mock");
    expect(due.text).toContain("12 November");
    expect(due.text).toContain(c.link);
    expect(reminderMail("overdue", c).text).toContain("isn't done yet");
    expect(reminderMail("nudge", c).subject).toContain("A reminder from Sunrise College");
  });

  it("copes with a nudge about work that has no due date", () => {
    const m = reminderMail("nudge", { ...c, dueAt: null });
    expect(m.text).not.toContain("NaN");
    expect(m.text).not.toContain("(due");
  });

  it("escapes admin-typed text in the HTML", () => {
    const m = reminderMail("due_soon", { ...c, orgName: "<b>Evil</b>", title: 'A "quote" & <script>', link: 'https://x/?a="b"' });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Evil</b>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.html).toContain("&quot;");
  });
});
