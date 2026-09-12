import { afterAll, describe, expect, it } from "vitest";
import {
  createCouponClient,
  LIMITS,
  ValidationError,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

/**
 * Regression tests for the security-hardening pass:
 *   [M] per-user cap cannot be bypassed by omitting userId
 *   [L] caller-supplied strings / JSON are bounded
 *   [P2002] only a real unique conflict maps to a domain error, without
 *           leaking the Prisma message through `details`
 *   [BULK] partial code collisions no longer abort the whole batch
 */
describe("T-17 Security hardening", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t17");

  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  function newClient(extra: Parameters<typeof createCouponClient>[0] extends infer C ? Partial<C> : never = {}) {
    return createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      ...extra,
    });
  }

  const fixed = { kind: "FIXED", amount: 500, currency: "KRW" } as const;

  it("[M] maxRedemptionsPerUser coupon refuses anonymous validate()/redeem()", async () => {
    const c = newClient();
    await c.coupons.create({ code: "T17PU", discount: fixed, maxRedemptionsPerUser: 1 });

    await expect(c.validate({ code: "T17PU" })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.redeem({ code: "T17PU", subtotal: 10_000, currency: "KRW", orderRef: "o1" })
    ).rejects.toBeInstanceOf(ValidationError);

    // Identified user still works, and the cap is enforced.
    const ok = await c.redeem({
      code: "T17PU",
      userId: "u1",
      subtotal: 10_000,
      currency: "KRW",
      orderRef: "o1",
    });
    expect(ok.redemption.redeemedByUserId).toBe("u1");

    // No redemption row was written by the anonymous attempts.
    const rows = await prisma.couponRedemption.count({
      where: { tenantId, couponId: ok.coupon.id },
    });
    expect(rows).toBe(1);
  });

  it("[M] coupon without a per-user cap still allows anonymous redeem", async () => {
    const c = newClient();
    await c.coupons.create({ code: "T17ANON", discount: fixed });
    const r = await c.redeem({ code: "T17ANON", subtotal: 10_000, currency: "KRW" });
    expect(r.redemption.redeemedByUserId).toBeNull();
  });

  it("[L] oversized userId / orderRef / actorId / ids -> ValidationError before any DB write", async () => {
    const c = newClient();
    await c.coupons.create({ code: "T17LEN", discount: fixed });
    const before = await prisma.couponAuditLog.count({ where: { tenantId } });

    await expect(
      c.redeem({
        code: "T17LEN",
        userId: "u".repeat(LIMITS.USER_ID_MAX_LENGTH + 1),
        subtotal: 10_000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.redeem({
        code: "T17LEN",
        userId: "u1",
        orderRef: "o".repeat(LIMITS.ORDER_REF_MAX_LENGTH + 1),
        subtotal: 10_000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({ discount: fixed, actorId: "a".repeat(LIMITS.USER_ID_MAX_LENGTH + 1) })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.get({ id: "i".repeat(LIMITS.ID_MAX_LENGTH + 1) })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.list({ cursor: "i".repeat(LIMITS.ID_MAX_LENGTH + 1) })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.validate({ code: "T17LEN", context: { plan: "p".repeat(LIMITS.CONTEXT_VALUE_MAX_LENGTH + 1) } })
    ).rejects.toBeInstanceOf(ValidationError);

    // Input validation happens before the transaction, so not even a
    // rejection audit row is written.
    const after = await prisma.couponAuditLog.count({ where: { tenantId } });
    expect(after).toBe(before);
  });

  it("[L] metadata over 16 KiB and oversized eligibility lists -> ValidationError", async () => {
    const c = newClient();
    await expect(
      c.coupons.create({
        discount: fixed,
        metadata: { blob: "x".repeat(LIMITS.METADATA_MAX_BYTES) },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        discount: fixed,
        eligibility: {
          allowedUserIds: Array.from({ length: LIMITS.ELIGIBILITY_MAX_ENTRIES + 1 }, (_, i) => `u${i}`),
        },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        discount: fixed,
        eligibility: { allowedPlans: ["p".repeat(LIMITS.ELIGIBILITY_ENTRY_MAX_LENGTH + 1)] },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    // Boundary value is accepted.
    const ok = await c.coupons.create({
      discount: fixed,
      metadata: { blob: "x".repeat(LIMITS.METADATA_MAX_BYTES - 20) },
    });
    expect(ok.metadata).not.toBeNull();
  });

  it("[L] create() rejects a status outside the CouponStatus enum", async () => {
    const c = newClient();
    await expect(
      c.coupons.create({ discount: fixed, status: "HACKED" as never })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("[P2002] duplicate user-supplied code -> ValidationError with cause but no Prisma text in details", async () => {
    const c = newClient();
    await c.coupons.create({ code: "T17DUP", discount: fixed });
    const err = await c.coupons.create({ code: "T17DUP", discount: fixed }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.details).toBeUndefined();
    expect(err.cause).toBeDefined();
    expect((err.cause as { code?: string }).code).toBe("P2002");
  });

  it("[P2002] duplicate campaign name -> ValidationError (not a raw Prisma error)", async () => {
    const c = newClient();
    await c.campaigns.create({ name: "T17-CAMP", discount: fixed });
    await expect(
      c.campaigns.create({ name: "T17-CAMP", discount: fixed })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("[BULK] a partial code collision is retried without aborting the batch", async () => {
    const t = freshTenantId("t17bulk");
    // Call 1 -> "AAA", call 2 -> "AAA" again (collides with row 1),
    // call 3 -> "BBB". count=2 must succeed with 3 attempts and 0 skipped.
    const seq = ["AAA", "AAA", "BBB"];
    let i = 0;
    const c = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
      codeGenerator: () => seq[i++] ?? `Z${i}`,
    });
    const r = await c.coupons.issueBulk({ count: 2, discount: fixed });
    expect(r.created.length).toBe(2);
    expect(r.codes.sort()).toEqual(["AAA", "BBB"]);
    expect(r.attempts).toBe(3);
    expect(r.skipped).toBe(0);
    // The audit row is written inside the same transaction, so a healthy
    // transaction is proven by its presence.
    const audit = await prisma.couponAuditLog.count({
      where: { tenantId: t, action: "coupon.issued.bulk" },
    });
    expect(audit).toBe(1);
    await truncateTenant(prisma, t);
  });

  it("[BULK] a collision with an already-stored code (previous batch) is also retried", async () => {
    const t = freshTenantId("t17bulk2");
    const seq = ["CCC", "CCC", "DDD"];
    let i = 0;
    const c = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
      codeGenerator: () => seq[i++] ?? `Z${i}`,
    });
    const first = await c.coupons.issueBulk({ count: 1, discount: fixed });
    expect(first.codes).toEqual(["CCC"]);
    const second = await c.coupons.issueBulk({ count: 1, discount: fixed });
    expect(second.codes).toEqual(["DDD"]);
    expect(second.attempts).toBe(2);
    await truncateTenant(prisma, t);
  });
});
