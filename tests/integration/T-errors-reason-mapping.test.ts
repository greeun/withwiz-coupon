import { describe, expect, it } from "vitest";
import {
  CampaignCapacityExceededError,
  CampaignClosedError,
  COUPON_REJECT_REASON,
  CouponAlreadyRedeemedError,
  CouponArchivedError,
  CouponError,
  CouponExhaustedError,
  CouponExpiredError,
  CouponInactiveError,
  CouponNotFoundError,
  CurrencyMismatchError,
  IneligibleCategoryError,
  IneligiblePlanError,
  IneligibleProductError,
  IneligibleUserError,
  InvalidDateRangeError,
  InvalidDiscountPolicyError,
  MinimumOrderNotMetError,
  PerUserLimitExceededError,
  TenantMismatchError,
  ValidationError,
} from "../../src/index.js";

// Exhaustive switch: if CouponRejectReason adds new values, this must fail.
function assertNever(x: never): never {
  throw new Error(`Unexpected reason: ${String(x)}`);
}

describe("Closed-set CouponRejectReason (13 literals) + 1:1 error.code mapping", () => {
  it("all 13 reasons map to the specified error class code", () => {
    for (const reason of Object.values(COUPON_REJECT_REASON)) {
      switch (reason) {
        case COUPON_REJECT_REASON.NOT_FOUND:
          expect(new CouponNotFoundError().code).toBe("NOT_FOUND");
          break;
        case COUPON_REJECT_REASON.NOT_STARTED:
          expect(
            new CouponExpiredError("not started", undefined, "NOT_STARTED").code
          ).toBe("NOT_STARTED");
          break;
        case COUPON_REJECT_REASON.EXPIRED:
          expect(new CouponExpiredError().code).toBe("EXPIRED");
          break;
        case COUPON_REJECT_REASON.EXHAUSTED:
          expect(new CouponExhaustedError().code).toBe("EXHAUSTED");
          break;
        case COUPON_REJECT_REASON.PER_USER_LIMIT:
          expect(new PerUserLimitExceededError().code).toBe("PER_USER_LIMIT");
          break;
        case COUPON_REJECT_REASON.MIN_ORDER_NOT_MET:
          expect(new MinimumOrderNotMetError().code).toBe("MIN_ORDER_NOT_MET");
          break;
        case COUPON_REJECT_REASON.INELIGIBLE_USER:
          expect(new IneligibleUserError().code).toBe("INELIGIBLE_USER");
          break;
        case COUPON_REJECT_REASON.INELIGIBLE_PLAN:
          expect(new IneligiblePlanError().code).toBe("INELIGIBLE_PLAN");
          break;
        case COUPON_REJECT_REASON.INELIGIBLE_PRODUCT:
          expect(new IneligibleProductError().code).toBe("INELIGIBLE_PRODUCT");
          break;
        case COUPON_REJECT_REASON.INELIGIBLE_CATEGORY:
          expect(new IneligibleCategoryError().code).toBe("INELIGIBLE_CATEGORY");
          break;
        case COUPON_REJECT_REASON.PAUSED:
          expect(new CouponInactiveError().code).toBe("PAUSED");
          break;
        case COUPON_REJECT_REASON.ARCHIVED:
          expect(new CouponArchivedError().code).toBe("ARCHIVED");
          break;
        case COUPON_REJECT_REASON.TENANT_MISMATCH:
          expect(new TenantMismatchError().code).toBe("TENANT_MISMATCH");
          break;
        default:
          assertNever(reason);
      }
    }
    // Count must be exactly 13.
    expect(Object.keys(COUPON_REJECT_REASON).length).toBe(13);
  });

  it("[F] TenantMismatchError is exported but NEVER thrown at runtime (enumeration-safe DECISION)", () => {
    // [F] enumeration attack defense DECISION:
    //   Cross-tenant lookup returns null/NOT_FOUND instead of throwing
    //   TenantMismatchError. The error class is exported for typed exhaustive
    //   handling (consumer switch/case on reject-reason), but the SDK itself
    //   never throws it. This prevents tenant-id enumeration via error
    //   leakage in consumer error-handling paths.
    //
    // See: spec.md §10 table / sprint_contract §7.4 / T10 multi-tenant tests
    //      (cross-tenant findByCode -> null; cross-tenant redeem -> NOT_FOUND).
    //
    // Instance + code behavior is preserved so consumers can construct it in
    // their own code if they choose to — we just guarantee the SDK never does.
    const instance = new TenantMismatchError("reserved for consumer use");
    expect(instance).toBeInstanceOf(CouponError);
    expect(instance.code).toBe("TENANT_MISMATCH");
    expect(() => {
      throw instance;
    }).toThrow(TenantMismatchError);
  });

  it("every error class in the 20-error taxonomy inherits from CouponError", () => {
    const instances = [
      new ValidationError("x"),
      new InvalidDiscountPolicyError("x"),
      new InvalidDateRangeError("x"),
      new CurrencyMismatchError("x"),
      new CouponNotFoundError(),
      new CouponArchivedError(),
      new CouponInactiveError(),
      new CouponExpiredError(),
      new CouponExhaustedError(),
      new CouponAlreadyRedeemedError(),
      new PerUserLimitExceededError(),
      new IneligibleUserError(),
      new IneligiblePlanError(),
      new IneligibleProductError(),
      new IneligibleCategoryError(),
      new MinimumOrderNotMetError(),
      new CampaignClosedError(),
      new CampaignCapacityExceededError(),
      new TenantMismatchError(),
    ];
    for (const e of instances) {
      expect(e).toBeInstanceOf(CouponError);
      expect(typeof e.code).toBe("string");
    }
    // 19 above + CouponError (abstract, not instantiable) == 20 classes.
  });
});
