import { describe, expect, it } from "vitest";
import {
  rowToAuditLog,
  rowToCampaign,
  rowToCoupon,
  rowToIssuance,
  rowToRedemption,
} from "../../src/mapping.js";

describe("mapping unit", () => {
  const baseDate = new Date();

  it("rowToCoupon with string dates", () => {
    const c = rowToCoupon({
      id: "c1",
      tenantId: "t1",
      campaignId: null,
      code: "ABC",
      status: "ACTIVE",
      discount: { kind: "PERCENT", percent: 10 },
      startsAt: baseDate.toISOString(),
      endsAt: null,
      maxRedemptions: null,
      redeemedCount: 0,
      maxRedemptionsPerUser: null,
      eligibility: {},
      metadata: null,
      createdAt: baseDate.toISOString(),
      updatedAt: baseDate,
    });
    expect(c.id).toBe("c1");
    expect(c.startsAt).toBeInstanceOf(Date);
  });

  it("rowToCampaign / rowToIssuance / rowToRedemption / rowToAuditLog", () => {
    const camp = rowToCampaign({
      id: "cmp1",
      tenantId: "t",
      name: "N",
      status: "ACTIVE",
      discount: { kind: "PERCENT", percent: 5 },
      eligibility: {},
      startsAt: null,
      endsAt: null,
      maxCoupons: null,
      issuedCount: 0,
      metadata: null,
      createdAt: baseDate,
      updatedAt: baseDate,
    });
    expect(camp.status).toBe("ACTIVE");

    const iss = rowToIssuance({
      id: "i1",
      tenantId: "t",
      couponId: "c",
      issuedToUserId: null,
      issuedBy: null,
      issuedAt: baseDate,
      metadata: null,
    });
    expect(iss.couponId).toBe("c");

    const red = rowToRedemption({
      id: "r1",
      tenantId: "t",
      couponId: "c",
      redeemedByUserId: null,
      orderRef: null,
      discountAmount: 500,
      currency: "KRW",
      redeemedAt: baseDate,
      metadata: null,
    });
    expect(red.discountAmount).toBe(500);

    const log = rowToAuditLog({
      id: "l1",
      tenantId: "t",
      action: "coupon.created",
      resourceId: null,
      resourceType: null,
      actorId: null,
      details: null,
      createdAt: baseDate,
    });
    expect(log.action).toBe("coupon.created");
  });
});
