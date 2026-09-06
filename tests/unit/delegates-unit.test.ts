import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL_NAMES,
  createDelegateResolver,
  lockCouponRow,
  resolveModelNames,
  resolveTableNames,
} from "../../src/delegates.js";
import { InvalidModelNameError } from "../../src/domain/errors.js";
import type { DelegateLike, PrismaTxLike } from "../../src/domain/types.js";

function fakeDelegate(): DelegateLike {
  return {
    findFirst: async () => null,
    findUnique: async () => null,
    findMany: async () => [],
    create: async () => ({}),
    createMany: async () => ({ count: 0 }),
    update: async () => ({}),
    updateMany: async () => ({ count: 0 }),
    count: async () => 0,
  };
}

describe("resolveModelNames", () => {
  it("returns the fragment defaults when nothing is overridden", () => {
    expect(resolveModelNames()).toEqual(DEFAULT_MODEL_NAMES);
    expect(resolveModelNames({})).toEqual(DEFAULT_MODEL_NAMES);
  });

  it("applies a partial override and leaves the rest at their defaults", () => {
    const names = resolveModelNames({ campaign: "couponCampaign" });
    expect(names.campaign).toBe("couponCampaign");
    expect(names.coupon).toBe("coupon");
    expect(names.couponAuditLog).toBe("couponAuditLog");
  });

  it("does not mutate DEFAULT_MODEL_NAMES", () => {
    resolveModelNames({ coupon: "somethingElse" });
    expect(DEFAULT_MODEL_NAMES.coupon).toBe("coupon");
  });

  it.each([
    ["empty", ""],
    ["leading digit", "1coupon"],
    ["dash", "coupon-table"],
    ["space", "coupon table"],
    ["quote", 'coupon"'],
    ["sql injection attempt", 'Coupon"; DROP TABLE "Coupon'],
  ])("rejects a %s model name", (_label, value) => {
    expect(() => resolveModelNames({ coupon: value })).toThrow(InvalidModelNameError);
  });
});

describe("resolveTableNames", () => {
  it("capitalizes each delegate name, matching Prisma's default mapping", () => {
    const tables = resolveTableNames(DEFAULT_MODEL_NAMES);
    expect(tables.coupon).toBe("Coupon");
    expect(tables.couponAuditLog).toBe("CouponAuditLog");
  });

  it("derives from the renamed delegate, not from the default", () => {
    const models = resolveModelNames({ coupon: "cpnCoupon" });
    expect(resolveTableNames(models).coupon).toBe("CpnCoupon");
  });

  it("prefers an explicit override, for schemas that use @@map", () => {
    const tables = resolveTableNames(DEFAULT_MODEL_NAMES, { coupon: "coupons" });
    expect(tables.coupon).toBe("coupons");
    // untouched keys still derive from the delegate name
    expect(tables.campaign).toBe("Campaign");
  });

  it("rejects a table name that is not a plain identifier", () => {
    expect(() =>
      resolveTableNames(DEFAULT_MODEL_NAMES, { coupon: 'Coupon" WHERE 1=1 --' })
    ).toThrow(InvalidModelNameError);
  });
});

describe("createDelegateResolver", () => {
  const models = resolveModelNames({ coupon: "cpnCoupon" });
  const tables = resolveTableNames(models);

  it("resolves a delegate by its configured name", () => {
    const resolver = createDelegateResolver(models, tables);
    const delegate = fakeDelegate();
    const db = { cpnCoupon: delegate } as unknown as PrismaTxLike;
    expect(resolver.coupon(db)).toBe(delegate);
  });

  it("resolves against the handle passed at call time, not a captured one", () => {
    const resolver = createDelegateResolver(models, tables);
    const rootDelegate = fakeDelegate();
    const txDelegate = fakeDelegate();
    const root = { cpnCoupon: rootDelegate } as unknown as PrismaTxLike;
    const tx = { cpnCoupon: txDelegate } as unknown as PrismaTxLike;
    expect(resolver.coupon(root)).toBe(rootDelegate);
    expect(resolver.coupon(tx)).toBe(txDelegate);
  });

  it("raises InvalidModelNameError when the delegate is absent", () => {
    const resolver = createDelegateResolver(models, tables);
    const db = { coupon: fakeDelegate() } as unknown as PrismaTxLike;
    // The client was told the delegate is `cpnCoupon`, so the default-named
    // one must not be picked up silently.
    expect(() => resolver.coupon(db)).toThrow(InvalidModelNameError);
    expect(() => resolver.coupon(db)).toThrow(/cpnCoupon/);
  });

  it("raises InvalidModelNameError when the property is not a delegate", () => {
    const resolver = createDelegateResolver(models, tables);
    const db = { cpnCoupon: { findFirst: "not a function" } } as unknown as PrismaTxLike;
    expect(() => resolver.coupon(db)).toThrow(InvalidModelNameError);
  });

  it("exposes the resolved names for diagnostics", () => {
    const resolver = createDelegateResolver(models, tables);
    expect(resolver.models.coupon).toBe("cpnCoupon");
    expect(resolver.tables.coupon).toBe("CpnCoupon");
  });
});

describe("lockCouponRow", () => {
  it("interpolates only the table name and keeps id/tenantId parameterized", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: queryRaw } as unknown as PrismaTxLike;

    await lockCouponRow(tx, "coupons", "coupon-1", "tenant-1");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0];
    expect(strings.join("?")).toBe(
      'SELECT * FROM "coupons" WHERE "id" = ? AND "tenantId" = ? FOR UPDATE'
    );
    // A tagged template needs `raw` to line up with the cooked strings.
    expect(strings.raw).toEqual([...strings]);
    expect(values).toEqual(["coupon-1", "tenant-1"]);
  });

  it("returns the rows the query produced", async () => {
    const rows = [{ id: "coupon-1" }];
    const tx = { $queryRaw: vi.fn().mockResolvedValue(rows) } as unknown as PrismaTxLike;
    await expect(lockCouponRow(tx, "Coupon", "coupon-1", "tenant-1")).resolves.toBe(rows);
  });
});
