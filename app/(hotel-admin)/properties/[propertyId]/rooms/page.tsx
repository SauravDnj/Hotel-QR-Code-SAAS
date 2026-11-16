import type { Metadata } from "next";
import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { HOUSEKEEPING_LABELS, HousekeepingBadge, OPERATIONAL_LABELS, OperationalBadge } from "@/components/room-status";
import { buttonVariants } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { can, canWrite } from "@/lib/permissions/authorize";
import { cn } from "@/lib/utils";
import { listCategories } from "@/modules/rooms/categories";
import { listFloors } from "@/modules/rooms/floors";
import { HOUSEKEEPING_STATUSES, listRooms, OPERATIONAL_STATUSES, roomStatusSummary } from "@/modules/rooms/rooms";

export const metadata: Metadata = { title: "Rooms" };

type SP = Record<string, string | undefined>;

function hrefWith(base: string, sp: SP, patch: SP) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export default async function RoomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ propertyId: string }>;
  searchParams: Promise<SP>;
}) {
  const { propertyId } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantContext();
  if (!can(ctx, "room.view", { propertyId })) return <PermissionDenied />;

  const db = getDb();
  const [floors, categories, result, summary] = await Promise.all([
    listFloors(db, ctx, propertyId),
    listCategories(db, ctx, propertyId),
    listRooms(db, ctx, propertyId, sp),
    roomStatusSummary(db, ctx, propertyId),
  ]);
  const manage = canWrite(ctx, "room.manage", { propertyId });
  const base = `/properties/${propertyId}/rooms`;
  const view = sp.view === "list" ? "list" : "grid";
  const filtered = Boolean(sp.q || sp.floorId || sp.categoryId || sp.operational || sp.housekeeping || sp.archived);

  if (floors.length === 0 || categories.length === 0) {
    return (
      <EmptyState
        title="Set up floors and room types first"
        description="Every room belongs to a floor and a room type."
        action={
          <div className="flex justify-center gap-2">
            <Link href={`/properties/${propertyId}/floors`} className={buttonVariants({ variant: "secondary" })}>
              Floors ({floors.length})
            </Link>
            <Link href={`/properties/${propertyId}/room-types`} className={buttonVariants({ variant: "secondary" })}>
              Room types ({categories.length})
            </Link>
          </div>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Rooms</h2>
          <p className="text-sm text-muted-foreground">
            {summary.total} rooms · {summary.operational.active ?? 0} in service · {summary.operational.out_of_order ?? 0} out of
            order · {summary.housekeeping.dirty ?? 0} dirty
          </p>
        </div>
        {manage && (
          <Link href={`${base}/new`} className={buttonVariants()}>
            Add rooms
          </Link>
        )}
      </div>

      <Card className="p-4">
        <form method="get" action={base} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end" role="search">
          <input type="hidden" name="view" value={view} />
          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            Search room number
            <Input name="q" type="search" defaultValue={sp.q} placeholder="e.g. 101" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Floor
            <Select name="floorId" defaultValue={sp.floorId ?? ""}>
              <option value="">All floors</option>
              {floors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Room type
            <Select name="categoryId" defaultValue={sp.categoryId ?? ""}>
              <option value="">All types</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Operational
            <Select name="operational" defaultValue={sp.operational ?? ""}>
              <option value="">Any</option>
              {OPERATIONAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {OPERATIONAL_LABELS[s].label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Housekeeping
            <Select name="housekeeping" defaultValue={sp.housekeeping ?? ""}>
              <option value="">Any</option>
              {HOUSEKEEPING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {HOUSEKEEPING_LABELS[s].label}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex flex-wrap items-center gap-2 lg:col-span-6">
            <button type="submit" className={buttonVariants({ size: "sm" })}>
              Apply filters
            </button>
            {filtered && (
              <Link href={hrefWith(base, { view }, {})} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                Clear
              </Link>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm">
              <input type="checkbox" name="archived" value="only" defaultChecked={sp.archived === "only"} />
              Show archived only
            </label>
            <span className="inline-flex rounded-ui border border-border" role="group" aria-label="View">
              {(["grid", "list"] as const).map((v) => (
                <Link
                  key={v}
                  href={hrefWith(base, sp, { view: v, page: undefined })}
                  aria-current={view === v ? "true" : undefined}
                  className={cn("px-3 py-1.5 text-sm capitalize", view === v ? "bg-primary text-primary-foreground" : "hover:bg-surface-muted")}
                >
                  {v}
                </Link>
              ))}
            </span>
          </div>
        </form>
      </Card>

      {result.total === 0 ? (
        <EmptyState
          title={filtered ? "No rooms match these filters" : "No rooms yet"}
          description={filtered ? "Try clearing a filter." : "Add rooms one by one or a whole range at once."}
        />
      ) : view === "grid" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Rooms">
          {result.items.map((r) => (
            <li key={r.id}>
              <Link
                href={`${base}/${r.id}`}
                className="block rounded-ui border border-border bg-surface p-3 hover:border-primary focus-visible:border-primary"
              >
                <p className="text-lg font-semibold">{r.roomCode}</p>
                <p className="mb-2 truncate text-xs text-muted-foreground">
                  {r.floorName} · {r.categoryName}
                </p>
                <div className="flex flex-wrap gap-1">
                  <OperationalBadge status={r.operationalStatus} />
                  <HousekeepingBadge status={r.housekeepingStatus} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-ui border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Room</th>
                <th scope="col" className="px-4 py-3 font-medium">Floor</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Guests</th>
                <th scope="col" className="px-4 py-3 font-medium">Operational</th>
                <th scope="col" className="px-4 py-3 font-medium">Housekeeping</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`${base}/${r.id}`} className="text-primary underline underline-offset-4">
                      {r.roomCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.floorName}</td>
                  <td className="px-4 py-3">{r.categoryName}</td>
                  <td className="px-4 py-3">{r.capacity}</td>
                  <td className="px-4 py-3"><OperationalBadge status={r.operationalStatus} /></td>
                  <td className="px-4 py-3"><HousekeepingBadge status={r.housekeepingStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {result.page} of {result.pageCount} · {result.total} rooms
          </span>
          <span className="flex gap-2">
            {result.page > 1 && (
              <Link href={hrefWith(base, sp, { page: String(result.page - 1) })} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                Previous
              </Link>
            )}
            {result.page < result.pageCount && (
              <Link href={hrefWith(base, sp, { page: String(result.page + 1) })} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                Next
              </Link>
            )}
          </span>
        </nav>
      )}
    </div>
  );
}
