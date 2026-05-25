/**
 * ItemMintingService Tests
 *
 * Regression coverage for the dnd5e validation guards.
 * Written to capture the SRD activity-key bug: Foundry uses base62 IDs
 * (mixed case alphanumeric) as activity keys, but the validator only
 * accepted lowercase slug-format keys.
 */
import { describe, expect, it, vi } from "vitest";

// ── Foundry globals ──────────────────────────────────────────────────────
vi.hoisted(() => {
    globalThis.foundry = {
        utils: {
            deepClone: (obj) => structuredClone(obj),
            setProperty: (obj, key, value) => {
                const parts = key.split(".");
                let target = obj;
                for (let i = 0; i < parts.length - 1; i++) {
                    target[parts[i]] ??= {};
                    target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = value;
            }
        }
    };

    globalThis.game = {
        system: { id: "dnd5e" }
    };

    // Minimal Roll mock — enough for formula validation
    globalThis.Roll = class Roll {
        constructor(formula) { this._formula = formula; }
        evaluateSync() { return this; }
        get isDeterministic() { return true; }
    };
});

import { ItemMintingService } from "../scripts/services/ItemMintingService.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal valid dnd5e item source object. */
function validItem(overrides = {}) {
    return {
        name: "Test Item",
        type: "weapon",
        system: {
            rarity: "common",
            attunement: "",
            ...overrides
        }
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("ItemMintingService", () => {

    // ── Basic validation ─────────────────────────────────────────────

    describe("guard / assertValid", () => {
        it("accepts a minimal valid item", () => {
            expect(() => ItemMintingService.guard(validItem())).not.toThrow();
        });

        it("rejects non-object source", () => {
            expect(() => ItemMintingService.guard(null)).toThrow(/source must be a plain object/);
            expect(() => ItemMintingService.guard("string")).toThrow(/source must be a plain object/);
        });

        it("accepts an item with no system block", () => {
            expect(() => ItemMintingService.guard({ name: "Bare" })).not.toThrow();
        });
    });

    // ── Rarity ───────────────────────────────────────────────────────

    describe("rarity validation", () => {
        it("accepts all valid rarities", () => {
            for (const r of ["common", "uncommon", "rare", "veryRare", "legendary", "artifact", ""]) {
                expect(() => ItemMintingService.guard(validItem({ rarity: r }))).not.toThrow();
            }
        });

        it("rejects unknown rarity", () => {
            expect(() => ItemMintingService.guard(validItem({ rarity: "mythical" })))
                .toThrow(/unknown value "mythical"/);
        });
    });

    // ── Activity key validation (regression: SRD Berserker Axe) ─────

    describe("activity key validation", () => {
        it("accepts lowercase slug-format keys", () => {
            const item = validItem({
                activities: {
                    "attack": { damage: {} },
                    "bonus-action": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts Foundry base62 ID keys (mixed-case alphanumeric)", () => {
            // This is the regression case: dnd5e SRD items (e.g. Berserker Axe)
            // use random base62 IDs like "rWBvAvfPodSbiilg" as activity keys.
            const item = validItem({
                activities: {
                    "rWBvAvfPodSbiilg": { damage: {} },
                    "Abc123XYZ": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("rejects keys with special characters", () => {
            const item = validItem({
                activities: {
                    "attack!": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/not a valid/);
        });

        it("rejects keys with spaces", () => {
            const item = validItem({
                activities: {
                    "my attack": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/not a valid/);
        });

        it("rejects keys with underscores", () => {
            const item = validItem({
                activities: {
                    "my_attack": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/not a valid/);
        });
    });

    // ── guardAll ─────────────────────────────────────────────────────

    describe("guardAll", () => {
        it("validates all items in a batch", () => {
            const items = [validItem(), validItem({ rarity: "rare" })];
            expect(() => ItemMintingService.guardAll(items)).not.toThrow();
        });

        it("throws with item label on failure", () => {
            const items = [
                validItem(),
                { name: "Bad Axe", system: { rarity: "bogus" } }
            ];
            expect(() => ItemMintingService.guardAll(items))
                .toThrow(/item: "Bad Axe"/);
        });

        it("rejects non-array input", () => {
            expect(() => ItemMintingService.guardAll({}))
                .toThrow(/sources must be an array/);
        });
    });

    // ── Identifier slug validation ──────────────────────────────────

    describe("identifier validation", () => {
        it("accepts valid slug identifiers", () => {
            expect(() => ItemMintingService.guard(validItem({ identifier: "longsword" }))).not.toThrow();
            expect(() => ItemMintingService.guard(validItem({ identifier: "great-axe" }))).not.toThrow();
        });

        it("rejects non-slug identifiers", () => {
            expect(() => ItemMintingService.guard(validItem({ identifier: "Great Axe" })))
                .toThrow(/invalid slug/);
        });
    });
});
