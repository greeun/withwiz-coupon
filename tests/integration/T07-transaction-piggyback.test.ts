import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-7 redeem piggybacks on consumer $transaction and rolls back with it", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t7");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("outer tx throws -> redeem side effects rolled back", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T7TX",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxRedemptions: 5,
    });

    await expect(
      prisma.$transaction(async (tx) => {
        await client.redeem({
          code: "T7TX",
          userId: "u7",
          orderRef: "o7",
          subtotal: 10000,
          currency: "KRW",
          tx: tx as unknown as Parameters<typeof client.redeem>[0]["tx"],
        });
        throw new Error("boom-by-consumer");
      })
    ).rejects.toThrow("boom-by-consumer");

    const count = await prisma.couponRedemption.count({
      where: { tenantId, couponId: c.id },
    });
    expect(count).toBe(0);
    const fresh = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(fresh?.redeemedCount).toBe(0);
  });
});
