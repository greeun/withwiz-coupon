import { describe, expect, it } from "vitest";
import {
  calculateDiscount,
  InvalidDiscountPolicyError,
  validateDiscountPolicy,
  ValidationError,
} from "../../src/index.js";

describe("discount unit: edge cases", () => {
  it("rejects non-object policy", () => {
    expect(() => validateDiscountPolicy(null as never)).toThrow(
      InvalidDiscountPolicyError
    );
    expect(() =>
      validateDiscountPolicy({ kind: "UNKNOWN" } as unknown as Parameters<typeof validateDiscountPolicy>[0])
    ).toThrow(InvalidDiscountPolicyError);
  });

  it("PERCENT.maxDiscount non-integer rejected", () => {
    expect(() =>
      validateDiscountPolicy({
        kind: "PERCENT",
        percent: 10,
        maxDiscount: 3.14 as unknown as number,
      })
    ).toThrow(InvalidDiscountPolicyError);
    expect(() =>
      validateDiscountPolicy({
        kind: "PERCENT",
        percent: 10,
        maxDiscount: -1,
      })
    ).toThrow(InvalidDiscountPolicyError);
  });

  it("PERCENT.minOrder negative rejected", () => {
    expect(() =>
      validateDiscountPolicy({ kind: "PERCENT", percent: 10, minOrder: -1 })
    ).toThrow(InvalidDiscountPolicyError);
  });

  it("PERCENT.currency wrong length rejected", () => {
    expect(() =>
      validateDiscountPolicy({ kind: "PERCENT", percent: 10, currency: "KR" as unknown as string })
    ).toThrow(ValidationError);
  });

  it("FIXED.minOrder negative rejected", () => {
    expect(() =>
      validateDiscountPolicy({
        kind: "FIXED",
        amount: 100,
        currency: "KRW",
        minOrder: -1,
      })
    ).toThrow(InvalidDiscountPolicyError);
  });

  it("calculate: throws on non-object input", () => {
    expect(() =>
      calculateDiscount(null as unknown as Parameters<typeof calculateDiscount>[0])
    ).toThrow(ValidationError);
  });

  it("calculate: subtotal negative rejected", () => {
    expect(() =>
      calculateDiscount({
        subtotal: -1,
        currency: "KRW",
        policy: { kind: "PERCENT", percent: 10 },
      })
    ).toThrow(ValidationError);
  });

  it("calculate: PERCENT without maxDiscount", () => {
    const r = calculateDiscount({
      subtotal: 20000,
      currency: "KRW",
      policy: { kind: "PERCENT", percent: 10 },
    });
    expect(r.discountAmount).toBe(2000);
    expect(r.total).toBe(18000);
  });
});
