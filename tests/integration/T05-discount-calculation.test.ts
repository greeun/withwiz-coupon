import { afterAll, describe, expect, it } from "vitest";
import {
  calculateDiscount,
  createCouponClient,
  CurrencyMismatchError,
  MinimumOrderNotMetError,
} from "../../src/index.js";
import { asPrismaLike, disconnectPrisma, getPrisma } from "../setup.js";

describe("T-5 Discount calculation engine (pure, total >= 0)", () => {
  const prisma = getPrisma();

  afterAll(async () => {
    await disconnectPrisma();
  });

  it("PERCENT 10% subtotal=10000 maxDiscount=500 -> discount=500, total=9500", () => {
    const r = calculateDiscount({
      subtotal: 10000,
      currency: "KRW",
      policy: { kind: "PERCENT", percent: 10, maxDiscount: 500 },
    });
    expect(r.discountAmount).toBe(500);
    expect(r.total).toBe(9500);
  });

  it("FIXED 3000 minOrder=10000 subtotal=9999 -> MinimumOrderNotMetError", () => {
    expect(() =>
      calculateDiscount({
        subtotal: 9999,
        currency: "KRW",
        policy: { kind: "FIXED", amount: 3000, currency: "KRW", minOrder: 10000 },
      })
    ).toThrow(MinimumOrderNotMetError);
  });

  it("Subtotal < discount -> total clamped to 0 (I8)", () => {
    const r = calculateDiscount({
      subtotal: 2000,
      currency: "KRW",
      policy: { kind: "FIXED", amount: 5000, currency: "KRW" },
    });
    expect(r.discountAmount).toBe(2000);
    expect(r.total).toBe(0);
  });

  it("PERCENT 100% -> full discount, total=0, total >= 0", () => {
    const r = calculateDiscount({
      subtotal: 12345,
      currency: "KRW",
      policy: { kind: "PERCENT", percent: 100 },
    });
    expect(r.discountAmount).toBe(12345);
    expect(r.total).toBe(0);
  });

  it("Currency mismatch -> CurrencyMismatchError", () => {
    expect(() =>
      calculateDiscount({
        subtotal: 10000,
        currency: "USD",
        policy: { kind: "FIXED", amount: 1000, currency: "KRW" },
      })
    ).toThrow(CurrencyMismatchError);
  });

  it("Redeem with currency mismatch -> CurrencyMismatchError", async () => {
    const tenantId = `t5-${Date.now()}`;
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T5CURR",
      discount: { kind: "FIXED", amount: 3000, currency: "KRW" },
    });
    await expect(
      client.redeem({
        code: "T5CURR",
        userId: "u",
        subtotal: 10000,
        currency: "USD",
      })
    ).rejects.toBeInstanceOf(CurrencyMismatchError);
    await prisma.couponAuditLog.deleteMany({ where: { tenantId } });
    await prisma.coupon.deleteMany({ where: { tenantId } });
  });
});
