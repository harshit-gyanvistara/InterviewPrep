import { expect, test, type Page } from "@playwright/test";
import { api, cleanup, createUser, email, RUN, signedIn, trackOrg } from "./helpers";

// M2-Org end to end (plans/m2-org.md O.7): a super-admin creates an org, its owner invites with a
// join code and sets an assignment, a member joins sharing scores and completes the assignment
// (stub liveAgent, no Gemini), and the owner sees it on the dashboard without the transcript.
// Then the exit-gate checks: org isolation, share levels, leaving, the seat limit, the org quota.

const ADMIN = "e2e-admin@e2e-offerly.dev"; // SUPER_ADMIN_EMAILS in playwright.config.ts
const OWNER = email("owner");
const MEMBER = email("member");
const OUTSIDER = email("outsider");
const LATECOMER = email("late");
const SLUG = `e2e-college-${RUN}`;
const SLUG_B = `e2e-other-${RUN}`;

test.describe.configure({ mode: "serial" });

let adminPage: Page;
let ownerPage: Page;
let memberPage: Page;
let orgId = "";
let joinCode = "";

test.beforeAll(async ({ browser }) => {
  await createUser(ADMIN, "E2E Admin");
  await createUser(OWNER, "Olivia Owner");
  await createUser(MEMBER, "Manu Member");
  await createUser(OUTSIDER, "Oscar Outsider");
  await createUser(LATECOMER, "Lata Latecomer");
  trackOrg(SLUG);
  trackOrg(SLUG_B);
  adminPage = await signedIn(browser, ADMIN);
  ownerPage = await signedIn(browser, OWNER);
  memberPage = await signedIn(browser, MEMBER);
});

test.afterAll(async () => {
  await cleanup();
});

test("a super-admin creates the org with its owner", async () => {
  await adminPage.goto("/admin/orgs");
  await adminPage.getByLabel("Name").fill("E2E College");
  await adminPage.getByLabel(/Address/).fill(SLUG);
  await adminPage.getByLabel("Owner's email (optional)").fill(OWNER);
  await adminPage.getByRole("button", { name: "Create organisation" }).click();
  await expect(adminPage.getByText(`Created, with ${OWNER} as owner.`)).toBeVisible();
  orgId = (await api<{ org: { id: string } }>(ownerPage.request, "GET", `/api/orgs/${SLUG}`)).json.org.id;
  expect(orgId).toBeTruthy();
});

test("the owner creates a join code and an assignment", async () => {
  await ownerPage.goto(`/org/${SLUG}`);
  await ownerPage.getByRole("button", { name: "Invites", exact: true }).click();
  await ownerPage.getByRole("button", { name: "Create code" }).click();
  const code = ownerPage.getByText(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  await expect(code).toBeVisible();
  joinCode = (await code.textContent())!.trim();

  await ownerPage.getByRole("button", { name: "Assignments", exact: true }).click();
  await ownerPage.getByLabel("Round").selectOption("behavioural");
  await ownerPage.getByLabel("Title (optional)").fill("Week 1");
  await ownerPage.getByRole("button", { name: "Set assignment" }).click();
  await expect(ownerPage.getByText("0 of 1 done")).toBeVisible();
});

test("a member joins with the code, sharing scores, and completes the assignment", async () => {
  await memberPage.goto(`/join/${joinCode.toLowerCase()}`);
  await expect(memberPage.getByRole("heading", { name: "E2E College" })).toBeVisible();
  await expect(memberPage.getByRole("radio", { name: /Activity and scores/ })).toBeChecked();
  await memberPage.getByRole("button", { name: "Join E2E College" }).click();
  await memberPage.waitForURL(`**/org/${SLUG}`);

  await expect(memberPage.getByText("Week 1")).toBeVisible();
  await memberPage.getByRole("link", { name: "Start" }).click();
  await expect(memberPage.getByText(/Assignment from E2E College/)).toBeVisible();
  await memberPage.getByRole("button", { name: "Continue to lobby" }).click();
  await memberPage.getByRole("button", { name: "Join interview" }).click();

  await expect(memberPage.getByText("Tell me about yourself.").first()).toBeVisible();
  await memberPage.getByPlaceholder("Type your answer, or use the mic").fill("I am a backend developer and I led our sign-up service migration to a queue.");
  await memberPage.getByRole("button", { name: "Send answer" }).click();
  await expect(memberPage.getByText("What was your role?").first()).toBeVisible();
  await memberPage.getByRole("button", { name: "End interview" }).click();
  await memberPage.getByRole("alertdialog").getByRole("button", { name: "End interview" }).click();
  await memberPage.waitForURL("**/report/**");
  await expect(memberPage.getByText("72").first()).toBeVisible();

  const mine = await api<{ assignments: unknown[] }>(memberPage.request, "GET", "/api/me/assignments");
  expect(mine.json.assignments).toEqual([]);
});

test("the owner sees it on the dashboard, at the member's share level", async () => {
  await ownerPage.goto(`/org/${SLUG}`);
  await ownerPage.getByRole("button", { name: "Members", exact: true }).click();
  const row = ownerPage.getByRole("row", { name: new RegExp(MEMBER) });
  await expect(row).toContainText("Activity and scores");
  await expect(row).toContainText("72");

  await ownerPage.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(ownerPage.getByText(/1 mock$/).first()).toBeVisible();

  await ownerPage.getByRole("button", { name: "Assignments", exact: true }).click();
  await expect(ownerPage.getByText("1 of 1 done")).toBeVisible();

  const memberId = (await api<{ members: { email: string; userId: string }[] }>(ownerPage.request, "GET", `/api/orgs/${SLUG}/dashboard`)).json.members.find((m) => m.email === MEMBER)!.userId;
  await ownerPage.goto(`/org/${SLUG}/members/${memberId}`);
  await expect(ownerPage.getByText("Behavioural Interview")).toBeVisible();
  await expect(ownerPage.getByText("Transcript")).toHaveCount(0);
  const detail = await api<{ transcripts: unknown }>(ownerPage.request, "GET", `/api/orgs/${SLUG}/members/${memberId}`);
  expect(detail.json.transcripts).toBeNull();

  const csv = await (await ownerPage.request.get(`/api/orgs/${SLUG}/export`)).text();
  expect(csv).toContain(`"${MEMBER}","member","","scores","1",`);
  expect(csv).toContain(`"72"`);
});

// ---- exit gate (plans/organisations.md § M2-Org exit gate) ----

test("gate 1: a member of org A can't read org B, and outsiders can't read org A", async ({ browser }) => {
  await api(adminPage.request, "POST", "/api/admin/orgs", { name: "E2E Other", slug: SLUG_B, kind: "company", ownerEmail: OUTSIDER });
  for (const path of [`/api/orgs/${SLUG_B}`, `/api/orgs/${SLUG_B}/dashboard`, `/api/orgs/${SLUG_B}/export`]) {
    expect((await api(memberPage.request, "GET", path, undefined, [404])).status, path).toBe(404);
  }
  const outsider = await signedIn(browser, OUTSIDER);
  for (const path of [`/api/orgs/${SLUG}`, `/api/orgs/${SLUG}/dashboard`, `/api/orgs/${SLUG}/audit`]) {
    expect((await api(outsider.request, "GET", path, undefined, [404])).status, path).toBe(404);
  }
  await outsider.context().close();
});

test("gate 2: members can't open the dashboard; transcripts need 'full'", async () => {
  expect((await api(memberPage.request, "GET", `/api/orgs/${SLUG}/dashboard`, undefined, [403])).status).toBe(403);
  // Already checked above at "scores": the owner's member page and API had no transcript.
});

async function startOrgSession(page: Page) {
  const id = `e2e-${Math.random().toString(36).slice(2)}`;
  await api(page.request, "PUT", "/api/db/sessions", { id, config: { packId: "behavioural", persona: "neutral", durationMin: 15, pressure: false, orgId }, messages: [], code: "", startedAt: Date.now(), status: "active" });
  return (await page.request.post("/api/interview/turn", { data: { sessionId: id, elapsedSec: 0, code: "" } })).status();
}

test("gate 5: an exhausted org quota stops a new org interview (429)", async () => {
  await api(adminPage.request, "PUT", `/api/admin/orgs/${orgId}/entitlements`, { entitlements: [{ key: "mocks", limit: 1, period: "month" }] });
  expect(await startOrgSession(ownerPage)).toBe(429);
  await api(adminPage.request, "PUT", `/api/admin/orgs/${orgId}/entitlements`, { entitlements: [] });
});

test("gate 3: after leaving, a member can't add org practice and the org can't see them", async () => {
  await api(memberPage.request, "DELETE", `/api/orgs/${SLUG}/me`);
  expect(await startOrgSession(memberPage)).toBe(403);
  const dash = await api<{ members: { email: string }[] }>(ownerPage.request, "GET", `/api/orgs/${SLUG}/dashboard`);
  expect(dash.json.members.map((m) => m.email)).not.toContain(MEMBER);
});

test("gate 4: the seat limit blocks the join that would exceed it", async ({ browser }) => {
  // Only the owner is active now; one seat means the next join has nowhere to go.
  await api(adminPage.request, "PUT", `/api/admin/orgs/${orgId}/entitlements`, { entitlements: [{ key: "seats", limit: 1, period: "none" }] });
  const late = await signedIn(browser, LATECOMER);
  const res = await late.request.post(`/api/join/${joinCode}`, { data: { shareLevel: "scores" } });
  expect(res.status()).toBe(409);
  expect((await res.json()).error).toMatch(/no free seats/);
  await late.context().close();
});
