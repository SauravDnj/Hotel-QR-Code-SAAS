import "server-only";
import webpush from "web-push";
import { serverEnv } from "@/lib/env";

/**
 * Delivery channels for staff alerts (Phase 9). Both are optional: without keys the inbox
 * (polling / Ably) remains the primary path, exactly as before. Payloads never contain
 * guest names, contact details or notes: only room, service and an inbox link.
 */

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface AlertMessage {
  room: string;
  service: string;
  minutes: number;
  url: string;
}

export interface NotificationSenders {
  /** "gone" = the push service says the subscription no longer exists (delete it). */
  push: ((target: PushTarget, payload: PushPayload) => Promise<"ok" | "gone">) | null;
  message: ((channel: "sms" | "whatsapp", to: string, msg: AlertMessage) => Promise<void>) | null;
}

export function vapidPublicKey(): string | null {
  return serverEnv().VAPID_PUBLIC_KEY ?? null;
}

export function webPushSender(): NotificationSenders["push"] {
  const env = serverEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  const vapid = { subject: env.VAPID_SUBJECT ?? env.APP_URL, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  return async (target, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: vapid, TTL: 15 * 60, urgency: "high", timeout: 8000 },
      );
      return "ok";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      // Never include the endpoint (a capability URL) in errors that may be logged.
      throw new Error(`push failed${status ? ` (${status})` : ""}`);
    }
  };
}

/** Twilio Messages API over REST (no SDK). WhatsApp uses an approved template when configured. */
export function twilioSender(fetchImpl: typeof fetch = fetch): NotificationSenders["message"] {
  const env = serverEnv();
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null;
  const sid = env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  return async (channel, to, msg) => {
    const text = `Escalated: room ${msg.room}, ${msg.service}, not accepted in ${msg.minutes} min. ${msg.url}`;
    const form = new URLSearchParams();
    if (channel === "sms") {
      if (!env.TWILIO_SMS_FROM) throw new Error("SMS sender is not configured");
      form.set("To", to);
      if (env.TWILIO_SMS_FROM.startsWith("MG")) form.set("MessagingServiceSid", env.TWILIO_SMS_FROM);
      else form.set("From", env.TWILIO_SMS_FROM);
      form.set("Body", text);
    } else {
      if (!env.TWILIO_WHATSAPP_FROM) throw new Error("WhatsApp sender is not configured");
      form.set("To", `whatsapp:${to}`);
      form.set("From", `whatsapp:${env.TWILIO_WHATSAPP_FROM}`);
      if (env.TWILIO_WHATSAPP_CONTENT_SID) {
        form.set("ContentSid", env.TWILIO_WHATSAPP_CONTENT_SID);
        form.set("ContentVariables", JSON.stringify({ 1: msg.room, 2: msg.service, 3: String(msg.minutes) }));
      } else {
        form.set("Body", text); // works inside the 24h session window / sandbox only
      }
    }
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`twilio ${res.status}`);
  };
}

export function defaultSenders(): NotificationSenders {
  return { push: webPushSender(), message: twilioSender() };
}
