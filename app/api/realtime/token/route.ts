import { getCurrentUser, requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";
import { realtimeEnabled, requestSubscribeToken } from "@/lib/realtime/ably";
import { departmentChannel } from "@/lib/realtime/channels";
import { subscribableChannels } from "@/modules/requests/staff";

/**
 * Channel authorisation (REALTIME_NOTIFICATIONS.md): the server decides the channels from
 * the session's tenant, property and department scope, and returns a short-lived,
 * subscribe-only token for exactly those channels. The browser never names a channel.
 */
export async function GET() {
  if (!(await getCurrentUser())) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const ctx = await requireTenantContext();
  const noStore = { "Cache-Control": "private, no-store" };
  if (!realtimeEnabled()) return Response.json({ enabled: false }, { headers: noStore });

  const channels = (await subscribableChannels(getDb(), ctx)).map((d) => departmentChannel(ctx.tenantId, d.propertyId, d.id));
  if (channels.length === 0) return Response.json({ enabled: false }, { headers: noStore });
  try {
    const token = await requestSubscribeToken(channels, ctx.userId);
    return Response.json({ enabled: true, channels, ...token }, { headers: noStore });
  } catch (err) {
    // Provider down: the client falls back to polling.
    logger.warn("realtime_token_failed", errorFields(err));
    return Response.json({ enabled: false, degraded: true }, { headers: noStore });
  }
}
