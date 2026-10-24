"""Report scoring eval set (plans/report-eval-set.md): scores each seed transcript in
evals/report/cases/ with the REAL scorer and compares it with the expected ranges. Costs one
scoring-model call per case per repeat; needs GEMINI_API_KEY in liveAgent/.env. Not part of CI.

    npm run agent:eval                          # every case once
    npm run agent:eval -- --case injection      # one case (substring match)
    npm run agent:eval -- --repeat 3            # score spread per case
    npm run agent:eval -- --thinking high       # try a scorer thinking level without a code change
"""

import argparse
import json
import os
import statistics
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "evals" / "report" / "cases"
RESULTS = ROOT / "evals" / "report" / "results"


def load_cases() -> list[dict]:
    """Every case with the shared defaults filled in; `pack`, `profile` and `config` overrides merge field by field."""
    defaults = json.loads((CASES / "_defaults.json").read_text(encoding="utf-8"))
    cases = []
    for path in sorted(CASES.glob("*.json")):
        if path.name.startswith("_"):
            continue
        case = json.loads(path.read_text(encoding="utf-8"))
        body = {key: {**defaults[key], **case.get(key, {})} for key in ("profile", "pack", "config", "domain")}
        body["config"]["durationMin"] = case.get("config", {}).get("durationMin", body["pack"]["durationMin"])
        body |= {"interviewerName": defaults["interviewerName"], "messages": case["messages"], "code": case.get("code", "")}
        cases.append({"id": path.stem, "description": case["description"], "expect": case["expect"], "body": body})
    return cases


def signed_error(value: float, lo: float, hi: float) -> float:
    """How far outside [lo, hi] a score is: negative below, positive above, 0 inside."""
    return value - lo if value < lo else value - hi if value > hi else 0


def check(expect: dict, report: dict) -> list[str]:
    """The ways a report misses its expectations; empty when it passes."""
    misses = []
    lo, hi = expect["overall"]
    if signed_error(report["overall"], lo, hi):
        misses.append(f"overall {report['overall']} not in {lo}-{hi}")
    if report["verdict"] not in expect["verdicts"]:
        misses.append(f"verdict {report['verdict']} not in {expect['verdicts']}")
    dims = {d["name"]: d for d in report["dimensions"]}
    for name, (dlo, dhi) in expect.get("dimensions", {}).items():
        d = dims.get(name)
        if d is None:
            misses.append(f"{name} missing")
        elif signed_error(d["score"], dlo, dhi):
            misses.append(f"{name} {d['score']} not in {dlo}-{dhi}")
    for name in expect.get("notAssessed", []):
        if dims.get(name, {}).get("assessed", True):
            misses.append(f"{name} should be not assessed")
    return misses


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--case", help="only cases whose id contains this")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--thinking", choices=["minimal", "low", "medium", "high", "default"],
                        help="scorer thinking level (default: low; 'default' is the model's own)")
    args = parser.parse_args()

    from measure_tokens import load_env

    load_env()
    if not os.environ.get("GEMINI_API_KEY"):
        raise SystemExit("GEMINI_API_KEY is not set in liveAgent/.env")
    os.environ.setdefault("LIVE_AGENT_TOKEN", "eval")
    if args.thinking:
        os.environ["GEMINI_REPORT_THINKING"] = args.thinking

    from fastapi.testclient import TestClient

    from live_agent.gemini import MODELS
    from live_agent.main import app

    cases = [c for c in load_cases() if not args.case or args.case in c["id"]]
    client = TestClient(app).__enter__()  # one event loop: the Gemini client's async session is bound to it
    auth = {"Authorization": f"Bearer {os.environ['LIVE_AGENT_TOKEN']}"}

    results, version = [], None
    print(f"{'case':<22} {'expected':>9} {'actual':<16} {'err':>5}  result")
    for case in cases:
        lo, hi = case["expect"]["overall"]
        runs = []
        for _ in range(args.repeat):
            res = client.post("/v1/interview/report", json=case["body"], headers=auth)
            if res.status_code != 200:
                runs.append({"error": f"{res.status_code}: {res.text[:200]}", "misses": ["request failed"]})
                continue
            version = res.headers.get("X-Prompt-Version")
            report = res.json()
            usage = json.loads(res.headers.get("X-LLM-Usage", "[]"))
            runs.append({"overall": report["overall"], "verdict": report["verdict"], "misses": check(case["expect"], report),
                         "dimensions": {d["name"]: d["score"] for d in report["dimensions"]},
                         "thoughtTokens": sum(u["thoughtTokens"] for u in usage), "outputTokens": sum(u["outputTokens"] for u in usage)})
        scored = [r for r in runs if "overall" in r]
        errors = [signed_error(r["overall"], lo, hi) for r in scored]
        actual = ", ".join(f"{r['overall']} {r['verdict']}" for r in scored) or "error"
        misses = sorted({m for r in runs for m in r["misses"]})
        print(f"{case['id']:<22} {f'{lo}-{hi}':>9} {actual:<16} {statistics.mean(errors) if errors else 0:>+5.0f}  "
              f"{'PASS' if not misses else 'FAIL: ' + '; '.join(misses)}")
        results.append({"id": case["id"], "expect": case["expect"], "runs": runs})

    all_errors = [signed_error(r["overall"], *c["expect"]["overall"]) for c in results for r in c["runs"] if "overall" in r]
    passed = sum(1 for c in results if not any(r["misses"] for r in c["runs"]))
    thought = [r["thoughtTokens"] for c in results for r in c["runs"] if "overall" in r]
    summary = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "model": MODELS.scoring, "promptVersion": version,
        "thinking": args.thinking or os.environ.get("GEMINI_REPORT_THINKING") or "low", "repeat": args.repeat, "passed": passed, "cases": len(results),
        "meanSignedError": round(statistics.mean(all_errors), 1) if all_errors else None,
        "meanAbsError": round(statistics.mean(abs(e) for e in all_errors), 1) if all_errors else None,
        "meanThoughtTokens": round(statistics.mean(thought)) if thought else None,
    }
    print(f"\n{passed}/{len(results)} cases pass | mean signed error {summary['meanSignedError']} | mean |error| {summary['meanAbsError']} "
          f"| {summary['model']} prompt {version} thinking={summary['thinking']} | ~{summary['meanThoughtTokens']} thinking tokens per report")

    RESULTS.mkdir(parents=True, exist_ok=True)
    out = RESULTS / f"{time.strftime('%Y%m%d-%H%M%S')}.json"
    out.write_text(json.dumps({"summary": summary, "cases": results}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
