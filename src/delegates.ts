/**
 * Prisma delegate / physical table resolution.
 *
 * The schema fragment ships five models (`Coupon`, `Campaign`,
 * `CouponIssuance`, `CouponRedemption`, `CouponAuditLog`). A consumer whose
 * own schema already owns one of those names — `Campaign` is the common
 * collision — can rename them and declare the mapping through
 * `createCouponClient({ models, tables })`.
 *
 * Every delegate access and every raw-SQL table reference in this package is
 * routed through the resolver built here, so no model name is hardcoded
 * anywhere else in `src/`.
 */

import { InvalidModelNameError } from "./domain/errors.js";
import type { DelegateLike, PrismaTxLike } from "./domain/types.js";

/** The five logical models this package owns. */
export type CouponModelKey =
  | "coupon"
  | "campaign"
  | "couponIssuance"
  | "couponRedemption"
  | "couponAuditLog";

/** Prisma delegate property names, keyed by logical model. */
export type ModelNameMap = Record<CouponModelKey, string>;

/** Physical table names (as they appear in SQL), keyed by logical model. */
export type TableNameMap = Record<CouponModelKey, string>;

export const MODEL_KEYS: readonly CouponModelKey[] = [
  "coupon",
  "campaign",
  "couponIssuance",
  "couponRedemption",
  "couponAuditLog",
];

/** Delegate names produced by the unmodified schema fragment. */
export const DEFAULT_MODEL_NAMES: ModelNameMap = {
  coupon: "coupon",
  campaign: "campaign",
  couponIssuance: "couponIssuance",
  couponRedemption: "couponRedemption",
  couponAuditLog: "couponAuditLog",
};

/**
 * Identifier guard. Table names are interpolated into raw SQL (there is no
 * way to parameterize an identifier), so anything that is not a plain
 * `[A-Za-z_][A-Za-z0-9_]*` word is rejected before it can reach the database.
 * Delegate names run through the same guard for symmetry.
 */
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertIdentifier(kind: string, key: CouponModelKey, value: string): string {
  if (typeof value !== "string" || !IDENTIFIER_RE.test(value)) {
    throw new InvalidModelNameError(
      `Invalid ${kind} for model "${key}": ${JSON.stringify(value)}. ` +
        `Expected a plain identifier matching ${IDENTIFIER_RE.source}.`
    );
  }
  return value;
}

/**
 * Merge caller overrides over the fragment defaults.
 */
export function resolveModelNames(overrides?: Partial<ModelNameMap>): ModelNameMap {
  const out = { ...DEFAULT_MODEL_NAMES };
  for (const key of MODEL_KEYS) {
    const override = overrides?.[key];
    if (override === undefined) continue;
    out[key] = assertIdentifier("model name", key, override);
  }
  return out;
}

/**
 * Derive physical table names from delegate names.
 *
 * Prisma's default mapping capitalizes the delegate name back into the model
 * name (`prisma.couponAuditLog` ⇢ table `"CouponAuditLog"`). A consumer using
 * `@@map` must pass `tables` explicitly.
 */
export function resolveTableNames(
  models: ModelNameMap,
  overrides?: Partial<TableNameMap>
): TableNameMap {
  const out = {} as TableNameMap;
  for (const key of MODEL_KEYS) {
    const override = overrides?.[key];
    out[key] =
      override === undefined
        ? models[key].charAt(0).toUpperCase() + models[key].slice(1)
        : assertIdentifier("table name", key, override);
  }
  return out;
}

/**
 * Resolves a logical model to the delegate object on a client or transaction
 * handle. Both `PrismaLike` and `PrismaTxLike` are accepted because Prisma
 * exposes the same delegate shape on either.
 */
export type DelegateResolver = {
  [K in CouponModelKey]: (db: PrismaTxLike) => DelegateLike;
} & {
  /** The resolved delegate names, for diagnostics. */
  readonly models: ModelNameMap;
  /** The resolved physical table names, used by the raw-SQL lock path. */
  readonly tables: TableNameMap;
};

function pick(db: PrismaTxLike, key: CouponModelKey, name: string): DelegateLike {
  const delegate = (db as unknown as Record<string, DelegateLike | undefined>)[name];
  if (!delegate || typeof delegate.findFirst !== "function") {
    throw new InvalidModelNameError(
      `Prisma delegate "${name}" (model "${key}") is missing on the client passed to ` +
        `createCouponClient. Either add the model to your schema or map it through ` +
        `config.models.${key}.`
    );
  }
  return delegate;
}

export function createDelegateResolver(
  models: ModelNameMap,
  tables: TableNameMap
): DelegateResolver {
  const resolver = {
    models,
    tables,
  } as DelegateResolver;
  for (const key of MODEL_KEYS) {
    // Bind the name once; the lookup itself stays lazy so a transaction handle
    // is resolved against its own delegates rather than the root client's.
    (resolver as Record<string, unknown>)[key] = (db: PrismaTxLike) =>
      pick(db, key, models[key]);
  }
  return resolver;
}

/**
 * `SELECT ... FOR UPDATE` on the coupon row, with the table name resolved at
 * call time.
 *
 * `$queryRaw` is a tagged template, and the table name cannot be a bound
 * parameter, so the template strings are assembled here while `couponId` and
 * `tenantId` stay parameterized. `table` has already passed
 * {@link assertIdentifier}, so the interpolation cannot break out of the
 * quoted identifier.
 */
export function lockCouponRow(
  tx: PrismaTxLike,
  table: string,
  couponId: string,
  tenantId: string
): Promise<Array<Record<string, unknown>>> {
  const parts = [
    `SELECT * FROM "${table}" WHERE "id" = `,
    ` AND "tenantId" = `,
    ` FOR UPDATE`,
  ];
  const strings = Object.assign([...parts], {
    raw: [...parts],
  }) as unknown as TemplateStringsArray;
  return tx.$queryRaw<Array<Record<string, unknown>>>(strings, couponId, tenantId);
}
