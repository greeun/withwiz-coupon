import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-8 Events: onEvent called, error-isolated, logger.warn on throw", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t8");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("onEvent gets exactly 1 coupon.redeemed event on success", async () => {
    const onEvent = vi.fn();
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      events: { onEvent },
    });
    const c = await client.coupons.create({
      code: "T8OK",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    await client.redeem({
      code: "T8OK",
      userId: "u",
      orderRef: "o",
      subtotal: 10000,
      currency: "KRW",
    });
    const redeemed = onEvent.mock.calls.filter(
      (call) => (call[0] as { type: string }).type === "coupon.redeemed"
    );
    expect(redeemed.length).toBe(1);
    const event = redeemed[0]![0] as { type: string; redemption: { couponId: string } };
    expect(event.redemption.couponId).toBe(c.id);
  });

  it("onEvent throws -> business result preserved, logger.warn called", async () => {
    const warn = vi.fn();
    const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() };
    const onEvent = vi.fn(() => {
      throw new Error("consumer-handler-broken");
    });
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      events: { onEvent },
      logger,
    });
    await client.coupons.create({
      code: "T8THROW",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    const result = await client.redeem({
      code: "T8THROW",
      userId: "u2",
      orderRef: "o2",
      subtotal: 10000,
      currency: "KRW",
    });
    expect(result.redemption.id).toBeDefined();
    expect(warn).toHaveBeenCalled();
  });
});
