import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-3 lazy EXPIRED / EXHAUSTED transitions", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t3");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("endsAt < now -> validate returns EXPIRED + DB status upgraded", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now: () => new Date("2027-01-01T00:00:00Z"),
    });
    const c = await client.coupons.create({
      code: "T3EXP",
      discount: { kind: "PERCENT", percent: 10 },
      endsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const res = await client.validate({ code: "T3EXP" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("EXPIRED");
    const raw = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(raw?.status).toBe("EXPIRED");
  });

  it("maxRedemptions=1 -> after first redeem, second validate returns EXHAUSTED + DB status", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T3EX",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxRedemptions: 1,
    });
    await client.redeem({
      code: "T3EX",
      userId: "u1",
      orderRef: "o1",
      subtotal: 10000,
      currency: "KRW",
    });
    const v = await client.validate({ code: "T3EX" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("EXHAUSTED");
    const raw = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(raw?.status).toBe("EXHAUSTED");
  });

  it("concurrent validate on expired coupon converges to EXPIRED (20 parallel)", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now: () => new Date("2027-01-01T00:00:00Z"),
    });
    const c = await client.coupons.create({
      code: "T3LAZY",
      discount: { kind: "PERCENT", percent: 5 },
      endsAt: new Date("2026-06-01T00:00:00Z"),
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.validate({ code: "T3LAZY" }))
    );
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("EXPIRED");
    }
    const raw = await prisma.coupon.findUnique({ where: { id: c.id } });
    expect(raw?.status).toBe("EXPIRED");
  });
});
