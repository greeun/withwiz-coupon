// Public entry for @withwiz/coupon.

export { createCouponClient } from "./client.js";
export type { CouponClient, CouponClientConfig } from "./client.js";

export { calculate as calculateDiscount, validateDiscountPolicy } from "./discount.js";

// --- Domain constants / enums / reason union ---
export {
  COUPON_STATUS,
  CAMPAIGN_STATUS,
  COUPON_REJECT_REASON,
  AUDIT_ACTION,
  LIMITS,
} from "./domain/constants.js";
export type {
  CouponStatus,
  CampaignStatus,
  CouponRejectReason,
  AuditAction,
} from "./domain/constants.js";

// --- Domain DTO types ---
export type {
  Coupon,
  Campaign,
  Issuance,
  Redemption,
  AuditLog,
  DiscountPolicy,
  EligibilityRules,
  DiscountInput,
  DiscountBreakdown,
  ValidateInput,
  ValidateContext,
  ValidationResult,
  RedeemInput,
  RedemptionResult,
  CreateCouponInput,
  IssueCouponInput,
  IssueBulkInput,
  BulkIssuanceResult,
  CreateCampaignInput,
  CampaignIssueArgs,
  CampaignSummary,
  ListCouponsArgs,
  ListCampaignsArgs,
  ListIssuancesArgs,
  ListRedemptionsArgs,
  ListAuditLogsArgs,
  Paged,
  CouponEvent,
  CouponEventHandler,
  CouponLogger,
  PrismaLike,
  PrismaTxLike,
} from "./domain/types.js";

// --- Errors ---
export {
  CouponError,
  ValidationError,
  InvalidDiscountPolicyError,
  InvalidDateRangeError,
  CurrencyMismatchError,
  CouponNotFoundError,
  CouponArchivedError,
  CouponInactiveError,
  CouponExpiredError,
  CouponExhaustedError,
  CouponAlreadyRedeemedError,
  PerUserLimitExceededError,
  IneligibleUserError,
  IneligiblePlanError,
  IneligibleProductError,
  IneligibleCategoryError,
  MinimumOrderNotMetError,
  CampaignClosedError,
  CampaignCapacityExceededError,
  TenantMismatchError,
} from "./domain/errors.js";
