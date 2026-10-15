import { afterAll, describe, expect, it } from "vitest";
import { createCouponClient, InvalidDiscountPolicyError, resolveDuration } from "../../src/index.js";
import { asPrismaLike, disconnectPrisma, freshTenantId, getPrisma } from "../setup.js";

describe("T-18 discount duration round-trip", () => {
  const prisma = getPrisma();
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("coupon duration survives create, validate and redeem", async () => {
    const client = createCouponClient({ prisma: asPrismaLike(prisma), defaultTenantId: freshTenantId("t18a") });
    const duration = { kind: "REPEATING" as const, months: 3 };
    await client.coupons.create({ code: "DUR3", discount: { kind: "PERCENT", percent: 20, duration } });

    const v = await client.validate({ code: "DUR3", userId: "org_1", subtotal: 1000, currency: "USD" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(resolveDuration(v.coupon.discount)).toEqual(duration);
    expect(v.discountPreview?.appliedPolicy.duration).toEqual(duration);

    const r = await client.redeem({ code: "DUR3", userId: "org_1", orderRef: "sub_1", subtotal: 1000, currency: "USD" });
    expect(r.discount.discountAmount).toBe(200);
    expect(r.discount.appliedPolicy.duration).toEqual(duration);
  });

  it("codes issued from a campaign inherit its duration", async () => {
    const client = createCouponClient({ prisma: asPrismaLike(prisma), defaultTenantId: freshTenantId("t18b") });
    const campaign = await client.campaigns.create({
      name: "FOREVER10",
      discount: { kind: "FIXED", amount: 100, currency: "USD", duration: { kind: "FOREVER" } },
    });
    const issued = await client.campaigns.issue({ campaignId: campaign.id, count: 2 });
    expect(issued.created).toHaveLength(2);
    const list = await client.coupons.list({ campaignId: campaign.id });
    expect(list.items).toHaveLength(2);
    for (const c of list.items) expect(resolveDuration(c.discount)).toEqual({ kind: "FOREVER" });
  });

  it("rejects an invalid duration at create time", async () => {
    const client = createCouponClient({ prisma: asPrismaLike(prisma), defaultTenantId: freshTenantId("t18c") });
    await expect(
      client.coupons.create({
        code: "BAD",
        discount: { kind: "PERCENT", percent: 10, duration: { kind: "REPEATING", months: 0 } },
      })
    ).rejects.toBeInstanceOf(InvalidDiscountPolicyError);
  });
});
