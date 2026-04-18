/**
 * Domain-level constants for @withwiz/coupon.
 * No env vars, no side effects. Pure values.
 */

export const COUPON_STATUS = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  EXPIRED: "EXPIRED",
  EXHAUSTED: "EXHAUSTED",
  ARCHIVED: "ARCHIVED",
} as const;

export type CouponStatus = (typeof COUPON_STATUS)[keyof typeof COUPON_STATUS];

export const CAMPAIGN_STATUS = {
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
} as const;

export type CampaignStatus =
  (typeof CAMPAIGN_STATUS)[keyof typeof CAMPAIGN_STATUS];

/**
 * Closed union of validate() reject reasons.
 * Exactly 13 literals as frozen by sprint_contract.md §7.4.
 */
export const COUPON_REJECT_REASON = {
  NOT_FOUND: "NOT_FOUND",
  NOT_STARTED: "NOT_STARTED",
  EXPIRED: "EXPIRED",
  EXHAUSTED: "EXHAUSTED",
  PER_USER_LIMIT: "PER_USER_LIMIT",
  MIN_ORDER_NOT_MET: "MIN_ORDER_NOT_MET",
  INELIGIBLE_USER: "INELIGIBLE_USER",
  INELIGIBLE_PLAN: "INELIGIBLE_PLAN",
  INELIGIBLE_PRODUCT: "INELIGIBLE_PRODUCT",
  INELIGIBLE_CATEGORY: "INELIGIBLE_CATEGORY",
  PAUSED: "PAUSED",
  ARCHIVED: "ARCHIVED",
  TENANT_MISMATCH: "TENANT_MISMATCH",
} as const;

export type CouponRejectReason =
  (typeof COUPON_REJECT_REASON)[keyof typeof COUPON_REJECT_REASON];

/**
 * Sanitization and resource limits.
 * - [A] code length cap / allowed charset
 * - [C] tenantId format
 * - [I] bulk count cap
 * - [J] maxAttempts cap
 * - [K] cursor pagination limits
 */
export const LIMITS = {
  CODE_MAX_LENGTH: 64,
  CODE_MIN_LENGTH: 1,
  /**
   * Default character set for generated codes (confusing chars removed).
   * Excludes `0/O`, `1/I/L` and lower-case to avoid user transcription errors.
   */
  CODE_DEFAULT_ALPHABET: "ABCDEFGHJKMNPQRSTUVWXYZ23456789",
  CODE_DEFAULT_LENGTH: 8,
  /**
   * [A] whitelist for accepted coupon codes (after NFKC normalization + upper-case).
   * Only uppercase ASCII letters, digits, underscore, hyphen are allowed.
   * SQL meta characters / quotes / spaces / CJK / emoji are all rejected.
   */
  CODE_ALLOWED_REGEX: /^[A-Z0-9_-]+$/,
  TENANT_ID_MAX_LENGTH: 64,
  TENANT_ID_REGEX: /^[a-zA-Z0-9_\-:.]+$/,
  BULK_MAX_COUNT: 10_000,
  BULK_MAX_ATTEMPTS: 5,
  BULK_DEFAULT_MAX_ATTEMPTS: 3,
  PAGINATION_DEFAULT_LIMIT: 50,
  PAGINATION_MAX_LIMIT: 200,
  NAME_MAX_LENGTH: 200,
  CURRENCY_LENGTH: 3,
} as const;

/**
 * Audit log action strings (stable identifiers).
 */
export const AUDIT_ACTION = {
  COUPON_CREATED: "coupon.created",
  COUPON_PAUSED: "coupon.paused",
  COUPON_RESUMED: "coupon.resumed",
  COUPON_ARCHIVED: "coupon.archived",
  COUPON_ISSUED: "coupon.issued",
  COUPON_ISSUED_BULK: "coupon.issued.bulk",
  COUPON_REDEEMED: "coupon.redeemed",
  COUPON_REDEEM_REJECTED: "coupon.redeem.rejected",
  CAMPAIGN_CREATED: "campaign.created",
  CAMPAIGN_CLOSED: "campaign.closed",
} as const;

export type AuditAction = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const RESOURCE_TYPE = {
  COUPON: "coupon",
  CAMPAIGN: "campaign",
} as const;

/**
 * Prototype-pollution guard keys.
 */
export const FORBIDDEN_METADATA_KEYS: ReadonlyArray<string> = [
  "__proto__",
  "constructor",
  "prototype",
];
