import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CampaignCapacityExceededError,
  CampaignClosedError,
  createCouponClient,
} from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-12 Campaign: maxCoupons, close, summary", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t12");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("maxCoupons=10, issuing 11th rejects with CampaignCapacityExceededError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const camp = await client.campaigns.create({
      name: "CAMP-10",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxCoupons: 10,
    });
    for (let i = 0; i < 10; i++) {
      await client.campaigns.issue({ campaignId: camp.id, count: 1, codeLength: 9 });
    }
    await expect(
      client.campaigns.issue({ campaignId: camp.id, count: 1, codeLength: 9 })
    ).rejects.toBeInstanceOf(CampaignCapacityExceededError);
  });

  it("closed campaign rejects issue with CampaignClosedError", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const camp = await client.campaigns.create({
      name: "CAMP-CLOSE",
      discount: { kind: "FIXED", amount: 500, currency: "KRW" },
      maxCoupons: 5,
    });
    await client.campaigns.close({ id: camp.id });
    await expect(
      client.campaigns.issue({ campaignId: camp.id, count: 1, codeLength: 9 })
    ).rejects.toBeInstanceOf(CampaignClosedError);
  });

  it("I4: concurrent issue(count=1)×100 with maxCoupons=10 never exceeds cap", async () => {
    // spec.md §5.5 I4 runtime invariant: Campaign.issuedCount <= Campaign.maxCoupons.
    // Dispatches 100 parallel issue() calls against a single campaign with
    // maxCoupons=10. Must yield exactly 10 fulfilled promises and DB state
    // must show issuedCount === 10 and exactly 10 Coupon rows tied to it.
    const t = freshTenantId("t12-concurrent");
    await truncateTenant(prisma, t);
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: t,
    });
    const campaign = await client.campaigns.create({
      name: "CAMP-CONCURRENT",
      discount: { kind: "FIXED", amount: 1000, currency: "KRW" },
      maxCoupons: 10,
    });

    const N = 100;
    const results = await Promise.allSettled(
      Array.from({ length: N }).map(() =>
        client.campaigns.issue({
          campaignId: campaign.id,
          count: 1,
          codeLength: 9,
        })
      )
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toBe(10);
    expect(rejected.length).toBe(N - 10);
    // All rejections must be CampaignCapacityExceededError.
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(CampaignCapacityExceededError);
      }
    }

    // DB assertions — the critical invariant.
    const db = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    expect(db?.issuedCount).toBe(10);
    const rows = await prisma.coupon.count({
      where: { campaignId: campaign.id, tenantId: t },
    });
    expect(rows).toBe(10);

    await truncateTenant(prisma, t);
  });

  it("summary fields match DB aggregation", async () => {
    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
    });
    const camp = await client.campaigns.create({
      name: "CAMP-SUM",
      discount: { kind: "FIXED", amount: 700, currency: "KRW" },
      maxCoupons: 5,
    });
    const issued = await client.campaigns.issue({ campaignId: camp.id, count: 3, codeLength: 9 });
    expect(issued.created.length).toBe(3);

    // Redeem 2 out of 3
    const [c1, c2] = issued.created;
    await client.redeem({
      code: c1.code,
      userId: "u1",
      orderRef: "ord1",
      subtotal: 10000,
      currency: "KRW",
    });
    await client.redeem({
      code: c2.code,
      userId: "u2",
      orderRef: "ord2",
      subtotal: 20000,
      currency: "KRW",
    });

    const s = await client.campaigns.summary({ id: camp.id });
    expect(s.issuedCount).toBe(3);
    expect(s.redeemedCount).toBe(2);
    expect(s.remaining).toBe(2);
    expect(s.totalDiscount).toBe(1400);
    expect(s.uniqueUsers).toBe(2);
    expect(s.lastRedeemedAt).not.toBeNull();
  });
});
