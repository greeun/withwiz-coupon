import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  CouponAlreadyRedeemedError,
  CouponError,
  CouponExhaustedError,
  createCouponClient,
} from "@withwiz/coupon";

const SCHEMA = "consumer_prisma7";
const DATABASE_URL =
  process.env.DATABASE_URL ??
  `postgresql://postgres:postgres@localhost:13011/coupon_test?schema=${SCHEMA}`;

// Same setup as a Prisma 7 app: no engine URL, the driver adapter owns the connection.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }, { schema: SCHEMA }),
});
const TENANT = "prisma7-app";
type P = Parameters<typeof createCouponClient>[0]["prisma"];
const coupon = createCouponClient({
  prisma: prisma as unknown as P,
  defaultTenantId: TENANT,
  models: { campaign: "couponCampaign" },
  // The row lock is raw SQL; under a driver adapter it does not inherit the
  // datasource schema, so name it (see README "Schema Setup").
  schema: SCHEMA,
});

async function clean() {
  await prisma.couponRedemption.deleteMany({ where: { tenantId: TENANT } });
  await prisma.couponAuditLog.deleteMany({ where: { tenantId: TENANT } });
  await prisma.coupon.deleteMany({ where: { tenantId: TENANT } });
  await prisma.couponCampaign.deleteMany({ where: { tenantId: TENANT } });
  await prisma.consumerOrder.deleteMany({ where: { tenantId: TENANT } });
}

describe("Prisma 7 driver adapter", () => {
  beforeAll(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("race on maxRedemptions=1 yields exactly one success", async () => {
    await coupon.coupons.create({
      code: "P7RACE",
      discount: { kind: "FIXED", amount: 100, currency: "USD" },
      maxRedemptions: 1,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        coupon.redeem({ code: "P7RACE", userId: `org_${i}`, orderRef: `o_${i}`, subtotal: 1000, currency: "USD" })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(CouponExhaustedError);
  });

  it("duplicate (coupon, user, orderRef) maps to CouponAlreadyRedeemedError", async () => {
    await coupon.coupons.create({ code: "P7DUP", discount: { kind: "FIXED", amount: 100, currency: "USD" } });
    await coupon.redeem({ code: "P7DUP", userId: "org_a", orderRef: "sub_a", subtotal: 1000, currency: "USD" });
    await expect(
      coupon.redeem({ code: "P7DUP", userId: "org_a", orderRef: "sub_a", subtotal: 1000, currency: "USD" })
    ).rejects.toBeInstanceOf(CouponAlreadyRedeemedError);
  });

  it("redeem piggybacks on an interactive transaction and rolls back with it", async () => {
    await coupon.coupons.create({
      code: "P7TX",
      discount: { kind: "FIXED", amount: 100, currency: "USD" },
      maxRedemptions: 1,
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.consumerOrder.create({ data: { tenantId: TENANT, amount: 1000 } });
        await coupon.redeem({
          code: "P7TX",
          userId: "org_t",
          orderRef: "o_t",
          subtotal: 1000,
          currency: "USD",
          tx: tx as never,
        });
        throw new Error("rollback");
      })
    ).rejects.toThrow("rollback");
    const again = await coupon.validate({ code: "P7TX", userId: "org_t", subtotal: 1000, currency: "USD" });
    expect(again.ok).toBe(true);
    expect(await prisma.consumerOrder.count({ where: { tenantId: TENANT } })).toBe(0);
  });

  it("duplicate code on create surfaces as a CouponError under the adapter", async () => {
    await coupon.coupons.create({ code: "P7CODE", discount: { kind: "FIXED", amount: 100, currency: "USD" } });
    await expect(
      coupon.coupons.create({ code: "P7CODE", discount: { kind: "FIXED", amount: 100, currency: "USD" } })
    ).rejects.toBeInstanceOf(CouponError);
  });
});
