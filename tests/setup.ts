/**
 * Test setup: shared PrismaClient factory + truncation helpers.
 *
 * DATABASE_URL must be set (e.g. to the docker-compose service).
 * Each test suite should pick a unique tenantId to avoid row-level interference.
 */

import { PrismaClient } from "@prisma/client";
import type { PrismaLike } from "../src/domain/types.js";
import { randomUUID } from "node:crypto";

let _client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_client) {
    if (!process.env.DATABASE_URL) {
      // allow-env: test harness only — required pre-condition for Postgres tests.
      process.env.DATABASE_URL =
        "postgresql://postgres:postgres@localhost:13011/coupon_test?schema=public";
    }
    _client = new PrismaClient({
      // Intentionally suppress Prisma's built-in error log stream in tests.
      // Tests exercise unique-constraint / capacity-rollback paths on purpose;
      // Prisma's default stderr noise for those cases is expected and clutters
      // CI output. Set COUPON_PRISMA_DEBUG=1 to re-enable for local debugging.
      log: process.env.COUPON_PRISMA_DEBUG ? ["warn", "error"] : [],
    });
  }
  return _client;
}

export function asPrismaLike(p: PrismaClient): PrismaLike {
  // PrismaClient structurally matches PrismaLike. Cast via unknown to avoid
  // direct Prisma type coupling in tests.
  return p as unknown as PrismaLike;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}

export function freshTenantId(prefix = "t"): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Deletes rows for a specific tenantId only. Keeps tests isolated.
 */
export async function truncateTenant(
  p: PrismaClient,
  tenantId: string
): Promise<void> {
  await p.couponRedemption.deleteMany({ where: { tenantId } });
  await p.couponIssuance.deleteMany({ where: { tenantId } });
  await p.couponAuditLog.deleteMany({ where: { tenantId } });
  await p.coupon.deleteMany({ where: { tenantId } });
  await p.campaign.deleteMany({ where: { tenantId } });
}
