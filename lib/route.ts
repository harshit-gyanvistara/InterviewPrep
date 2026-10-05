import type { z } from "zod";
import { ApiError } from "./liveAgent";
import { LIMITS } from "./schemas";

// Server-only helpers for app/api route handlers.

/**
 * Reads and validates a JSON request body. Throws ApiError 413 for oversized bodies and 400 for
 * bad JSON or a schema mismatch (with per-field `issues`); `errorResponse` turns either into the
 * usual `{ error }` response.
 */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.bodyBytes) throw new ApiError(413, "Request is too large.");

  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > LIMITS.bodyBytes) throw new ApiError(413, "Request is too large.");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }

  const parsed = schema.safeParse(json);
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const first = parsed.error.issues[0];
  // Custom rules carry a message written for the user; built-in ones need the field name for context.
  const message = first.code === "custom" ? first.message : `Invalid request: ${issues[0].path || "body"}: ${first.message}`;
  throw new ApiError(400, message, issues);
}
