/**
 * Eligibility engine — checks whether a redeem/validate call matches
 * the coupon's whitelist rules.
 */

import {
  IneligibleCategoryError,
  IneligiblePlanError,
  IneligibleProductError,
  IneligibleUserError,
} from "./domain/errors.js";
import { COUPON_REJECT_REASON } from "./domain/constants.js";
import type { CouponRejectReason } from "./domain/constants.js";
import type {
  EligibilityRules,
  ValidateContext,
} from "./domain/types.js";

export type EligibilityCheckInput = {
  rules: EligibilityRules;
  userId?: string | null;
  context?: ValidateContext;
};

export type EligibilityOutcome =
  | { ok: true }
  | { ok: false; reason: CouponRejectReason };

/**
 * Pure non-destructive check. Returns outcome; the caller decides whether
 * to throw the corresponding error class or return { ok: false, reason }.
 */
export function checkEligibility(input: EligibilityCheckInput): EligibilityOutcome {
  const { rules, userId, context } = input;

  if (!rules) {
    return { ok: true };
  }

  if (rules.allowedUserIds && rules.allowedUserIds.length > 0) {
    if (!userId || !rules.allowedUserIds.includes(userId)) {
      return { ok: false, reason: COUPON_REJECT_REASON.INELIGIBLE_USER };
    }
  }

  if (rules.allowedPlans && rules.allowedPlans.length > 0) {
    const plan = context?.plan;
    if (!plan || !rules.allowedPlans.includes(plan)) {
      return { ok: false, reason: COUPON_REJECT_REASON.INELIGIBLE_PLAN };
    }
  }

  if (rules.allowedProductIds && rules.allowedProductIds.length > 0) {
    const productId = context?.productId;
    if (!productId || !rules.allowedProductIds.includes(productId)) {
      return { ok: false, reason: COUPON_REJECT_REASON.INELIGIBLE_PRODUCT };
    }
  }

  if (rules.allowedCategories && rules.allowedCategories.length > 0) {
    const categoryId = context?.categoryId;
    if (!categoryId || !rules.allowedCategories.includes(categoryId)) {
      return { ok: false, reason: COUPON_REJECT_REASON.INELIGIBLE_CATEGORY };
    }
  }

  return { ok: true };
}

/**
 * Map an eligibility reject reason to its corresponding error class
 * for the redeem() path.
 */
export function eligibilityReasonToError(reason: CouponRejectReason): Error {
  switch (reason) {
    case COUPON_REJECT_REASON.INELIGIBLE_USER:
      return new IneligibleUserError();
    case COUPON_REJECT_REASON.INELIGIBLE_PLAN:
      return new IneligiblePlanError();
    case COUPON_REJECT_REASON.INELIGIBLE_PRODUCT:
      return new IneligibleProductError();
    case COUPON_REJECT_REASON.INELIGIBLE_CATEGORY:
      return new IneligibleCategoryError();
    default:
      return new IneligibleUserError(`Unexpected eligibility reason: ${reason}`);
  }
}
