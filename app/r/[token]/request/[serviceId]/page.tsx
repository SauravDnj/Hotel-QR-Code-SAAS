import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceIcon } from "@/components/service-icon";
import { clientIp } from "@/lib/auth/ip";
import { getDb } from "@/lib/db/client";
import { getGuestServiceForm } from "@/modules/requests/guest";
import { submitGuestRequestAction } from "../../../actions";
import { GuestShell, readableOn } from "../../../guest-shell";
import { RequestForm } from "./request-form";

export const metadata: Metadata = {
  title: { absolute: "Request a service" },
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default async function GuestRequestPage({ params }: { params: Promise<{ token: string; serviceId: string }> }) {
  const { token, serviceId } = await params;
  const data = await getGuestServiceForm(getDb(), token, serviceId, { ip: clientIp(await headers()) });
  if (!data) notFound();
  const { service } = data;
  const accent = data.accentColor ?? "#1f2a44";

  return (
    <GuestShell>
      <Link href={`/r/${token}`} className="inline-flex min-h-11 items-center text-sm font-medium" style={{ color: accent }}>
        ← Back
      </Link>
      <div className="rounded-2xl bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full p-2.5" style={{ background: `${accent}1a`, color: accent }}>
            <ServiceIcon name={service.icon} className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">{service.name}</h1>
            <p className="text-sm text-muted-foreground">
              {data.hotelName}
              {data.roomLabel && <> · Room {data.roomLabel}</>}
            </p>
          </div>
        </div>
        {service.description && <p className="mt-3 text-sm text-muted-foreground">{service.description}</p>}
        {!service.availableNow ? (
          <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm" role="status">
            Available {service.availableFrom}–{service.availableTo}. Please call reception if it&apos;s urgent.
          </p>
        ) : (
          <RequestForm
            action={submitGuestRequestAction.bind(null, token)}
            serviceId={service.id}
            idempotencyKey={crypto.randomUUID()}
            maxQuantity={service.maxQuantity}
            options={service.options}
            noteMode={service.noteMode}
            accent={accent}
            onAccent={readableOn(accent)}
          />
        )}
      </div>
    </GuestShell>
  );
}
