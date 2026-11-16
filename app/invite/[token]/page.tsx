import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db/client";
import { getInvitation } from "@/modules/staff/service";
import { acceptInviteAction } from "./actions";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = {
  title: "Join your hotel team",
  robots: { index: false, follow: false },
  referrer: "same-origin",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvitation(getDb(), token);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Card>
        {!invite ? (
          <div className="text-center">
            <h1 className="text-lg font-semibold">This invitation isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have expired, been used already or been revoked. Ask your manager for a new link.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">You&apos;ve been invited to</p>
            <h1 className="text-xl font-semibold">{invite.hotelName}</h1>
            <p className="mt-2 text-sm">
              as <span className="font-medium">{invite.roleName}</span>
              {invite.propertyName && (
                <>
                  {" "}
                  at {invite.propertyName}
                  {invite.departmentName && <> ({invite.departmentName})</>}
                </>
              )}
              .
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Account: {invite.email}</p>
            <AcceptForm action={acceptInviteAction.bind(null, token)} accountExists={invite.accountExists} defaultName={invite.name} />
          </>
        )}
      </Card>
    </main>
  );
}
