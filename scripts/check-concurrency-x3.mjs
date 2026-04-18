#!/usr/bin/env node
/**
 * Runs the concurrency test file 3 consecutive times. Exits non-zero on any
 * failure. Prints "3/3 PASS" on success.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const testFile = "tests/integration/T06-concurrent-redeem.test.ts";

let pass = 0;
for (let i = 1; i <= 3; i++) {
  console.log(`\n=== concurrency run ${i}/3 ===`);
  const r = spawnSync(
    "npx",
    ["vitest", "run", testFile],
    {
      cwd: PKG_ROOT,
      stdio: "inherit",
      env: { ...process.env },
    }
  );
  if (r.status === 0) {
    pass++;
  } else {
    console.error(`run ${i}/3 FAILED (exit ${r.status})`);
    process.exit(1);
  }
}

console.log(`\n${pass}/3 PASS`);
process.exit(0);
