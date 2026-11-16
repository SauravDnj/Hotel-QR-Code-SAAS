import type { Metadata } from "next";
import { QrCode } from "lucide-react";
import { GuestShell } from "../guest-shell";

export const metadata: Metadata = {
  title: { absolute: "QR code unavailable" },
  robots: { index: false, follow: false },
};

/**
 * Shown for unknown, revoked, deactivated or malformed codes alike, so a visitor cannot tell
 * which (no enumeration signal) and nothing about any hotel is revealed.
 */
export default function QrUnavailable() {
  return (
    <GuestShell>
      <div className="mt-16 rounded-2xl bg-surface p-8 text-center shadow-sm">
        <QrCode className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">This QR code isn&apos;t active</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been replaced or switched off. Please contact the hotel reception for help.
        </p>
      </div>
    </GuestShell>
  );
}
