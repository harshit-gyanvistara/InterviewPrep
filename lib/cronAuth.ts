import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./liveAgent";

/**
 * Checks a scheduler's `Authorization` header against CRON_SECRET. Fails closed: with no secret
 * configured nobody can run the job (503), and a wrong or missing header is 401. Compared in constant time.
 */
export function requireCronSecret(header: string | null, secret: string | undefined): void {
  if (!secret) throw new ApiError(503, "CRON_SECRET is not set on the server.");
  const given = Buffer.from(header ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new ApiError(401, "Not authorised.");
}
