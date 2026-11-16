import "server-only";
import { after } from "next/server";
import { getDb } from "@/lib/db/client";
import { errorFields, logger } from "@/lib/observability/logger";
import { drainOutbox } from "@/modules/realtime/outbox";
import { escalateOverdue } from "@/modules/requests/escalation";
import { ablyPublisher } from "./ably";

/**
 * Publishes pending outbox events after the response is sent. Called after every request
 * change and by inbox polls, so events flow even without a frequent cron. Failures stay
 * pending and are retried with backoff.
 */
export function drainOutboxAfterResponse(limit = 10) {
  after(async () => {
    try {
      await escalateOverdue(getDb());
      await drainOutbox(getDb(), ablyPublisher(), { limit });
    } catch (err) {
      logger.warn("outbox_drain_failed", errorFields(err));
    }
  });
}
