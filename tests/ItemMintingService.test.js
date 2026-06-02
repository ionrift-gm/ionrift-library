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

    // ── Foundry deletion DSL (regression: b7bfd2d) ────────────────

    describe("deletion DSL keys", () => {
        it("skips activity keys prefixed with -=", () => {
            const item = validItem({
                activities: {
                    "-=rWBvAvfPodSbiilg": null,
                    "-=oldAction": null
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("skips -= keys alongside valid activity keys", () => {
            const item = validItem({
                activities: {
                    "attack": { damage: {} },
                    "-=removed": null,
                    "Abc123XYZ": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("still rejects invalid keys that are not deletion DSL", () => {
            const item = validItem({
                activities: {
                    "=notDeletion": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/not a valid/);
        });
    });

    // ── guardPatch ───────────────────────────────────────────────

    describe("guardPatch", () => {
        it("assembles dot-path system keys and validates", () => {
            const patch = {
                name: "Longsword +1",
                "system.rarity": "rare",
                "system.attunement": "required"
            };
            expect(() => ItemMintingService.guardPatch(patch)).not.toThrow();
        });

        it("returns the original patch object on success", () => {
            const patch = { name: "Dagger", "system.rarity": "common" };
            const result = ItemMintingService.guardPatch(patch);
            expect(result).toBe(patch);
        });

        it("rejects invalid rarity via dot-path", () => {
            const patch = { name: "Bad Item", "system.rarity": "mythic" };
            expect(() => ItemMintingService.guardPatch(patch)).toThrow(/unknown value "mythic"/);
        });

        it("rejects non-object patch", () => {
            expect(() => ItemMintingService.guardPatch(null)).toThrow(/patch must be a plain object/);
            expect(() => ItemMintingService.guardPatch("string")).toThrow(/patch must be a plain object/);
        });

        it("handles nested dot-path keys", () => {
            const patch = {
                name: "Fire Sword",
                "system.damage.base.bonus": "1d6"
            };
            expect(() => ItemMintingService.guardPatch(patch)).not.toThrow();
        });

        it("passes through non-system keys without validation", () => {
            const patch = {
                name: "Shield",
                img: "icons/shield.webp",
                "system.rarity": "uncommon"
            };
            expect(() => ItemMintingService.guardPatch(patch)).not.toThrow();
        });
    });

    // ── validateFormula ──────────────────────────────────────────

    describe("validateFormula", () => {
        it("returns valid: true for a simple formula", () => {
            const result = ItemMintingService.validateFormula("2d6 + 3");
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("2d6 + 3");
        });

        it("returns valid: true for an empty string", () => {
            const result = ItemMintingService.validateFormula("");
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("");
        });

        it("returns valid: true for null/undefined (normalised to empty)", () => {
            expect(ItemMintingService.validateFormula(null).valid).toBe(true);
            expect(ItemMintingService.validateFormula(null).normalised).toBe("");
            expect(ItemMintingService.validateFormula(undefined).valid).toBe(true);
        });

        it("trims whitespace", () => {
            const result = ItemMintingService.validateFormula("  1d8  ");
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("1d8");
        });

        it("returns valid: false for non-string input", () => {
            const result = ItemMintingService.validateFormula(42);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/must be a string/);
        });

        it("includes fieldPath in error messages when provided", () => {
            const result = ItemMintingService.validateFormula(42, { fieldPath: "system.damage.bonus" });
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/system\.damage\.bonus/);
        });

        it("accepts formulas with @-references", () => {
            const result = ItemMintingService.validateFormula("@item.level + 2");
            expect(result.valid).toBe(true);
        });
    });

    // ── Attunement validation ────────────────────────────────────

    describe("attunement validation", () => {
        it("accepts all valid attunement values", () => {
            for (const a of ["", "required", "optional"]) {
                expect(() => ItemMintingService.guard(validItem({ attunement: a }))).not.toThrow();
            }
        });

        it("rejects unknown attunement", () => {
            expect(() => ItemMintingService.guard(validItem({ attunement: "always" })))
                .toThrow(/unknown value "always"/);
        });
    });

    // ── Damage block validation ─────────────────────────────────

    describe("damage block validation", () => {
        it("accepts valid damage base with bonus formula", () => {
            const item = validItem({
                damage: { base: { bonus: "1d6" } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts valid versatile damage", () => {
            const item = validItem({
                damage: { versatile: { bonus: "1d8" } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts damage block bonus formula", () => {
            const item = validItem({
                damage: { bonus: "2" }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("rejects invalid formula in damage base", () => {
            const item = validItem({
                damage: { base: { bonus: 123 } }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/must be a string/);
        });

        it("validates custom formula in damage parts", () => {
            const item = validItem({
                damage: { base: { custom: { formula: "2d6 + @mod" } } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });
    });

    // ── Activity damage/healing/consumption validation ──────────

    describe("activity nested validation", () => {
        it("validates damage parts within activities", () => {
            const item = validItem({
                activities: {
                    "attack": {
                        damage: {
                            parts: [{ bonus: "1d6" }]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("rejects invalid formula in activity damage part", () => {
            const item = validItem({
                activities: {
                    "attack": {
                        damage: {
                            parts: [{ bonus: 999 }]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).toThrow(/must be a string/);
        });

        it("validates healing bonus within activities", () => {
            const item = validItem({
                activities: {
                    "heal": {
                        healing: { bonus: "2d8 + @mod" }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("validates consumption targets value formula", () => {
            const item = validItem({
                activities: {
                    "attack": {
                        consumption: {
                            targets: [{ value: "1" }]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("validates consumption targets scaling formula", () => {
            const item = validItem({
                activities: {
                    "cast": {
                        consumption: {
                            targets: [{ scaling: { formula: "@item.level" } }]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });
    });

    // ── Identifier slug validation ──────────────────────────────

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

    // ── Options propagation ─────────────────────────────────────

    describe("error message options", () => {
        it("includes moduleId in error message", () => {
            expect(() => ItemMintingService.guard(null, { moduleId: "ionrift-test" }))
                .toThrow(/ionrift-test/);
        });

        it("includes recipeKey in error message", () => {
            expect(() => ItemMintingService.guard(null, { recipeKey: "fire-sword" }))
                .toThrow(/recipe: fire-sword/);
        });
    });
});
