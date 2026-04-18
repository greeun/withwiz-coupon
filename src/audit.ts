/**
 * Audit log recorder. Writes CouponAuditLog rows inside the given transaction.
 */

import type { PrismaTxLike } from "./domain/types.js";

export type AuditWriteInput = {
  tenantId: string;
  action: string;
  resourceId?: string | null;
  resourceType?: string | null;
  actorId?: string | null;
  details?: Record<string, unknown> | null;
};

export async function writeAudit(
  tx: PrismaTxLike,
  input: AuditWriteInput
): Promise<void> {
  await tx.couponAuditLog.create({
    data: {
      tenantId: input.tenantId,
      action: input.action,
      resourceId: input.resourceId ?? null,
      resourceType: input.resourceType ?? null,
      actorId: input.actorId ?? null,
      details: input.details ?? null,
    },
  });
}
