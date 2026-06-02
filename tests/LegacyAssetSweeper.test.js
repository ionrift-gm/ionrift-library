/**
 * LegacyAssetSweeper Tests
 *
 * Coverage for the pure-logic utilities in LegacyAssetSweeper:
 *   - _browseTargetMatches: the false-positive fix from 46ce9d9
 *   - _compareVersions: semver comparison used for removal-wave gating
 *   - formatBytes: human-readable byte strings for savings headlines
 *
 * These are the high-risk pure functions that can be tested without
 * mocking Foundry's FilePicker or game state.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    globalThis.game = {
        modules: { get: () => null },
        settings: { get: () => "auto", set: async () => {} },
        user: { isGM: true },
        release: { generation: 13 }
    };
    globalThis.ui = { notifications: { warn: () => {} } };
});

import { LegacyAssetSweeper } from "../scripts/services/LegacyAssetSweeper.js";

// ── _browseTargetMatches ─────────────────────────────────────────────

describe("LegacyAssetSweeper._browseTargetMatches", () => {

    it("returns true when browseTarget is empty (no target field)", () => {
        expect(LegacyAssetSweeper._browseTargetMatches("", "sounds/pack")).toBe(true);
    });

    it("returns true when browseTarget is null/undefined", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(null, "sounds/pack")).toBe(true);
        expect(LegacyAssetSweeper._browseTargetMatches(undefined, "sounds/pack")).toBe(true);
    });

    it("returns true when paths match exactly", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules/ionrift-resonance/sounds/pack",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(true);
    });

    it("normalises trailing slashes", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules/ionrift-resonance/sounds/pack/",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(true);
    });

    it("normalises case differences", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "Modules/Ionrift-Resonance/Sounds/Pack",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(true);
    });

    it("normalises backslashes to forward slashes", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules\\ionrift-resonance\\sounds\\pack",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(true);
    });

    it("detects parent-fallback mismatch (the false-positive bug)", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules/ionrift-resonance/sounds",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(false);
    });

    it("detects sibling-directory mismatch", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules/ionrift-resonance/sounds/other",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(false);
    });

    it("handles double slashes in browse result", () => {
        expect(LegacyAssetSweeper._browseTargetMatches(
            "modules//ionrift-resonance//sounds/pack",
            "modules/ionrift-resonance/sounds/pack"
        )).toBe(true);
    });
});

// ── _compareVersions ─────────────────────────────────────────────────

describe("LegacyAssetSweeper._compareVersions", () => {

    it("returns 0 for equal versions", () => {
        expect(LegacyAssetSweeper._compareVersions("2.7.0", "2.7.0")).toBe(0);
    });

    it("returns negative when a < b", () => {
        expect(LegacyAssetSweeper._compareVersions("2.6.9", "2.7.0")).toBeLessThan(0);
    });

    it("returns positive when a > b", () => {
        expect(LegacyAssetSweeper._compareVersions("3.0.0", "2.7.0")).toBeGreaterThan(0);
    });

    it("compares major versions correctly", () => {
        expect(LegacyAssetSweeper._compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
        expect(LegacyAssetSweeper._compareVersions("10.0.0", "2.0.0")).toBeGreaterThan(0);
    });

    it("compares minor versions correctly", () => {
        expect(LegacyAssetSweeper._compareVersions("2.5.0", "2.7.0")).toBeLessThan(0);
        expect(LegacyAssetSweeper._compareVersions("2.10.0", "2.7.0")).toBeGreaterThan(0);
    });

    it("compares patch versions correctly", () => {
        expect(LegacyAssetSweeper._compareVersions("2.7.1", "2.7.0")).toBeGreaterThan(0);
        expect(LegacyAssetSweeper._compareVersions("2.7.0", "2.7.3")).toBeLessThan(0);
    });

    it("handles pre-release suffixes by ignoring them", () => {
        expect(LegacyAssetSweeper._compareVersions("2.7.0-beta", "2.7.0")).toBe(0);
        expect(LegacyAssetSweeper._compareVersions("2.7.0-rc.1", "2.7.0")).toBe(0);
    });

    it("handles null/undefined as 0.0.0", () => {
        expect(LegacyAssetSweeper._compareVersions(null, "1.0.0")).toBeLessThan(0);
        expect(LegacyAssetSweeper._compareVersions("1.0.0", undefined)).toBeGreaterThan(0);
    });

    it("handles versions with different segment counts", () => {
        expect(LegacyAssetSweeper._compareVersions("2.7", "2.7.0")).toBe(0);
        expect(LegacyAssetSweeper._compareVersions("2.7.0.1", "2.7.0")).toBeGreaterThan(0);
    });
});

// ── formatBytes ──────────────────────────────────────────────────────

describe("LegacyAssetSweeper.formatBytes", () => {

    it("formats zero bytes", () => {
        expect(LegacyAssetSweeper.formatBytes(0)).toBe("0 MB");
    });

    it("formats negative bytes as zero", () => {
        expect(LegacyAssetSweeper.formatBytes(-100)).toBe("0 MB");
    });

    it("formats NaN as zero", () => {
        expect(LegacyAssetSweeper.formatBytes(NaN)).toBe("0 MB");
    });

    it("formats Infinity as zero", () => {
        expect(LegacyAssetSweeper.formatBytes(Infinity)).toBe("0 MB");
    });

    it("formats small byte counts", () => {
        expect(LegacyAssetSweeper.formatBytes(500)).toBe("500 bytes");
    });

    it("formats kilobytes", () => {
        expect(LegacyAssetSweeper.formatBytes(2048)).toBe("2 KB");
        expect(LegacyAssetSweeper.formatBytes(1024)).toBe("1 KB");
    });

    it("formats megabytes", () => {
        expect(LegacyAssetSweeper.formatBytes(78 * 1024 * 1024)).toBe("78 MB");
        expect(LegacyAssetSweeper.formatBytes(1024 * 1024)).toBe("1 MB");
    });

    it("formats gigabytes with one decimal", () => {
        expect(LegacyAssetSweeper.formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 GB");
        expect(LegacyAssetSweeper.formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
    });
});

// ── getModuleManifest / getCoveredModuleIds ──────────────────────────

describe("LegacyAssetSweeper manifest access", () => {

    it("getCoveredModuleIds returns at least ionrift-resonance", () => {
        const ids = LegacyAssetSweeper.getCoveredModuleIds();
        expect(ids).toContain("ionrift-resonance");
    });

    it("getModuleManifest returns entries for ionrift-resonance", () => {
        const entries = LegacyAssetSweeper.getModuleManifest("ionrift-resonance");
        expect(entries).not.toBeNull();
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBeGreaterThan(0);
    });

    it("getModuleManifest returns null for unknown modules", () => {
        expect(LegacyAssetSweeper.getModuleManifest("nonexistent-module")).toBeNull();
    });

    it("manifest entries have required fields", () => {
        const entries = LegacyAssetSweeper.getModuleManifest("ionrift-resonance");
        for (const entry of entries) {
            expect(entry.id).toBeDefined();
            expect(entry.removedInVersion).toBeDefined();
            expect(entry.kind).toBeDefined();
            expect(Array.isArray(entry.paths)).toBe(true);
            expect(entry.estimatedBytes).toBeGreaterThan(0);
        }
    });
});

// ── getPlatformMode ─────────────────────────────────────────────────

describe("LegacyAssetSweeper.getPlatformMode", () => {

    it("returns v13-button when generation is 13 and not Forge", () => {
        const mode = LegacyAssetSweeper.getPlatformMode();
        expect(mode).toBe("v13-button");
    });
});
