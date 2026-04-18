import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-1 basic CRUD + pagination + idGenerator override", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t1");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterEach(async () => {});
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("create -> findByCode returns same object (id, code equal)", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const created = await client.coupons.create({
      code: "WELCOME10",
      discount: { kind: "PERCENT", percent: 10 },
    });
    expect(created.code).toBe("WELCOME10");
    expect(typeof created.id).toBe("string");

    const fetched = await client.coupons.findByCode({ code: "welcome10" });
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.code).toBe(created.code);
  });

  it("list returns Paged<Coupon> with items[] and nullable nextCursor", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const page = await client.coupons.list({ limit: 10 });
    expect(Array.isArray(page.items)).toBe(true);
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    // nextCursor is either a string or null.
    expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
  });

  it("bulk issue + cursor-based pagination yields distinct pages", async () => {
    const t = freshTenantId("t1b");
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
    });
    await client.coupons.issueBulk({
      count: 25,
      codeLength: 8,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });
    const p1 = await client.coupons.list({ limit: 10 });
    expect(p1.items.length).toBe(10);
    expect(p1.nextCursor).not.toBeNull();

    const p2 = await client.coupons.list({ limit: 10, cursor: p1.nextCursor! });
    expect(p2.items.length).toBe(10);
    const ids1 = new Set(p1.items.map((c) => c.id));
    const ids2 = new Set(p2.items.map((c) => c.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
    await truncateTenant(prisma, t);
  });

  it("pagination limit > max (200) throws ValidationError [K]", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    await expect(
      client.coupons.list({ limit: 10_000 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
