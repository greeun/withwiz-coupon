/**
 * Pure discount calculation engine.
 *
 * [N] NO side effects, NO I/O, NO time dependency.
 * The only exceptions it throws are validation-level CouponError subclasses
 * that correspond to the input itself (not to coupon state).
 */

import {
  CurrencyMismatchError,
  InvalidDiscountPolicyError,
  MinimumOrderNotMetError,
  ValidationError,
} from "./domain/errors.js";
import type { DiscountBreakdown, DiscountInput, DiscountPolicy } from "./domain/types.js";

function ensureNonNegativeInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(
      `${name} must be a non-negative integer (got ${String(value)})`
    );
  }
}

function ensurePositiveInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(
      `${name} must be a positive integer (got ${String(value)})`
    );
  }
}

function ensureCurrency(code: string): void {
  if (typeof code !== "string" || code.length !== 3) {
    throw new ValidationError(
      `currency must be a 3-letter ISO-4217 code (got ${String(code)})`
    );
  }
}

/**
 * Validates the shape of a DiscountPolicy. Throws InvalidDiscountPolicyError
 * on any violation. Public so it can be re-used by validators.
 */
export function validateDiscountPolicy(policy: DiscountPolicy): void {
  if (!policy || typeof policy !== "object") {
    throw new InvalidDiscountPolicyError("discount policy must be an object");
  }
  if (policy.kind === "PERCENT") {
    const { percent } = policy;
    if (
      typeof percent !== "number" ||
      !Number.isFinite(percent) ||
      percent <= 0 ||
      percent > 100
    ) {
      throw new InvalidDiscountPolicyError(
        `PERCENT.percent must be in (0, 100] (got ${String(percent)})`
      );
    }
    if (policy.maxDiscount !== undefined) {
      if (
        typeof policy.maxDiscount !== "number" ||
        !Number.isInteger(policy.maxDiscount) ||
        policy.maxDiscount < 0
      ) {
        throw new InvalidDiscountPolicyError(
          "PERCENT.maxDiscount must be a non-negative integer"
        );
      }
    }
    if (policy.minOrder !== undefined) {
      if (
        typeof policy.minOrder !== "number" ||
        !Number.isInteger(policy.minOrder) ||
        policy.minOrder < 0
      ) {
        throw new InvalidDiscountPolicyError(
          "PERCENT.minOrder must be a non-negative integer"
        );
      }
    }
    if (policy.currency !== undefined) {
      ensureCurrency(policy.currency);
    }
    return;
  }
  if (policy.kind === "FIXED") {
    const { amount, currency } = policy;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      throw new InvalidDiscountPolicyError(
        `FIXED.amount must be a positive integer (got ${String(amount)})`
      );
    }
    ensureCurrency(currency);
    if (policy.minOrder !== undefined) {
      if (
        typeof policy.minOrder !== "number" ||
        !Number.isInteger(policy.minOrder) ||
        policy.minOrder < 0
      ) {
        throw new InvalidDiscountPolicyError(
          "FIXED.minOrder must be a non-negative integer"
        );
      }
    }
    return;
  }
  throw new InvalidDiscountPolicyError(
    `unknown discount policy kind: ${String((policy as { kind?: string }).kind)}`
  );
}

/**
 * Pure discount calculation. Returns a DiscountBreakdown with total >= 0.
 * Throws CurrencyMismatchError if input.currency != policy.currency (when policy carries one).
 * Throws MinimumOrderNotMetError if subtotal < policy.minOrder.
 */
export function calculate(input: DiscountInput): DiscountBreakdown {
  if (!input || typeof input !== "object") {
    throw new ValidationError("discount input must be an object");
  }
  ensureNonNegativeInteger("subtotal", input.subtotal);
  ensureCurrency(input.currency);
  validateDiscountPolicy(input.policy);

  const trace: string[] = [];

  // Currency match check.
  const policyCurrency = extractPolicyCurrency(input.policy);
  if (policyCurrency && policyCurrency !== input.currency) {
    throw new CurrencyMismatchError(
      `currency mismatch: input=${input.currency} policy=${policyCurrency}`
    );
  }

  // Minimum order check.
  const minOrder = input.policy.minOrder;
  if (typeof minOrder === "number" && input.subtotal < minOrder) {
    throw new MinimumOrderNotMetError(
      `minimum order ${minOrder} not met (subtotal=${input.subtotal})`
    );
  }

  let discountAmount = 0;
  if (input.policy.kind === "PERCENT") {
    const raw = Math.floor((input.subtotal * input.policy.percent) / 100);
    trace.push(`percent=${input.policy.percent}% raw=${raw}`);
    if (typeof input.policy.maxDiscount === "number") {
      const capped = Math.min(raw, input.policy.maxDiscount);
      if (capped !== raw) {
        trace.push(`capped by maxDiscount=${input.policy.maxDiscount} -> ${capped}`);
      }
      discountAmount = capped;
    } else {
      discountAmount = raw;
    }
  } else {
    discountAmount = input.policy.amount;
    trace.push(`fixed=${input.policy.amount}`);
  }

  // Clamp: discount cannot exceed subtotal (total >= 0).
  if (discountAmount > input.subtotal) {
    trace.push(`clamped discount ${discountAmount} to subtotal ${input.subtotal}`);
    discountAmount = input.subtotal;
  }

  ensurePositiveIntegerIfNonZero(discountAmount);

  const total = input.subtotal - discountAmount;
  trace.push(`total=${total}`);

  return {
    subtotal: input.subtotal,
    discountAmount,
    total,
    appliedPolicy: input.policy,
    trace,
    currency: input.currency,
  };
}

function ensurePositiveIntegerIfNonZero(value: number): void {
  if (value !== 0 && !Number.isInteger(value)) {
    throw new ValidationError("discountAmount must be an integer");
  }
  if (value < 0) {
    throw new ValidationError("discountAmount must be non-negative");
  }
}

function extractPolicyCurrency(policy: DiscountPolicy): string | undefined {
  if (policy.kind === "FIXED") return policy.currency;
  if (policy.kind === "PERCENT") return policy.currency;
  return undefined;
}
