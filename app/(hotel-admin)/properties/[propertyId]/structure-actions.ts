"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { createCategory, setCategoryArchived, updateCategory, type CategoryInput } from "@/modules/rooms/categories";
import { createFloor, setFloorArchived, updateFloor, type FloorInput } from "@/modules/rooms/floors";
import {
  bulkCreateRooms,
  changeRoomStatus,
  createRoom,
  setRoomArchived,
  updateRoom,
  type BulkRoomInput,
  type RoomInput,
  type StatusChangeInput,
} from "@/modules/rooms/rooms";
import {
  createDefaultDepartments,
  createDepartment,
  updateDepartment,
  type DepartmentInput,
} from "@/modules/departments/service";

// Every action rebuilds the tenant context from the session; ids bound from the page are
// re-validated by the service layer against the caller's tenant and property scope.

type Run = (formData: FormData) => Promise<string | void>;

async function run(propertyId: string, formData: FormData, fn: Run): Promise<ActionState> {
  const values = formValues(formData);
  let message: string | void;
  try {
    message = await fn(formData);
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { ok: true, message: message || "Saved." };
}

const v = <T,>(fd: FormData) => formValues(fd) as unknown as T;
const ctx = () => requireTenantContext();
const db = () => getDb();

// ---------- Floors ----------
export async function createFloorAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await createFloor(db(), await ctx(), propertyId, v<FloorInput>(fd));
    return "Floor added.";
  });
}
export async function updateFloorAction(propertyId: string, floorId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await updateFloor(db(), await ctx(), propertyId, floorId, v<FloorInput>(fd));
  });
}
export async function archiveFloorAction(propertyId: string, floorId: string, archived: boolean, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await setFloorArchived(db(), await ctx(), propertyId, floorId, archived);
    return archived ? "Floor archived." : "Floor restored.";
  });
}

// ---------- Room types ----------
export async function createCategoryAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await createCategory(db(), await ctx(), propertyId, v<CategoryInput>(fd));
    return "Room type added.";
  });
}
export async function updateCategoryAction(propertyId: string, categoryId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await updateCategory(db(), await ctx(), propertyId, categoryId, v<CategoryInput>(fd));
  });
}
export async function archiveCategoryAction(
  propertyId: string,
  categoryId: string,
  archived: boolean,
  _p: ActionState,
  fd: FormData,
) {
  return run(propertyId, fd, async () => {
    await setCategoryArchived(db(), await ctx(), propertyId, categoryId, archived);
    return archived ? "Room type archived." : "Room type restored.";
  });
}

// ---------- Rooms ----------
export async function createRoomAction(propertyId: string, _p: ActionState, fd: FormData): Promise<ActionState> {
  const values = formValues(fd);
  let roomId: string;
  try {
    roomId = (await createRoom(db(), await ctx(), propertyId, v<RoomInput>(fd))).id;
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  redirect(`/properties/${propertyId}/rooms/${roomId}?created=1`);
}
export async function bulkCreateRoomsAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    const { count } = await bulkCreateRooms(db(), await ctx(), propertyId, v<BulkRoomInput>(fd));
    return `${count} rooms created.`;
  });
}
export async function updateRoomAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  const r = await run(propertyId, fd, async () => {
    await updateRoom(db(), await ctx(), propertyId, roomId, v<RoomInput>(fd));
    return "Room saved.";
  });
  return { ...r, values: formValues(fd) };
}
export async function changeRoomStatusAction(propertyId: string, roomId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await changeRoomStatus(db(), await ctx(), propertyId, roomId, v<StatusChangeInput>(fd));
    return "Status updated.";
  });
}
export async function archiveRoomAction(propertyId: string, roomId: string, archived: boolean, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await setRoomArchived(db(), await ctx(), propertyId, roomId, archived);
    return archived ? "Room archived." : "Room restored.";
  });
}

// ---------- Departments ----------
export async function createDefaultDepartmentsAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    const { created } = await createDefaultDepartments(db(), await ctx(), propertyId);
    return created ? `${created} departments added.` : "All default departments already exist.";
  });
}
export async function createDepartmentAction(propertyId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await createDepartment(db(), await ctx(), propertyId, v<DepartmentInput>(fd));
    return "Department added.";
  });
}
export async function updateDepartmentAction(propertyId: string, departmentId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, fd, async () => {
    await updateDepartment(db(), await ctx(), propertyId, departmentId, v<DepartmentInput>(fd));
  });
}
