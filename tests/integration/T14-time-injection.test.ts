import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-14 Time injection: config.now controls status judgement", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t14");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("same coupon judged ACTIVE or EXPIRED based on config.now", async () => {
    // real-time client
    const liveClient = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await liveClient.coupons.create({
      code: "T14",
      discount: { kind: "PERCENT", percent: 10 },
      endsAt: new Date("2027-01-01T00:00:00Z"),
    });
    const r = await liveClient.validate({ code: "T14" });
    expect(r.ok).toBe(true);

    // time-traveled client
    const futureClient = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now: () => new Date("2030-01-01T00:00:00Z"),
    });
    const r2 = await futureClient.validate({ code: "T14" });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("EXPIRED");
    expect(c.id).toBeDefined();
  });

  it("onEvent receives at === injected now", async () => {
    const fixed = new Date("2026-07-01T12:00:00Z");
    const onEvent = vi.fn();
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now: () => fixed,
      events: { onEvent },
    });
    await client.coupons.create({
      code: "T14AT",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    const created = onEvent.mock.calls.find(
      (call) => (call[0] as { type: string }).type === "coupon.created"
    );
    expect(created).toBeDefined();
    const event = created![0] as { at: Date };
    expect(event.at.getTime()).toBe(fixed.getTime());
  });
});
