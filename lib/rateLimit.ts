import { ApiError } from "./liveAgent";

// Server-only. Per-IP rate limits for the AI routes (implementationPlan M1.2), so nobody who can
// reach the server can burn the Gemini budget. Each route calls `enforceRateLimit` before reading
// its body. Counts live in Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (shared by every
// server instance), otherwise in this process's memory (fine for local dev and a single server).
// Per-user quotas replace the IP as the key once accounts exist (M2).

export interface Rule {
  limit: number;
  windowSec: number;
}

/** Requests allowed per client IP per window. The Pro-model routes (report, pack generation) are strictest. */
export const RATE_LIMITS = {
  "interview.turn": { limit: 20, windowSec: 60 },
  "interview.report": { limit: 5, windowSec: 600 },
  "pack.generate": { limit: 5, windowSec: 600 },
  roadmap: { limit: 5, windowSec: 600 },
  "ai.assist": { limit: 20, windowSec: 60 },
  // Pings both Gemini models.
  health: { limit: 5, windowSec: 60 },
} satisfies Record<string, Rule>;

export type Bucket = keyof typeof RATE_LIMITS;

export interface Hit {
  allowed: boolean;
  retryAfterSec: number;
}

/** Counts one request for `key` in a fixed window of `rule.windowSec`. */
export interface LimiterStore {
  hit(key: string, rule: Rule): Promise<Hit>;
}

export function memoryStore(now: () => number = Date.now): LimiterStore {
  const windows = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, rule) {
      const t = now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      let w = windows.get(key);
      if (!w || w.resetAt <= t) {
        w = { count: 0, resetAt: t + rule.windowSec * 1000 };
        windows.set(key, w);
      }
      w.count++;
      return { allowed: w.count <= rule.limit, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
    },
  };
}

/** Upstash Redis over its REST API (no client library): create the window with its TTL, count, read the TTL. */
export function upstashStore(url: string, token: string): LimiterStore {
  const endpoint = `${url.replace(/\/+$/, "")}/pipeline`;
  return {
    async hit(key, rule) {
      const k = `offerly:rl:${key}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify([
          ["SET", k, "0", "EX", String(rule.windowSec), "NX"],
          ["INCR", k],
          ["TTL", k],
        ]),
        signal: AbortSignal.timeout(2_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
      const out = (await res.json()) as { result?: unknown; error?: string }[];
      const failed = out.find((r) => r.error);
      if (failed) throw new Error(`Upstash: ${failed.error}`);
      const count = Number(out[1]?.result);
      const ttl = Number(out[2]?.result);
      return { allowed: count <= rule.limit, retryAfterSec: ttl > 0 ? ttl : rule.windowSec };
    },
  };
}

let defaultStore: LimiterStore | undefined;
function getStore(): LimiterStore {
  const { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token } = process.env;
  return (defaultStore ??= url && token ? upstashStore(url, token) : memoryStore());
}

/**
 * The caller's IP. On Vercel (and most hosts behind a load balancer) the first x-forwarded-for
 * entry is set by the platform. Behind a proxy that passes client-supplied headers through, it can
 * be spoofed; fix that at the proxy. Requests without either header (local dev) share one bucket.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip")?.trim() || "unknown";
}

const wait = (sec: number) => (sec < 90 ? `${sec} seconds` : `${Math.ceil(sec / 60)} minutes`);

/**
 * Throws ApiError 429 (with Retry-After) when this client is over the bucket's limit. If the store
 * itself fails (Upstash down), the request is let through and the error logged: an outage of the
 * limiter shouldn't take the app down with it.
 */
export async function enforceRateLimit(req: Request, bucket: Bucket, store: LimiterStore = getStore()): Promise<void> {
  const ip = clientIp(req);
  let hit: Hit;
  try {
    hit = await store.hit(`${bucket}:${ip}`, RATE_LIMITS[bucket]);
  } catch (e) {
    console.error(JSON.stringify({ event: "ratelimit.error", bucket, error: e instanceof Error ? e.message : String(e) }));
    return;
  }
  if (hit.allowed) return;
  console.warn(JSON.stringify({ event: "ratelimit.blocked", bucket, ip }));
  throw new ApiError(429, `Too many requests. Try again in ${wait(hit.retryAfterSec)}.`, { retryAfterSec: hit.retryAfterSec });
}
