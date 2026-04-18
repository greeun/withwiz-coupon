import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/index.js";

// Import the internal module directly via the built src path.
import { defaultCodeGenerator, defaultIdGenerator } from "../../src/id.js";

describe("id unit", () => {
  it("defaultIdGenerator produces non-empty unique strings", () => {
    const a = defaultIdGenerator();
    const b = defaultIdGenerator();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("defaultCodeGenerator with default alphabet & length", () => {
    const c = defaultCodeGenerator({ length: 12 });
    expect(c.length).toBe(12);
    for (const ch of c) {
      // The default alphabet excludes confusing characters.
      expect("01OILouildk".includes(ch)).toBe(false);
    }
  });

  it("defaultCodeGenerator rejects invalid length / empty alphabet", () => {
    expect(() => defaultCodeGenerator({ length: 0 })).toThrow(ValidationError);
    expect(() => defaultCodeGenerator({ length: 65 })).toThrow(ValidationError);
    expect(() =>
      defaultCodeGenerator({ length: 5, alphabet: "" })
    ).toThrow(ValidationError);
  });

  it("custom alphabet respected", () => {
    const c = defaultCodeGenerator({ length: 10, alphabet: "AB" });
    for (const ch of c) expect(["A", "B"].includes(ch)).toBe(true);
  });
});
