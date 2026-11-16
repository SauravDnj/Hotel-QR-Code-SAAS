"use client";

import { useEffect } from "react";

/** Registers the staff PWA service worker (staff pages only; guests are never asked to install). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* installability is optional */
    });
  }, []);
  return null;
}
