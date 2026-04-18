/**
 * Public DTO & domain types for @withwiz/coupon.
 * No Prisma generated types imported here (see contract §10 PrismaLike rule).
 */

import type { CouponStatus, CampaignStatus, CouponRejectReason } from "./constants.js";

// --- Policy / Eligibility ---------------------------------------------------

export type DiscountPolicy =
  | {
      kind: "PERCENT";
      percent: number;
      maxDiscount?: number;
      minOrder?: number;
      currency?: string;
    }
  | {
      kind: "FIXED";
      amount: number;
      currency: string;
      minOrder?: number;
    };

export type EligibilityRules = {
  allowedUserIds?: string[];
  allowedPlans?: string[];
  allowedProductIds?: string[];
  allowedCategories?: string[];
};

// --- Entity DTOs ------------------------------------------------------------

export type Coupon = {
  id: string;
  tenantId: string;
  campaignId: string | null;
  code: string;
  status: CouponStatus;
  discount: DiscountPolicy;
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  maxRedemptionsPerUser: number | null;
  eligibility: EligibilityRules;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Campaign = {
  id: string;
  tenantId: string;
  name: string;
  status: CampaignStatus;
  discount: DiscountPolicy;
  eligibility: EligibilityRules;
  startsAt: Date | null;
  endsAt: Date | null;
  maxCoupons: number | null;
  issuedCount: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Issuance = {
  id: string;
  tenantId: string;
  couponId: string;
  issuedToUserId: string | null;
  issuedBy: string | null;
  issuedAt: Date;
  metadata: Record<string, unknown> | null;
};

export type Redemption = {
  id: string;
  tenantId: string;
  couponId: string;
  redeemedByUserId: string | null;
  orderRef: string | null;
  discountAmount: number;
  currency: string;
  redeemedAt: Date;
  metadata: Record<string, unknown> | null;
};

export type AuditLog = {
  id: string;
  tenantId: string;
  action: string;
  resourceId: string | null;
  resourceType: string | null;
  actorId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
};

// --- Input types ------------------------------------------------------------

export type CreateCouponInput = {
  tenantId?: string;
  code?: string;
  codeLength?: number;
  campaignId?: string;
  discount: DiscountPolicy;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerUser?: number | null;
  eligibility?: EligibilityRules;
  metadata?: Record<string, unknown> | null;
  status?: CouponStatus;
  actorId?: string;
};

export type IssueCouponInput = {
  tenantId?: string;
  couponId: string;
  issuedToUserId?: string | null;
  issuedBy?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type IssueBulkInput = {
  tenantId?: string;
  count: number;
  codeLength?: number;
  campaignId?: string;
  discount: DiscountPolicy;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerUser?: number | null;
  eligibility?: EligibilityRules;
  metadata?: Record<string, unknown> | null;
  maxAttempts?: number;
  actorId?: string;
};

export type BulkIssuanceResult = {
  created: Coupon[];
  skipped: number;
  codes: string[];
  attempts: number;
};

export type ListCouponsArgs = {
  tenantId?: string;
  campaignId?: string;
  status?: CouponStatus;
  cursor?: string;
  limit?: number;
};

export type ListCampaignsArgs = {
  tenantId?: string;
  status?: CampaignStatus;
  cursor?: string;
  limit?: number;
};

export type ListIssuancesArgs = {
  tenantId?: string;
  couponId?: string;
  issuedToUserId?: string;
  cursor?: string;
  limit?: number;
};

export type ListRedemptionsArgs = {
  tenantId?: string;
  couponId?: string;
  redeemedByUserId?: string;
  cursor?: string;
  limit?: number;
};

export type ListAuditLogsArgs = {
  tenantId?: string;
  action?: string;
  resourceId?: string;
  resourceType?: string;
  cursor?: string;
  limit?: number;
};

export type Paged<T> = {
  items: T[];
  nextCursor: string | null;
};

// --- Validate / Redeem ------------------------------------------------------

export type ValidateContext = {
  plan?: string;
  productId?: string;
  categoryId?: string;
};

export type ValidateInput = {
  tenantId?: string;
  code: string;
  userId?: string | null;
  subtotal?: number;
  currency?: string;
  context?: ValidateContext;
};

export type ValidationResult =
  | {
      ok: true;
      coupon: Coupon;
      discountPreview: DiscountBreakdown | null;
    }
  | {
      ok: false;
      reason: CouponRejectReason;
    };

// --- Discount ---------------------------------------------------------------

export type DiscountInput = {
  subtotal: number;
  currency: string;
  policy: DiscountPolicy;
};

export type DiscountBreakdown = {
  subtotal: number;
  discountAmount: number;
  total: number;
  appliedPolicy: DiscountPolicy;
  trace: string[];
  currency: string;
};

// --- Redeem -----------------------------------------------------------------

export type RedeemInput = {
  tenantId?: string;
  code: string;
  userId?: string | null;
  orderRef?: string | null;
  subtotal: number;
  currency: string;
  context?: ValidateContext;
  metadata?: Record<string, unknown> | null;
  /**
   * Consumer's Prisma transaction client. When provided, redeem() "piggybacks"
   * on this transaction instead of opening a new one.
   */
  tx?: PrismaTxLike;
};

export type RedemptionResult = {
  redemption: Redemption;
  coupon: Coupon;
  discount: DiscountBreakdown;
};

// --- Campaign inputs --------------------------------------------------------

export type CreateCampaignInput = {
  tenantId?: string;
  name: string;
  discount: DiscountPolicy;
  eligibility?: EligibilityRules;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxCoupons?: number | null;
  metadata?: Record<string, unknown> | null;
  actorId?: string;
};

export type CampaignIssueArgs = {
  tenantId?: string;
  campaignId: string;
  count: number;
  codeLength?: number;
  maxAttempts?: number;
  actorId?: string;
};

export type CampaignSummary = {
  id: string;
  tenantId: string;
  name: string;
  status: CampaignStatus;
  issuedCount: number;
  redeemedCount: number;
  remaining: number | null;
  totalDiscount: number;
  uniqueUsers: number;
  lastRedeemedAt: Date | null;
};

// --- Events -----------------------------------------------------------------

export type CouponEvent =
  | { type: "coupon.created"; at: Date; tenantId: string; coupon: Coupon }
  | { type: "coupon.issued"; at: Date; tenantId: string; issuance: Issuance }
  | {
      type: "coupon.issued.bulk";
      at: Date;
      tenantId: string;
      campaignId?: string;
      count: number;
    }
  | { type: "coupon.redeemed"; at: Date; tenantId: string; redemption: Redemption }
  | {
      type: "coupon.redeem.rejected";
      at: Date;
      tenantId: string;
      code: string;
      reason: CouponRejectReason;
      userId?: string | null;
      orderRef?: string | null;
    }
  | { type: "coupon.paused"; at: Date; tenantId: string; couponId: string }
  | { type: "coupon.resumed"; at: Date; tenantId: string; couponId: string }
  | { type: "coupon.archived"; at: Date; tenantId: string; couponId: string }
  | { type: "campaign.created"; at: Date; tenantId: string; campaign: Campaign }
  | { type: "campaign.closed"; at: Date; tenantId: string; campaignId: string };

export interface CouponEventHandler {
  onEvent(event: CouponEvent): void | Promise<void>;
}

// --- Logger -----------------------------------------------------------------

export interface CouponLogger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// --- PrismaLike structural typing -------------------------------------------

/**
 * Minimal structural interface for the subset of PrismaClient methods we use.
 * Consumers pass their own PrismaClient which will structurally match this.
 *
 * We deliberately AVOID importing any type from @prisma/client.
 */

export type WhereInput = Record<string, unknown>;
export type OrderByInput = Record<string, unknown> | Record<string, unknown>[];

export interface FindFirstArgs {
  where?: WhereInput;
  orderBy?: OrderByInput;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

export interface FindUniqueArgs {
  where: WhereInput;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

export interface FindManyArgs {
  where?: WhereInput;
  orderBy?: OrderByInput;
  take?: number;
  skip?: number;
  cursor?: WhereInput;
  select?: Record<string, unknown>;
  include?: Record<string, unknown>;
}

export interface CreateArgs {
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

export interface CreateManyArgs {
  data: Record<string, unknown>[];
  skipDuplicates?: boolean;
}

export interface UpdateArgs {
  where: WhereInput;
  data: Record<string, unknown>;
  select?: Record<string, unknown>;
}

export interface UpdateManyArgs {
  where: WhereInput;
  data: Record<string, unknown>;
}

export interface CountArgs {
  where?: WhereInput;
}

export interface AggregateArgs {
  where?: WhereInput;
  _sum?: Record<string, true>;
  _count?: Record<string, true> | true;
  _max?: Record<string, true>;
}

// Result types are intentionally loose — we immediately normalize to our DTOs.
export interface DelegateLike<TRow = Record<string, unknown>> {
  findFirst(args?: FindFirstArgs): Promise<TRow | null>;
  findUnique(args: FindUniqueArgs): Promise<TRow | null>;
  findMany(args?: FindManyArgs): Promise<TRow[]>;
  create(args: CreateArgs): Promise<TRow>;
  createMany(args: CreateManyArgs): Promise<{ count: number }>;
  update(args: UpdateArgs): Promise<TRow>;
  updateMany(args: UpdateManyArgs): Promise<{ count: number }>;
  count(args?: CountArgs): Promise<number>;
  aggregate?(args: AggregateArgs): Promise<Record<string, unknown>>;
}

export interface PrismaTxLike {
  coupon: DelegateLike;
  campaign: DelegateLike;
  couponIssuance: DelegateLike;
  couponRedemption: DelegateLike;
  couponAuditLog: DelegateLike;
  /**
   * Parameterized raw query — used only for `SELECT ... FOR UPDATE` row locks
   * in the redeem() concurrency path. Tagged-template style.
   */
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

export interface PrismaLike extends PrismaTxLike {
  $transaction<T>(
    fn: (tx: PrismaTxLike) => Promise<T>,
    options?: { maxWait?: number; timeout?: number; isolationLevel?: string }
  ): Promise<T>;
}
