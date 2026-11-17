import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, ConfirmButton } from "@/components/action-form";
import { PermissionDenied } from "@/components/permission-denied";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { formatDateTime } from "@/lib/utils";
import { getEntitlements } from "@/modules/billing/subscription";
import { API_SCOPE_KEYS, API_SCOPES, listApiKeys } from "@/modules/integrations/keys";
import { listWebhooks, WEBHOOK_EVENTS } from "@/modules/integrations/webhooks";
import { listProperties } from "@/modules/properties/service";
import { getTenantSettings } from "@/modules/tenants/settings";
import {
  createApiKeyAction,
  createWebhookAction,
  deleteWebhookAction,
  revokeApiKeyAction,
  testWebhookAction,
  toggleWebhookAction,
} from "./actions";
import { SecretForm } from "./secret-form";

export const metadata: Metadata = { title: "Integrations" };

/** API keys and webhooks for PMS / channel manager / POS connections (Phase 9). */
export default async function IntegrationsPage() {
  const ctx = await requireTenantContext();
  if (!can(ctx, "tenant.manage")) return <PermissionDenied />;
  const db = getDb();
  const [ent, keys, hooks, props, tenant] = await Promise.all([
    getEntitlements(db, ctx.tenantId),
    listApiKeys(db, ctx),
    listWebhooks(db, ctx),
    listProperties(db, ctx),
    getTenantSettings(db, ctx),
  ]);
  const tz = tenant.timezone;
  const included = Boolean(ent.modules.integrations);
  const manage = included && canWrite(ctx, "tenant.manage");
  const propName = new Map(props.map((p) => [p.id, p.name]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline underline-offset-4">
          ← Hotel settings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Connect a PMS, channel manager or POS. The REST API is documented in <code>docs/API.md</code>: base URL <code>/api/v1</code>,{" "}
          header <code>Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      {!included && (
        <Alert tone="info">
          API access and webhooks aren&apos;t included in your plan.{" "}
          <Link href="/billing" className="underline underline-offset-4">
            See plans
          </Link>
        </Alert>
      )}

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">API keys</h2>
        {keys.length === 0 ? (
          <EmptyState title="No API keys" description="Create a key for each system you connect, with only the permissions it needs." />
        ) : (
          <ul className="divide-y divide-border rounded-ui border border-border text-sm" aria-label="API keys">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {k.name} <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>{" "}
                    {k.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {k.scopes.join(", ")} · {k.propertyId ? propName.get(k.propertyId) ?? "one property" : "all properties"} · created{" "}
                    {formatDateTime(k.createdAt, tz)}
                    {k.lastUsedAt ? ` · last used ${formatDateTime(k.lastUsedAt, tz)}` : " · never used"}
                  </p>
                </div>
                {!k.revokedAt && canWrite(ctx, "tenant.manage") && (
                  <ActionForm action={revokeApiKeyAction.bind(null, k.id)} aria-label={`Revoke ${k.name}`}>
                    <ConfirmButton size="sm" variant="secondary" confirmLabel="Revoke now">
                      Revoke
                    </ConfirmButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Create a key</summary>
            <div className="mt-3">
              <SecretForm action={createApiKeyAction} label="Create API key">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm">
                    Name
                    <Input name="name" id="key-name" required maxLength={60} placeholder="e.g. Channel manager" />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Property
                    <Select name="propertyId" id="key-property" defaultValue="">
                      <option value="">All properties</option>
                      {props.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                </div>
                <fieldset className="space-y-1">
                  <legend className="text-sm font-medium">Permissions</legend>
                  {API_SCOPE_KEYS.map((s) => (
                    <label key={s} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="checkbox" name="scopes" value={s} className="size-4" />
                      <span>
                        <code className="text-xs">{s}</code> · {API_SCOPES[s].label}
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Button type="submit">Create key</Button>
              </SecretForm>
            </div>
          </details>
        )}
      </Card>

      <Card className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Webhooks</h2>
          <p className="text-xs text-muted-foreground">
            We POST signed JSON events to your https endpoint and retry failures with backoff. Events carry ids and codes only, never guest
            details.
          </p>
        </div>
        {hooks.length === 0 ? (
          <EmptyState title="No webhooks" description="Add an endpoint to receive booking, stay and request events." />
        ) : (
          <ul className="divide-y divide-border rounded-ui border border-border text-sm" aria-label="Webhooks">
            {hooks.map((w) => (
              <li key={w.id} className="space-y-2 px-3 py-2">
                <p className="break-all font-medium">
                  {w.url} {w.active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Paused</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {w.events.join(", ")}
                  {w.lastDeliveryAt && (
                    <>
                      {" "}
                      · last delivery {formatDateTime(w.lastDeliveryAt, tz)} {w.lastStatus ? `(HTTP ${w.lastStatus})` : ""}
                      {w.lastError ? ` · ${w.lastError}` : ""}
                    </>
                  )}
                </p>
                {canWrite(ctx, "tenant.manage") && (
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={testWebhookAction.bind(null, w.id)} aria-label={`Test ${w.url}`}>
                      <Button type="submit" size="sm" variant="secondary">
                        Send test event
                      </Button>
                    </ActionForm>
                    <ActionForm action={toggleWebhookAction.bind(null, w.id, !w.active)} aria-label={`${w.active ? "Pause" : "Enable"} ${w.url}`}>
                      <Button type="submit" size="sm" variant="ghost">
                        {w.active ? "Pause" : "Enable"}
                      </Button>
                    </ActionForm>
                    <ActionForm action={deleteWebhookAction.bind(null, w.id)} aria-label={`Delete ${w.url}`}>
                      <ConfirmButton size="sm" variant="ghost" confirmLabel="Delete">
                        Delete
                      </ConfirmButton>
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {manage && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Add a webhook</summary>
            <div className="mt-3">
              <SecretForm action={createWebhookAction} label="Add webhook">
                <label className="flex flex-col gap-1 text-sm">
                  Endpoint URL (https)
                  <Input name="url" id="hook-url" type="url" required maxLength={500} placeholder="https://pms.example.com/hooks/hotel" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Description (optional)
                  <Input name="description" id="hook-desc" maxLength={100} />
                </label>
                <fieldset className="grid gap-1 sm:grid-cols-2">
                  <legend className="mb-1 text-sm font-medium">Events</legend>
                  {WEBHOOK_EVENTS.map((e) => (
                    <label key={e} className="flex min-h-9 items-center gap-2 text-sm">
                      <input type="checkbox" name="events" value={e} className="size-4" defaultChecked={e.startsWith("reservation.")} />
                      <code className="text-xs">{e}</code>
                    </label>
                  ))}
                </fieldset>
                <Button type="submit">Add webhook</Button>
              </SecretForm>
            </div>
          </details>
        )}
      </Card>
    </div>
  );
}
