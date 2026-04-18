/**
 * ID / code generators.
 * - cuid2 as default internal ID generator.
 * - nanoid with confusion-free alphabet as default coupon code generator.
 */

import { createId } from "@paralleldrive/cuid2";
import { customAlphabet } from "nanoid";
import { LIMITS } from "./domain/constants.js";
import { ValidationError } from "./domain/errors.js";

export function defaultIdGenerator(): string {
  return createId();
}

export type CodeGeneratorOpts = {
  length: number;
  alphabet?: string;
};

export function defaultCodeGenerator(opts: CodeGeneratorOpts): string {
  const alphabet = opts.alphabet ?? LIMITS.CODE_DEFAULT_ALPHABET;
  const length = opts.length;
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < LIMITS.CODE_MIN_LENGTH ||
    length > LIMITS.CODE_MAX_LENGTH
  ) {
    throw new ValidationError(
      `code length must be an integer in [${LIMITS.CODE_MIN_LENGTH}, ${LIMITS.CODE_MAX_LENGTH}] (got ${String(length)})`
    );
  }
  if (typeof alphabet !== "string" || alphabet.length === 0) {
    throw new ValidationError("code alphabet must be a non-empty string");
  }
  const nano = customAlphabet(alphabet, length);
  return nano();
}
