import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Minimal Ably REST client (no SDK): publish from the server, and mint short-lived,
 * subscribe-only tokens for staff browsers. The API key never leaves the server.
 * https://ably.com/docs/api/rest-api
 */

const REST = "https://rest.ably.io";

export interface RealtimePublisher {
  readonly enabled: boolean;
  publish(channel: string, name: string, data: unknown): Promise<void>;
}

function parseKey(): { keyName: string; keySecret: string; full: string } | null {
  const key = serverEnv().ABLY_API_KEY;
  if (!key) return null;
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return { keyName: key.slice(0, idx), keySecret: key.slice(idx + 1), full: key };
}

export function realtimeEnabled(): boolean {
  return parseKey() !== null;
}

export function ablyPublisher(fetchImpl: typeof fetch = fetch): RealtimePublisher {
  const key = parseKey();
  return {
    enabled: key !== null,
    async publish(channel, name, data) {
      if (!key) throw new Error("Realtime is not configured");
      const res = await fetchImpl(`${REST}/channels/${encodeURIComponent(channel)}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(key.full).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, data: JSON.stringify(data) }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Ably publish failed: HTTP ${res.status}`);
    },
  };
}

export interface SignedTokenRequest {
  keyName: string;
  ttl: number;
  capability: string;
  clientId: string;
  timestamp: number;
  nonce: string;
  mac: string;
}

/** Ably "signed token request": HMAC-SHA256 over the newline-joined fields. */
export function signTokenRequest(
  keyName: string,
  keySecret: string,
  params: { ttl: number; capability: Record<string, string[]>; clientId: string; timestamp: number; nonce?: string },
): SignedTokenRequest {
  const capability = JSON.stringify(params.capability);
  const nonce = params.nonce ?? randomBytes(16).toString("hex");
  const text = [keyName, params.ttl, capability, params.clientId, params.timestamp, nonce].join("\n") + "\n";
  const mac = createHmac("sha256", keySecret).update(text).digest("base64");
  return { keyName, ttl: params.ttl, capability, clientId: params.clientId, timestamp: params.timestamp, nonce, mac };
}

/** Exchanges a signed request for a token the browser can use (subscribe-only channels). */
export async function requestSubscribeToken(channels: string[], clientId: string, ttlMs = 60 * 60 * 1000) {
  const key = parseKey();
  if (!key || channels.length === 0) return null;
  const capability = Object.fromEntries(channels.map((c) => [c, ["subscribe"]]));
  const body = signTokenRequest(key.keyName, key.keySecret, { ttl: ttlMs, capability, clientId, timestamp: Date.now() });
  const res = await fetch(`${REST}/keys/${encodeURIComponent(key.keyName)}/requestToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Ably token request failed: HTTP ${res.status}`);
  const json = (await res.json()) as { token: string; expires: number };
  return { token: json.token, expires: json.expires };
}
