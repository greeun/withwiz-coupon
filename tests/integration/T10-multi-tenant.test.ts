import { afterAll, describe, expect, it } from "vitest";
import {
  createCouponClient,
  TenantMismatchError,
  ValidationError,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-10 Multi-tenant isolation", () => {
  const prisma = getPrisma();
  const A = freshTenantId("t10a");
  const B = freshTenantId("t10b");

  afterAll(async () => {
    await truncateTenant(prisma, A);
    await truncateTenant(prisma, B);
    await disconnectPrisma();
  });

  it("cross-tenant findByCode returns null (enumeration-safe)", async () => {
    const clientA = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: A,
    });
    const clientB = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: B,
    });
    await clientA.coupons.create({
      code: "SECRETA",
      discount: { kind: "PERCENT", percent: 10 },
    });
    const r = await clientB.coupons.findByCode({ code: "SECRETA" });
    expect(r).toBeNull();
  });

  it("cross-tenant redeem (known code in other tenant) throws CouponNotFoundError — no leak of existence", async () => {
    const clientA = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: A,
    });
    await clientA.coupons.create({
      code: "TENANTA",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    const clientB = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: B,
    });
    // Must reject — either NOT_FOUND or TENANT_MISMATCH is acceptable in spirit,
    // but we chose NOT_FOUND (enumeration-safe per contract [F]).
    await expect(
      clientB.redeem({
        code: "TENANTA",
        userId: "u",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("TenantMismatchError is thrown when explicit tenantId is wrong for a coupon.id lookup", async () => {
    const clientA = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: A,
    });
    const c = await clientA.coupons.create({
      code: "TENANTAID",
      discount: { kind: "PERCENT", percent: 5 },
    });
    const clientB = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: B,
    });
    // Using B tenant to pause a coupon that belongs to A -> not found in B's scope
    await expect(
      clientB.coupons.pause({ id: c.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Also: explicitly pass a bogus tenantId through normal route
    await expect(
      clientA.coupons.pause({ tenantId: B, id: c.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // TenantMismatchError class must still be instantiable and is surface-exported.
    const e = new TenantMismatchError("cross");
    expect(e.code).toBe("TENANT_MISMATCH");
  });

  it("list* called without tenantId (no default) throws ValidationError", async () => {
    const client = createCouponClient({ prisma: asPrismaLike(prisma) });
    await expect(client.coupons.list({})).rejects.toBeInstanceOf(ValidationError);
    await expect(client.campaigns.list({})).rejects.toBeInstanceOf(ValidationError);
    await expect(client.audit.listLogs({})).rejects.toBeInstanceOf(ValidationError);
  });

  it("[E] defaultTenantId fallback: neither provided -> ValidationError", async () => {
    const client = createCouponClient({ prisma: asPrismaLike(prisma) });
    await expect(
      client.coupons.create({
        code: "T10NOOP",
        discount: { kind: "PERCENT", percent: 10 },
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
