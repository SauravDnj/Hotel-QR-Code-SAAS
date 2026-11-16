"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Requests made from THIS device, kept only in this browser's localStorage. The server never
 * lists a room's requests: the next guest in the room must not see the previous guest's.
 */
const KEY = "guest-requests";
export const MAX_REMEMBERED = 10;

export interface RememberedRequest {
  token: string;
  service: string;
  at: string;
}

export function readRemembered(): RememberedRequest[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as RememberedRequest[];
    // Status links expire after 72h; drop old entries.
    const cutoff = Date.now() - 72 * 3600_000;
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.token === "string" && Date.parse(r.at) > cutoff) : [];
  } catch {
    return [];
  }
}

export function remember(entry: RememberedRequest) {
  try {
    const list = [entry, ...readRemembered().filter((r) => r.token !== entry.token)].slice(0, MAX_REMEMBERED);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable (private mode): the status link still works */
  }
}

export function MyRequests() {
  const [items, setItems] = useState<RememberedRequest[]>([]);
  useEffect(() => {
    // Read after mount: localStorage is browser-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from browser storage
    setItems(readRemembered());
  }, []);
  if (items.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
      <h3 className="mb-2 text-sm font-semibold">Your requests on this phone</h3>
      <ul className="divide-y divide-border text-sm">
        {items.map((r) => (
          <li key={r.token}>
            <Link href={`/s/${r.token}`} className="flex min-h-11 items-center justify-between gap-2">
              <span>{r.service}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · View status →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Records a request on this device once its status page opens. */
export function RememberRequest(props: RememberedRequest) {
  useEffect(() => {
    remember(props);
  }, [props]);
  return null;
}
