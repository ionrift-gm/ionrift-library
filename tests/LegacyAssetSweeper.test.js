import { describe, expect, it } from "vitest";
import { LegacyAssetSweeper } from "../scripts/services/LegacyAssetSweeper.js";

describe("LegacyAssetSweeper", () => {

    // ── formatBytes ──────────────────────────────────────────────────

    describe("formatBytes", () => {
        it("formats zero as 0 MB", () => {
            expect(LegacyAssetSweeper.formatBytes(0)).toBe("0 MB");
        });

        it("formats negative as 0 MB", () => {
            expect(LegacyAssetSweeper.formatBytes(-100)).toBe("0 MB");
        });

        it("formats NaN as 0 MB", () => {
            expect(LegacyAssetSweeper.formatBytes(NaN)).toBe("0 MB");
        });

        it("formats Infinity as 0 MB", () => {
            expect(LegacyAssetSweeper.formatBytes(Infinity)).toBe("0 MB");
        });

        it("formats small byte values", () => {
            expect(LegacyAssetSweeper.formatBytes(512)).toBe("512 bytes");
        });

        it("formats kilobyte values", () => {
            expect(LegacyAssetSweeper.formatBytes(1024)).toBe("1 KB");
            expect(LegacyAssetSweeper.formatBytes(2560)).toBe("3 KB");
        });

        it("formats megabyte values", () => {
            expect(LegacyAssetSweeper.formatBytes(1024 * 1024)).toBe("1 MB");
            expect(LegacyAssetSweeper.formatBytes(78 * 1024 * 1024)).toBe("78 MB");
        });

        it("formats gigabyte values with one decimal", () => {
            expect(LegacyAssetSweeper.formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
            expect(LegacyAssetSweeper.formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
        });
    });

    // ── _browseTargetMatches ─────────────────────────────────────────

    describe("_browseTargetMatches", () => {
        it("returns true for exact match", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(
                "modules/ionrift-resonance/sounds/pack",
                "modules/ionrift-resonance/sounds/pack"
            )).toBe(true);
        });

        it("ignores trailing slashes", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(
                "modules/ionrift-resonance/sounds/pack/",
                "modules/ionrift-resonance/sounds/pack"
            )).toBe(true);
        });

        it("is case-insensitive", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(
                "Modules/Ionrift-Resonance/Sounds/Pack",
                "modules/ionrift-resonance/sounds/pack"
            )).toBe(true);
        });

        it("normalizes backslashes", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(
                "modules\\ionrift-resonance\\sounds\\pack",
                "modules/ionrift-resonance/sounds/pack"
            )).toBe(true);
        });

        it("returns false when paths differ", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(
                "modules/ionrift-resonance/sounds",
                "modules/ionrift-resonance/sounds/pack"
            )).toBe(false);
        });

        it("returns true when browseTarget is empty (trusts result)", () => {
            expect(LegacyAssetSweeper._browseTargetMatches("", "any/path")).toBe(true);
        });

        it("returns true when browseTarget is null (trusts result)", () => {
            expect(LegacyAssetSweeper._browseTargetMatches(null, "any/path")).toBe(true);
        });
    });

    // ── _compareVersions ─────────────────────────────────────────────

    describe("_compareVersions", () => {
        it("returns 0 for equal versions", () => {
            expect(LegacyAssetSweeper._compareVersions("2.7.0", "2.7.0")).toBe(0);
        });

        it("returns negative when a < b", () => {
            expect(LegacyAssetSweeper._compareVersions("2.6.0", "2.7.0")).toBeLessThan(0);
        });

        it("returns positive when a > b", () => {
            expect(LegacyAssetSweeper._compareVersions("2.7.1", "2.7.0")).toBeGreaterThan(0);
        });

        it("compares major version differences", () => {
            expect(LegacyAssetSweeper._compareVersions("3.0.0", "2.9.9")).toBeGreaterThan(0);
        });

        it("strips prerelease suffix before comparing", () => {
            expect(LegacyAssetSweeper._compareVersions("2.7.0-beta.1", "2.7.0")).toBe(0);
        });

        it("handles null version input", () => {
            expect(LegacyAssetSweeper._compareVersions(null, "1.0.0")).toBeLessThan(0);
        });

        it("handles undefined version input", () => {
            expect(LegacyAssetSweeper._compareVersions(undefined, "1.0.0")).toBeLessThan(0);
        });

        it("handles versions with different segment counts", () => {
            expect(LegacyAssetSweeper._compareVersions("2.7", "2.7.0")).toBe(0);
            expect(LegacyAssetSweeper._compareVersions("2.7.0", "2.7")).toBe(0);
        });
    });

    // ── getCoveredModuleIds / getModuleManifest ──────────────────────

    describe("getCoveredModuleIds", () => {
        it("includes ionrift-resonance", () => {
            expect(LegacyAssetSweeper.getCoveredModuleIds()).toContain("ionrift-resonance");
        });
    });

    describe("getModuleManifest", () => {
        it("returns manifest entries for ionrift-resonance", () => {
            const entries = LegacyAssetSweeper.getModuleManifest("ionrift-resonance");
            expect(entries).not.toBeNull();
            expect(entries.length).toBeGreaterThan(0);
            expect(entries[0].id).toBe("resonance-prepack-sounds");
        });

        it("returns null for unknown module", () => {
            expect(LegacyAssetSweeper.getModuleManifest("nonexistent")).toBeNull();
        });
    });
});
