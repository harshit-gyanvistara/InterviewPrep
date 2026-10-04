// Runs liveAgent (the Python AI service in ./liveAgent) from npm scripts on any OS.
//   node scripts/agent.mjs setup    create liveAgent/.venv and install it with dev deps
//   node scripts/agent.mjs serve    run it on :8000 with reload, loading liveAgent/.env
//   node scripts/agent.mjs test     run its pytest suite
//   node scripts/agent.mjs openapi  rewrite liveAgent/openapi.json
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "liveAgent");
const venvPython = join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const python = (...args) => {
  if (!existsSync(venvPython)) {
    console.error("liveAgent is not set up yet. Run: npm run agent:setup");
    process.exit(1);
  }
  run(venvPython, args);
};

switch (process.argv[2]) {
  case "setup":
    run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", ".venv"]);
    python("-m", "pip", "install", "--upgrade", "pip");
    python("-m", "pip", "install", "-e", ".[dev]");
    break;
  case "serve": {
    const env = existsSync(join(dir, ".env")) ? ["--env-file", ".env"] : [];
    python("-m", "uvicorn", "live_agent.main:app", "--reload", "--port", process.env.LIVE_AGENT_PORT || "8000", ...env);
    break;
  }
  case "test":
    python("-m", "pytest", ...process.argv.slice(3));
    break;
  case "openapi":
    python("scripts/export_openapi.py");
    break;
  default:
    console.error("Usage: node scripts/agent.mjs setup|serve|test|openapi");
    process.exit(1);
}
