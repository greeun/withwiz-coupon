/**
 * Type-surface smoke test. Validated via `tsc --noEmit`.
 * (Not run by vitest — its filename intentionally excludes ".test.ts".)
 */

import {
  createCouponClient,
  COUPON_STATUS,
  COUPON_REJECT_REASON,
  AUDIT_ACTION,
  LIMITS,
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
} from "../src/index.js";
import type {
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
  CouponClient,
  CouponClientConfig,
  CouponStatus,
  CampaignStatus,
  CouponRejectReason,
} from "../src/index.js";

// factory shape
type F = typeof createCouponClient;
declare const _f: F;

// enum-like constants
declare const _st: typeof COUPON_STATUS;
declare const _rr: typeof COUPON_REJECT_REASON;
declare const _act: typeof AUDIT_ACTION;
declare const _lim: typeof LIMITS;

// Concrete types used
type AssertNever<T extends never> = T;
type _c1 = AssertNever<
  Exclude<
    | keyof CouponClient["coupons"]
    | keyof CouponClient["campaigns"]
    | keyof CouponClient["discount"]
    | keyof CouponClient["audit"]
    | "validate"
    | "redeem",
    | "create" | "issue" | "issueBulk" | "findByCode" | "get" | "list"
    | "pause" | "resume" | "archive"
    | "summary" | "close"
    | "listIssuances" | "listRedemptions" | "listLogs"
    | "validate" | "redeem" | "calculate"
  >
>;

// Errors: all in the public surface
const _errs = [
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
];

// Type re-exports must exist
declare const _coupon: Coupon;
declare const _campaign: Campaign;
declare const _iss: Issuance;
declare const _red: Redemption;
declare const _aud: AuditLog;
declare const _dp: DiscountPolicy;
declare const _er: EligibilityRules;
declare const _di: DiscountInput;
declare const _db: DiscountBreakdown;
declare const _vi: ValidateInput;
declare const _vc: ValidateContext;
declare const _vr: ValidationResult;
declare const _ri: RedeemInput;
declare const _rr2: RedemptionResult;
declare const _cci: CreateCouponInput;
declare const _ici: IssueCouponInput;
declare const _ibi: IssueBulkInput;
declare const _bir: BulkIssuanceResult;
declare const _ccai: CreateCampaignInput;
declare const _cia: CampaignIssueArgs;
declare const _csum: CampaignSummary;
declare const _lca: ListCouponsArgs;
declare const _lcam: ListCampaignsArgs;
declare const _lia: ListIssuancesArgs;
declare const _lra: ListRedemptionsArgs;
declare const _lla: ListAuditLogsArgs;
declare const _pg: Paged<Coupon>;
declare const _ev: CouponEvent;
declare const _eh: CouponEventHandler;
declare const _lg: CouponLogger;
declare const _pl: PrismaLike;
declare const _pt: PrismaTxLike;
declare const _cfg: CouponClientConfig;
declare const _cs: CouponStatus;
declare const _caps: CampaignStatus;
declare const _reasons: CouponRejectReason;

export {};
