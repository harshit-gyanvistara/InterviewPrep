import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (plans/m2-org.md O.7). They need a LOCAL Supabase with the migrations applied,
// the same one the row-level security tests use:
//
//   npx supabase start
//   eval "$(npx supabase status -o env)"
//   SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_PUBLISHABLE_KEY=$PUBLISHABLE_KEY SUPABASE_TEST_SECRET_KEY=$SECRET_KEY npm run e2e
//
// Playwright builds the app into .next-e2e (so a running `next dev` is untouched), starts it on
// :3300 against that database, and starts a stub liveAgent on :8100 so Gemini is never called.
// Variables set here override .env.local, which is never used for these tests.

const url = process.env.SUPABASE_TEST_URL ?? "";
// These tests create and delete users: never point them at a real project.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)) {
  throw new Error("E2E tests need SUPABASE_TEST_URL pointing at a local Supabase (npx supabase start). See playwright.config.ts.");
}
const PORT = 3300;
const AGENT_PORT = 8100;
export const E2E_ADMIN_EMAIL = "e2e-admin@e2e-offerly.dev";

const appEnv = {
  NEXT_DIST_DIR: ".next-e2e",
  AUTH_MODE: "supabase",
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_TEST_PUBLISHABLE_KEY ?? "",
  SUPABASE_SECRET_KEY: process.env.SUPABASE_TEST_SECRET_KEY ?? "",
  LIVE_AGENT_URL: `http://127.0.0.1:${AGENT_PORT}`,
  LIVE_AGENT_TOKEN: "e2e-token",
  SUPER_ADMIN_EMAILS: E2E_ADMIN_EMAIL,
  BETA_ALLOWED_EMAILS: "",
  BLOCKED_EMAIL_DOMAINS: "",
  PACKAGE_DEFAULT: "pro",
  UPSTASH_REDIS_REST_URL: "",
  UPSTASH_REDIS_REST_TOKEN: "",
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: "node e2e/stub-agent.mjs",
      url: `http://127.0.0.1:${AGENT_PORT}/healthz`,
      env: { STUB_AGENT_PORT: String(AGENT_PORT), LIVE_AGENT_TOKEN: "e2e-token" },
      reuseExistingServer: false,
    },
    {
      command: `npx next build && npx next start -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/welcome`,
      env: appEnv,
      timeout: 600_000,
      reuseExistingServer: false,
    },
  ],
});
