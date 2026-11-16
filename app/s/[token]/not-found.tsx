import type { Metadata } from "next";
import { GuestShell } from "../../r/guest-shell";

export const metadata: Metadata = {
  title: { absolute: "Request not found" },
  robots: { index: false, follow: false },
};

export default function RequestNotFound() {
  return (
    <GuestShell>
      <div className="mt-16 rounded-2xl bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">This request link has expired</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Request links work for 3 days. Scan the QR code in your room again, or contact reception.
        </p>
      </div>
    </GuestShell>
  );
}
