import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCouponClient,
  IneligibleCategoryError,
  IneligiblePlanError,
  IneligibleProductError,
  IneligibleUserError,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-4 Eligibility rules (4 fields + empty)", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t4");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("allowedUserIds -> mismatched user yields INELIGIBLE_USER + IneligibleUserError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T4USER",
      discount: { kind: "PERCENT", percent: 10 },
      eligibility: { allowedUserIds: ["u-allow"] },
    });
    const v = await client.validate({ code: "T4USER", userId: "u-deny" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("INELIGIBLE_USER");

    await expect(
      client.redeem({
        code: "T4USER",
        userId: "u-deny",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toBeInstanceOf(IneligibleUserError);
  });

  it("allowedPlans -> INELIGIBLE_PLAN + IneligiblePlanError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T4PLAN",
      discount: { kind: "PERCENT", percent: 10 },
      eligibility: { allowedPlans: ["PREMIUM"] },
    });
    const v = await client.validate({
      code: "T4PLAN",
      userId: "u1",
      context: { plan: "BASIC" },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("INELIGIBLE_PLAN");

    await expect(
      client.redeem({
        code: "T4PLAN",
        userId: "u1",
        subtotal: 10000,
        currency: "KRW",
        context: { plan: "BASIC" },
      })
    ).rejects.toBeInstanceOf(IneligiblePlanError);
  });

  it("allowedProductIds -> INELIGIBLE_PRODUCT + IneligibleProductError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T4PROD",
      discount: { kind: "PERCENT", percent: 10 },
      eligibility: { allowedProductIds: ["SKU-A"] },
    });
    const v = await client.validate({
      code: "T4PROD",
      userId: "u",
      context: { productId: "SKU-B" },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("INELIGIBLE_PRODUCT");

    await expect(
      client.redeem({
        code: "T4PROD",
        userId: "u",
        subtotal: 10000,
        currency: "KRW",
        context: { productId: "SKU-B" },
      })
    ).rejects.toBeInstanceOf(IneligibleProductError);
  });

  it("allowedCategories -> INELIGIBLE_CATEGORY + IneligibleCategoryError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T4CAT",
      discount: { kind: "PERCENT", percent: 10 },
      eligibility: { allowedCategories: ["electronics"] },
    });
    const v = await client.validate({
      code: "T4CAT",
      userId: "u",
      context: { categoryId: "books" },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("INELIGIBLE_CATEGORY");

    await expect(
      client.redeem({
        code: "T4CAT",
        userId: "u",
        subtotal: 10000,
        currency: "KRW",
        context: { categoryId: "books" },
      })
    ).rejects.toBeInstanceOf(IneligibleCategoryError);
  });

  it("empty eligibility allows everyone", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await client.coupons.create({
      code: "T4EMPTY",
      discount: { kind: "PERCENT", percent: 10 },
    });
    const v = await client.validate({ code: "T4EMPTY", userId: "anyone" });
    expect(v.ok).toBe(true);
  });
});
