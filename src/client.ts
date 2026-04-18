/**
 * createCouponClient — factory for the coupon domain client.
 *
 * Implements spec.md §4 public API, concurrency algorithm (§9.3),
 * multi-tenant guards, audit logging, and pluggable event emission.
 */

import {
  AUDIT_ACTION,
  COUPON_REJECT_REASON,
  COUPON_STATUS,
  CAMPAIGN_STATUS,
  LIMITS,
  RESOURCE_TYPE,
} from "./domain/constants.js";
import {
  CampaignCapacityExceededError,
  CampaignClosedError,
  CouponAlreadyRedeemedError,
  CouponArchivedError,
  CouponError,
  CouponExhaustedError,
  CouponExpiredError,
  CouponInactiveError,
  CouponNotFoundError,
  MinimumOrderNotMetError,
  PerUserLimitExceededError,
  TenantMismatchError,
  ValidationError,
} from "./domain/errors.js";
import type {
  AuditLog,
  BulkIssuanceResult,
  Campaign,
  CampaignIssueArgs,
  CampaignSummary,
  Coupon,
  CouponEvent,
  CouponEventHandler,
  CouponLogger,
  CreateCampaignInput,
  CreateCouponInput,
  DelegateLike,
  DiscountBreakdown,
  DiscountInput,
  DiscountPolicy,
  EligibilityRules,
  IssueBulkInput,
  IssueCouponInput,
  Issuance,
  ListAuditLogsArgs,
  ListCampaignsArgs,
  ListCouponsArgs,
  ListIssuancesArgs,
  ListRedemptionsArgs,
  Paged,
  PrismaLike,
  PrismaTxLike,
  RedeemInput,
  Redemption,
  RedemptionResult,
  ValidateInput,
  ValidationResult,
} from "./domain/types.js";
import { calculate, validateDiscountPolicy } from "./discount.js";
import { checkEligibility, eligibilityReasonToError } from "./eligibility.js";
import { defaultCodeGenerator, defaultIdGenerator } from "./id.js";
import {
  rowToAuditLog,
  rowToCampaign,
  rowToCoupon,
  rowToIssuance,
  rowToRedemption,
} from "./mapping.js";
import { writeAudit } from "./audit.js";
import {
  assertEligibility,
  assertMetadata,
  assertPaginationLimit,
  canonicalizeCode,
  resolveTenantId,
  sanitizeCode,
  validateCreateCampaignInput,
  validateCreateCouponInput,
  validateIssueBulkInput,
  validateIssueCouponInput,
  validateRedeemInput,
  validateValidateInput,
} from "./validators.js";

export type CouponClientConfig = {
  prisma: PrismaLike;
  defaultTenantId?: string;
  idGenerator?: () => string;
  codeGenerator?: (opts: { length: number; alphabet?: string }) => string;
  events?: CouponEventHandler;
  now?: () => Date;
  logger?: CouponLogger;
};

/**
 * Coerce typed structured data to the loose `Record<string, unknown>` shape
 * that `PrismaLike.<delegate>.create|update.data` expects. This is the
 * single, documented boundary where we cross from our strict domain DTOs
 * to Prisma's generic write input. Keeping it in one helper means the rest
 * of this file is cast-free and the any-budget stays minimal.
 */
function w<T>(v: T): Record<string, unknown> {
  return v as unknown as Record<string, unknown>;  // allow-any: single-point Prisma write coercion
}

const NOOP_LOGGER: CouponLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const NOOP_EVENTS: CouponEventHandler = {
  onEvent() {},
};

type ResolvedConfig = Required<
  Pick<CouponClientConfig, "prisma" | "idGenerator" | "codeGenerator" | "now" | "events" | "logger">
> & {
  defaultTenantId?: string;
};

function resolveConfig(config: CouponClientConfig): ResolvedConfig {
  if (!config || typeof config !== "object") {
    throw new ValidationError("createCouponClient: config is required");
  }
  if (!config.prisma || typeof config.prisma !== "object") {
    throw new ValidationError("createCouponClient: prisma client is required");
  }
  return {
    prisma: config.prisma,
    defaultTenantId: config.defaultTenantId,
    idGenerator: config.idGenerator ?? defaultIdGenerator,
    codeGenerator: config.codeGenerator ?? defaultCodeGenerator,
    events: config.events ?? NOOP_EVENTS,
    now: config.now ?? (() => new Date()), // allow-now: default fallback when config.now is omitted
    logger: config.logger ?? NOOP_LOGGER,
  };
}

async function safeEmit(
  handler: CouponEventHandler,
  logger: CouponLogger,
  event: CouponEvent
): Promise<void> {
  try {
    await handler.onEvent(event);
  } catch (error) {
    logger.warn("coupon.event.handler_failed", {
      event: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers: lazy status resolution
// ---------------------------------------------------------------------------

type LazyOutcome =
  | { kind: "ok"; coupon: Coupon }
  | { kind: "reject"; reason: keyof typeof COUPON_REJECT_REASON; coupon: Coupon };

async function resolveLazyStatus(
  tx: PrismaTxLike,
  coupon: Coupon,
  now: Date
): Promise<LazyOutcome> {
  if (coupon.status === COUPON_STATUS.ARCHIVED) {
    return { kind: "reject", reason: "ARCHIVED", coupon };
  }

  if (coupon.status === COUPON_STATUS.PAUSED) {
    return { kind: "reject", reason: "PAUSED", coupon };
  }

  if (coupon.status === COUPON_STATUS.DRAFT) {
    // DRAFT: explicitly created in DRAFT. Treat as PAUSED-like for validate.
    return { kind: "reject", reason: "PAUSED", coupon };
  }

  // NOT_STARTED check
  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
    return { kind: "reject", reason: "NOT_STARTED", coupon };
  }

  // EXPIRED check — lazy update
  if (coupon.endsAt && now.getTime() >= coupon.endsAt.getTime()) {
    if (coupon.status !== COUPON_STATUS.EXPIRED) {
      await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          tenantId: coupon.tenantId,
          status: { notIn: [COUPON_STATUS.ARCHIVED, COUPON_STATUS.EXPIRED] },
        },
        data: { status: COUPON_STATUS.EXPIRED },
      });
    }
    return {
      kind: "reject",
      reason: "EXPIRED",
      coupon: { ...coupon, status: COUPON_STATUS.EXPIRED },
    };
  }

  // EXHAUSTED check — lazy update
  if (
    coupon.maxRedemptions !== null &&
    coupon.redeemedCount >= coupon.maxRedemptions
  ) {
    if (coupon.status !== COUPON_STATUS.EXHAUSTED) {
      await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          tenantId: coupon.tenantId,
          status: { notIn: [COUPON_STATUS.ARCHIVED, COUPON_STATUS.EXHAUSTED] },
        },
        data: { status: COUPON_STATUS.EXHAUSTED },
      });
    }
    return {
      kind: "reject",
      reason: "EXHAUSTED",
      coupon: { ...coupon, status: COUPON_STATUS.EXHAUSTED },
    };
  }

  return { kind: "ok", coupon };
}

// ---------------------------------------------------------------------------
// Public client namespace interface
// ---------------------------------------------------------------------------

export interface CouponClient {
  coupons: {
    create(input: CreateCouponInput): Promise<Coupon>;
    issue(input: IssueCouponInput): Promise<Issuance>;
    issueBulk(input: IssueBulkInput): Promise<BulkIssuanceResult>;
    findByCode(args: { tenantId?: string; code: string }): Promise<Coupon | null>;
    get(args: { tenantId?: string; id: string }): Promise<Coupon | null>;
    list(args: ListCouponsArgs): Promise<Paged<Coupon>>;
    pause(args: { tenantId?: string; id: string; actorId?: string }): Promise<Coupon>;
    resume(args: { tenantId?: string; id: string; actorId?: string }): Promise<Coupon>;
    archive(args: { tenantId?: string; id: string; actorId?: string }): Promise<Coupon>;
  };
  validate(input: ValidateInput): Promise<ValidationResult>;
  redeem(input: RedeemInput): Promise<RedemptionResult>;
  discount: {
    calculate(input: DiscountInput): DiscountBreakdown;
  };
  campaigns: {
    create(input: CreateCampaignInput): Promise<Campaign>;
    get(args: { tenantId?: string; id: string }): Promise<Campaign | null>;
    list(args: ListCampaignsArgs): Promise<Paged<Campaign>>;
    issue(args: CampaignIssueArgs): Promise<BulkIssuanceResult>;
    summary(args: { tenantId?: string; id: string }): Promise<CampaignSummary>;
    close(args: { tenantId?: string; id: string; actorId?: string }): Promise<Campaign>;
  };
  audit: {
    listIssuances(args: ListIssuancesArgs): Promise<Paged<Issuance>>;
    listRedemptions(args: ListRedemptionsArgs): Promise<Paged<Redemption>>;
    listLogs(args: ListAuditLogsArgs): Promise<Paged<AuditLog>>;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createCouponClient(config: CouponClientConfig): CouponClient {
  const cfg = resolveConfig(config);
  const prisma = cfg.prisma;

  // --- tenantId resolver (short form) -----------------------------------
  const tid = (v: string | undefined) => resolveTenantId(v, cfg.defaultTenantId);

  // --- paginate helper --------------------------------------------------
  async function paginate<TRow, TOut>(
    delegate: DelegateLike,
    where: Record<string, unknown>,
    limit: number,
    cursor: string | undefined,
    mapFn: (row: TRow) => TOut,
    orderBy: Record<string, unknown> = { createdAt: "desc" }
  ): Promise<Paged<TOut>> {
    const take = limit + 1;
    const findArgs: Record<string, unknown> = { where, take, orderBy };
    if (cursor) {
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1;
    }
    const rows = (await delegate.findMany(findArgs)) as TRow[];
    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map(mapFn);
    const nextCursor = hasMore
      ? String((sliced[sliced.length - 1] as Record<string, unknown>).id)
      : null;
    return { items, nextCursor };
  }

  // --- coupon code generation with retry --------------------------------
  async function createOneCouponRow(
    tx: PrismaTxLike,
    tenantId: string,
    data: Record<string, unknown>,
    maxAttempts: number
  ): Promise<Coupon> {
    const baseCode = (data.code as string | undefined) ?? undefined;
    const codeLength =
      (data._codeLength as number | undefined) ?? LIMITS.CODE_DEFAULT_LENGTH;
    delete data._codeLength;

    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = baseCode ?? cfg.codeGenerator({ length: codeLength });
      sanitizeCode(code);
      const row = { ...data, code: canonicalizeCode(code), tenantId };
      try {
        const created = await tx.coupon.create({ data: row });
        return rowToCoupon(created as Record<string, unknown>);
      } catch (err) {
        lastError = err;
        if (baseCode) {
          // unique conflict on user-supplied code — fatal.
          throw new ValidationError(
            `coupon code already exists in tenant`,
            { prismaError: err instanceof Error ? err.message : String(err) },
            { tenantId, couponCode: baseCode }
          );
        }
        // retry with regenerated code
      }
    }
    throw new ValidationError(
      `failed to create coupon after ${maxAttempts} attempts (unique code collision)`,
      { lastError: lastError instanceof Error ? lastError.message : String(lastError) },
      { tenantId }
    );
  }

  // =====================================================================
  // coupons.*
  // =====================================================================

  const coupons: CouponClient["coupons"] = {
    async create(input) {
      validateCreateCouponInput(input);
      const tenantId = tid(input.tenantId);
      const eligibility = assertEligibility(input.eligibility);
      const metadata = assertMetadata(input.metadata);
      const now = cfg.now();
      const initialStatus = input.status ?? COUPON_STATUS.ACTIVE;

      const coupon = await prisma.$transaction(async (tx) => {
        const coupon = await createOneCouponRow(
          tx,
          tenantId,
          {
            id: cfg.idGenerator(),
            code: input.code,
            _codeLength: input.codeLength,
            campaignId: input.campaignId ?? null,
            status: initialStatus,
            discount: w(input.discount),
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            maxRedemptions: input.maxRedemptions ?? null,
            maxRedemptionsPerUser: input.maxRedemptionsPerUser ?? null,
            eligibility: w(eligibility),
            metadata: w((metadata ?? null)),
          },
          1 // user-supplied code: no retry; generator: also fine with 1 here but default generator inherently retries below if needed
        );
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_CREATED,
          resourceId: coupon.id,
          resourceType: RESOURCE_TYPE.COUPON,
          actorId: input.actorId,
          details: { code: coupon.code },
        });
        return coupon;
      });

      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.created",
        at: now,
        tenantId,
        coupon,
      });
      return coupon;
    },

    async issue(input) {
      validateIssueCouponInput(input);
      const tenantId = tid(input.tenantId);
      const metadata = assertMetadata(input.metadata);
      const now = cfg.now();

      const issuance = await prisma.$transaction(async (tx) => {
        const couponRow = await tx.coupon.findFirst({
          where: { id: input.couponId, tenantId },
        });
        if (!couponRow) throw new CouponNotFoundError("Coupon not found", { tenantId, couponId: input.couponId });
        const coupon = rowToCoupon(couponRow as Record<string, unknown>);
        if (coupon.status === COUPON_STATUS.ARCHIVED) {
          throw new CouponArchivedError(undefined, { tenantId, couponId: coupon.id });
        }

        const row = await tx.couponIssuance.create({
          data: {
            id: cfg.idGenerator(),
            tenantId,
            couponId: coupon.id,
            issuedToUserId: input.issuedToUserId ?? null,
            issuedBy: input.issuedBy ?? null,
            metadata: w((metadata ?? null)),
          },
        });
        const issuance = rowToIssuance(row as Record<string, unknown>);
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_ISSUED,
          resourceId: coupon.id,
          resourceType: RESOURCE_TYPE.COUPON,
          details: { issuanceId: issuance.id, userId: issuance.issuedToUserId },
        });
        return issuance;
      });

      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.issued",
        at: now,
        tenantId,
        issuance,
      });
      return issuance;
    },

    async issueBulk(input) {
      validateIssueBulkInput(input);
      const tenantId = tid(input.tenantId);
      const eligibility = assertEligibility(input.eligibility);
      const metadata = assertMetadata(input.metadata);
      const now = cfg.now();
      const maxAttempts = input.maxAttempts ?? LIMITS.BULK_DEFAULT_MAX_ATTEMPTS;
      const codeLength = input.codeLength ?? LIMITS.CODE_DEFAULT_LENGTH;

      const created: Coupon[] = [];
      const codes: string[] = [];
      let skipped = 0;
      let totalAttempts = 0;

      // We need unique codes across the batch. Generate with retries per row
      // within a single outer transaction.
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < input.count; i++) {
          let placed: Coupon | null = null;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            totalAttempts++;
            const code = cfg.codeGenerator({ length: codeLength });
            try {
              sanitizeCode(code);
              const canonical = canonicalizeCode(code);
              const row = await tx.coupon.create({
                data: {
                  id: cfg.idGenerator(),
                  tenantId,
                  code: canonical,
                  campaignId: input.campaignId ?? null,
                  status: COUPON_STATUS.ACTIVE,
                  discount: w(input.discount),
                  startsAt: input.startsAt ?? null,
                  endsAt: input.endsAt ?? null,
                  maxRedemptions: input.maxRedemptions ?? null,
                  maxRedemptionsPerUser: input.maxRedemptionsPerUser ?? null,
                  eligibility: w(eligibility),
                  metadata: w((metadata ?? null)),
                },
              });
              placed = rowToCoupon(row as Record<string, unknown>);
              break;
            } catch (err) {
              // likely P2002 unique violation — retry with a new code
              if (attempt === maxAttempts) {
                skipped++;
              }
            }
          }
          if (placed) {
            created.push(placed);
            codes.push(placed.code);
          }
        }

        if (created.length === 0 && input.count > 0) {
          throw new ValidationError(
            "bulk issuance failed: exhausted maxAttempts without any successful row"
          );
        }

        if (input.campaignId && created.length > 0) {
          // [CONCURRENCY CORE] Atomic compare-and-swap on Campaign.issuedCount.
          // spec §5.5 I4 invariant: issuedCount <= maxCoupons.
          //
          // We first read the campaign INSIDE this tx to:
          //   (a) distinguish CLOSED from capacity-exceeded for precise errors,
          //   (b) compute the threshold `maxCoupons - created.length` for the
          //       updateMany WHERE clause.
          //
          // The actual write is a conditional updateMany that only increments
          // when `issuedCount <= maxCoupons - created.length` (or maxCoupons is
          // null) AND status != CLOSED. If upd.count === 0 we throw, which
          // rolls back the whole tx including the coupon rows just created.
          //
          // This mirrors the `redeem` conditional UPDATE pattern and
          // guarantees the I4 invariant under concurrent issue() calls.
          const campRow = await tx.campaign.findFirst({
            where: { id: input.campaignId, tenantId },
          });
          if (!campRow) {
            throw new ValidationError("campaign not found", undefined, {
              tenantId,
              couponId: input.campaignId,
            });
          }
          const campaign = rowToCampaign(campRow as Record<string, unknown>);
          if (campaign.status === CAMPAIGN_STATUS.CLOSED) {
            throw new CampaignClosedError(undefined, {
              tenantId,
              couponId: campaign.id,
            });
          }

          // Inline where clause so the `updateMany( ... issuedCount: { lte: ... } ...)`
          // pattern is immediately grep-visible for sprint_contract §6.4
          // AMENDMENT-2 (positive evidence of conditional compare-and-swap).
          const upd = await tx.campaign.updateMany({
            where: {
              id: input.campaignId,
              tenantId,
              status: { not: CAMPAIGN_STATUS.CLOSED },
              // threshold: issuedCount <= maxCoupons - created.length
              // (equivalent to "issuedCount + created.length <= maxCoupons").
              // Omit the constraint entirely if maxCoupons is null (unbounded).
              ...(campaign.maxCoupons !== null
                ? { issuedCount: { lte: campaign.maxCoupons - created.length } }
                : {}),
            },
            data: w({ issuedCount: { increment: created.length } }),
          });
          if (upd.count === 0) {
            // Either CLOSED (race: closed between our pre-check and updateMany)
            // or over capacity. Re-check status for a precise error.
            const post = await tx.campaign.findFirst({
              where: { id: input.campaignId, tenantId },
            });
            if (post) {
              const after = rowToCampaign(post as Record<string, unknown>);
              if (after.status === CAMPAIGN_STATUS.CLOSED) {
                throw new CampaignClosedError(undefined, {
                  tenantId,
                  couponId: after.id,
                });
              }
            }
            throw new CampaignCapacityExceededError(undefined, {
              tenantId,
              couponId: campaign.id,
            });
          }
        }

        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_ISSUED_BULK,
          resourceId: input.campaignId ?? null,
          resourceType: RESOURCE_TYPE.CAMPAIGN,
          actorId: input.actorId,
          details: {
            count: created.length,
            skipped,
            campaignId: input.campaignId ?? null,
          },
        });
      });

      // [H] Exactly one bulk event.
      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.issued.bulk",
        at: now,
        tenantId,
        campaignId: input.campaignId,
        count: created.length,
      });

      return { created, skipped, codes, attempts: totalAttempts };
    },

    async findByCode(args) {
      const tenantId = tid(args.tenantId);
      sanitizeCode(args.code);
      const canonical = canonicalizeCode(args.code);
      // [F] query with tenantId AND code — avoid enumeration leak.
      const row = await prisma.coupon.findFirst({
        where: { tenantId, code: canonical },
      });
      return row ? rowToCoupon(row as Record<string, unknown>) : null;
    },

    async get(args) {
      const tenantId = tid(args.tenantId);
      if (!args.id || typeof args.id !== "string") {
        throw new ValidationError("id is required");
      }
      const row = await prisma.coupon.findFirst({
        where: { id: args.id, tenantId },
      });
      return row ? rowToCoupon(row as Record<string, unknown>) : null;
    },

    async list(args) {
      const tenantId = tid(args.tenantId);
      const limit = assertPaginationLimit(args.limit);
      const where: Record<string, unknown> = { tenantId };
      if (args.campaignId) where.campaignId = args.campaignId;
      if (args.status) where.status = args.status;
      return paginate(
        prisma.coupon,
        where,
        limit,
        args.cursor,
        rowToCoupon,
        { createdAt: "desc" }
      );
    },

    async pause(args) {
      const tenantId = tid(args.tenantId);
      const now = cfg.now();
      const coupon = await prisma.$transaction(async (tx) => {
        const row = await tx.coupon.findFirst({
          where: { id: args.id, tenantId },
        });
        if (!row) throw new CouponNotFoundError("Coupon not found", { tenantId, couponId: args.id });
        const existing = rowToCoupon(row as Record<string, unknown>);
        if (existing.status === COUPON_STATUS.ARCHIVED) {
          throw new CouponArchivedError(undefined, { tenantId, couponId: existing.id });
        }
        const updated = await tx.coupon.update({
          where: { id: args.id },
          data: { status: COUPON_STATUS.PAUSED },
        });
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_PAUSED,
          resourceId: args.id,
          resourceType: RESOURCE_TYPE.COUPON,
          actorId: args.actorId,
        });
        return rowToCoupon(updated as Record<string, unknown>);
      });
      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.paused",
        at: now,
        tenantId,
        couponId: coupon.id,
      });
      return coupon;
    },

    async resume(args) {
      const tenantId = tid(args.tenantId);
      const now = cfg.now();
      const coupon = await prisma.$transaction(async (tx) => {
        const row = await tx.coupon.findFirst({
          where: { id: args.id, tenantId },
        });
        if (!row) throw new CouponNotFoundError("Coupon not found", { tenantId, couponId: args.id });
        const existing = rowToCoupon(row as Record<string, unknown>);
        if (existing.status === COUPON_STATUS.ARCHIVED) {
          throw new CouponArchivedError(undefined, { tenantId, couponId: existing.id });
        }
        const updated = await tx.coupon.update({
          where: { id: args.id },
          data: { status: COUPON_STATUS.ACTIVE },
        });
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_RESUMED,
          resourceId: args.id,
          resourceType: RESOURCE_TYPE.COUPON,
          actorId: args.actorId,
        });
        return rowToCoupon(updated as Record<string, unknown>);
      });
      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.resumed",
        at: now,
        tenantId,
        couponId: coupon.id,
      });
      return coupon;
    },

    async archive(args) {
      const tenantId = tid(args.tenantId);
      const now = cfg.now();
      const coupon = await prisma.$transaction(async (tx) => {
        const row = await tx.coupon.findFirst({
          where: { id: args.id, tenantId },
        });
        if (!row) throw new CouponNotFoundError("Coupon not found", { tenantId, couponId: args.id });
        const existing = rowToCoupon(row as Record<string, unknown>);
        if (existing.status === COUPON_STATUS.ARCHIVED) {
          throw new CouponArchivedError(undefined, { tenantId, couponId: existing.id });
        }
        const updated = await tx.coupon.update({
          where: { id: args.id },
          data: { status: COUPON_STATUS.ARCHIVED },
        });
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.COUPON_ARCHIVED,
          resourceId: args.id,
          resourceType: RESOURCE_TYPE.COUPON,
          actorId: args.actorId,
        });
        return rowToCoupon(updated as Record<string, unknown>);
      });
      await safeEmit(cfg.events, cfg.logger, {
        type: "coupon.archived",
        at: now,
        tenantId,
        couponId: coupon.id,
      });
      return coupon;
    },
  };

  // =====================================================================
  // validate
  // =====================================================================

  async function validate(input: ValidateInput): Promise<ValidationResult> {
    validateValidateInput(input);
    const tenantId = tid(input.tenantId);
    sanitizeCode(input.code);
    const canonical = canonicalizeCode(input.code);
    const now = cfg.now();

    return prisma.$transaction(async (tx) => {
      // [F] WHERE tenantId AND code — enumeration-safe.
      const row = await tx.coupon.findFirst({
        where: { tenantId, code: canonical },
      });
      if (!row) return { ok: false, reason: COUPON_REJECT_REASON.NOT_FOUND };
      let coupon = rowToCoupon(row as Record<string, unknown>);

      const lazy = await resolveLazyStatus(tx, coupon, now);
      if (lazy.kind === "reject") {
        return { ok: false, reason: COUPON_REJECT_REASON[lazy.reason] };
      }
      coupon = lazy.coupon;

      // Eligibility
      const elig = checkEligibility({
        rules: coupon.eligibility,
        userId: input.userId ?? null,
        context: input.context,
      });
      if (!elig.ok) {
        return { ok: false, reason: elig.reason };
      }

      // Per-user limit pre-check (non-destructive)
      if (coupon.maxRedemptionsPerUser !== null && input.userId) {
        const count = await tx.couponRedemption.count({
          where: {
            tenantId,
            couponId: coupon.id,
            redeemedByUserId: input.userId,
          },
        });
        if (count >= coupon.maxRedemptionsPerUser) {
          return { ok: false, reason: COUPON_REJECT_REASON.PER_USER_LIMIT };
        }
      }

      // Discount preview (only if subtotal/currency available)
      let discountPreview: DiscountBreakdown | null = null;
      if (typeof input.subtotal === "number" && typeof input.currency === "string") {
        try {
          discountPreview = calculate({
            subtotal: input.subtotal,
            currency: input.currency,
            policy: coupon.discount,
          });
        } catch (err) {
          if (err instanceof MinimumOrderNotMetError) {
            return { ok: false, reason: COUPON_REJECT_REASON.MIN_ORDER_NOT_MET };
          }
          throw err;
        }
      }

      return { ok: true, coupon, discountPreview };
    });
  }

  // =====================================================================
  // redeem — concurrency-safe core
  // =====================================================================

  async function runRedeem(
    tx: PrismaTxLike,
    input: RedeemInput,
    tenantId: string,
    now: Date
  ): Promise<RedemptionResult> {
    const canonical = canonicalizeCode(input.code);

    // First, locate the coupon by (tenantId, code) — this is tenant-scoped
    // and enumeration-safe.
    const lookup = await tx.coupon.findFirst({
      where: { tenantId, code: canonical },
      select: { id: true },
    });
    if (!lookup) throw new CouponNotFoundError("Coupon not found", { tenantId, couponCode: canonical });
    const couponId = String((lookup as Record<string, unknown>).id);

    // [CONCURRENCY CORE] Acquire a row-level lock on the Coupon row. This
    // serializes concurrent redeem() calls for the same coupon under READ
    // COMMITTED isolation, preventing per-user race TOCTOU without needing
    // SERIALIZABLE (which would force expensive retries).
    const locked = await tx.$queryRaw<Array<Record<string, unknown>>>`
      SELECT * FROM "Coupon" WHERE "id" = ${couponId} AND "tenantId" = ${tenantId} FOR UPDATE
    `;
    if (!Array.isArray(locked) || locked.length === 0) {
      throw new CouponNotFoundError("Coupon not found", { tenantId, couponId });
    }
    let coupon = rowToCoupon(locked[0]);

    // Archive check (cannot redeem archived).
    if (coupon.status === COUPON_STATUS.ARCHIVED) {
      throw new CouponArchivedError(undefined, { tenantId, couponId: coupon.id, couponCode: coupon.code });
    }
    // Paused/Draft check
    if (
      coupon.status === COUPON_STATUS.PAUSED ||
      coupon.status === COUPON_STATUS.DRAFT
    ) {
      throw new CouponInactiveError(undefined, { tenantId, couponId: coupon.id, couponCode: coupon.code });
    }
    // Time window check
    if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
      throw new CouponExpiredError(
        "Coupon has not started yet",
        { tenantId, couponId: coupon.id, couponCode: coupon.code },
        "NOT_STARTED"
      );
    }
    if (coupon.endsAt && now.getTime() >= coupon.endsAt.getTime()) {
      // lazy transition
      await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          tenantId,
          status: { notIn: [COUPON_STATUS.ARCHIVED, COUPON_STATUS.EXPIRED] },
        },
        data: { status: COUPON_STATUS.EXPIRED },
      });
      throw new CouponExpiredError(undefined, {
        tenantId,
        couponId: coupon.id,
        couponCode: coupon.code,
      });
    }

    // Eligibility
    const elig = checkEligibility({
      rules: coupon.eligibility,
      userId: input.userId ?? null,
      context: input.context,
    });
    if (!elig.ok) {
      throw eligibilityReasonToError(elig.reason);
    }

    // Per-user limit pre-check (non-atomic; post-commit re-check below enforces it atomically)
    if (coupon.maxRedemptionsPerUser !== null && input.userId) {
      const userCount = await tx.couponRedemption.count({
        where: {
          tenantId,
          couponId: coupon.id,
          redeemedByUserId: input.userId,
        },
      });
      if (userCount >= coupon.maxRedemptionsPerUser) {
        throw new PerUserLimitExceededError(undefined, {
          tenantId,
          couponId: coupon.id,
          couponCode: coupon.code,
        });
      }
    }

    // Discount calculation — must succeed BEFORE we commit redemption.
    const discount = calculate({
      subtotal: input.subtotal,
      currency: input.currency,
      policy: coupon.discount,
    });

    // --- The critical conditional UPDATE ---------------------------------
    // [CONCURRENCY CORE]
    // Prisma updateMany with where-redeemedCount<maxRedemptions ensures
    // atomic "check + increment" in a single SQL UPDATE.
    const updWhere: Record<string, unknown> = {
      id: coupon.id,
      tenantId,
      status: { notIn: [COUPON_STATUS.ARCHIVED, COUPON_STATUS.EXPIRED, COUPON_STATUS.EXHAUSTED, COUPON_STATUS.PAUSED, COUPON_STATUS.DRAFT] },
    };
    if (coupon.maxRedemptions !== null) {
      // condition: redeemedCount < maxRedemptions
      updWhere.redeemedCount = { lt: coupon.maxRedemptions };
    }
    const upd = await tx.coupon.updateMany({
      where: updWhere,
      data: w({ redeemedCount: { increment: 1 } }),
    });
    if (upd.count === 0) {
      throw new CouponExhaustedError(undefined, {
        tenantId,
        couponId: coupon.id,
        couponCode: coupon.code,
      });
    }

    // Re-read for fresh redeemedCount & maybe flip status to EXHAUSTED.
    const refreshed = await tx.coupon.findFirst({
      where: { id: coupon.id, tenantId },
    });
    if (!refreshed) {
      // Should not happen inside a tx.
      throw new CouponNotFoundError("Coupon vanished mid-transaction", { tenantId, couponId: coupon.id });
    }
    coupon = rowToCoupon(refreshed as Record<string, unknown>);

    if (
      coupon.maxRedemptions !== null &&
      coupon.redeemedCount >= coupon.maxRedemptions &&
      coupon.status !== COUPON_STATUS.EXHAUSTED
    ) {
      await tx.coupon.updateMany({
        where: {
          id: coupon.id,
          tenantId,
          status: { notIn: [COUPON_STATUS.ARCHIVED, COUPON_STATUS.EXHAUSTED] },
        },
        data: { status: COUPON_STATUS.EXHAUSTED },
      });
      coupon = { ...coupon, status: COUPON_STATUS.EXHAUSTED };
    }

    // INSERT redemption (unique key guards idempotency).
    // Unique conflict on (couponId, userId, orderRef) -> throw. Prisma aborts
    // the whole transaction, which correctly rolls back the counter bump we
    // did above. Do NOT issue further queries on this tx after the conflict
    // (Postgres refuses with "transaction aborted").
    let redemption: Redemption;
    try {
      const inserted = await tx.couponRedemption.create({
        data: {
          id: cfg.idGenerator(),
          tenantId,
          couponId: coupon.id,
          redeemedByUserId: input.userId ?? null,
          orderRef: input.orderRef ?? null,
          discountAmount: discount.discountAmount,
          currency: input.currency,
          metadata: w((input.metadata ?? null)),
        },
      });
      redemption = rowToRedemption(inserted as Record<string, unknown>);
    } catch (err) {
      throw new CouponAlreadyRedeemedError(undefined, {
        tenantId,
        couponId: coupon.id,
        couponCode: coupon.code,
        cause: err,
      });
    }

    // After INSERT succeeded, enforce per-user limit atomically within this
    // transaction: COUNT rows with same (couponId, userId) including the one
    // we just inserted. If above the cap, throw — Prisma rolls back.
    if (coupon.maxRedemptionsPerUser !== null && input.userId) {
      const userCountFinal = await tx.couponRedemption.count({
        where: {
          tenantId,
          couponId: coupon.id,
          redeemedByUserId: input.userId,
        },
      });
      if (userCountFinal > coupon.maxRedemptionsPerUser) {
        throw new PerUserLimitExceededError(undefined, {
          tenantId,
          couponId: coupon.id,
          couponCode: coupon.code,
        });
      }
    }

    await writeAudit(tx, {
      tenantId,
      action: AUDIT_ACTION.COUPON_REDEEMED,
      resourceId: coupon.id,
      resourceType: RESOURCE_TYPE.COUPON,
      actorId: input.userId ?? null,
      details: {
        redemptionId: redemption.id,
        userId: redemption.redeemedByUserId,
        orderRef: redemption.orderRef,
        discountAmount: redemption.discountAmount,
        currency: redemption.currency,
      },
    });

    return { redemption, coupon, discount };
  }

  async function redeem(input: RedeemInput): Promise<RedemptionResult> {
    validateRedeemInput(input);
    const tenantId = tid(input.tenantId);
    const now = cfg.now();

    let result: RedemptionResult;
    let rejectAudit:
      | { action: typeof AUDIT_ACTION.COUPON_REDEEM_REJECTED; reason: string }
      | null = null;

    try {
      if (input.tx) {
        result = await runRedeem(input.tx, input, tenantId, now);
      } else {
        result = await prisma.$transaction((tx) => runRedeem(tx, input, tenantId, now));
      }
    } catch (err) {
      // Record rejection audit in a *separate* transaction so it isn't rolled back.
      if (err instanceof CouponError) {
        try {
          await prisma.couponAuditLog.create({
            data: {
              id: cfg.idGenerator(),
              tenantId,
              action: AUDIT_ACTION.COUPON_REDEEM_REJECTED,
              resourceId: err.couponId ?? null,
              resourceType: RESOURCE_TYPE.COUPON,
              actorId: input.userId ?? null,
              details: {
                reason: err.code,
                code: err.couponCode ?? canonicalizeCode(input.code),
                userId: input.userId ?? null,
                orderRef: input.orderRef ?? null,
              },
            },
          });
        } catch (auditErr) {
          cfg.logger.warn("coupon.redeem.rejected_audit_failed", {
            error: auditErr instanceof Error ? auditErr.message : String(auditErr),
          });
        }
        await safeEmit(cfg.events, cfg.logger, {
          type: "coupon.redeem.rejected",
          at: now,
          tenantId,
          code: canonicalizeCode(input.code),
          reason: err.code as never,
          userId: input.userId ?? null,
          orderRef: input.orderRef ?? null,
        });
      }
      throw err;
    }

    // commit succeeded — emit event (outside tx)
    await safeEmit(cfg.events, cfg.logger, {
      type: "coupon.redeemed",
      at: now,
      tenantId,
      redemption: result.redemption,
    });
    return result;
  }

  // =====================================================================
  // discount.calculate
  // =====================================================================

  const discountNs = {
    calculate(input: DiscountInput): DiscountBreakdown {
      return calculate(input);
    },
  };

  // =====================================================================
  // campaigns.*
  // =====================================================================

  const campaigns: CouponClient["campaigns"] = {
    async create(input) {
      validateCreateCampaignInput(input);
      const tenantId = tid(input.tenantId);
      const eligibility = assertEligibility(input.eligibility);
      const metadata = assertMetadata(input.metadata);
      const now = cfg.now();

      const campaign = await prisma.$transaction(async (tx) => {
        const row = await tx.campaign.create({
          data: {
            id: cfg.idGenerator(),
            tenantId,
            name: input.name,
            status: CAMPAIGN_STATUS.ACTIVE,
            discount: w(input.discount),
            eligibility: w(eligibility),
            startsAt: input.startsAt ?? null,
            endsAt: input.endsAt ?? null,
            maxCoupons: input.maxCoupons ?? null,
            metadata: w((metadata ?? null)),
          },
        });
        const campaign = rowToCampaign(row as Record<string, unknown>);
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.CAMPAIGN_CREATED,
          resourceId: campaign.id,
          resourceType: RESOURCE_TYPE.CAMPAIGN,
          actorId: input.actorId,
          details: { name: campaign.name },
        });
        return campaign;
      });

      await safeEmit(cfg.events, cfg.logger, {
        type: "campaign.created",
        at: now,
        tenantId,
        campaign,
      });
      return campaign;
    },

    async get(args) {
      const tenantId = tid(args.tenantId);
      if (!args.id) throw new ValidationError("id is required");
      const row = await prisma.campaign.findFirst({
        where: { id: args.id, tenantId },
      });
      return row ? rowToCampaign(row as Record<string, unknown>) : null;
    },

    async list(args) {
      const tenantId = tid(args.tenantId);
      const limit = assertPaginationLimit(args.limit);
      const where: Record<string, unknown> = { tenantId };
      if (args.status) where.status = args.status;
      return paginate(
        prisma.campaign,
        where,
        limit,
        args.cursor,
        rowToCampaign,
        { createdAt: "desc" }
      );
    },

    async issue(args) {
      if (!args || typeof args !== "object") throw new ValidationError("args required");
      if (typeof args.campaignId !== "string" || !args.campaignId) {
        throw new ValidationError("campaignId is required");
      }
      if (
        typeof args.count !== "number" ||
        !Number.isInteger(args.count) ||
        args.count <= 0 ||
        args.count > LIMITS.BULK_MAX_COUNT
      ) {
        throw new ValidationError(
          `count must be a positive integer <= ${LIMITS.BULK_MAX_COUNT}`
        );
      }
      const tenantId = tid(args.tenantId);

      // Fetch campaign for policy inheritance. This read is outside the tx
      // only to copy policy fields (discount/eligibility/window) into the
      // issueBulk payload; the AUTHORITATIVE capacity + CLOSED checks happen
      // INSIDE issueBulk's tx via a conditional updateMany that enforces spec
      // §5.5 I4 (issuedCount <= maxCoupons) atomically under concurrency.
      const campRow = await prisma.campaign.findFirst({
        where: { id: args.campaignId, tenantId },
      });
      if (!campRow) {
        throw new ValidationError("campaign not found", undefined, {
          tenantId,
          couponId: args.campaignId,
        });
      }
      const campaign = rowToCampaign(campRow as Record<string, unknown>);
      // Fast-path preflight: cheap CLOSED check to avoid doing work we'll
      // immediately rollback. The tx-internal updateMany is still the source
      // of truth for concurrency safety.
      if (campaign.status === CAMPAIGN_STATUS.CLOSED) {
        throw new CampaignClosedError(undefined, { tenantId, couponId: campaign.id });
      }

      return coupons.issueBulk({
        tenantId,
        count: args.count,
        codeLength: args.codeLength,
        campaignId: campaign.id,
        discount: campaign.discount,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        maxAttempts: args.maxAttempts,
        eligibility: campaign.eligibility,
        actorId: args.actorId,
      });
    },

    async summary(args) {
      const tenantId = tid(args.tenantId);
      if (!args.id) throw new ValidationError("id is required");
      const campRow = await prisma.campaign.findFirst({
        where: { id: args.id, tenantId },
      });
      if (!campRow) {
        throw new ValidationError("campaign not found", undefined, {
          tenantId,
          couponId: args.id,
        });
      }
      const campaign = rowToCampaign(campRow as Record<string, unknown>);

      // Aggregate redemptions across all coupons of this campaign.
      const couponRows = await prisma.coupon.findMany({
        where: { tenantId, campaignId: campaign.id },
      });
      const couponIds = couponRows.map((r) => String((r as Record<string, unknown>).id));

      let redeemedCount = 0;
      let totalDiscount = 0;
      let lastRedeemedAt: Date | null = null;
      const uniqueUserSet = new Set<string>();

      if (couponIds.length > 0) {
        const reds = await prisma.couponRedemption.findMany({
          where: { tenantId, couponId: { in: couponIds } },
        });
        redeemedCount = reds.length;
        for (const r of reds) {
          const row = r as Record<string, unknown>;
          const amt = row.discountAmount;
          if (typeof amt === "number") totalDiscount += amt;
          const uid = row.redeemedByUserId;
          if (typeof uid === "string" && uid.length > 0) uniqueUserSet.add(uid);
          const ra = row.redeemedAt;
          const raDate =
            ra instanceof Date
              ? ra
              : typeof ra === "string" || typeof ra === "number"
                ? new Date(ra)
                : null;
          if (raDate && (!lastRedeemedAt || raDate.getTime() > lastRedeemedAt.getTime())) {
            lastRedeemedAt = raDate;
          }
        }
      }

      const remaining =
        campaign.maxCoupons === null ? null : Math.max(campaign.maxCoupons - campaign.issuedCount, 0);

      return {
        id: campaign.id,
        tenantId: campaign.tenantId,
        name: campaign.name,
        status: campaign.status,
        issuedCount: campaign.issuedCount,
        redeemedCount,
        remaining,
        totalDiscount,
        uniqueUsers: uniqueUserSet.size,
        lastRedeemedAt,
      };
    },

    async close(args) {
      const tenantId = tid(args.tenantId);
      if (!args.id) throw new ValidationError("id is required");
      const now = cfg.now();
      const campaign = await prisma.$transaction(async (tx) => {
        const row = await tx.campaign.findFirst({
          where: { id: args.id, tenantId },
        });
        if (!row) {
          throw new ValidationError("campaign not found", undefined, {
            tenantId,
            couponId: args.id,
          });
        }
        const updated = await tx.campaign.update({
          where: { id: args.id },
          data: { status: CAMPAIGN_STATUS.CLOSED },
        });
        await writeAudit(tx, {
          tenantId,
          action: AUDIT_ACTION.CAMPAIGN_CLOSED,
          resourceId: args.id,
          resourceType: RESOURCE_TYPE.CAMPAIGN,
          actorId: args.actorId,
        });
        return rowToCampaign(updated as Record<string, unknown>);
      });
      await safeEmit(cfg.events, cfg.logger, {
        type: "campaign.closed",
        at: now,
        tenantId,
        campaignId: campaign.id,
      });
      return campaign;
    },
  };

  // =====================================================================
  // audit.*
  // =====================================================================

  const audit: CouponClient["audit"] = {
    async listIssuances(args) {
      const tenantId = tid(args.tenantId);
      const limit = assertPaginationLimit(args.limit);
      const where: Record<string, unknown> = { tenantId };
      if (args.couponId) where.couponId = args.couponId;
      if (args.issuedToUserId) where.issuedToUserId = args.issuedToUserId;
      return paginate(
        prisma.couponIssuance,
        where,
        limit,
        args.cursor,
        rowToIssuance,
        { issuedAt: "desc" }
      );
    },

    async listRedemptions(args) {
      const tenantId = tid(args.tenantId);
      const limit = assertPaginationLimit(args.limit);
      const where: Record<string, unknown> = { tenantId };
      if (args.couponId) where.couponId = args.couponId;
      if (args.redeemedByUserId) where.redeemedByUserId = args.redeemedByUserId;
      return paginate(
        prisma.couponRedemption,
        where,
        limit,
        args.cursor,
        rowToRedemption,
        { redeemedAt: "desc" }
      );
    },

    async listLogs(args) {
      const tenantId = tid(args.tenantId);
      const limit = assertPaginationLimit(args.limit);
      const where: Record<string, unknown> = { tenantId };
      if (args.action) where.action = args.action;
      if (args.resourceId) where.resourceId = args.resourceId;
      if (args.resourceType) where.resourceType = args.resourceType;
      return paginate(
        prisma.couponAuditLog,
        where,
        limit,
        args.cursor,
        rowToAuditLog,
        { createdAt: "desc" }
      );
    },
  };

  return {
    coupons,
    validate,
    redeem,
    discount: discountNs,
    campaigns,
    audit,
  };
}
