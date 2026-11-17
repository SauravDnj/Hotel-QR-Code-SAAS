import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { formatMoney, toMajorString } from "@/lib/money";
import { loadOr404 } from "@/lib/page-errors";
import { canWrite } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { getFolio, PAYMENT_METHODS } from "@/modules/ordering/folio";
import { addChargeAction, recordPaymentAction, voidChargeAction } from "../../actions";

export const metadata: Metadata = { title: "Guest bill" };

const METHOD_LABEL: Record<string, string> = { cash: "Cash", card: "Card", upi: "UPI", bank: "Bank transfer", other: "Other" };
const SOURCE_LABEL: Record<string, string> = { order: "Guest order", manual: "Reception", api: "Integration" };

/** The stay's bill: charges (orders, manual, POS), payments and balance. */
export default async function FolioPage({ params, searchParams }: { params: Promise<{ stayId: string }>; searchParams: Promise<{ property?: string }> }) {
  const [{ stayId }, { property }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext();
  const db = getDb();
  const f = await loadOr404(() => getFolio(db, ctx, property ?? "", stayId));
  const cur = f.property.currency;
  const manage = canWrite(ctx, "folio.manage", { propertyId: f.property.id });
  const tz = f.property.timezone;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/front-desk?property=${f.property.id}`} className="text-sm text-primary underline underline-offset-4">
          ← Front desk
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Bill · Room {f.stay.roomCode}
        </h1>
        <p className="text-sm text-muted-foreground">
          {f.stay.guestName} · checked in {formatDateTime(f.stay.checkInAt, tz)}
          {f.stay.checkedOutAt ? ` · checked out ${formatDateTime(f.stay.checkedOutAt, tz)}` : ""}
        </p>
      </div>

      <Card className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-foreground">Charges</p>
          <p className="text-xl font-semibold">{formatMoney(f.charged, cur)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-xl font-semibold">{formatMoney(f.paid, cur)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Balance due</p>
          <p className="text-xl font-semibold" data-testid="balance">
            {formatMoney(f.balance, cur)} {f.balance > 0 ? <Badge tone="warning">Due</Badge> : <Badge tone="success">Settled</Badge>}
          </p>
        </div>
      </Card>

      {f.pending.length > 0 && (
        <p className="text-sm text-muted-foreground" role="status">
          {f.pending.length} room-charged order{f.pending.length === 1 ? " is" : "s are"} still being prepared and will be added when
          delivered.
        </p>
      )}

      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold">Charges</h2>
        {f.charges.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No charges yet.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm" aria-label="Charges">
            <tbody>
              {f.charges.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span className={c.voidedAt ? "line-through" : undefined}>{c.description}</span>
                    <div className="text-xs text-muted-foreground">
                      {SOURCE_LABEL[c.source] ?? c.source} · {formatDateTime(c.createdAt, tz)}
                      {c.voidedAt && <> · void: {c.voidReason}</>}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.amountMinor, cur)}</td>
                  <td className="px-4 py-2 text-right">
                    {manage && !c.voidedAt && (
                      <ActionForm action={voidChargeAction.bind(null, f.property.id, c.id)} className="flex justify-end gap-1" aria-label={`Void ${c.description}`}>
                        <label htmlFor={`reason-${c.id}`} className="sr-only">
                          Reason
                        </label>
                        <Input name="reason" id={`reason-${c.id}`} placeholder="Reason" maxLength={200} className="w-32" required />
                        <ConfirmButton size="sm" variant="ghost" confirmLabel="Void">
                          Void
                        </ConfirmButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold">Payments</h2>
        {f.payments.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No payments recorded.</p>
        ) : (
          <table className="mt-2 w-full text-left text-sm" aria-label="Payments">
            <tbody>
              {f.payments.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    {METHOD_LABEL[p.method] ?? p.method}
                    {p.reference && <span className="text-muted-foreground"> · {p.reference}</span>}
                    <div className="text-xs text-muted-foreground">{formatDateTime(p.createdAt, tz)}</div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatMoney(p.amountMinor, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {manage && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Add charge</h2>
            <ActionForm action={addChargeAction.bind(null, f.property.id, f.stay.id)} className="space-y-3" aria-label="Add charge">
              <label className="flex flex-col gap-1 text-sm">
                Description
                <Input name="description" id="charge-desc" required maxLength={120} placeholder="e.g. Minibar" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Amount ({cur}; negative for a discount)
                <Input name="amount" id="charge-amount" required inputMode="decimal" />
              </label>
              <Button type="submit">Add charge</Button>
            </ActionForm>
          </Card>
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Record payment</h2>
            <ActionForm action={recordPaymentAction.bind(null, f.property.id, f.stay.id)} className="space-y-3" aria-label="Record payment">
              <label className="flex flex-col gap-1 text-sm">
                Amount ({cur})
                <Input name="amount" id="payment-amount" required inputMode="decimal" defaultValue={f.balance > 0 ? toMajorString(f.balance, cur) : ""} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Method
                <Select name="method" id="payment-method" defaultValue="cash">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Reference (optional)
                <Input name="reference" id="payment-ref" maxLength={80} placeholder="Receipt or transaction id" />
              </label>
              <Button type="submit">Record payment</Button>
            </ActionForm>
            <p className="mt-3 text-xs text-muted-foreground">Card and UPI payments are taken on your own terminal; no card details are stored here.</p>
          </Card>
        </div>
      )}
    </div>
  );
}
