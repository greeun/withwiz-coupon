/**
 * Error taxonomy for @withwiz/coupon.
 *
 * All errors extend CouponError. Each concrete subclass exposes a static
 * `code` string that matches the corresponding CouponRejectReason value
 * (where applicable — see sprint_contract.md §7.4).
 *
 * All messages are in English. i18n is a consumer concern.
 */

export interface CouponErrorContext {
  tenantId?: string;
  couponId?: string;
  couponCode?: string;
  cause?: unknown;
}

export abstract class CouponError extends Error {
  public readonly name: string;
  public readonly code: string;
  public readonly tenantId?: string;
  public readonly couponId?: string;
  public readonly couponCode?: string;
  public readonly cause?: unknown;

  protected constructor(message: string, code: string, ctx?: CouponErrorContext) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.tenantId = ctx?.tenantId;
    this.couponId = ctx?.couponId;
    this.couponCode = ctx?.couponCode;
    this.cause = ctx?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Validation family ------------------------------------------------------

export class ValidationError extends CouponError {
  public static readonly code = "VALIDATION_ERROR";
  public readonly details?: unknown;
  constructor(message: string, details?: unknown, ctx?: CouponErrorContext) {
    super(message, ValidationError.code, ctx);
    this.details = details;
  }
}

export class InvalidDiscountPolicyError extends CouponError {
  public static readonly code = "INVALID_DISCOUNT_POLICY";
  constructor(message: string, ctx?: CouponErrorContext) {
    super(message, InvalidDiscountPolicyError.code, ctx);
  }
}

export class InvalidDateRangeError extends CouponError {
  public static readonly code = "INVALID_DATE_RANGE";
  constructor(message: string, ctx?: CouponErrorContext) {
    super(message, InvalidDateRangeError.code, ctx);
  }
}

export class CurrencyMismatchError extends CouponError {
  public static readonly code = "CURRENCY_MISMATCH";
  constructor(message: string, ctx?: CouponErrorContext) {
    super(message, CurrencyMismatchError.code, ctx);
  }
}

// --- Coupon state family ----------------------------------------------------

export class CouponNotFoundError extends CouponError {
  public static readonly code = "NOT_FOUND";
  constructor(message = "Coupon not found", ctx?: CouponErrorContext) {
    super(message, CouponNotFoundError.code, ctx);
  }
}

export class CouponArchivedError extends CouponError {
  public static readonly code = "ARCHIVED";
  constructor(message = "Coupon is archived", ctx?: CouponErrorContext) {
    super(message, CouponArchivedError.code, ctx);
  }
}

export class CouponInactiveError extends CouponError {
  public static readonly code = "PAUSED";
  constructor(message = "Coupon is not active", ctx?: CouponErrorContext) {
    super(message, CouponInactiveError.code, ctx);
  }
}

export class CouponExpiredError extends CouponError {
  public static readonly code = "EXPIRED";
  constructor(message = "Coupon is expired", ctx?: CouponErrorContext, codeOverride?: "EXPIRED" | "NOT_STARTED") {
    super(message, codeOverride ?? CouponExpiredError.code, ctx);
    // Override runtime code if provided (for NOT_STARTED variant).
  }
}

export class CouponExhaustedError extends CouponError {
  public static readonly code = "EXHAUSTED";
  constructor(message = "Coupon fully redeemed", ctx?: CouponErrorContext) {
    super(message, CouponExhaustedError.code, ctx);
  }
}

export class CouponAlreadyRedeemedError extends CouponError {
  public static readonly code = "ALREADY_REDEEMED";
  constructor(message = "Coupon already redeemed for this order", ctx?: CouponErrorContext) {
    super(message, CouponAlreadyRedeemedError.code, ctx);
  }
}

export class PerUserLimitExceededError extends CouponError {
  public static readonly code = "PER_USER_LIMIT";
  constructor(message = "Per-user redemption limit exceeded", ctx?: CouponErrorContext) {
    super(message, PerUserLimitExceededError.code, ctx);
  }
}

// --- Eligibility family -----------------------------------------------------

export class IneligibleUserError extends CouponError {
  public static readonly code = "INELIGIBLE_USER";
  constructor(message = "User is not eligible for this coupon", ctx?: CouponErrorContext) {
    super(message, IneligibleUserError.code, ctx);
  }
}

export class IneligiblePlanError extends CouponError {
  public static readonly code = "INELIGIBLE_PLAN";
  constructor(message = "Plan is not eligible for this coupon", ctx?: CouponErrorContext) {
    super(message, IneligiblePlanError.code, ctx);
  }
}

export class IneligibleProductError extends CouponError {
  public static readonly code = "INELIGIBLE_PRODUCT";
  constructor(message = "Product is not eligible for this coupon", ctx?: CouponErrorContext) {
    super(message, IneligibleProductError.code, ctx);
  }
}

export class IneligibleCategoryError extends CouponError {
  public static readonly code = "INELIGIBLE_CATEGORY";
  constructor(message = "Category is not eligible for this coupon", ctx?: CouponErrorContext) {
    super(message, IneligibleCategoryError.code, ctx);
  }
}

export class MinimumOrderNotMetError extends CouponError {
  public static readonly code = "MIN_ORDER_NOT_MET";
  constructor(message = "Minimum order amount not met", ctx?: CouponErrorContext) {
    super(message, MinimumOrderNotMetError.code, ctx);
  }
}

// --- Campaign family --------------------------------------------------------

export class CampaignClosedError extends CouponError {
  public static readonly code = "CAMPAIGN_CLOSED";
  constructor(message = "Campaign is closed", ctx?: CouponErrorContext) {
    super(message, CampaignClosedError.code, ctx);
  }
}

export class CampaignCapacityExceededError extends CouponError {
  public static readonly code = "CAMPAIGN_CAPACITY_EXCEEDED";
  constructor(message = "Campaign capacity exceeded", ctx?: CouponErrorContext) {
    super(message, CampaignCapacityExceededError.code, ctx);
  }
}

// --- Multi-tenant guard -----------------------------------------------------

export class TenantMismatchError extends CouponError {
  public static readonly code = "TENANT_MISMATCH";
  constructor(message = "Tenant mismatch", ctx?: CouponErrorContext) {
    super(message, TenantMismatchError.code, ctx);
  }
}
