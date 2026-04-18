/**
 * Row → DTO mappers. Prisma returns Json columns as unknown; we assert them
 * into our DTO types here.
 */

import type {
  AuditLog,
  Campaign,
  Coupon,
  DiscountPolicy,
  EligibilityRules,
  Issuance,
  Redemption,
} from "./domain/types.js";
import type { CouponStatus, CampaignStatus } from "./domain/constants.js";

type RawRow = Record<string, unknown>;

function asString(v: unknown, field: string): string {
  if (typeof v !== "string") {
    throw new Error(`mapping: expected string for ${field}, got ${typeof v}`);
  }
  return v;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return String(v);
  return v;
}

function asNumber(v: unknown, field: string): number {
  if (typeof v !== "number") {
    throw new Error(`mapping: expected number for ${field}, got ${typeof v}`);
  }
  return v;
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number") return Number(v);
  return v;
}

function asDate(v: unknown, field: string): Date {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  throw new Error(`mapping: expected Date for ${field}, got ${typeof v}`);
}

function asDateOrNull(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  return null;
}

function asJsonObject(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

/**
 * Read an arbitrary Json object and coerce it to a domain DTO of type T.
 * Single documented point of Json → DTO coercion.
 */
function jsonAs<T>(v: unknown): T {
  return (asJsonObject(v) ?? {}) as T;  // allow-any: Json → domain DTO coercion
}

export function rowToCoupon(row: RawRow): Coupon {
  return {
    id: asString(row.id, "id"),
    tenantId: asString(row.tenantId, "tenantId"),
    campaignId: asStringOrNull(row.campaignId),
    code: asString(row.code, "code"),
    status: asString(row.status, "status") as CouponStatus,
    discount: jsonAs<DiscountPolicy>(row.discount),
    startsAt: asDateOrNull(row.startsAt),
    endsAt: asDateOrNull(row.endsAt),
    maxRedemptions: asNumberOrNull(row.maxRedemptions),
    redeemedCount: asNumber(row.redeemedCount, "redeemedCount"),
    maxRedemptionsPerUser: asNumberOrNull(row.maxRedemptionsPerUser),
    eligibility: (asJsonObject(row.eligibility) ?? {}) as EligibilityRules,
    metadata: asJsonObject(row.metadata),
    createdAt: asDate(row.createdAt, "createdAt"),
    updatedAt: asDate(row.updatedAt, "updatedAt"),
  };
}

export function rowToCampaign(row: RawRow): Campaign {
  return {
    id: asString(row.id, "id"),
    tenantId: asString(row.tenantId, "tenantId"),
    name: asString(row.name, "name"),
    status: asString(row.status, "status") as CampaignStatus,
    discount: jsonAs<DiscountPolicy>(row.discount),
    eligibility: (asJsonObject(row.eligibility) ?? {}) as EligibilityRules,
    startsAt: asDateOrNull(row.startsAt),
    endsAt: asDateOrNull(row.endsAt),
    maxCoupons: asNumberOrNull(row.maxCoupons),
    issuedCount: asNumber(row.issuedCount, "issuedCount"),
    metadata: asJsonObject(row.metadata),
    createdAt: asDate(row.createdAt, "createdAt"),
    updatedAt: asDate(row.updatedAt, "updatedAt"),
  };
}

export function rowToIssuance(row: RawRow): Issuance {
  return {
    id: asString(row.id, "id"),
    tenantId: asString(row.tenantId, "tenantId"),
    couponId: asString(row.couponId, "couponId"),
    issuedToUserId: asStringOrNull(row.issuedToUserId),
    issuedBy: asStringOrNull(row.issuedBy),
    issuedAt: asDate(row.issuedAt, "issuedAt"),
    metadata: asJsonObject(row.metadata),
  };
}

export function rowToRedemption(row: RawRow): Redemption {
  return {
    id: asString(row.id, "id"),
    tenantId: asString(row.tenantId, "tenantId"),
    couponId: asString(row.couponId, "couponId"),
    redeemedByUserId: asStringOrNull(row.redeemedByUserId),
    orderRef: asStringOrNull(row.orderRef),
    discountAmount: asNumber(row.discountAmount, "discountAmount"),
    currency: asString(row.currency, "currency"),
    redeemedAt: asDate(row.redeemedAt, "redeemedAt"),
    metadata: asJsonObject(row.metadata),
  };
}

export function rowToAuditLog(row: RawRow): AuditLog {
  return {
    id: asString(row.id, "id"),
    tenantId: asString(row.tenantId, "tenantId"),
    action: asString(row.action, "action"),
    resourceId: asStringOrNull(row.resourceId),
    resourceType: asStringOrNull(row.resourceType),
    actorId: asStringOrNull(row.actorId),
    details: asJsonObject(row.details),
    createdAt: asDate(row.createdAt, "createdAt"),
  };
}
