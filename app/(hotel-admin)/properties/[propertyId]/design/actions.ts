"use server";

import { revalidatePath } from "next/cache";
import { formValues, toActionState, type ActionState } from "@/lib/actions";
import { requireTenantContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import {
  addGalleryPhoto,
  removeBrandImage,
  removeGalleryPhoto,
  setBrandImage,
  setServiceImage,
  updateGalleryPhoto,
  updatePortalDesign,
} from "@/modules/guest-portal/design";

// Ids bound from the page are re-checked by the services against the caller's tenant/property.

async function run(propertyId: string, fn: () => Promise<string>, values?: Record<string, string>): Promise<ActionState> {
  let message: string;
  try {
    message = await fn();
  } catch (err) {
    return toActionState(err, values);
  }
  revalidatePath(`/properties/${propertyId}`, "layout");
  return { ok: true, message };
}

async function fileBytes(fd: FormData): Promise<Buffer> {
  const f = fd.get("file");
  if (!(f instanceof File)) return Buffer.alloc(0);
  return Buffer.from(await f.arrayBuffer());
}

export async function saveDesignAction(propertyId: string, _p: ActionState, fd: FormData) {
  const values = formValues(fd);
  return run(
    propertyId,
    async () => {
      await updatePortalDesign(getDb(), await requireTenantContext(), propertyId, values as never);
      return "Design saved. Guests see it on their next scan.";
    },
    values,
  );
}

export async function uploadBrandAction(propertyId: string, kind: "logo" | "cover", fd: FormData) {
  return run(propertyId, async () => {
    await setBrandImage(getDb(), await requireTenantContext(), propertyId, kind, await fileBytes(fd));
    return kind === "logo" ? "Logo uploaded." : "Cover photo uploaded.";
  });
}

export async function removeBrandAction(propertyId: string, kind: "logo" | "cover") {
  return run(propertyId, async () => {
    await removeBrandImage(getDb(), await requireTenantContext(), propertyId, kind);
    return "Removed.";
  });
}

export async function uploadGalleryAction(propertyId: string, fd: FormData) {
  return run(propertyId, async () => {
    await addGalleryPhoto(getDb(), await requireTenantContext(), propertyId, await fileBytes(fd), String(fd.get("caption") ?? ""));
    return "Photo added.";
  });
}

export async function updateGalleryAction(propertyId: string, mediaId: string, _p: ActionState, fd: FormData) {
  return run(propertyId, async () => {
    const move = fd.get("move");
    await updateGalleryPhoto(getDb(), await requireTenantContext(), propertyId, mediaId, {
      caption: fd.has("caption") ? String(fd.get("caption") ?? "") : undefined,
      move: move === "up" || move === "down" ? move : undefined,
    });
    return "Saved.";
  });
}

export async function removeGalleryAction(propertyId: string, mediaId: string) {
  return run(propertyId, async () => {
    await removeGalleryPhoto(getDb(), await requireTenantContext(), propertyId, mediaId);
    return "Photo removed.";
  });
}

export async function uploadServiceImageAction(propertyId: string, serviceId: string, fd: FormData) {
  return run(propertyId, async () => {
    await setServiceImage(getDb(), await requireTenantContext(), propertyId, serviceId, await fileBytes(fd));
    return "Photo added to the service.";
  });
}

export async function removeServiceImageAction(propertyId: string, serviceId: string) {
  return run(propertyId, async () => {
    await setServiceImage(getDb(), await requireTenantContext(), propertyId, serviceId, null);
    return "Photo removed.";
  });
}
