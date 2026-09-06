import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InvalidModelNameError,
  createCouponClient,
} from "../../src/index.js";
import type { PrismaLike, PrismaTxLike } from "../../src/domain/types.js";
import {
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

/**
 * T-16: a consumer whose own schema already owns `Campaign` (or any other
 * fragment model) renames the models and declares the mapping.
 *
 * The test DB keeps the default schema, so the rename is simulated by exposing
 * the real delegates under different property names — and *only* under those
 * names. Any code path that still reached for `prisma.coupon` would raise
 * InvalidModelNameError instead of silently working, which is exactly the
 * regression this suite guards.
 */

const RENAMED = {
  coupon: "cpnCoupon",
  campaign: "cpnCampaign",
  couponIssuance: "cpnIssuance",
  couponRedemption: "cpnRedemption",
  couponAuditLog: "cpnAuditLog",
} as const;

/** The physical tables are unchanged, so the raw-SQL lock needs the real names. */
const REAL_TABLES = {
  coupon: "Coupon",
  campaign: "Campaign",
  couponIssuance: "CouponIssuance",
  couponRedemption: "CouponRedemption",
  couponAuditLog: "CouponAuditLog",
} as const;

type AnyHandle = Record<string, unknown>;

/** Re-expose a client/transaction handle under the renamed delegates only. */
function renameHandle(handle: AnyHandle): AnyHandle {
  const out: AnyHandle = {
    $queryRaw: (...args: unknown[]) =>
      (handle.$queryRaw as (...a: unknown[]) => unknown).apply(handle, args),
  };
  for (const [original, alias] of Object.entries(RENAMED)) {
    out[alias] = handle[original];
  }
  return out;
}

function renamedClient(root: AnyHandle): PrismaLike {
  const wrapped = renameHandle(root);
  wrapped.$transaction = (
    fn: (tx: PrismaTxLike) => Promise<unknown>,
    options?: unknown
  ) =>
    (root.$transaction as (f: unknown, o?: unknown) => Promise<unknown>).call(
      root,
      (tx: AnyHandle) => fn(renameHandle(tx) as unknown as PrismaTxLike),
      options
    );
  return wrapped as unknown as PrismaLike;
}

describe("T-16 custom model names: renamed delegates drive every code path", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t16");

  const makeClient = (overrides: Record<string, unknown> = {}) =>
    createCouponClient({
      prisma: renamedClient(prisma as unknown as AnyHandle),
      defaultTenantId: tenantId,
      models: { ...RENAMED },
      tables: { ...REAL_TABLES },
      ...overrides,
    });

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("create -> issue -> validate -> redeem works end to end under renamed delegates", async () => {
    const client = makeClient();

    const coupon = await client.coupons.create({
      code: "T16RENAME",
      discount: { kind: "FIXED", amount: 1500, currency: "KRW" },
      maxRedemptions: 2,
      actorId: "actor-16",
    });
    expect(coupon.code).toBe("T16RENAME");

    const issuance = await client.coupons.issue({
      couponId: coupon.id,
      issuedToUserId: "u16",
    });
    expect(issuance.couponId).toBe(coupon.id);
    expect(issuance.issuedToUserId).toBe("u16");

    const validation = await client.validate({
      code: "T16RENAME",
      userId: "u16",
      subtotal: 10000,
      currency: "KRW",
    });
    expect(validation.ok).toBe(true);

    // redeem() is the path that also exercises the raw-SQL row lock.
    const result = await client.redeem({
      code: "T16RENAME",
      userId: "u16",
      orderRef: "ord-16",
      subtotal: 10000,
      currency: "KRW",
    });
    expect(result.discount.discountAmount).toBe(1500);
    expect(result.coupon.redeemedCount).toBe(1);
  });

  it("lists and audit logs read through the renamed delegates", async () => {
    const client = makeClient();

    const coupons = await client.coupons.list({ limit: 10 });
    expect(coupons.items.some((c) => c.code === "T16RENAME")).toBe(true);

    const redemptions = await client.audit.listRedemptions({ limit: 10 });
    expect(redemptions.items.some((r) => r.orderRef === "ord-16")).toBe(true);

    const issuances = await client.audit.listIssuances({ limit: 10 });
    expect(issuances.items.length).toBeGreaterThanOrEqual(1);

    const logs = await client.audit.listLogs({ limit: 50 });
    const actions = new Set(logs.items.map((l) => l.action));
    expect(actions.has("coupon.created")).toBe(true);
    expect(actions.has("coupon.redeemed")).toBe(true);
  });

  it("campaign issue works under a renamed campaign delegate", async () => {
    const client = makeClient();

    const campaign = await client.campaigns.create({
      name: "T16 campaign",
      discount: { kind: "PERCENT", percent: 20 },
      maxCoupons: 5,
    });
    const issued = await client.campaigns.issue({
      campaignId: campaign.id,
      count: 3,
      codeLength: 10,
    });
    expect(issued.created.length).toBe(3);

    const summary = await client.campaigns.summary({ id: campaign.id });
    expect(summary.issuedCount).toBe(3);
  });

  it("raises InvalidModelNameError when a declared delegate is missing", async () => {
    const client = createCouponClient({
      prisma: renamedClient(prisma as unknown as AnyHandle),
      defaultTenantId: tenantId,
      // `cpnCoupon` is what the handle actually exposes.
      models: { ...RENAMED, coupon: "notThere" },
      tables: { ...REAL_TABLES },
    });
    await expect(
      client.coupons.findByCode({ code: "T16RENAME" })
    ).rejects.toBeInstanceOf(InvalidModelNameError);
  });

  it("rejects a malformed model name while the client is being created", () => {
    expect(() =>
      createCouponClient({
        prisma: renamedClient(prisma as unknown as AnyHandle),
        defaultTenantId: tenantId,
        models: { coupon: 'Coupon"; DROP TABLE "Coupon' },
      })
    ).toThrow(InvalidModelNameError);
  });

  it("without the tables override the row lock targets a table that does not exist", async () => {
    const client = createCouponClient({
      prisma: renamedClient(prisma as unknown as AnyHandle),
      defaultTenantId: tenantId,
      models: { ...RENAMED },
      // tables omitted on purpose: it would derive "CpnCoupon", not "Coupon".
    });
    await client.coupons.create({
      code: "T16NOTABLE",
      discount: { kind: "FIXED", amount: 100, currency: "KRW" },
    });
    await expect(
      client.redeem({
        code: "T16NOTABLE",
        userId: "u16b",
        orderRef: "ord-16b",
        subtotal: 10000,
        currency: "KRW",
      })
    ).rejects.toThrow();
  });
});
