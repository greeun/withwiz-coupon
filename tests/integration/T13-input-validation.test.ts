import { afterAll, describe, expect, it } from "vitest";
import {
  createCouponClient,
  InvalidDateRangeError,
  InvalidDiscountPolicyError,
  ValidationError,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-13 Input validation + security guards [A][B][C][I]", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t13");

  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  function newClient() {
    return createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
  }

  it("I7: percent = 0 / -1 / 101 -> InvalidDiscountPolicyError; 100 ok", async () => {
    const c = newClient();
    for (const p of [0, -1, 101]) {
      await expect(
        c.coupons.create({
          discount: { kind: "PERCENT", percent: p },
        })
      ).rejects.toBeInstanceOf(InvalidDiscountPolicyError);
    }
    const ok = await c.coupons.create({
      code: "T13P100",
      discount: { kind: "PERCENT", percent: 100 },
    });
    expect(ok.id).toBeDefined();
  });

  it("I8: FIXED amount = 0 / -1 -> InvalidDiscountPolicyError", async () => {
    const c = newClient();
    for (const a of [0, -1]) {
      await expect(
        c.coupons.create({
          discount: { kind: "FIXED", amount: a, currency: "KRW" },
        })
      ).rejects.toBeInstanceOf(InvalidDiscountPolicyError);
    }
  });

  it("I6: startsAt >= endsAt -> InvalidDateRangeError (equality also rejected)", async () => {
    const c = newClient();
    const t = new Date("2026-06-01T00:00:00Z");
    await expect(
      c.coupons.create({
        discount: { kind: "PERCENT", percent: 10 },
        startsAt: t,
        endsAt: new Date("2026-05-01T00:00:00Z"),
      })
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
    await expect(
      c.coupons.create({
        discount: { kind: "PERCENT", percent: 10 },
        startsAt: t,
        endsAt: t,
      })
    ).rejects.toBeInstanceOf(InvalidDateRangeError);
  });

  it("[A] code: empty / > 64 / NUL / whitespace / control -> ValidationError", async () => {
    const c = newClient();
    await expect(
      c.coupons.create({ code: "", discount: { kind: "PERCENT", percent: 10 } })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        code: "x".repeat(65),
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        code: "AB\u0000CD",
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        code: "AB CD",
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      c.coupons.create({
        code: "AB\tCD",
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("[A] code charset whitelist [A-Z0-9_-] — SQL meta chars / quotes / CJK rejected", async () => {
    const c = newClient();
    // SQL meta / quote / punctuation — must be rejected.
    // NOTE: "ABC--" is VALID (hyphen is whitelisted). Banned chars below
    // include quotes, semicolons, colons, dots, slashes, CJK, emoji, and
    // common SQL/URL meta characters.
    const rejected = [
      "ABC'",
      "ABC;DROP",
      "ABC\"X",
      "ABC:1",
      "ABC.1",
      "ABC/1",
      "ABC\\1",
      "ABC한글",
      "ABC🎉",
      "ABC+1",
      "ABC@1",
      "ABC#1",
      "ABC$1",
    ];
    for (const code of rejected) {
      await expect(
        c.coupons.create({
          code,
          discount: { kind: "PERCENT", percent: 10 },
        })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("[A] code charset whitelist — lowercase canonicalized; underscore + hyphen accepted", async () => {
    const c = newClient();
    // lower-case → upper-case canonicalization → still matches whitelist.
    const okLower = await c.coupons.create({
      code: "abc-123",
      discount: { kind: "PERCENT", percent: 10 },
    });
    expect(okLower.code).toBe("ABC-123");

    const okUnderscore = await c.coupons.create({
      code: "ABC_123",
      discount: { kind: "PERCENT", percent: 10 },
    });
    expect(okUnderscore.code).toBe("ABC_123");
  });

  it("[B] metadata with __proto__ / constructor / prototype -> ValidationError", async () => {
    const c = newClient();
    const bad = [
      JSON.parse('{"__proto__": {"x": 1}}'),
      { constructor: { evil: true } },
      { prototype: { evil: true } },
    ];
    for (const m of bad) {
      await expect(
        c.coupons.create({
          discount: { kind: "PERCENT", percent: 10 },
          metadata: m,
        })
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it("[C] tenantId invalid characters or too long -> ValidationError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
    });
    await expect(
      client.coupons.create({
        tenantId: "bad@tenant",
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      client.coupons.create({
        tenantId: "x".repeat(65),
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("[I] issueBulk count > 10,000 -> ValidationError", async () => {
    const c = newClient();
    await expect(
      c.coupons.issueBulk({
        count: 10_001,
        discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
