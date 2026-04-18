import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCouponClient } from "../../src/index.js";
import {
  asPrismaLike,
  disconnectPrisma,
  freshTenantId,
  getPrisma,
  truncateTenant,
} from "../setup.js";

describe("T-15 All 5 injection points are actually invoked (Q1 DECISION)", () => {
  const prisma = getPrisma();
  const tenantId = freshTenantId("t15");

  beforeAll(async () => {
    await truncateTenant(prisma, tenantId);
  });
  afterAll(async () => {
    await truncateTenant(prisma, tenantId);
    await disconnectPrisma();
  });

  it("now / idGenerator / codeGenerator / events.onEvent / logger all called", async () => {
    const now = vi.fn(() => new Date("2026-10-10T10:10:10Z"));
    let counter = 0;
    const idGenerator = vi.fn(() => `custom-id-${++counter}`);
    const codeGenerator = vi.fn((opts: { length: number }) => "CUSTC" + opts.length + Date.now().toString(36).toUpperCase());
    const onEvent = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const client = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      now,
      idGenerator,
      codeGenerator,
      events: { onEvent },
      logger,
    });

    const c = await client.coupons.create({
      discount: { kind: "PERCENT", percent: 15 },
    });

    // idGenerator invoked at least once
    expect(idGenerator).toHaveBeenCalled();
    // codeGenerator invoked at least once (because no explicit code)
    expect(codeGenerator).toHaveBeenCalled();
    // now invoked
    expect(now).toHaveBeenCalled();
    // events.onEvent invoked
    expect(onEvent).toHaveBeenCalled();

    // Custom ID was applied
    expect(c.id.startsWith("custom-id-")).toBe(true);
    // Custom code prefix
    expect(c.code.startsWith("CUSTC")).toBe(true);

    // Force a logger.warn by throwing inside onEvent
    const warnLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const client2 = createCouponClient({
      prisma: asPrismaLike(prisma),
      defaultTenantId: tenantId,
      idGenerator,
      codeGenerator,
      now,
      events: { onEvent: bad },
      logger: warnLogger,
    });
    await client2.coupons.create({
      discount: { kind: "FIXED", amount: 100, currency: "KRW" },
    });
    expect(warnLogger.warn).toHaveBeenCalled();
  });
});
