import { describe, expect, it } from "vitest";
import {
  checkEligibility,
  eligibilityReasonToError,
} from "../../src/eligibility.js";
import {
  IneligibleCategoryError,
  IneligiblePlanError,
  IneligibleProductError,
  IneligibleUserError,
} from "../../src/index.js";

describe("eligibility unit", () => {
  it("no rules -> ok", () => {
    expect(checkEligibility({ rules: {} }).ok).toBe(true);
  });

  it("allowedUserIds missing userId -> reject", () => {
    const r = checkEligibility({
      rules: { allowedUserIds: ["u1"] },
      userId: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INELIGIBLE_USER");
  });

  it("allowedPlans missing context -> reject", () => {
    const r = checkEligibility({
      rules: { allowedPlans: ["PRO"] },
      userId: "u1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("INELIGIBLE_PLAN");
  });

  it("eligibilityReasonToError covers all 4 eligibility errors", () => {
    expect(eligibilityReasonToError("INELIGIBLE_USER")).toBeInstanceOf(IneligibleUserError);
    expect(eligibilityReasonToError("INELIGIBLE_PLAN")).toBeInstanceOf(IneligiblePlanError);
    expect(eligibilityReasonToError("INELIGIBLE_PRODUCT")).toBeInstanceOf(IneligibleProductError);
    expect(eligibilityReasonToError("INELIGIBLE_CATEGORY")).toBeInstanceOf(IneligibleCategoryError);
    // fallthrough to IneligibleUserError for unexpected
    const e = eligibilityReasonToError("NOT_FOUND");
    expect(e).toBeInstanceOf(IneligibleUserError);
  });
});
