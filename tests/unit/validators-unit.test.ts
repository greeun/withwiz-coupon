import { describe, expect, it } from "vitest";
import {
  canonicalizeCode,
  sanitizeCode,
} from "../../src/validators.js";
import { ValidationError } from "../../src/index.js";

describe("validators unit", () => {
  it("sanitizeCode normalizes NFKC and upper-cases (AMENDMENT-2 whitelist)", () => {
    // Post-AMENDMENT-2: sanitizeCode is the single enforcement point for the
    // [A] whitelist. It upper-cases the input and enforces /^[A-Z0-9_-]+$/.
    expect(sanitizeCode("abc123")).toBe("ABC123");
    expect(sanitizeCode("ABC_123")).toBe("ABC_123");
    expect(sanitizeCode("abc-123")).toBe("ABC-123");
  });

  it("sanitizeCode rejects SQL meta / quote / CJK / emoji (AMENDMENT-2 [A])", () => {
    for (const bad of ["ABC'", "ABC;DROP", "ABC.", "ABC:", "ABC/x", "ABC한", "ABC🎉"]) {
      expect(() => sanitizeCode(bad)).toThrow(ValidationError);
    }
  });

  it("sanitizeCode rejects non-string", () => {
    expect(() => sanitizeCode(12 as unknown as string)).toThrow(ValidationError);
  });

  it("sanitizeCode rejects control char at end", () => {
    expect(() => sanitizeCode("abc\u007f")).toThrow(ValidationError);
  });

  it("canonicalizeCode upper-cases", () => {
    expect(canonicalizeCode("welcome10")).toBe("WELCOME10");
  });

  it("sanitizeCode rejects newline", () => {
    expect(() => sanitizeCode("abc\ndef")).toThrow(ValidationError);
    expect(() => sanitizeCode("abc\rdef")).toThrow(ValidationError);
  });
});
