#!/usr/bin/env node
/**
 * Static check for the overlay sublayer convention.
 *
 * Run from the workspace root:
 *   node modules/ionrift-library/scripts/dev/verifySublayerConvention.mjs
 *
 * Verifies:
 *   1. OverlayService.tierToSublayer("Free") routes to "core" (post-rename default).
 *   2. The LEGACY_FREE_SUBLAYER and DEFAULT_CORE_SUBLAYER constants exist.
 *   3. resolveInstallSublayer contains the sticky-back-compat branch.
 *   4. registry.json overlay entries declare a sublayer only for known cases:
 *        - Pack-named (`wanderers`, `frost-stone`)            → expected.
 *        - Legacy lock (`free`) for `quartermaster-core-overlay` → expected,
 *          tracked in QUARTERMASTER_BACKLOG.md until compendium imgs repath.
 *      Any other explicit `"sublayer": "free"` is flagged.
 *
 * Exits non-zero on the first violation, with a description of what to fix.
 *
 * This is the codified guard for the May 2026 sublayer rename. Treat new
 * uses of `"free"` as a sublayer literal as a code-review red flag unless
 * they appear in the allowlist below.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const libRoot = resolve(here, "..", "..");
const annexRoot = resolve(libRoot, "..", "ionrift-annex");
const workspaceRoot = resolve(libRoot, "..", "..");

const ALLOWED_LEGACY_FREE_LOCK = new Set([
    "quartermaster-core-overlay"
]);

const ALLOWED_PACK_SUBLAYERS = new Set([
    "wanderers",
    "frost-stone"
]);

const failures = [];

function fail(label, detail) {
    failures.push({ label, detail });
}

// 1-3. OverlayService source contracts.
const overlaySrcPath = resolve(annexRoot, "scripts", "services", "packs", "OverlayService.js");
const overlaySrc = readFileSync(overlaySrcPath, "utf8");

if (!/const\s+DEFAULT_CORE_SUBLAYER\s*=\s*["']core["']/.test(overlaySrc)) {
    fail(
        "DEFAULT_CORE_SUBLAYER constant missing",
        "Expected `const DEFAULT_CORE_SUBLAYER = \"core\";` in OverlayService.js"
    );
}

if (!/const\s+LEGACY_FREE_SUBLAYER\s*=\s*["']free["']/.test(overlaySrc)) {
    fail(
        "LEGACY_FREE_SUBLAYER constant missing",
        "Expected `const LEGACY_FREE_SUBLAYER = \"free\";` in OverlayService.js"
    );
}

const tierToSublayerMatch = overlaySrc.match(
    /static\s+tierToSublayer\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{4}\}/
);
if (!tierToSublayerMatch) {
    fail(
        "tierToSublayer not found",
        "Expected a `static tierToSublayer` method on OverlayService."
    );
} else if (!/DEFAULT_CORE_SUBLAYER/.test(tierToSublayerMatch[1])) {
    fail(
        "tierToSublayer no longer routes Free → core",
        "tierToSublayer must return DEFAULT_CORE_SUBLAYER for the Free tier."
    );
}

const installResolverMatch = overlaySrc.match(
    /static\s+async\s+resolveInstallSublayer[\s\S]*?return\s+this\.tierToSublayer/
);
if (!installResolverMatch) {
    fail(
        "resolveInstallSublayer not found or shape changed",
        "Expected an async resolveInstallSublayer that ends in `return this.tierToSublayer(...)`."
    );
} else if (!/LEGACY_FREE_SUBLAYER/.test(installResolverMatch[0])) {
    fail(
        "Sticky-back-compat branch missing",
        "resolveInstallSublayer must check for a legacy free/ manifest before falling through to the tier default."
    );
}

// 4. Registry sanity.
const registryPath = resolve(workspaceRoot, "ionrift-pack-registry", "registry.json");
let registry;
try {
    registry = JSON.parse(readFileSync(registryPath, "utf8"));
} catch (e) {
    fail("registry.json unreadable", `${registryPath}: ${e.message}`);
}

if (registry?.overlays) {
    for (const [overlayId, entry] of Object.entries(registry.overlays)) {
        if (!entry?.sublayer) continue;
        const sublayer = entry.sublayer;
        if (sublayer === "free") {
            if (!ALLOWED_LEGACY_FREE_LOCK.has(overlayId)) {
                fail(
                    `Unexpected free/ pin: ${overlayId}`,
                    `registry.json declares "sublayer": "free" for ${overlayId}. ` +
                    "New overlays should default to core/ (omit the field) or use a pack-named sublayer. " +
                    "Add to ALLOWED_LEGACY_FREE_LOCK only after documenting the back-compat reason in QUARTERMASTER_BACKLOG.md."
                );
            }
            continue;
        }
        if (
            sublayer !== "core"
            && !ALLOWED_PACK_SUBLAYERS.has(sublayer)
            && !["initiate", "acolyte", "weaver", "artificer"].includes(sublayer)
        ) {
            fail(
                `Unknown sublayer: ${overlayId} → "${sublayer}"`,
                "Add to ALLOWED_PACK_SUBLAYERS or document the new convention before shipping."
            );
        }
    }
}

if (failures.length > 0) {
    console.error("Sublayer convention check FAILED:\n");
    for (const { label, detail } of failures) {
        console.error(`  [FAIL] ${label}`);
        console.error(`         ${detail}\n`);
    }
    process.exit(1);
}

console.log("Sublayer convention check passed.");
console.log(`  OverlayService: ${overlaySrcPath}`);
console.log(`  Registry: ${registryPath}`);
