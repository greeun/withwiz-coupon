/**
 * Input sanitization and validation layer. Uses Zod for schema checks
 * and enforces security guards ([A]~[O]).
 */

import { z } from "zod";
import {
  COUPON_STATUS,
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
  ValidateContext,
  ValidateInput,
} from "./domain/types.js";

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

/**
 * [L] Bounded string guard for caller-supplied identifiers (userId, orderRef,
 * actorId, couponId, ...). `null` / `undefined` pass through untouched so
 * optional fields keep their "absent" semantics; anything else must be a
 * non-empty string no longer than `max`.
 */
export function assertOptionalString(
  name: string,
  value: unknown,
  max: number
): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${name} must be a non-empty string`);
  }
  if (value.length > max) {
    throw new ValidationError(`${name} length exceeds max (${max})`);
  }
}

/** Same as {@link assertOptionalString} but the value is mandatory. */
export function assertRequiredString(
  name: string,
  value: unknown,
  max: number
): asserts value is string {
  if (value === undefined || value === null) {
    throw new ValidationError(`${name} is required`);
  }
  assertOptionalString(name, value, max);
}

export function assertContext(context: unknown): void {
  if (context === undefined || context === null) return;
  if (typeof context !== "object" || Array.isArray(context)) {
    throw new ValidationError("context must be a plain object");
  }
  const c = context as ValidateContext;
  assertOptionalString("context.plan", c.plan, LIMITS.CONTEXT_VALUE_MAX_LENGTH);
  assertOptionalString("context.productId", c.productId, LIMITS.CONTEXT_VALUE_MAX_LENGTH);
  assertOptionalString("context.categoryId", c.categoryId, LIMITS.CONTEXT_VALUE_MAX_LENGTH);
}

export function assertCouponStatus(status: unknown): void {
  if (status === undefined) return;
  const allowed = Object.values(COUPON_STATUS) as string[];
  if (typeof status !== "string" || !allowed.includes(status)) {
    throw new ValidationError(
      `status must be one of ${allowed.join(", ")}`
    );
  }
}

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
  // [L] Size cap. The serialized form is what lands in the Json column, so
  // measure that rather than key count. JSON.stringify also rejects cycles
  // and BigInt, both of which Prisma would refuse later with a less useful
  // error.
  let serialized: string;
  try {
    serialized = JSON.stringify(rec);
  } catch {
    throw new ValidationError("metadata must be JSON-serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > LIMITS.METADATA_MAX_BYTES) {
    throw new ValidationError(
      `metadata exceeds max size (${LIMITS.METADATA_MAX_BYTES} bytes)`
    );
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
    // [L] Bound both the list and each entry so a whitelist cannot be used
    // to inflate the Json column.
    if (v.length > LIMITS.ELIGIBILITY_MAX_ENTRIES) {
      throw new ValidationError(
        `eligibility.${key} exceeds max entries (${LIMITS.ELIGIBILITY_MAX_ENTRIES})`
      );
    }
    if (v.some((x) => (x as string).length > LIMITS.ELIGIBILITY_ENTRY_MAX_LENGTH)) {
      throw new ValidationError(
        `eligibility.${key} entry exceeds max length (${LIMITS.ELIGIBILITY_ENTRY_MAX_LENGTH})`
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
  assertCouponStatus(input.status);
  assertOptionalString("campaignId", input.campaignId, LIMITS.ID_MAX_LENGTH);
  assertOptionalString("actorId", input.actorId, LIMITS.USER_ID_MAX_LENGTH);
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
  assertOptionalString("campaignId", input.campaignId, LIMITS.ID_MAX_LENGTH);
  assertOptionalString("actorId", input.actorId, LIMITS.USER_ID_MAX_LENGTH);
}

export function validateIssueCouponInput(input: IssueCouponInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  assertRequiredString("couponId", input.couponId, LIMITS.ID_MAX_LENGTH);
  assertOptionalString("issuedToUserId", input.issuedToUserId, LIMITS.USER_ID_MAX_LENGTH);
  assertOptionalString("issuedBy", input.issuedBy, LIMITS.USER_ID_MAX_LENGTH);
  assertMetadata(input.metadata);
}

export function validateValidateInput(input: ValidateInput): void {
  if (!input || typeof input !== "object") {
    throw new ValidationError("input must be an object");
  }
  if (typeof input.code !== "string" || input.code.length === 0) {
    throw new ValidationError("code is required");
  }
  assertOptionalString("userId", input.userId, LIMITS.USER_ID_MAX_LENGTH);
  assertContext(input.context);
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
  assertOptionalString("userId", input.userId, LIMITS.USER_ID_MAX_LENGTH);
  assertOptionalString("orderRef", input.orderRef, LIMITS.ORDER_REF_MAX_LENGTH);
  assertContext(input.context);
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
  assertOptionalString("actorId", input.actorId, LIMITS.USER_ID_MAX_LENGTH);
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
