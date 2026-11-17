"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  checkInReservation,
  closeReservation,
  createReservation,
  updateReservation,
  type ReservationInput,
} from "@/modules/reservations/service";

// propertyId/reservationId are bound from the page; services re-check tenant, property scope,
// permission and availability under row locks.

function refresh() {
  revalidatePath("/reservations");
  revalidatePath("/front-desk");
}

export async function createReservationAction(propertyId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  let code: string;
  try {
    const res = await createReservation(getDb(), await requireTenantContext(), propertyId, values as unknown as ReservationInput);
    code = res.reservation.code;
    if (res.duplicate) return { ok: true, message: `Already booked as ${code} (same external reference).` };
  } catch (err) {
    return toActionState(err, values);
  }
  refresh();
  return { ok: true, message: `Booked. Confirmation code ${code}.` };
}

export async function updateReservationAction(propertyId: string, id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await updateReservation(getDb(), await requireTenantContext(), propertyId, id, values as unknown as ReservationInput);
  } catch (err) {
    return toActionState(err, values);
  }
  refresh();
  return { ok: true, message: "Booking updated.", values };
}

export async function closeReservationAction(
  propertyId: string,
  id: string,
  to: "cancelled" | "no_show",
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  try {
    await closeReservation(getDb(), await requireTenantContext(), propertyId, id, to, { reason: formValues(fd).reason });
  } catch (err) {
    return toActionState(err);
  }
  refresh();
  return { ok: true, message: to === "cancelled" ? "Booking cancelled." : "Marked as no-show." };
}

export async function checkInReservationAction(propertyId: string, id: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  try {
    await checkInReservation(getDb(), await requireTenantContext(), propertyId, id, { roomId: values.checkinRoomId });
  } catch (err) {
    return toActionState(err, values);
  }
  refresh();
  revalidatePath("/housekeeping");
  redirect(`/front-desk?property=${propertyId}`);
}
