"""Writes openapi.json (the Core <-> liveAgent contract). Run after changing live_agent/models.py or
a route, then `npm run agent:types` in the repo root to regenerate lib/liveAgent.types.ts."""

import json
from pathlib import Path

from live_agent.main import app

out = Path(__file__).resolve().parent.parent / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"Wrote {out}")
