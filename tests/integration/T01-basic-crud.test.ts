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

  it("cursor pagination drops/duplicates nothing when the sort key ties", async () => {
    const t = freshTenantId("t1c");
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
    });
    await client.coupons.issueBulk({
      count: 25,
      codeLength: 8,
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
    });
    // issueBulk already produces createdAt ties, but only lands one on the
    // page boundary by chance. Collapse every row onto a single timestamp so
    // the boundary tie is guaranteed and the assertion is deterministic.
    await prisma.coupon.updateMany({
      where: { tenantId: t },
      data: { createdAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res: Awaited<ReturnType<typeof client.coupons.list>> =
        await client.coupons.list(
          cursor === null ? { limit: 10 } : { limit: 10, cursor }
        );
      seen.push(...res.items.map((c) => c.id));
      if (res.nextCursor === null) break;
      cursor = res.nextCursor;
    }
    expect(seen.length).toBe(25); // nothing dropped
    expect(new Set(seen).size).toBe(25); // nothing duplicated
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
