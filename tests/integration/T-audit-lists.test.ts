import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("audit.listIssuances / listRedemptions cover", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("taudit");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("listIssuances filters by couponId and issuedToUserId", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "AUDITCODE",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    await client.coupons.issue({
      couponId: c.id,
      issuedToUserId: "u-a",
      issuedBy: "admin",
    });
    await client.coupons.issue({
      couponId: c.id,
      issuedToUserId: "u-b",
    });
    const allIss = await client.audit.listIssuances({ couponId: c.id });
    expect(allIss.items.length).toBe(2);
    const byUser = await client.audit.listIssuances({
      couponId: c.id,
      issuedToUserId: "u-a",
    });
    expect(byUser.items.length).toBe(1);
  });

  it("listRedemptions filters by couponId and redeemedByUserId", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const c = await client.coupons.create({
      code: "AUDITREDEEM",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
    });
    await client.redeem({
      code: "AUDITREDEEM",
      userId: "uA",
      orderRef: "oA",
      subtotal: 10000,
      currency: "KRW",
    });
    await client.redeem({
      code: "AUDITREDEEM",
      userId: "uB",
      orderRef: "oB",
      subtotal: 10000,
      currency: "KRW",
    });
    const all = await client.audit.listRedemptions({ couponId: c.id });
    expect(all.items.length).toBe(2);
    const byUser = await client.audit.listRedemptions({ redeemedByUserId: "uA" });
    expect(byUser.items.some((r) => r.redeemedByUserId === "uA")).toBe(true);
  });

  it("listLogs filters by action / resourceType", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const logs = await client.audit.listLogs({ action: "coupon.created" });
    expect(logs.items.length).toBeGreaterThan(0);
    for (const l of logs.items) expect(l.action).toBe("coupon.created");

    const byRes = await client.audit.listLogs({ resourceType: "coupon" });
    expect(byRes.items.length).toBeGreaterThan(0);
  });

  it("campaigns.get / coupons.get work for known + unknown id", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const camp = await client.campaigns.create({
      name: "AUDITCAMP",
      discount: { kind: "PERCENT", percent: 10 },
    });
    const got = await client.campaigns.get({ id: camp.id });
    expect(got?.id).toBe(camp.id);
    const missing = await client.campaigns.get({ id: "does-not-exist" });
    expect(missing).toBeNull();

    const c = await client.coupons.create({
      code: "GETBY",
      discount: { kind: "PERCENT", percent: 5 },
    });
    const g = await client.coupons.get({ id: c.id });
    expect(g?.code).toBe("GETBY");
    const n = await client.coupons.get({ id: "no-such" });
    expect(n).toBeNull();
  });

  it("campaigns.list filters by status", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const camp = await client.campaigns.create({
      name: "CAMP-LIST-TEST",
      discount: { kind: "PERCENT", percent: 5 },
    });
    await client.campaigns.close({ id: camp.id });
    const listClosed = await client.campaigns.list({ status: "CLOSED" });
    expect(listClosed.items.some((c) => c.id === camp.id)).toBe(true);
    const active = await client.campaigns.list({ status: "ACTIVE" });
    expect(active.items.every((c) => c.id !== camp.id)).toBe(true);
  });
});
