import { afterEach, describe, expect, it, vi } from "vitest";
import { devLoginAllowed, devLoginEnabled } from "./devLogin";

afterEach(() => vi.unstubAllEnvs());

function env(over: Record<string, string>) {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("AUTH_MODE", "supabase");
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.test");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("DEV_LOGIN", "on");
  vi.stubEnv("SUPER_ADMIN_EMAILS", 'Boss@College.edu, other@x.com');
  for (const [k, v] of Object.entries(over)) vi.stubEnv(k, v);
}

describe("devLoginEnabled", () => {
  it("is on only with DEV_LOGIN=on, accounts on, outside production", () => {
    env({});
    expect(devLoginEnabled()).toBe(true);
  });

  it("is never on in production, even with DEV_LOGIN=on", () => {
    env({ NODE_ENV: "production" });
    expect(devLoginEnabled()).toBe(false);
    expect(devLoginAllowed("boss@college.edu")).toBe(false);
  });

  it("is off unless explicitly switched on", () => {
    for (const v of ["", "off", "true", "1", "ON"]) {
      env({ DEV_LOGIN: v });
      expect(devLoginEnabled()).toBe(false);
    }
  });

  it("is off when accounts are off", () => {
    env({ AUTH_MODE: "off" });
    expect(devLoginEnabled()).toBe(false);
  });
});

describe("devLoginAllowed", () => {
  it("allows only super-admin emails, ignoring case and spaces", () => {
    env({});
    expect(devLoginAllowed("boss@college.edu")).toBe(true);
    expect(devLoginAllowed("OTHER@x.com")).toBe(true);
    expect(devLoginAllowed("student@college.edu")).toBe(false);
    expect(devLoginAllowed("")).toBe(false);
  });
});
