// A stand-in for liveAgent in end-to-end tests (plans/m2-org.md O.7): canned interviewer lines and a
// fixed scored report, so tests never call Gemini. Same paths and auth header as the real service.
import { createServer } from "node:http";

const port = Number(process.env.STUB_AGENT_PORT ?? 8100);
const token = process.env.LIVE_AGENT_TOKEN ?? "e2e-token";

const REPORT = {
  overall: 72,
  verdict: "Hire",
  summary: "Clear, specific answers. Stub report for end-to-end tests.",
  strengths: ["Clear structure"],
  topFixes: ["Quantify impact", "Close with the result", "Name trade-offs"],
  dimensions: [
    { name: "Structure (STAR)", score: 7, evidence: "I led the migration", feedback: "Good", assessed: true },
    { name: "Ownership and impact", score: 6, evidence: "I led the migration", feedback: "Good", assessed: true },
  ],
  answerReviews: [],
  coverage: { answered: 3, expected: 5, sufficient: true },
};

let turns = 0;

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(json));
    };
    if (req.url === "/healthz") return send(200, { ok: true });
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: "Unauthorized." });
    if (req.url === "/v1/interview/turn") {
      turns += 1;
      return send(200, { reply: turns % 2 ? "Hello, I'm Liam. Tell me about yourself." : "Thanks. What was your role?", endInterview: false }, { "X-Prompt-Version": "e2e" });
    }
    if (req.url === "/v1/interview/report") return send(200, REPORT, { "X-Prompt-Version": "e2e" });
    send(404, { error: `Stub agent has no ${req.url}` });
  });
}).listen(port, () => console.log(`stub liveAgent on :${port}`));
