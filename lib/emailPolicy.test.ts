import { afterEach, describe, expect, it, vi } from "vitest";
import { isBetaAllowed, isBlockedEmail } from "./emailPolicy";

afterEach(() => vi.unstubAllEnvs());

describe("isBlockedEmail", () => {
  it("blocks throwaway inboxes", () => {
    expect(isBlockedEmail("test@yopmail.com")).toBe(true);
    expect(isBlockedEmail("test@mailinator.com")).toBe(true);
  });

  it("blocks subdomains of a blocked domain", () => {
    expect(isBlockedEmail("test@inbox.yopmail.com")).toBe(true);
  });

  it("allows ordinary providers and work domains", () => {
    expect(isBlockedEmail("asha@gmail.com")).toBe(false);
    expect(isBlockedEmail("asha@outlook.com")).toBe(false);
    expect(isBlockedEmail("asha@build-score.com")).toBe(false);
  });

  it("blocks extra domains from BLOCKED_EMAIL_DOMAINS", () => {
    vi.stubEnv("BLOCKED_EMAIL_DOMAINS", " Example.org , other.test ");
    expect(isBlockedEmail("a@example.org")).toBe(true);
    expect(isBlockedEmail("a@sub.other.test")).toBe(true);
    expect(isBlockedEmail("a@example.com")).toBe(false);
  });
});

describe("isBetaAllowed", () => {
  it("lets everyone in when the list is empty", () => {
    expect(isBetaAllowed("anyone@gmail.com")).toBe(true);
  });

  it("allows only listed emails and @domains when set", () => {
    vi.stubEnv("BETA_ALLOWED_EMAILS", "Asha@Example.com, @team.test");
    expect(isBetaAllowed("asha@example.com")).toBe(true);
    expect(isBetaAllowed("ravi@team.test")).toBe(true);
    expect(isBetaAllowed("ravi@sub.team.test")).toBe(false);
    expect(isBetaAllowed("stranger@gmail.com")).toBe(false);
    expect(isBetaAllowed(null)).toBe(false);
  });
});
