import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCouponClient, ValidationError } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-11 Bulk issuance (500+), unique codes, [J] maxAttempts guard", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t11");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("issueBulk count=500 yields 500 unique codes + emits exactly ONE 'coupon.issued.bulk' event [H]", async () => {
    // [H] spec.md §6.5 / sprint_contract §16[H]: bulk issuance must emit the
    // 'coupon.issued.bulk' event exactly once per call (no per-row events).
    const onEvent = vi.fn();
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      events: { onEvent },
    });
    const result = await client.coupons.issueBulk({
      count: 500,
      codeLength: 10,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });
    expect(result.created.length).toBe(500);
    expect(new Set(result.codes).size).toBe(500);
    expect(result.skipped).toBe(0);

    // [H] Exactly ONE bulk event, not N.
    const bulkEvents = onEvent.mock.calls.filter(
      (call) => call[0]?.type === "coupon.issued.bulk"
    );
    expect(bulkEvents).toHaveLength(1);
    expect(bulkEvents[0][0]).toMatchObject({
      type: "coupon.issued.bulk",
      tenantId,
      count: 500,
    });
  });

  it("[I] count > 10,000 throws ValidationError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await expect(
      client.coupons.issueBulk({
        count: 10_001,
        discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("[J] repeated colliding codeGenerator -> ValidationError after maxAttempts", async () => {
    const t = freshTenantId("t11b");
    // All generators return the exact same code — after attempt 1 it collides.
    const fixedCode = "COLLIDEXX";
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
      codeGenerator: () => fixedCode,
    });
    // First one succeeds.
    const first = await client.coupons.issueBulk({
      count: 1,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });
    expect(first.created.length).toBe(1);
    // Second attempt with the same generator — always collides.
    // The outer try wrapping bulk records "skipped" and if NONE created, throws.
    await expect(
      client.coupons.issueBulk({
        count: 1,
        discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await truncateTenant(prisma, t);
  });

  it("[T-15] codeGenerator override is actually invoked", async () => {
    const t = freshTenantId("t11c");
    const gen = vi.fn((opts: { length: number }) => "CUSTOM" + opts.length + Math.random().toString(36).slice(2, 6).toUpperCase());
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
      codeGenerator: gen,
    });
    const r = await client.coupons.issueBulk({
      count: 3,
      codeLength: 10,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });
    expect(gen).toHaveBeenCalled();
    for (const code of r.codes) {
      expect(code.startsWith("CUSTOM")).toBe(true);
    }
    await truncateTenant(prisma, t);
  });
});
