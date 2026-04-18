import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CouponArchivedError,
  CouponInactiveError,
  CouponExpiredError,
  createCouponClient,
  COUPON_STATUS,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-2 state transition + I10 ARCHIVED immutability + CouponInactiveError", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t2");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("pause -> validate rejects with PAUSED; resume -> ok", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T2PAUSE1",
      discount: { kind: "PERCENT", percent: 10 },
    });
    await client.coupons.pause({ id: c.id });
    const afterPause = await client.validate({ code: "T2PAUSE1" });
    expect(afterPause.ok).toBe(false);
    if (!afterPause.ok) expect(afterPause.reason).toBe("PAUSED");

    await client.coupons.resume({ id: c.id });
    const afterResume = await client.validate({ code: "T2PAUSE1" });
    expect(afterResume.ok).toBe(true);
  });

  it("PAUSED state -> redeem throws CouponInactiveError with code=PAUSED", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T2INACTIVE",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    await client.coupons.pause({ id: c.id });
    await expect(
      client.redeem({
        code: "T2INACTIVE",
        userId: "u1",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(CouponInactiveError);
    try {
      await client.redeem({
        code: "T2INACTIVE",
        userId: "u1",
        subtotal: 10000,
        currency: "KRW",
      });
    } catch (e) {
      expect((e as CouponInactiveError).code).toBe("PAUSED");
    }
  });

  it("DRAFT state -> redeem throws CouponInactiveError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T2DRAFT",
      discount: { kind: "PERCENT", percent: 5 },
      status: COUPON_STATUS.DRAFT,
    });
    await expect(
      client.redeem({
        code: "T2DRAFT",
        userId: "u1",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(CouponInactiveError);
    expect(c.status).toBe("DRAFT");
  });

  it("startsAt > now -> redeem throws CouponExpiredError with code=NOT_STARTED", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    await client.coupons.create({
      code: "T2NOTSTARTED",
      discount: { kind: "PERCENT", percent: 5 },
      startsAt: new Date("2026-02-01T00:00:00Z"),
      endsAt: new Date("2026-12-01T00:00:00Z"),
    });
    try {
      await client.redeem({
        code: "T2NOTSTARTED",
        userId: "u1",
        subtotal: 10000,
        currency: "KRW",
      });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(CouponExpiredError);
      expect((e as CouponExpiredError).code).toBe("NOT_STARTED");
    }
  });

  it("archive -> all 5 mutative APIs throw CouponArchivedError (I10)", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T2ARCH",
      discount: { kind: "PERCENT", percent: 10 },
    });
    await client.coupons.archive({ id: c.id });

    await expect(client.coupons.pause({ id: c.id })).rejects.toBeInstanceOf(CouponArchivedError);
    await expect(client.coupons.resume({ id: c.id })).rejects.toBeInstanceOf(CouponArchivedError);
    await expect(client.coupons.archive({ id: c.id })).rejects.toBeInstanceOf(CouponArchivedError);
    await expect(
      client.coupons.issue({ couponId: c.id, issuedToUserId: "u" })
    ).rejects.toBeInstanceOf(CouponArchivedError);
    await expect(
      client.redeem({
        code: "T2ARCH",
        userId: "u",
        subtotal: 1000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(CouponArchivedError);
  });
});
