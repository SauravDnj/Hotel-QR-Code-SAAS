"use client";

import { Bell, BellOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Mode = "connecting" | "live" | "polling" | "offline";

const SOUND_KEY = "inbox-sound";
const ABLY_SSE = "https://realtime.ably.io/sse";

function beep() {
  try {
    const ctx = new AudioContext();
    [0, 0.25].forEach((t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + t);
      osc.stop(ctx.currentTime + t + 0.2);
    });
    navigator.vibrate?.(200);
  } catch {
    /* audio unavailable */
  }
}

/**
 * Keeps the server-rendered inbox fresh. The database is the source of truth:
 * - with Ably configured, a subscribe-only token for the user's own department channels
 *   drives instant refreshes over Server-Sent Events;
 * - polling the change marker always runs (fast when not live) and recovers anything missed
 *   while offline, asleep or during a provider outage.
 * Messages carry ids only; the page re-fetches details through authorised server code.
 */
type Marker = { latest: string | null; newCount: number; mineCount: number };

export function LiveInbox({ initial, prefs }: { initial: Marker; prefs: { sound: boolean; scope: "all" | "mine" } }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("connecting");
  const [sound, setSound] = useState(false);
  const marker = useRef(initial);
  const soundRef = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      // A per-device choice overrides the profile default (set in My profile).
      const stored = localStorage.getItem(SOUND_KEY);
      const on = stored === null ? prefs.sound : stored === "on";
      soundRef.current = on;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
      setSound(on);
    } catch {
      /* storage unavailable */
    }
  }, [prefs.sound]);

  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 300);
  }, [router]);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/marker", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as Marker;
      const prev = marker.current;
      marker.current = next;
      if (next.latest !== prev.latest || next.newCount !== prev.newCount) {
        const grew = prefs.scope === "mine" ? next.mineCount > prev.mineCount : next.newCount > prev.newCount;
        if (grew && soundRef.current) beep();
        refresh();
      }
      setMode((m) => (m === "offline" ? "polling" : m));
    } catch {
      setMode("offline");
    }
  }, [refresh, prefs.scope]);

  // Realtime subscription (optional) with token refresh and reconnect backoff.
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    async function connect() {
      if (stopped) return;
      try {
        const res = await fetch("/api/realtime/token", { cache: "no-store" });
        const t = (await res.json()) as { enabled: boolean; token?: string; channels?: string[] };
        if (!t.enabled || !t.token || !t.channels?.length) {
          setMode("polling");
          return;
        }
        const url = `${ABLY_SSE}?v=1.2&channels=${t.channels.map(encodeURIComponent).join(",")}&accessToken=${encodeURIComponent(t.token)}`;
        source = new EventSource(url);
        source.onopen = () => {
          attempt = 0;
          setMode("live");
          void check(); // recover anything missed while disconnected
        };
        source.onmessage = () => void check();
        source.onerror = () => {
          source?.close();
          setMode("polling");
          // Token may have expired or the provider is down: back off, then mint a new token.
          retry = setTimeout(connect, Math.min(60_000, 2000 * 2 ** attempt++));
        };
      } catch {
        setMode("polling");
        retry = setTimeout(connect, Math.min(60_000, 2000 * 2 ** attempt++));
      }
    }
    void connect();
    return () => {
      stopped = true;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [check]);

  // Polling: every 10s without realtime, every 60s as a safety net with it.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, mode === "live" ? 60_000 : 10_000);
    const onWake = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [check, mode]);

  function toggleSound() {
    const on = !sound;
    setSound(on);
    soundRef.current = on;
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (on) beep(); // user gesture unlocks audio and previews the alert
  }

  const label: Record<Mode, string> = {
    connecting: "Connecting…",
    live: "Live",
    polling: "Auto-refresh every 10 s",
    offline: "Offline – retrying",
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        role="status"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
          mode === "live" && "border-success text-success",
          mode === "offline" && "border-danger text-danger",
          (mode === "polling" || mode === "connecting") && "border-border text-muted-foreground",
        )}
      >
        <span className={cn("size-2 rounded-full", mode === "live" ? "bg-success" : mode === "offline" ? "bg-danger" : "bg-muted-foreground")} aria-hidden />
        {label[mode]}
      </span>
      <button
        type="button"
        onClick={toggleSound}
        aria-pressed={sound}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 hover:bg-surface-muted"
      >
        {sound ? <Bell className="size-3.5" aria-hidden /> : <BellOff className="size-3.5" aria-hidden />}
        Sound {sound ? "on" : "off"}
      </button>
    </div>
  );
}
