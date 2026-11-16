import type { Db } from "@/lib/db/types";
import { roomQrCodes } from "@/lib/db/schema";
import { encryptSecret, generateQrToken, hashQrToken } from "@/lib/crypto/secrets";
import { serverEnv } from "@/lib/env";
import type { TenantContext } from "@/lib/permissions/authorize";

/** True when the keys needed to mint QR codes are configured (lets room creation skip safely). */
export function qrKeysConfigured(): boolean {
  const env = serverEnv();
  return Boolean(env.QR_TOKEN_PEPPER && env.ENCRYPTION_KEY);
}

interface IssueTarget {
  tenantId: string;
  propertyId: string;
  roomId: string;
}

/** Inserts fresh active codes. Callers handle permissions, locking and audit. */
export async function insertQrCodes(tx: Db, targets: IssueTarget[], userId: string | null) {
  if (targets.length === 0) return [];
  return tx
    .insert(roomQrCodes)
    .values(
      targets.map((t) => {
        const token = generateQrToken();
        return { ...t, tokenHash: hashQrToken(token), tokenCiphertext: encryptSecret(token), issuedByUserId: userId };
      }),
    )
    .returning({ id: roomQrCodes.id, roomId: roomQrCodes.roomId });
}

/**
 * FR-03 "create QR when room is created": called inside the room-creation transaction.
 * Room managers create the code as a system side effect; managing it later needs qr.* permissions.
 */
export async function issueForNewRooms(tx: Db, ctx: TenantContext, propertyId: string, roomIds: string[]) {
  if (!qrKeysConfigured() || roomIds.length === 0) return;
  await insertQrCodes(
    tx,
    roomIds.map((roomId) => ({ tenantId: ctx.tenantId, propertyId, roomId })),
    ctx.userId,
  );
}
