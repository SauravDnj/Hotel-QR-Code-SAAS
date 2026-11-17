import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card, PageHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { TIMEZONES } from "@/lib/timezones";
import { formatDateTime } from "@/lib/utils";
import { listActivePlans } from "@/modules/billing/plans";
import { getTenantDetail } from "@/modules/platform/admin";
import {
  activateAction,
  changePlanAction,
  extendTrialAction,
  memberStatusAction,
  startSupportAction,
  updateTenantProfileAction,
} from "../../actions";
import { LinkAction } from "../../link-action";
import { resetLinkAction, resetMfaAction } from "../../support/actions";
import { TenantStatusForm } from "../../tenant-status-form";
import { ReasonInput, Stat, StatusBadge, td, th } from "../../ui";

export const metadata: Metadata = { title: "Hotel" };

const small = "min-h-9 rounded-ui border border-border bg-surface px-2 text-sm";
const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);

export default async function TenantDetailPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const actor = await requirePlatformAdmin();
  const { tenantId } = await params;
  const detail = await getTenantDetail(getDb(), actor, tenantId).catch((e) => {
    if (e instanceof AppError && e.code === "not_found") notFound();
    throw e;
  });
  const plans = await listActivePlans(getDb());
  const { tenant, subscription, plan, usage } = detail;
  const activeStaff = detail.staff.filter((s) => s.status === "active").length;
  const roomCount = detail.properties.reduce((n, p) => n + p.rooms, 0);

  return (
    <div className="space-y-6">
      <Link href="/platform/tenants" className="text-sm text-primary underline underline-offset-4">
        ← Hotels
      </Link>
      <PageHeader
        title={tenant.name}
        description={`${tenant.legalName} · ${tenant.contactEmail} · ${tenant.country} · ${tenant.timezone} · ${tenant.currency} · created ${formatDateTime(tenant.createdAt, "UTC")} UTC`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={tenant.status} />
            {tenant.platformHold && <Badge tone="danger">Suspended by super admin</Badge>}
          </div>
        }
      />

      <section aria-label="Usage" className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Properties" value={detail.properties.length} />
        <Stat label="Rooms" value={roomCount} />
        <Stat label="Active staff" value={activeStaff} hint={`${detail.staff.length} total`} />
        <Stat label="In house" value={usage.inHouse} hint={`${usage.upcomingBookings} bookings ahead`} />
        <Stat label="Requests (30 d)" value={usage.requests30d} hint={`${usage.totalRequests} all time`} />
        <Stat label="Open requests" value={usage.openRequests} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h2 className="mb-1 font-semibold">Log in as hotel admin</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Full access, like the hotel owner: rooms, staff, settings, check-in/out, requests. Every change is recorded in the audit log. Ends after 1
            hour.
          </p>
          <ActionForm action={startSupportAction.bind(null, tenant.id)} className="flex flex-col gap-2" aria-label="Log in as hotel admin">
            <input type="hidden" name="mode" value="full" />
            <ReasonInput label="Why? e.g. setup help, ticket ref (audited)" className="w-full" />
            <Button type="submit">Log in as hotel admin</Button>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">View hotel (read-only)</h2>
          <p className="mb-3 text-sm text-muted-foreground">See the hotel exactly as staff do without being able to change anything. Audited, 1 hour.</p>
          <ActionForm action={startSupportAction.bind(null, tenant.id)} className="flex flex-col gap-2" aria-label="Open read-only view">
            <input type="hidden" name="mode" value="view" />
            <ReasonInput label="Why? (audited)" className="w-full" />
            <Button type="submit" variant="secondary">
              Open read-only view
            </Button>
          </ActionForm>
        </Card>
        <Card>
          <h2 className="mb-1 font-semibold">Open as a guest</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Open the page a guest sees after scanning any room&apos;s QR code: Wi-Fi, services, design. You can also send a test request.
          </p>
          <Link href={`/platform/tenants/${tenant.id}/guest`} className={buttonVariants({ variant: "secondary" })}>
            Choose a room →
          </Link>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Subscription</h2>
          <dl className="mb-4 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Plan</dt>
            <dd>
              {plan.name} · {money(plan.priceMinor, plan.currency)}/month
            </dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              <StatusBadge status={subscription.status} />
            </dd>
            {subscription.trialEndsAt && (
              <>
                <dt className="text-muted-foreground">Trial ends</dt>
                <dd>{formatDateTime(subscription.trialEndsAt, "UTC")}</dd>
              </>
            )}
            {subscription.currentPeriodEnd && (
              <>
                <dt className="text-muted-foreground">Paid until</dt>
                <dd>{formatDateTime(subscription.currentPeriodEnd, "UTC")}</dd>
              </>
            )}
            {subscription.graceEndsAt && (
              <>
                <dt className="text-muted-foreground">Grace ends</dt>
                <dd>{formatDateTime(subscription.graceEndsAt, "UTC")}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Payment</dt>
            <dd>{subscription.provider ?? "none yet"}</dd>
          </dl>

          <div className="space-y-4 border-t border-border pt-4">
            <div>
              <h3 className="mb-1 text-sm font-medium">Change plan</h3>
              <ActionForm action={changePlanAction.bind(null, tenant.id)} className="flex flex-wrap items-center gap-2" aria-label="Change plan">
                <select name="planId" defaultValue={plan.id} aria-label="Plan" className={small}>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <ReasonInput className="w-48" />
                <Button type="submit" size="sm" variant="secondary">
                  Change
                </Button>
              </ActionForm>
            </div>
            {subscription.status !== "active" && (
              <div>
                <h3 className="mb-1 text-sm font-medium">Extend free trial</h3>
                <ActionForm action={extendTrialAction.bind(null, tenant.id)} className="flex flex-wrap items-center gap-2" aria-label="Extend trial">
                  <input name="days" type="number" min={1} max={90} defaultValue={14} aria-label="Trial days" className={`${small} w-20`} />
                  <ReasonInput className="w-48" />
                  <Button type="submit" size="sm" variant="secondary">
                    Extend
                  </Button>
                </ActionForm>
              </div>
            )}
            <div>
              <h3 className="mb-1 text-sm font-medium">Mark as paid (bank transfer, cash, complimentary)</h3>
              <ActionForm action={activateAction.bind(null, tenant.id)} className="flex flex-wrap items-center gap-2" aria-label="Mark as paid">
                <input name="days" type="number" min={1} max={1100} defaultValue={365} aria-label="Paid days" className={`${small} w-20`} />
                <span className="text-xs text-muted-foreground">days</span>
                <ReasonInput label="Receipt / reference (audited)" className="w-48" />
                <Button type="submit" size="sm" variant="secondary">
                  Activate
                </Button>
              </ActionForm>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">{tenant.platformHold ? "Reactivate hotel" : "Suspend hotel"}</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            {tenant.platformHold
              ? "Lifts your suspension. The hotel returns to whatever its subscription allows."
              : "Staff can still sign in and view data, but nothing can be changed and guests can't send new requests. Nothing is deleted."}
          </p>
          <TenantStatusForm tenantId={tenant.id} suspended={tenant.platformHold} />

          <details className="mt-6 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium">Edit hotel details</summary>
            <ActionForm action={updateTenantProfileAction.bind(null, tenant.id)} className="mt-3 grid gap-2 text-sm" aria-label="Edit hotel details">
              <label className="flex flex-col gap-1 text-xs">
                Hotel name
                <input name="name" required defaultValue={tenant.name} className={small} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Legal / business name
                <input name="legalName" required defaultValue={tenant.legalName} className={small} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                Contact email
                <input name="contactEmail" type="email" required defaultValue={tenant.contactEmail} className={small} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs">
                  Country
                  <input name="country" required maxLength={2} defaultValue={tenant.country} className={small} />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Timezone
                  <select name="timezone" defaultValue={tenant.timezone} className={small}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <ReasonInput />
              <div>
                <Button type="submit" size="sm">
                  Save details
                </Button>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>

      <section aria-labelledby="props-h">
        <h2 id="props-h" className="mb-2 font-semibold">
          Properties
        </h2>
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm" aria-label="Properties">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className={th}>Name</th>
                <th scope="col" className={th}>City</th>
                <th scope="col" className={th}>Timezone</th>
                <th scope="col" className={th}>Rooms</th>
                <th scope="col" className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.properties.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={`${td} font-medium`}>{p.name}</td>
                  <td className={td}>{p.city ?? "—"}</td>
                  <td className={td}>{p.timezone}</td>
                  <td className={`${td} tabular-nums`}>{p.rooms}</td>
                  <td className={td}>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="staff-h">
        <h2 id="staff-h" className="mb-1 font-semibold">
          Staff & logins ({detail.staff.length})
        </h2>
        <p className="mb-2 text-sm text-muted-foreground">
          Turning access off removes this person from this hotel on their next click. To block a login everywhere, use Users &amp; staff.
        </p>
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm" aria-label="Staff">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className={th}>Person</th>
                <th scope="col" className={th}>Roles</th>
                <th scope="col" className={th}>Access</th>
                <th scope="col" className={th}>Last sign-in</th>
                <th scope="col" className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {detail.staff.map((s) => (
                <tr key={s.membershipId} className="border-b border-border last:border-0">
                  <td className={td}>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.email}</p>
                  </td>
                  <td className={td}>
                    {s.roles.length === 0
                      ? "—"
                      : s.roles.map((r, i) => (
                          <p key={i}>
                            {r.role}
                            <span className="text-xs text-muted-foreground"> · {r.property ?? "all properties"}</span>
                          </p>
                        ))}
                  </td>
                  <td className={td}>
                    <StatusBadge status={s.status} />
                    {s.userStatus === "disabled" && <p className="mt-1 text-xs text-danger">Login blocked</p>}
                    {s.mfaEnabled && <p className="mt-1 text-xs text-muted-foreground">Two-step on</p>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{s.lastLoginAt ? formatDateTime(s.lastLoginAt, "UTC") : "never"}</td>
                  <td className={`${td} space-y-2`}>
                    <ActionForm
                      action={memberStatusAction.bind(null, tenant.id, s.membershipId)}
                      className="flex flex-wrap items-center gap-1"
                      aria-label={`${s.status === "active" ? "Turn off" : "Turn on"} access for ${s.email}`}
                    >
                      <input type="hidden" name="status" value={s.status === "active" ? "disabled" : "active"} />
                      <ReasonInput label={`Reason for ${s.email} (audited)`} className="w-40 text-xs" />
                      <Button type="submit" size="sm" variant={s.status === "active" ? "danger" : "secondary"}>
                        {s.status === "active" ? "Turn off access" : "Turn on access"}
                      </Button>
                    </ActionForm>
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">Password / two-step</summary>
                      <div className="mt-2 space-y-2">
                        <LinkAction action={resetLinkAction} email={s.email} submit="Reset password" />
                        {s.mfaEnabled && <LinkAction action={resetMfaAction} email={s.email} submit="Reset two-step" variant="danger" />}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="audit-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="audit-h" className="font-semibold">
            Recent activity
          </h2>
          <Link href={`/platform/audit?tenant=${tenant.id}`} className="text-sm text-primary underline underline-offset-4">
            Full audit log →
          </Link>
        </div>
        <Card className="p-0">
          <ul className="divide-y divide-border text-sm">
            {detail.audit.length === 0 && <li className="p-4 text-muted-foreground">No activity yet.</li>}
            {detail.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span>
                  <code className="text-xs">{a.action}</code>
                  <span className="text-muted-foreground"> · {a.actorType === "platform_admin" ? `super admin ${a.actorEmail ?? ""}` : (a.actorEmail ?? a.actorType)}</span>
                </span>
                <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(a.createdAt, "UTC")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
