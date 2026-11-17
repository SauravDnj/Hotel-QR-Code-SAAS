"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Status = "checking" | "unsupported" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Turns phone/desktop notifications on or off for THIS browser. Permission is requested
 * only when the person taps the button (never on page load).
 */
export function PushToggle({
  publicKey,
  subscribe,
  unsubscribe,
}: {
  publicKey: string;
  subscribe: (json: string) => Promise<{ ok: boolean; message: string }>;
  unsubscribe: (endpoint: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (!cancelled) setStatus(sub ? "on" : "off");
    })().catch(() => !cancelled && setStatus("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setStatus("busy");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      const res = await subscribe(JSON.stringify(sub.toJSON()));
      setMessage(res.message);
      setStatus(res.ok ? "on" : "off");
    } catch {
      setMessage("Couldn't turn on notifications in this browser.");
      setStatus("off");
    }
  }

  async function turnOff() {
    setStatus("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setMessage("Notifications are off for this device.");
    } finally {
      setStatus("off");
    }
  }

  return (
    <div className="space-y-2">
      {status === "unsupported" && (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t receive notifications. On iPhone, first add the app to your Home Screen (Share → Add to Home Screen), then open it from there.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-warning">Notifications are blocked for this site. Allow them in your browser settings, then reload.</p>
      )}
      {(status === "off" || status === "busy" || status === "checking") && (
        <Button type="button" onClick={turnOn} disabled={status !== "off"}>
          {status === "busy" ? "Turning on…" : "Turn on notifications on this device"}
        </Button>
      )}
      {status === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-success">On for this device.</span>
          <Button type="button" variant="secondary" size="sm" onClick={turnOff}>
            Turn off
          </Button>
        </div>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
