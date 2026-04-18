import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CouponAlreadyRedeemedError,
  CouponExhaustedError,
  PerUserLimitExceededError,
  createCouponClient,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

// T-6 concurrency: 3 cases, each with the 3-value invariant
//   resolved success count === Redemption row count === Coupon.redeemedCount

describe("T-6 concurrency: redeem is race-condition safe", () => {
  const prisma = getPrisma();

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("6.1.a maxRedemptions=1 -> 1 success / 49 CouponExhaustedError (out of 50 parallel)", async () => {
    const tenantId = freshTenantId("t6a");
    await truncateTenant(prisma, tenantId);
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T6A",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxRedemptions: 1,
    });

    const N = 50;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        client.redeem({
          code: "T6A",
          userId: `user-${i}`,
          orderRef: `order-${i}`,
          subtotal: 10000,
          currency: "KRW",
        })
      )
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(N - 1);
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(CouponExhaustedError);
      }
    }

    const rowCount = await prisma.couponRedemption.count({
      where: { tenantId, couponId: c.id },
    });
    expect(rowCount).toBe(1);

    const fresh = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(fresh?.redeemedCount).toBe(1);

    await truncateTenant(prisma, tenantId);
  });

  it("6.1.b maxRedemptionsPerUser=1 same user different orderRef -> 1 success / rest rejected", async () => {
    const tenantId = freshTenantId("t6b");
    await truncateTenant(prisma, tenantId);
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T6B",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
      maxRedemptionsPerUser: 1,
    });

    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        client.redeem({
          code: "T6B",
          userId: "same-user",
          orderRef: `ord-${i}`,
          subtotal: 10000,
          currency: "KRW",
        })
      )
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") {
        // Allowed error types per Q2 DECISION
        const ok =
          r.reason instanceof PerUserLimitExceededError ||
          r.reason instanceof CouponAlreadyRedeemedError;
        expect(ok).toBe(true);
      }
    }

    const rowCount = await prisma.couponRedemption.count({
      where: { tenantId, couponId: c.id },
    });
    expect(rowCount).toBe(1);

    const fresh = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(fresh?.redeemedCount).toBe(1);

    await truncateTenant(prisma, tenantId);
  });

  it("6.1.c same user + same orderRef idempotent -> exactly 1 success, rest CouponAlreadyRedeemedError", async () => {
    const tenantId = freshTenantId("t6c");
    await truncateTenant(prisma, tenantId);
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T6C",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });

    const N = 10;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        client.redeem({
          code: "T6C",
          userId: "single",
          orderRef: "single-order",
          subtotal: 10000,
          currency: "KRW",
        })
      )
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBe(1);
    for (const r of results) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(CouponAlreadyRedeemedError);
      }
    }

    const rowCount = await prisma.couponRedemption.count({
      where: { tenantId, couponId: c.id },
    });
    expect(rowCount).toBe(1);

    const fresh = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(fresh?.redeemedCount).toBe(1);

    await truncateTenant(prisma, tenantId);
  });
});
