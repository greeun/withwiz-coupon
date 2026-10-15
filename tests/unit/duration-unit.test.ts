import { describe, expect, it } from "vitest";
import {
  InvalidDiscountPolicyError,
  LIMITS,
  resolveDuration,
  validateDiscountPolicy,
  calculateDiscount,
} from "../../src/index.js";
import { discountPolicySchema } from "../../src/validators.js";

describe("discount duration", () => {
  it("defaults to ONCE when absent", () => {
    expect(resolveDuration({ kind: "PERCENT", percent: 10 })).toEqual({ kind: "ONCE" });
  });

  it("returns declared duration", () => {
    expect(
      resolveDuration({ kind: "FIXED", amount: 100, currency: "USD", duration: { kind: "REPEATING", months: 3 } })
    ).toEqual({ kind: "REPEATING", months: 3 });
  });

  it("accepts ONCE, FOREVER and REPEATING within range on both kinds", () => {
    for (const duration of [
      { kind: "ONCE" as const },
      { kind: "FOREVER" as const },
      { kind: "REPEATING" as const, months: 1 },
      { kind: "REPEATING" as const, months: LIMITS.DURATION_MAX_MONTHS },
    ]) {
      expect(() => validateDiscountPolicy({ kind: "PERCENT", percent: 10, duration })).not.toThrow();
      expect(() => validateDiscountPolicy({ kind: "FIXED", amount: 1, currency: "USD", duration })).not.toThrow();
    }
  });

  it("rejects REPEATING months out of range or non-integer", () => {
    for (const months of [0, -1, LIMITS.DURATION_MAX_MONTHS + 1, 1.5, Number.NaN]) {
      expect(() =>
        validateDiscountPolicy({ kind: "PERCENT", percent: 10, duration: { kind: "REPEATING", months } })
      ).toThrow(InvalidDiscountPolicyError);
    }
  });

  it("rejects unknown duration kind and non-object duration", () => {
    expect(() =>
      validateDiscountPolicy({ kind: "PERCENT", percent: 10, duration: { kind: "WEEKLY" } as never })
    ).toThrow(InvalidDiscountPolicyError);
    expect(() =>
      validateDiscountPolicy({ kind: "PERCENT", percent: 10, duration: "ONCE" as never })
    ).toThrow(InvalidDiscountPolicyError);
  });

  it("calculateDiscount keeps duration in appliedPolicy", () => {
    const r = calculateDiscount({
      subtotal: 1000,
      currency: "USD",
      policy: { kind: "PERCENT", percent: 20, duration: { kind: "REPEATING", months: 3 } },
    });
    expect(r.discountAmount).toBe(200);
    expect(r.appliedPolicy.duration).toEqual({ kind: "REPEATING", months: 3 });
  });

  it("zod schema accepts duration and rejects bad months", () => {
    expect(
      discountPolicySchema.safeParse({ kind: "FIXED", amount: 5, currency: "USD", duration: { kind: "FOREVER" } }).success
    ).toBe(true);
    expect(
      discountPolicySchema.safeParse({ kind: "PERCENT", percent: 5, duration: { kind: "REPEATING", months: 37 } }).success
    ).toBe(false);
  });
});
