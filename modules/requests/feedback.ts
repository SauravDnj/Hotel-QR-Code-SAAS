import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db/types";
import { departments, requestFeedback, serviceRequests } from "@/lib/db/schema";
import { hashQrToken, isWellFormedQrToken } from "@/lib/crypto/secrets";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { TenantContext } from "@/lib/permissions/authorize";
import { isUniqueViolation } from "@/modules/rooms/db-errors";
import { requestScopeCondition } from "./staff";

/**
 * Guest feedback (1–5 stars + optional comment) on a COMPLETED request, given once from the
 * request's status page. The status token is the only identity input, as for the receipt.
 */
export const FEEDBACK_COMMENT_MAX = 500;

export const feedbackSchema = z.object({
  rating: z.coerce.number().int().min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"),
  comment: z
    .string()
    .trim()
    .max(FEEDBACK_COMMENT_MAX, `Keep it under ${FEEDBACK_COMMENT_MAX} characters`)
    .optional()
    .transform((v) => (v ? v : null)),
});

export type FeedbackResult =
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "rate_limited" }
  | { kind: "not_completed" }
  | { kind: "already_rated" }
  | { kind: "invalid"; message: string };

export async function submitGuestFeedback(db: Db, token: unknown, raw: unknown, opts: { ip: string | null }): Promise<FeedbackResult> {
  if (opts.ip) {
    const byIp = await consumeRateLimit(db, `guest-feedback:ip:${opts.ip}`, RATE_LIMITS.guestRequestByIp);
    if (!byIp.allowed) return { kind: "rate_limited" };
  }
  if (!isWellFormedQrToken(token)) return { kind: "unavailable" };
  const parsed = feedbackSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid", message: parsed.error.issues[0]?.message ?? "Check your rating." };

  const [r] = await db
    .select({ id: serviceRequests.id, tenantId: serviceRequests.tenantId, propertyId: serviceRequests.propertyId, status: serviceRequests.status, expires: serviceRequests.guestTokenExpiresAt })
    .from(serviceRequests)
    .where(eq(serviceRequests.guestTokenHash, hashQrToken(token)));
  if (!r || r.expires.getTime() < Date.now()) return { kind: "unavailable" };
  if (r.status !== "completed") return { kind: "not_completed" };

  try {
    await db.insert(requestFeedback).values({
      tenantId: r.tenantId,
      propertyId: r.propertyId,
      requestId: r.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: "already_rated" };
    throw err;
  }
  return { kind: "ok" };
}

/** The guest's own rating, for the status page (looked up by the request id resolved from the token). */
export async function feedbackForRequest(db: Db, tenantId: string, requestId: string) {
  const [f] = await db
    .select({ rating: requestFeedback.rating, comment: requestFeedback.comment, createdAt: requestFeedback.createdAt })
    .from(requestFeedback)
    .where(and(eq(requestFeedback.tenantId, tenantId), eq(requestFeedback.requestId, requestId)));
  return f ?? null;
}

/**
 * Ratings for the Reports page: requests submitted in the range, limited to the caller's
 * request scope (property + department), like the other request figures.
 */
export async function feedbackSummary(db: Db, ctx: TenantContext, propertyId: string, range: { start: Date; end: Date }) {
  const scope = requestScopeCondition(ctx, "request.view");
  const where = and(
    eq(requestFeedback.tenantId, ctx.tenantId),
    eq(requestFeedback.propertyId, propertyId),
    gte(serviceRequests.submittedAt, range.start),
    lt(serviceRequests.submittedAt, range.end),
    scope ?? sql`false`,
  );
  const base = () =>
    db
      .select({
        count: sql<number>`count(*)`.mapWith(Number),
        avg: sql<number | null>`round(avg(${requestFeedback.rating})::numeric, 1)`.mapWith((v) => (v === null ? null : Number(v))),
        r1: sql<number>`count(*) filter (where ${requestFeedback.rating} = 1)`.mapWith(Number),
        r2: sql<number>`count(*) filter (where ${requestFeedback.rating} = 2)`.mapWith(Number),
        r3: sql<number>`count(*) filter (where ${requestFeedback.rating} = 3)`.mapWith(Number),
        r4: sql<number>`count(*) filter (where ${requestFeedback.rating} = 4)`.mapWith(Number),
        r5: sql<number>`count(*) filter (where ${requestFeedback.rating} = 5)`.mapWith(Number),
      })
      .from(requestFeedback)
      .innerJoin(serviceRequests, eq(serviceRequests.id, requestFeedback.requestId))
      .innerJoin(departments, eq(departments.id, serviceRequests.departmentId));
  const [t] = await base().where(where);
  const byDepartment = await db
    .select({
      department: serviceRequests.departmentName,
      count: sql<number>`count(*)`.mapWith(Number),
      avg: sql<number>`round(avg(${requestFeedback.rating})::numeric, 1)`.mapWith(Number),
    })
    .from(requestFeedback)
    .innerJoin(serviceRequests, eq(serviceRequests.id, requestFeedback.requestId))
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(where)
    .groupBy(serviceRequests.departmentName)
    .orderBy(sql`avg(${requestFeedback.rating}) asc`);
  // Low ratings are the ones a manager should read first.
  const low = await db
    .select({
      requestId: serviceRequests.id,
      roomCode: serviceRequests.roomCode,
      serviceName: serviceRequests.serviceName,
      rating: requestFeedback.rating,
      comment: requestFeedback.comment,
      createdAt: requestFeedback.createdAt,
    })
    .from(requestFeedback)
    .innerJoin(serviceRequests, eq(serviceRequests.id, requestFeedback.requestId))
    .innerJoin(departments, eq(departments.id, serviceRequests.departmentId))
    .where(and(where, lte(requestFeedback.rating, 3)))
    .orderBy(desc(requestFeedback.createdAt))
    .limit(10);
  return {
    count: t?.count ?? 0,
    average: t?.avg ?? null,
    distribution: [t?.r1 ?? 0, t?.r2 ?? 0, t?.r3 ?? 0, t?.r4 ?? 0, t?.r5 ?? 0],
    byDepartment,
    low,
  };
}
