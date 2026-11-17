import "server-only";
import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";
import { drainOutbox } from "@/modules/realtime/outbox";
import { escalateOverdue } from "@/modules/requests/escalation";
import { ablyPublisher } from "./ably";
import { defaultSenders } from "@/lib/notifications/senders";
import { deliverNotification } from "@/modules/notifications/service";
import { deliverWebhook } from "@/modules/integrations/webhooks";
import type { Notifier } from "@/modules/realtime/outbox";

/** Delivery for outbox jobs: "webhook.*" (integrations) and "notify.*" (push / SMS). */
export function outboxNotifier(): Notifier {
  const senders = defaultSenders();
  return async ({ tenantId, eventType, payload }) => {
    if (eventType.startsWith("webhook.")) return deliverWebhook(getDb(), tenantId, payload);
    if (!senders.push && !senders.message) return null; // channel removed since the job was written
    return deliverNotification(getDb(), tenantId, payload, senders);
  };
}

/**
 * Publishes pending outbox events after the response is sent. Called after every request
 * change and by inbox polls, so events flow even without a frequent cron. Failures stay
 * pending and are retried with backoff.
 */
export function drainOutboxAfterResponse(limit = 10) {
  after(async () => {
    try {
      await escalateOverdue(getDb());
      await drainOutbox(getDb(), ablyPublisher(), { limit, notifier: outboxNotifier() });
    } catch (err) {
      logger.warn("outbox_drain_failed", errorFields(err));
    }
  });
}
