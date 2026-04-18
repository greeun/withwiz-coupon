# @withwiz/coupon

Multi-tenant, concurrency-safe coupon domain core for Prisma + Node.js.
Drop-in for Next.js / serverless / any Node backend. No UI, no payment glue,
no emitter side effects — pure coupon lifecycle.

> 본 패키지는 멀티테넌트·동시성 안전 쿠폰 도메인 코어입니다. UI/결제/메일 어떤 것도 결합하지 않고
> Prisma를 통해 consumer가 이미 가진 DB에 쿠폰 스키마를 병합해 사용합니다.

## Install

```bash
npm install @withwiz/coupon
# peer deps
npm install @prisma/client
```

Peer dependencies:

- `@prisma/client` >= 5 < 7
- `typescript` >= 5 (optional)

Runtime dependencies (bundled): `zod`, `nanoid`, `@paralleldrive/cuid2`.

Node.js >= 18.17.

## Quick Start

```ts
import { createCouponClient } from "@withwiz/coupon";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const coupon = createCouponClient({
  prisma,
  defaultTenantId: "tlog",
  events: {
    async onEvent(e) {
      // Fan out to queue, webhook, analytics, etc.
      if (e.type === "coupon.redeemed") {
        // await fetch(...); await bullQueue.add(...);
      }
    },
  },
});

// 1) Admin creates a campaign and issues 10,000 codes
const campaign = await coupon.campaigns.create({
  name: "SPRING2026",
  discount: { kind: "PERCENT", percent: 10, maxDiscount: 5000 },
  startsAt: new Date("2026-04-01"),
  endsAt: new Date("2026-04-30"),
  maxCoupons: 10_000,
});
await coupon.campaigns.issue({ campaignId: campaign.id, count: 10_000, codeLength: 10 });

// 2) Customer applies a code at checkout (non-destructive preview)
const preview = await coupon.validate({
  code: "ABC123",
  userId: "u_42",
  subtotal: 45000,
  currency: "KRW",
  context: { plan: "PREMIUM" },
});
if (!preview.ok) throw new Error(preview.reason); // NOT_FOUND / EXPIRED / ...

// 3) Customer confirms order — piggyback on consumer's transaction
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: { /* ... */ } });
  await coupon.redeem({
    code: "ABC123",
    userId: "u_42",
    orderRef: order.id,
    subtotal: 45000,
    currency: "KRW",
    context: { plan: "PREMIUM" },
    tx, // SAME transaction as the order write
  });
});

// 4) Admin reads live summary
const s = await coupon.campaigns.summary({ id: campaign.id });
```

## Schema Setup

Copy the contents of `prisma/fragment.prisma` from this package into your
`schema.prisma` and run your normal Prisma migration workflow:

```bash
# After copying the fragment, regenerate and migrate:
npx prisma generate
npx prisma migrate dev --name add_coupon
```

Model names may be renamed if they conflict with your existing schema;
however the field names, indexes and the `@@unique` constraints must be
preserved for concurrency and invariants to hold.

## Errors

All errors extend `CouponError` and carry a stable string `code`.

| Class | `code` |
|---|---|
| `ValidationError` | `VALIDATION_ERROR` |
| `InvalidDiscountPolicyError` | `INVALID_DISCOUNT_POLICY` |
| `InvalidDateRangeError` | `INVALID_DATE_RANGE` |
| `CurrencyMismatchError` | `CURRENCY_MISMATCH` |
| `CouponNotFoundError` | `NOT_FOUND` |
| `CouponArchivedError` | `ARCHIVED` |
| `CouponInactiveError` | `PAUSED` |
| `CouponExpiredError` | `EXPIRED` or `NOT_STARTED` |
| `CouponExhaustedError` | `EXHAUSTED` |
| `CouponAlreadyRedeemedError` | `ALREADY_REDEEMED` |
| `PerUserLimitExceededError` | `PER_USER_LIMIT` |
| `IneligibleUserError` | `INELIGIBLE_USER` |
| `IneligiblePlanError` | `INELIGIBLE_PLAN` |
| `IneligibleProductError` | `INELIGIBLE_PRODUCT` |
| `IneligibleCategoryError` | `INELIGIBLE_CATEGORY` |
| `MinimumOrderNotMetError` | `MIN_ORDER_NOT_MET` |
| `CampaignClosedError` | `CAMPAIGN_CLOSED` |
| `CampaignCapacityExceededError` | `CAMPAIGN_CAPACITY_EXCEEDED` |
| `TenantMismatchError` | `TENANT_MISMATCH` |

## CouponRejectReason

`validate()` returns `{ ok: false, reason }` where `reason` is a closed
union of 13 literals:

```
'NOT_FOUND' | 'NOT_STARTED' | 'EXPIRED' | 'EXHAUSTED'
| 'PER_USER_LIMIT' | 'MIN_ORDER_NOT_MET'
| 'INELIGIBLE_USER' | 'INELIGIBLE_PLAN' | 'INELIGIBLE_PRODUCT' | 'INELIGIBLE_CATEGORY'
| 'PAUSED' | 'ARCHIVED' | 'TENANT_MISMATCH'
```

Each reason maps 1:1 to an error class `code` emitted by `redeem()` on the
corresponding failure path.

## Events

`CouponEvent` union:

```
coupon.created | coupon.issued | coupon.issued.bulk
| coupon.redeemed | coupon.redeem.rejected
| coupon.paused | coupon.resumed | coupon.archived
| campaign.created | campaign.closed
```

Events fire **after** the transactional mutation commits. If your handler
throws, the business result is preserved and a `logger.warn` is emitted.

```ts
createCouponClient({
  prisma,
  events: {
    async onEvent(e) {
      switch (e.type) {
        case "coupon.redeemed":
          // enqueue webhook / analytics / email
          break;
      }
    },
  },
});
```

## Multi-tenant

Every public method requires `tenantId`, either via:

- explicit `tenantId` on the call args, or
- `config.defaultTenantId` passed to `createCouponClient`.

If neither is provided, calls throw `ValidationError`. Cross-tenant lookups
(e.g. tenant B querying tenant A's code) return `null` / `NOT_FOUND` to
prevent enumeration attacks.

For single-tenant applications, set `defaultTenantId: "default"` at init and
never touch tenantId again.

## Security Notes

- Coupon codes are **case-normalized to upper-case** before storage and
  lookup. `welcome10` and `WELCOME10` are the same code.
- `code` length cap is 64. Control chars, NUL, whitespace and homoglyph
  variants are rejected at input.
- `metadata` object is guarded against prototype pollution (`__proto__` /
  `constructor` / `prototype` keys rejected).
- `issueBulk.count` and `campaigns.issue.count` are capped at 10,000.
- Cursor pagination defaults to `limit=50`, max `limit=200`.
- No `$executeRawUnsafe` / `$queryRawUnsafe` is used anywhere in this
  package.

## Non-goals / Future

- UI components, admin dashboards, React hooks
- Stripe / PayPal / PG integration
- Email / SMS / push
- Edge runtime (Cloudflare Workers / Vercel Edge)
- i18n: error messages are English-only. Translate on the consumer side.

A future minor version may add an optional `batchKey` to `issueBulk()` for
caller-supplied idempotency.

## License

MIT
