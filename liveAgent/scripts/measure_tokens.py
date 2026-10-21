"""Measures where the tokens go in one mock: runs a scripted interview against the REAL Gemini models
(costs money; needs GEMINI_API_KEY in liveAgent/.env) and prints each call's usage from X-LLM-Usage.

    npm run agent:measure                       # 12 answers, then the report
    npm run agent:measure -- --answers 25       # a long mock, past the history trim
    npm run agent:measure -- --no-report        # interview turns only

Not part of CI. Use it before and after a token change to compare.
"""

import argparse
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and not key.strip().startswith("#"):
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


RESUME = (
    "Asha Rao | B.Tech Computer Science, 2025 | Bengaluru\n"
    "EXPERIENCE\n"
    "Backend intern, Zeta (Jan-Jun 2025): built a ledger reconciliation job in Go that matched 2M "
    "card transactions nightly against bank files; cut manual reconciliation from 6 hours to 20 minutes. "
    "Added idempotency keys to the refunds API after a duplicate-refund incident. Wrote Postgres "
    "migrations and on-call runbooks.\n"
    "Teaching assistant, Data Structures (2024): ran weekly labs for 60 students.\n"
    "PROJECTS\n"
    "PayLater (hackathon winner, 2024): buy-now-pay-later prototype with a credit-limit engine, "
    "React Native app and a Node backend. Rate-limited the OTP endpoint with Redis.\n"
    "Distributed key-value store (course project): Raft-based replication in Go, 3-node cluster, "
    "linearizable reads, chaos-tested with network partitions.\n"
    "SKILLS\nGo, Python, TypeScript, Postgres, Redis, Kafka basics, Docker, AWS (EC2, S3, SQS)\n"
    "ACHIEVEMENTS\nTop 2% in Codeforces Round 912; ICPC regionalist 2023."
)
JD = (
    "Backend Software Engineer, Payments. Build and own payment APIs in Go and Postgres serving "
    "millions of transactions a day. Design idempotent, fault-tolerant services; join the on-call "
    "rotation; work with product on reconciliation, refunds and settlement. 0-2 years of experience."
)
ANSWERS = [
    "Hi, I'm Asha. I graduated in computer science this year and interned at Zeta on the payments backend, mostly Go and Postgres.",
    "The reconciliation job compared our ledger with bank settlement files every night. I streamed both files, keyed by transaction id, and wrote mismatches to a review table.",
    "We had a duplicate refund when a client retried after a timeout. I added an idempotency key column with a unique index and returned the stored response on a repeat.",
    "My teammate wanted to rewrite the job in Python. I disagreed because the team knew Go, so we benchmarked both on a day of data and Go was four times faster, so we kept it.",
    "A failure: I shipped a migration that locked the refunds table for two minutes. I learned to add columns without defaults first and backfill in batches.",
    "For PayLater I built the credit limit engine. It scored users from repayment history and capped exposure per merchant.",
    "I'd handle a spike by putting the work on a queue, scaling consumers, and shedding non-critical traffic with rate limits.",
    "In the Raft project the hard part was leader election under partitions. We found a bug where two leaders accepted writes and fixed the term check.",
    "I prioritise by impact on money movement first: anything that can lose or duplicate money beats feature work.",
    "Under pressure during an on-call page I followed the runbook, rolled back the deploy, then wrote the postmortem the next day.",
    "I want this role because payments has real correctness stakes and I enjoyed that at Zeta.",
    "Yes, one question: how does the team split on-call between new and senior engineers?",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--answers", type=int, default=len(ANSWERS), help="candidate answers to give (cycles the script)")
    parser.add_argument("--duration", type=int, default=30, help="mock length in minutes")
    parser.add_argument("--no-report", action="store_true")
    args = parser.parse_args()

    load_env()
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY is not set in liveAgent/.env")
    os.environ.setdefault("LIVE_AGENT_TOKEN", "measure")

    from live_agent.main import app  # after the env is loaded

    # One event loop for the whole run: the Gemini client's async session is bound to it.
    client = TestClient(app).__enter__()
    auth = {"Authorization": f"Bearer {os.environ['LIVE_AGENT_TOKEN']}"}
    profile = {"id": "p1", "name": "Asha Rao", "targetRole": "Backend Software Engineer", "targetCompanies": "Razorpay, Flipkart",
               "jobDescription": JD, "experience": "fresher", "resume": RESUME, "onboarded": True}
    pack = {"id": "b", "title": "Behavioural Round", "company": "Any employer", "role": "Graduate", "roundType": "behavioural",
            "description": "", "durationMin": args.duration, "topics": ["Tell me about yourself", "A conflict in a team", "A failure and what you learned", "Ownership"],
            "rubric": ["Clarity", "Ownership", "Impact", "Self-awareness"], "style": "Calm and probing", "domains": "all"}
    config = {"packId": "b", "persona": "neutral", "durationMin": args.duration, "pressure": False}
    domain = {"id": "general", "interviewerContext": "", "scoringContext": "", "roundHints": "", "roadmapHints": "", "version": 1}
    persona = {"name": "Liam", "tone": "Professional and neutral. Follow-ups when answers are thin."}

    rows: list[dict] = []
    messages: list[dict] = []

    def call(path: str, body: dict) -> dict:
        res = client.post(path, json=body, headers=auth)
        if res.status_code != 200:
            raise SystemExit(f"{path} -> {res.status_code}: {res.text[:300]}")
        rows.extend(json.loads(res.headers.get("X-LLM-Usage", "[]")))
        return res.json()

    per_answer = args.duration * 60 / (args.answers + 1)
    for i in range(args.answers + 1):
        out = call("/v1/interview/turn", {"config": config, "profile": profile, "pack": pack, "persona": persona, "domain": domain,
                                          "messages": messages, "elapsedSec": int(i * per_answer)})
        messages.append({"id": str(len(messages)), "role": "interviewer", "text": out["reply"], "at": 0})
        if out["endInterview"] or i == args.answers:
            break
        messages.append({"id": str(len(messages)), "role": "candidate", "text": ANSWERS[i % len(ANSWERS)], "at": 0})

    if not args.no_report:
        call("/v1/interview/report", {"config": config, "profile": profile, "pack": pack, "domain": domain,
                                      "interviewerName": persona["name"], "messages": messages, "code": ""})

    print(f"\n{'#':>3} {'task':<18} {'model':<22} {'input':>7} {'cached':>7} {'cache%':>6} {'output':>7} {'thought':>7} {'ms':>6}")
    for n, r in enumerate(rows, 1):
        pct = 100 * r["cachedTokens"] / r["inputTokens"] if r["inputTokens"] else 0
        print(f"{n:>3} {r['task']:<18} {r['model'][:22]:<22} {r['inputTokens']:>7} {r['cachedTokens']:>7} {pct:>5.0f}% "
              f"{r['outputTokens']:>7} {r['thoughtTokens']:>7} {r['ms']:>6}")

    print("\nTOTALS BY TASK")
    for task in dict.fromkeys(r["task"] for r in rows):
        rs = [r for r in rows if r["task"] == task]
        inp, cached = sum(r["inputTokens"] for r in rs), sum(r["cachedTokens"] for r in rs)
        out, thought = sum(r["outputTokens"] for r in rs), sum(r["thoughtTokens"] for r in rs)
        print(f"  {task:<18} calls={len(rs):<3} input={inp:<8} uncached={inp - cached:<8} cached={cached:<8} "
              f"({100 * cached / inp if inp else 0:.0f}%)  output={out:<6} thought={thought}")
    print("\nThought tokens are billed as output. Prices per model: https://ai.google.dev/gemini-api/docs/pricing")


if __name__ == "__main__":
    main()
