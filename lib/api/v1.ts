import "server-only";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/types";
import { AppError } from "@/lib/errors";
import { errorFields, logger } from "@/lib/observability/logger";
import { consumeRateLimit } from "@/lib/rate-limit";
import { drainOutboxAfterResponse } from "@/lib/realtime/drain";
import { getEntitlements } from "@/modules/billing/subscription";
import { authenticateApiKey, type ApiPrincipal, type ApiScope } from "@/modules/integrations/keys";

/**
 * Integration REST API helpers (/api/v1). Every request:
 * 1. authenticates the Bearer API key (hash lookup; revoked = unknown);
 * 2. checks the key's scope and the hotel plan's "integrations" module;
 * 3. is rate limited per key (120 requests/minute);
 * 4. runs the SAME services as the staff UI with a context built only from the key, so
 *    tenant, property scope, permissions, validation and audit rules are identical.
 * Errors are JSON { error: { code, message, fields? } } and never include internals.
 */

export const API_RATE_LIMIT = { limit: 120, windowSeconds: 60 };

const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extra } });
}

export function apiError(status: number, code: string, message: string, fields?: Record<string, string[] | undefined>) {
  return json({ error: { code, message, ...(fields ? { fields } : {}) } }, status);
}

const STATUS: Record<AppError["code"], number> = {
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  validation: 422,
  rate_limited: 429,
  tenant_inactive: 403,
  plan_limit: 402,
};

export async function withApi(
  req: Request,
  /** null = any valid key (e.g. listing the properties the key can see). */
  scope: ApiScope | null,
  handler: (p: ApiPrincipal, db: Db) => Promise<Response>,
): Promise<Response> {
  const db = getDb();
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  try {
    const principal = await authenticateApiKey(db, presented);
    if (!principal) return apiError(401, "unauthorized", "Missing or invalid API key.");
    const limit = await consumeRateLimit(db, `api:key:${principal.keyId}`, API_RATE_LIMIT);
    if (!limit.allowed) return json({ error: { code: "rate_limited", message: "Too many requests. Retry in a minute." } }, 429, { "Retry-After": "60" });
    if (scope && !principal.scopes.includes(scope)) return apiError(403, "insufficient_scope", `This key lacks the ${scope} permission.`);
    const ent = await getEntitlements(db, principal.ctx.tenantId);
    if (!ent.modules.integrations) return apiError(402, "plan_limit", "API access isn't included in this hotel's plan.");
    const res = await handler(principal, db);
    if (req.method !== "GET") drainOutboxAfterResponse(); // deliver webhooks triggered by the change
    return res;
  } catch (err) {
    if (err instanceof z.ZodError) return apiError(422, "validation", "Invalid request.", z.flattenError(err).fieldErrors as Record<string, string[]>);
    if (err instanceof AppError) return apiError(STATUS[err.code] ?? 400, err.code, err.message);
    if (err instanceof SyntaxError) return apiError(400, "bad_json", "The request body must be JSON.");
    logger.error("api_v1_failed", { path: new URL(req.url).pathname, method: req.method, ...errorFields(err) });
    return apiError(500, "internal", "Something went wrong.");
  }
}

/** Reads a JSON object body (max 32 KB). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 32_768) throw new AppError("Request body too large.", "validation");
  const parsed = JSON.parse(text || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SyntaxError("not an object");
  return parsed as Record<string, unknown>;
}
