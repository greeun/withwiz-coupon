/**
 * Input sanitization and validation layer. Uses Zod for schema checks
 * and enforces security guards ([A]~[O]).
 */

import { z } from "zod";
import {
  FORBIDDEN_METADATA_KEYS,
  LIMITS,
} from "./domain/constants.js";
import {
  InvalidDateRangeError,
  ValidationError,
} from "./domain/errors.js";
import { validateDiscountPolicy } from "./discount.js";
import type {
  CreateCampaignInput,
  CreateCouponInput,
  DiscountPolicy,
  EligibilityRules,
  IssueBulkInput,
  IssueCouponInput,
  RedeemInput,
  ValidateInput,
} from "./domain/types.js";

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

export function assertTenantId(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError("tenantId is required");
  }
  if (value.length > LIMITS.TENANT_ID_MAX_LENGTH) {
    throw new ValidationError(
      `tenantId length exceeds max (${LIMITS.TENANT_ID_MAX_LENGTH})`
    );
  }
  if (!LIMITS.TENANT_ID_REGEX.test(value)) {
    throw new ValidationError(
      `tenantId contains invalid characters (allowed: [a-zA-Z0-9_-:.])`
    );
  }
}

export function sanitizeCode(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("code must be a string");
  }
  // NFKC normalization to prevent homoglyph/compatibility exploits.
  const normalized = raw.normalize("NFKC");
  if (normalized.length === 0 || normalized.length > LIMITS.CODE_MAX_LENGTH) {
    throw new ValidationError(
      `code length must be in [1, ${LIMITS.CODE_MAX_LENGTH}]`
    );
  }
  // Reject NUL, control chars, any whitespace — fast-path with precise messages
  // so downstream callers can distinguish whitespace/control from "invalid char".
  for (let i = 0; i < normalized.length; i++) {
    const cp = normalized.charCodeAt(i);
    if (cp === 0x00) {
      throw new ValidationError("code contains NUL");
    }
    if (cp < 0x20 || cp === 0x7f) {
      throw new ValidationError("code contains control characters");
    }
    if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) {
      throw new ValidationError("code contains whitespace");
    }
  }
  // [A] Whitelist: only [A-Z0-9_-] allowed after NFKC + upper-case. SQL meta
  // chars ('";:), CJK, emoji, punctuation are all rejected here. This is the
  // single enforcement point for coupon code charset.
  const upper = normalized.toUpperCase();
  if (!LIMITS.CODE_ALLOWED_REGEX.test(upper)) {
    throw new ValidationError(
      "coupon code contains invalid characters; allowed: [A-Z0-9_-]"
    );
  }
  return upper;
}

/**
 * Returns a canonical form of a code for storage / lookup (upper-case).
 * Documented in README.md. sanitizeCode already upper-cases + whitelists, so
 * this is an alias that makes intent explicit at call sites.
 */
export function canonicalizeCode(raw: string): string {
  return sanitizeCode(raw);
}

export function assertMetadata(
  meta: unknown
): Record<string, unknown> | null | undefined {
  if (meta === undefined || meta === null) return meta as null | undefined;
  if (typeof meta !== "object" || Array.isArray(meta)) {
    throw new ValidationError("metadata must be a plain object");
  }
  const rec = meta as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (FORBIDDEN_METADATA_KEYS.includes(key)) {
      throw new ValidationError(
        `metadata key "${key}" is forbidden (prototype pollution guard)`
      );
    }
  }
  return rec;
}

export function assertPaginationLimit(limit: number | undefined): number {
  if (limit === undefined) return LIMITS.PAGINATION_DEFAULT_LIMIT;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > LIMITS.PAGINATION_MAX_LIMIT
  ) {
    throw new ValidationError(
      `limit must be an integer in [1, ${LIMITS.PAGINATION_MAX_LIMIT}]`
    );
  }
  return limit;
}

export function assertCurrency(currency: unknown): asserts currency is string {
  if (
    typeof currency !== "string" ||
    currency.length !== LIMITS.CURRENCY_LENGTH
  ) {
    throw new ValidationError(
      `currency must be a ${LIMITS.CURRENCY_LENGTH}-letter ISO-4217 code`
    );
  }
}

export function assertDateRange(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined
): void {
  if (startsAt && endsAt) {
    if (!(startsAt instanceof Date) || !(endsAt instanceof Date)) {
      throw new ValidationError("startsAt/endsAt must be Date objects");
    }
    if (startsAt.getTime() >= endsAt.getTime()) {
      throw new InvalidDateRangeError(
        "startsAt must be strictly less than endsAt"
      );
    }
  }
}

export function assertEligibility(rules: unknown): EligibilityRules {
  if (rules === undefined || rules === null) return {};
  if (typeof rules !== "object" || Array.isArray(rules)) {
    throw new ValidationError("eligibility must be a plain object");
  }
  const r = rules as Record<string, unknown>;
  const allowed: (keyof EligibilityRules)[] = [
    "allowedUserIds",
    "allowedPlans",
    "allowedProductIds",
    "allowedCategories",
  ];
  const out: EligibilityRules = {};
  for (const key of allowed) {
    const v = r[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.length > 0)) {
      throw new ValidationError(
        `eligibility.${key} must be an array of non-empty strings`
      );
    }
    out[key] = v as string[];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Input assertions (not full schemas — we keep them lightweight and explicit)
// ---------------------------------------------------------------------------

export function resolveTenantId(
  provided: string | undefined,
  defaultTenantId: string | undefined
): string {
  const tid = provided ?? defaultTenantId;
  assertTenantId(tid);
  return tid;
}

export function validateCreateCouponInput(input: CreateCouponInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  validateDiscountPolicy(input.discount as DiscountPolicy);
  assertDateRange(input.startsAt ?? null, input.endsAt ?? null);
  assertMetadata(input.metadata);
  if (input.maxRedemptions !== undefined && input.maxRedemptions !== null) {
    if (
      typeof input.maxRedemptions !== "number" ||
      !Number.isInteger(input.maxRedemptions) ||
      input.maxRedemptions <= 0
    ) {
      throw new ValidationError("maxRedemptions must be a positive integer or null");
    }
  }
  if (input.maxRedemptionsPerUser !== undefined && input.maxRedemptionsPerUser !== null) {
    if (
      typeof input.maxRedemptionsPerUser !== "number" ||
      !Number.isInteger(input.maxRedemptionsPerUser) ||
      input.maxRedemptionsPerUser <= 0
    ) {
      throw new ValidationError(
        "maxRedemptionsPerUser must be a positive integer or null"
      );
    }
  }
}

export function validateIssueBulkInput(input: IssueBulkInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (
    typeof input.count !== "number" ||
    !Number.isInteger(input.count) ||
    input.count <= 0
  ) {
    throw new ValidationError("count must be a positive integer");
  }
  if (input.count > LIMITS.BULK_MAX_COUNT) {
    throw new ValidationError(
      `count exceeds max bulk limit (${LIMITS.BULK_MAX_COUNT})`
    );
  }
  if (input.maxAttempts !== undefined) {
    if (
      typeof input.maxAttempts !== "number" ||
      !Number.isInteger(input.maxAttempts) ||
      input.maxAttempts <= 0 ||
      input.maxAttempts > LIMITS.BULK_MAX_ATTEMPTS
    ) {
      throw new ValidationError(
        `maxAttempts must be in [1, ${LIMITS.BULK_MAX_ATTEMPTS}]`
      );
    }
  }
  validateDiscountPolicy(input.discount as DiscountPolicy);
  assertDateRange(input.startsAt ?? null, input.endsAt ?? null);
  assertMetadata(input.metadata);
}

export function validateIssueCouponInput(input: IssueCouponInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (typeof input.couponId !== "string" || input.couponId.length === 0) {
    throw new ValidationError("couponId is required");
  }
  assertMetadata(input.metadata);
}

export function validateValidateInput(input: ValidateInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (typeof input.code !== "string" || input.code.length === 0) {
    throw new ValidationError("code is required");
  }
  if (input.subtotal !== undefined) {
    if (
      typeof input.subtotal !== "number" ||
      !Number.isInteger(input.subtotal) ||
      input.subtotal < 0
    ) {
      throw new ValidationError("subtotal must be a non-negative integer");
    }
  }
  if (input.currency !== undefined) {
    assertCurrency(input.currency);
  }
}

export function validateRedeemInput(input: RedeemInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (typeof input.code !== "string" || input.code.length === 0) {
    throw new ValidationError("code is required");
  }
  if (
    typeof input.subtotal !== "number" ||
    !Number.isInteger(input.subtotal) ||
    input.subtotal < 0
  ) {
    throw new ValidationError("subtotal must be a non-negative integer");
  }
  assertCurrency(input.currency);
  assertMetadata(input.metadata);
}

export function validateCreateCampaignInput(input: CreateCampaignInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (typeof input.name !== "string" || input.name.length === 0) {
    throw new ValidationError("campaign name is required");
  }
  if (input.name.length > LIMITS.NAME_MAX_LENGTH) {
    throw new ValidationError(
      `campaign name exceeds max length (${LIMITS.NAME_MAX_LENGTH})`
    );
  }
  validateDiscountPolicy(input.discount as DiscountPolicy);
  assertDateRange(input.startsAt ?? null, input.endsAt ?? null);
  assertMetadata(input.metadata);
  if (input.maxCoupons !== undefined && input.maxCoupons !== null) {
    if (
      typeof input.maxCoupons !== "number" ||
      !Number.isInteger(input.maxCoupons) ||
      input.maxCoupons <= 0
    ) {
      throw new ValidationError(
        "maxCoupons must be a positive integer or null"
      );
    }
    if (input.maxCoupons > LIMITS.BULK_MAX_COUNT) {
      throw new ValidationError(
        `maxCoupons exceeds bulk limit (${LIMITS.BULK_MAX_COUNT})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Zod re-exports — not strictly required, but lightweight schemas in case
// consumers want them for their own I/O boundary.
// ---------------------------------------------------------------------------

export const discountPolicySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PERCENT"),
    percent: z.number().gt(0).lte(100),
    maxDiscount: z.number().int().nonnegative().optional(),
    minOrder: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
  }),
  z.object({
    kind: z.literal("FIXED"),
    amount: z.number().int().positive(),
    currency: z.string().length(3),
    minOrder: z.number().int().nonnegative().optional(),
  }),
]);
