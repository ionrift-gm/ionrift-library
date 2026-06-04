import { describe, expect, it } from "vitest";
import {
    isPlayerVisibleMenu,
    isPlayerVisibleSetting,
    findPlayerVisibleSettingKeys,
    findPlayerVisibleMenuKeys,
    assertNoPlayerConfigEntries,
    assertNoPlayerMenuEntries
} from "../scripts/SettingsVisibility.js";

describe("SettingsVisibility", () => {

    // ── isPlayerVisibleMenu ──────────────────────────────────────────

    describe("isPlayerVisibleMenu", () => {
        it("returns true when restricted is absent", () => {
            expect(isPlayerVisibleMenu({})).toBe(true);
        });

        it("returns true when restricted is false", () => {
            expect(isPlayerVisibleMenu({ restricted: false })).toBe(true);
        });

        it("returns false when restricted is true", () => {
            expect(isPlayerVisibleMenu({ restricted: true })).toBe(false);
        });

        it("returns true for null config", () => {
            expect(isPlayerVisibleMenu(null)).toBe(true);
        });

        it("returns true for undefined config", () => {
            expect(isPlayerVisibleMenu(undefined)).toBe(true);
        });
    });

    // ── isPlayerVisibleSetting ───────────────────────────────────────

    describe("isPlayerVisibleSetting", () => {
        it("returns true for client-scope config:true setting", () => {
            expect(isPlayerVisibleSetting({ config: true, scope: "client" })).toBe(true);
        });

        it("returns false for world-scope setting even with config:true", () => {
            expect(isPlayerVisibleSetting({ config: true, scope: "world" })).toBe(false);
        });

        it("returns false when config is not true", () => {
            expect(isPlayerVisibleSetting({ config: false, scope: "client" })).toBe(false);
        });

        it("returns false when config is missing", () => {
            expect(isPlayerVisibleSetting({ scope: "client" })).toBe(false);
        });

        it("defaults scope to client when absent", () => {
            expect(isPlayerVisibleSetting({ config: true })).toBe(true);
        });

        it("returns false for null config", () => {
            expect(isPlayerVisibleSetting(null)).toBe(false);
        });

        it("returns false for undefined config", () => {
            expect(isPlayerVisibleSetting(undefined)).toBe(false);
        });
    });

    // ── findPlayerVisibleSettingKeys ──────────────────────────────────

    describe("findPlayerVisibleSettingKeys", () => {
        it("returns keys of client-scope config:true settings", () => {
            const regs = [
                { key: "visible", cfg: { config: true, scope: "client" } },
                { key: "hidden", cfg: { config: true, scope: "world" } },
                { key: "internal", cfg: { config: false } }
            ];
            expect(findPlayerVisibleSettingKeys(regs)).toEqual(["visible"]);
        });

        it("returns empty array when none are visible", () => {
            const regs = [
                { key: "a", cfg: { config: false } }
            ];
            expect(findPlayerVisibleSettingKeys(regs)).toEqual([]);
        });
    });

    // ── findPlayerVisibleMenuKeys ────────────────────────────────────

    describe("findPlayerVisibleMenuKeys", () => {
        it("returns keys of unrestricted menus", () => {
            const regs = [
                { key: "open", cfg: {} },
                { key: "locked", cfg: { restricted: true } }
            ];
            expect(findPlayerVisibleMenuKeys(regs)).toEqual(["open"]);
        });
    });

    // ── assertNoPlayerConfigEntries ──────────────────────────────────

    describe("assertNoPlayerConfigEntries", () => {
        it("does not throw when no settings are player-visible", () => {
            const regs = [{ key: "a", cfg: { config: true, scope: "world" } }];
            expect(() => assertNoPlayerConfigEntries(regs, "test-mod")).not.toThrow();
        });

        it("throws listing visible keys when some are player-visible", () => {
            const regs = [{ key: "leaked", cfg: { config: true, scope: "client" } }];
            expect(() => assertNoPlayerConfigEntries(regs, "test-mod"))
                .toThrow(/test-mod.*leaked/);
        });
    });

    // ── assertNoPlayerMenuEntries ────────────────────────────────────

    describe("assertNoPlayerMenuEntries", () => {
        it("does not throw when all menus are restricted", () => {
            const regs = [{ key: "m", cfg: { restricted: true } }];
            expect(() => assertNoPlayerMenuEntries(regs, "test-mod")).not.toThrow();
        });

        it("throws listing visible keys when some menus are unrestricted", () => {
            const regs = [{ key: "open-menu", cfg: {} }];
            expect(() => assertNoPlayerMenuEntries(regs, "test-mod"))
                .toThrow(/test-mod.*open-menu/);
        });
    });
});
