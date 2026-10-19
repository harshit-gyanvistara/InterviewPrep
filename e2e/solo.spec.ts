import { expect, test, type Page } from "@playwright/test";
import { cleanup, createAccount, email, signedIn } from "./helpers";

// Solo end to end (implementationPlan M2.9): a brand-new account goes through the real onboarding
// steps, takes a mock in text mode against the stub liveAgent (no Gemini), sees the scored report,
// and finds it on /progress and the dashboard. Plus the onboarding page's way out for a wrong email.

const SOLO = email("solo");
const WRONG = email("wrong");

test.describe.configure({ mode: "serial" });

let page: Page;
let sessionId = "";

test.beforeAll(async ({ browser }) => {
  await createAccount(SOLO);
  await createAccount(WRONG);
  page = await signedIn(browser, SOLO);
});

test.afterAll(async () => {
  await cleanup();
});

test("a new account is sent to onboarding and completes it", async () => {
  await page.goto("/");
  await page.waitForURL("**/onboarding");
  await expect(page.getByText(`Signed in as ${SOLO}.`)).toBeVisible();

  await expect(page.getByRole("heading", { name: "First, who are we preparing?" })).toBeVisible();
  const next = page.getByRole("button", { name: "Continue" });
  await expect(next).toBeDisabled();
  await page.getByLabel("Your name").fill("Sana Solo");
  await page.getByLabel("Where are you now?").selectOption("0-1y");
  await next.click();

  await expect(page.getByRole("heading", { name: "What are you aiming for?" })).toBeVisible();
  await expect(next).toBeDisabled();
  await page.getByLabel("Target role", { exact: true }).fill("Backend Developer");
  await next.click();

  await expect(page.getByRole("heading", { name: "Add your resume" })).toBeVisible();
  await page.getByPlaceholder("Education, projects, internships, skills…").fill("B.Tech CSE. Built a sign-up service on a queue.");
  await next.click();

  await expect(page.getByRole("heading", { name: "Check your setup" })).toBeVisible();
  await next.click();

  await expect(page.getByRole("heading", { name: "You're set, Sana" })).toBeVisible();
  await page.getByRole("button", { name: "Take my baseline mock" }).click();
  await page.waitForURL("**/practice");
});

test("takes a mock in text mode and gets a scored report", async () => {
  await page.getByRole("button", { name: "Continue to lobby" }).click();
  await page.getByRole("button", { name: "Join interview" }).click();
  await page.waitForURL("**/interview/**");
  sessionId = new URL(page.url()).pathname.split("/").pop()!;

  // The stub's lines alternate across the whole run, so count turns rather than match text.
  await expect(page.getByText("1 turns")).toBeVisible();
  const answers = [
    "I'm a backend developer with a year of experience, mostly on Go services.",
    "I led our sign-up service migration to a queue, which cut failed sign-ups by 40 percent.",
    "I owned the rollout plan and the on-call runbook, and I'd measure p95 latency earlier next time.",
  ];
  for (const [i, answer] of answers.entries()) {
    await page.getByPlaceholder("Type your answer, or use the mic").fill(answer);
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.getByText(`${3 + 2 * i} turns`)).toBeVisible();
  }

  await page.getByRole("button", { name: "End interview" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "End interview" }).click();
  await page.waitForURL(`**/report/${sessionId}`);
  await expect(page.getByText("72").first()).toBeVisible();
  await expect(page.getByText("Hire", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Too short")).toHaveCount(0);
});

test("the report shows on /progress and the dashboard", async () => {
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Your progress" })).toBeVisible();
  const history = page.locator(`a[href="/report/${sessionId}"]`).filter({ hasText: "Hire" });
  await expect(history).toContainText("72");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /, Sana$/ })).toBeVisible();
  const recent = page.locator(`a[href="/report/${sessionId}"]`);
  await expect(recent).toContainText("72");
  await expect(recent).toContainText("Hire");
});

test("'Not you? Sign out' on onboarding returns to /welcome", async ({ browser }) => {
  const wrong = await signedIn(browser, WRONG);
  await wrong.goto("/");
  await wrong.waitForURL("**/onboarding");
  await wrong.getByRole("button", { name: "Not you? Sign out" }).click();
  await wrong.waitForURL("**/welcome");
  // Really signed out: onboarding now sends you back to /welcome.
  await wrong.goto("/onboarding");
  await wrong.waitForURL("**/welcome");
  await wrong.context().close();
});
