#!/usr/bin/env node
/**
 * Package isolation checker — runs V1~V7 + V2a~V2d grep gates.
 * Exits non-zero on any violation.
 *
 * Scope: ONLY scan packages/coupon/src (+ dist when present).
 * This script intentionally does NOT scan the consumer repo above us.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const SRC = join(PKG_ROOT, "src");
const DIST = join(PKG_ROOT, "dist");

/**
 * Recursive file walker for .ts / .mjs / .cjs files (and .d.ts in dist).
 */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walk(p, out);
    } else {
      if (/\.(ts|mjs|cjs|js)$/.test(name)) out.push(p);
    }
  }
  return out;
}

function readAll(files) {
  return files.map((f) => ({
    path: relative(PKG_ROOT, f),
    content: readFileSync(f, "utf8"),
  }));
}

const scanSources = readAll(walk(SRC));
const scanDist = readAll(walk(DIST));
const all = [...scanSources, ...scanDist];

let failed = 0;
function report(v, matches) {
  if (matches.length === 0) {
    console.log(`[OK] ${v}`);
    return;
  }
  failed++;
  console.error(`[FAIL] ${v}: ${matches.length} matches`);
  for (const m of matches.slice(0, 10)) {
    console.error(`  ${m.path}:${m.line}  ${m.text.slice(0, 140)}`);
  }
}

function grep(files, regex, label) {
  const matches = [];
  for (const { path, content } of files) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        // Skip lines explicitly allowed with allow-* comments
        if (/\/\/\s*allow-/.test(lines[i])) continue;
        matches.push({ path, line: i + 1, text: lines[i] });
      }
    }
  }
  return matches;
}

// V1: consumer @/ or relative-up imports into consumer src
const V1 = /from\s+['"](@\/|\.\.\/\.\.\/src\/|\.\.\/\.\.\/\.\.\/src\/)/;
report("V1 (no @/ or ../../src/ imports)", grep(all, V1));

// V2: forbid toolkit / src/... anywhere
const V2 = /@withwiz\/toolkit|(?<!@)src\/lib|(?<!@)src\/app|(?<!@)src\/components|(?<!@)src\/types|(?<!@)src\/skins/;
report("V2 (no @withwiz/toolkit / src/* refs)", grep(all, V2));

// V2a: every prisma.<delegate>.* call should have tenantId within 800 chars
// We do a coarse approximation: any file that matches prisma delegate calls
// but does NOT contain `tenantId` nearby flags. Use per-line scan for
// delegate method calls and look for `tenantId` within the next 20 lines.
const delegateRe = /prisma\.(coupon|campaign|couponIssuance|couponRedemption|couponAuditLog)\.(findFirst|findUnique|findMany|update|updateMany|delete|deleteMany|count|aggregate|create|createMany)\s*\(/;
// NB: we only scan SRC (not dist — dist is bundled and loses locality)
const v2aMisses = [];
for (const { path, content } of scanSources) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!delegateRe.test(lines[i])) continue;
    // gather up to next 30 lines to look for tenantId
    const slice = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 30)).join("\n");
    if (!/tenantId/.test(slice) && !/\/\/\s*allow-tenant-scope/.test(lines[i])) {
      v2aMisses.push({ path, line: i + 1, text: lines[i] });
    }
  }
}
report("V2a (every prisma delegate call includes tenantId)", v2aMisses);

// V2b: forbid imports from @prisma/client in SRC
const V2b = /import\s+(type\s+)?.*from\s+['"]@prisma\/client['"]/;
report("V2b (no @prisma/client imports in src/)", grep(scanSources, V2b));

// V2c: forbid Prisma.<Generated type> references in SRC
const V2c = /\bPrisma\.(Coupon|Campaign|CouponIssuance|CouponRedemption|CouponAuditLog)[A-Za-z]*/;
report("V2c (no Prisma.Coupon* generated type refs)", grep(scanSources, V2c));

// V2d: forbid process.env.* reads in SRC (allow with allow-env comment)
const V2d = /process\.env\./;
report("V2d (no process.env direct reads in src/)", grep(scanSources, V2d));

// V2e (AMENDMENT-2): issuedCount TOCTOU negative grep. The previous Evaluator
// caught a real spec §5.5 I4 violation because campaigns.issue used a
// read-then-unconditional-update pattern. We now enforce that any write to
// `issuedCount` happens via an `updateMany` that carries a `where` condition
// on issuedCount (lte/lt). Evidence: there must exist at least one updateMany
// block with issuedCount + lte/lt somewhere in src/, AND the naive
// `campaign.update({ ... issuedCount: ... })` shape must be absent.
//
// Positive evidence (must be >=1):
const v2ePositive = [];
for (const { path, content } of scanSources) {
  // cheap but reliable: check if the file contains both the updateMany pattern
  // and an issuedCount lte/lt clause in the same block of <= 40 lines.
  const idx = content.indexOf("updateMany");
  let cursor = 0;
  while (cursor < content.length) {
    const i = content.indexOf("updateMany", cursor);
    if (i < 0) break;
    // window from this updateMany call for ~800 chars.
    const window = content.slice(i, Math.min(content.length, i + 800));
    if (/issuedCount/.test(window) && /(lte|lt)\s*:/.test(window)) {
      v2ePositive.push({ path, line: content.slice(0, i).split("\n").length, text: "updateMany + issuedCount lte/lt" });
      break;
    }
    cursor = i + "updateMany".length;
  }
}
if (v2ePositive.length === 0) {
  failed++;
  console.error("[FAIL] V2e (AMENDMENT-2 positive: updateMany + issuedCount lte/lt): 0 matches");
} else {
  console.log(`[OK] V2e (AMENDMENT-2 positive: updateMany + issuedCount lte/lt) ${v2ePositive.length} match(es)`);
}

// Negative evidence: any `campaign.update({ ... issuedCount: ... })` without
// a `where` clause on issuedCount. We use a multi-line regex approximation.
const v2eNegative = [];
for (const { path, content } of scanSources) {
  // match the unconditional pattern: campaign.update( ... data: ... issuedCount ...
  const re = /(?:tx|prisma)\.campaign\.update\s*\(\s*\{[^{}]{0,500}data\s*:\s*[^}]{0,300}issuedCount/gs;
  let m;
  while ((m = re.exec(content)) !== null) {
    // Locate the matched block and ensure there is no `issuedCount:` inside a
    // `where:` clause directly before the data: clause (which would make it
    // a conditional write, acceptable). campaign.update has no WHERE-based
    // optimistic concurrency — only updateMany does, so this pattern is
    // ALWAYS unconditional and banned.
    const pre = content.slice(0, m.index).split("\n").length;
    v2eNegative.push({ path, line: pre, text: m[0].slice(0, 140).replace(/\n/g, " ") });
  }
}
report("V2e (AMENDMENT-2 negative: unconditional campaign.update({...issuedCount}))", v2eNegative);

if (failed > 0) {
  console.error(`\n${failed} isolation check(s) failed.`);
  process.exit(1);
}
console.log("\nAll isolation checks passed.");
process.exit(0);
