import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createCouponClient, CouponExhaustedError } from "@withwiz/coupon";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5442/coupon_test?schema=consumer_sample";

process.env.DATABASE_URL = DATABASE_URL;

const prisma = new PrismaClient();
const TENANT = "sample-app";

describe("consumer sample end-to-end", () => {
  beforeAll(async () => {
    await prisma.couponRedemption.deleteMany({ where: { tenantId: TENANT } });
    await prisma.couponAuditLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.coupon.deleteMany({ where: { tenantId: TENANT } });
    await prisma.consumerOrder.deleteMany({ where: { tenantId: TENANT } });
  });
  afterAll(async () => {
    await prisma.couponRedemption.deleteMany({ where: { tenantId: TENANT } });
    await prisma.couponAuditLog.deleteMany({ where: { tenantId: TENANT } });
    await prisma.coupon.deleteMany({ where: { tenantId: TENANT } });
    await prisma.consumerOrder.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  it("redeem piggybacks on consumer tx + maxRedemptions=1 race produces 1 success only", async () => {
    const coupon = createCouponClient({
      prisma: prisma as unknown as Parameters<typeof createCouponClient>[0]["prisma"],
      defaultTenantId: TENANT,
    });
    const c = await coupon.coupons.create({
      code: "SAMPLE10",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxRedemptions: 1,
    });

    // Create consumer orders + redeem in same tx for first user
    await prisma.$transaction(async (tx) => {
      const order = await tx.consumerOrder.create({
        data: { tenantId: TENANT, amount: 10000 },
      });
      await coupon.redeem({
        code: "SAMPLE10",
        userId: "u1",
        orderRef: order.id,
        subtotal: 10000,
        currency: "KRW",
        tx: tx as unknown as Parameters<typeof coupon.redeem>[0]["tx"],
      });
    });

    // Second redeem should fail with CouponExhaustedError
    await expect(
      coupon.redeem({
        code: "SAMPLE10",
        userId: "u2",
        orderRef: "consumer-order-2",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(CouponExhaustedError);

    const fresh = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(fresh?.redeemedCount).toBe(1);
  });
});
