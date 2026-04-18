import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CouponExhaustedError, createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-9 Audit log: all state transitions + redeem success/reject + actorId + rejected context", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t9");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("every audit action appears at least once; actorId stored; rejected has reason", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "T9LIFE",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxRedemptions: 1,
      actorId: "actor-1",
    });
    await client.coupons.pause({ id: c.id, actorId: "actor-2" });
    await client.coupons.resume({ id: c.id, actorId: "actor-3" });
    await client.redeem({
      code: "T9LIFE",
      userId: "u1",
      orderRef: "ord-1",
      subtotal: 10000,
      currency: "KRW",
    });
    // trigger rejection (already exhausted)
    await expect(
      client.redeem({
        code: "T9LIFE",
        userId: "u2",
        orderRef: "ord-2",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(CouponExhaustedError);
    await client.coupons.archive({ id: c.id, actorId: "actor-4" });

    // bulk issue to cover coupon.issued.bulk
    await client.coupons.issueBulk({
      count: 3,
      codeLength: 8,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });

    const logs = await client.audit.listLogs({ limit: 200 });
    const actions = new Set(logs.items.map((l) => l.action));
    expect(actions.has("coupon.created")).toBe(true);
    expect(actions.has("coupon.paused")).toBe(true);
    expect(actions.has("coupon.resumed")).toBe(true);
    expect(actions.has("coupon.redeemed")).toBe(true);
    expect(actions.has("coupon.redeem.rejected")).toBe(true);
    expect(actions.has("coupon.archived")).toBe(true);
    expect(actions.has("coupon.issued.bulk")).toBe(true);

    // actorId is stored
    const pausedLog = logs.items.find((l) => l.action === "coupon.paused");
    expect(pausedLog?.actorId).toBe("actor-2");

    // rejected log has reason and metadata
    const rejectedLog = logs.items.find((l) => l.action === "coupon.redeem.rejected");
    expect(rejectedLog?.details).toBeDefined();
    expect(rejectedLog?.details?.reason).toBe("EXHAUSTED");
  });
});
