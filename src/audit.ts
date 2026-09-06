/**
 * Audit log recorder. Writes audit rows through the delegate the caller
 * resolved, so a renamed audit model stays transparent here.
 */

import type { DelegateLike } from "./domain/types.js";

export type AuditWriteInput = {
  tenantId: string;
  action: string;
  resourceId?: string | null;
  resourceType?: string | null;
  actorId?: string | null;
  details?: Record<string, unknown> | null;
};

export async function writeAudit(
  auditLog: DelegateLike,
  input: AuditWriteInput
): Promise<void> {
  await auditLog.create({
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
