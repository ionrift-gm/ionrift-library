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

    // ── Attunement ───────────────────────────────────────────────────

    describe("attunement validation", () => {
        it("accepts all valid attunement values", () => {
            for (const a of ["", "required", "optional"]) {
                expect(() => ItemMintingService.guard(validItem({ attunement: a }))).not.toThrow();
            }
        });

        it("rejects unknown attunement value", () => {
            expect(() => ItemMintingService.guard(validItem({ attunement: "attuned" })))
                .toThrow(/unknown value "attuned"/);
        });
    });

    // ── Deletion DSL keys (-=) ──────────────────────────────────────

    describe("deletion DSL keys", () => {
        it("accepts -= prefixed activity keys without validation", () => {
            const item = validItem({
                activities: {
                    "-=oldActivity": null
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts mix of -= deletion keys and regular keys", () => {
            const item = validItem({
                activities: {
                    "-=removed": null,
                    "attack": { damage: {} }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });
    });

    // ── guardPatch ──────────────────────────────────────────────────

    describe("guardPatch", () => {
        it("validates a flat patch with dot-path system keys", () => {
            const patch = {
                name: "Upgraded Sword",
                "system.rarity": "rare",
                "system.attunement": "required"
            };
            expect(() => ItemMintingService.guardPatch(patch)).not.toThrow();
        });

        it("returns the original patch object", () => {
            const patch = { name: "Sword", "system.rarity": "common" };
            const result = ItemMintingService.guardPatch(patch);
            expect(result).toBe(patch);
        });

        it("rejects patch with invalid rarity in dot-path", () => {
            const patch = { "system.rarity": "mythical" };
            expect(() => ItemMintingService.guardPatch(patch))
                .toThrow(/unknown value "mythical"/);
        });

        it("rejects non-object patch", () => {
            expect(() => ItemMintingService.guardPatch(null))
                .toThrow(/patch must be a plain object/);
            expect(() => ItemMintingService.guardPatch("string"))
                .toThrow(/patch must be a plain object/);
        });

        it("passes a patch with no system keys", () => {
            const patch = { name: "Just a Name", img: "icons/sword.png" };
            expect(() => ItemMintingService.guardPatch(patch)).not.toThrow();
        });
    });

    // ── validateFormula ─────────────────────────────────────────────

    describe("validateFormula", () => {
        it("accepts an empty string formula", () => {
            const result = ItemMintingService.validateFormula("");
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("");
        });

        it("accepts null formula as empty", () => {
            const result = ItemMintingService.validateFormula(null);
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("");
        });

        it("accepts undefined formula as empty", () => {
            const result = ItemMintingService.validateFormula(undefined);
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("");
        });

        it("rejects non-string formula", () => {
            const result = ItemMintingService.validateFormula(42);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/must be a string/);
        });

        it("accepts a simple dice formula", () => {
            const result = ItemMintingService.validateFormula("2d6 + 3");
            expect(result.valid).toBe(true);
        });

        it("trims whitespace from formulas", () => {
            const result = ItemMintingService.validateFormula("  1d8  ");
            expect(result.valid).toBe(true);
            expect(result.normalised).toBe("1d8");
        });

        it("includes fieldPath in error when provided", () => {
            const result = ItemMintingService.validateFormula(42, {
                fieldPath: "system.damage.base.bonus"
            });
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/system\.damage\.base\.bonus/);
        });
    });

    // ── Damage block validation ─────────────────────────────────────

    describe("damage block validation", () => {
        it("accepts item with valid damage base formula", () => {
            const item = validItem({
                damage: { base: { bonus: "2" } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts item with versatile damage", () => {
            const item = validItem({
                damage: { versatile: { bonus: "1d4" } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts item with damage bonus formula", () => {
            const item = validItem({
                damage: { bonus: "1d6" }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts item with custom damage formula", () => {
            const item = validItem({
                damage: { base: { custom: { formula: "3d8" } } }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });
    });

    // ── Activity damage/healing/consumption ─────────────────────────

    describe("activity validation", () => {
        it("accepts activity with damage parts", () => {
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

        it("accepts activity with healing bonus", () => {
            const item = validItem({
                activities: {
                    "heal": {
                        healing: { bonus: "2d8" }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("accepts activity with consumption targets", () => {
            const item = validItem({
                activities: {
                    "cast": {
                        consumption: {
                            targets: [
                                { value: "1" }
                            ]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });

        it("skips null consumption targets gracefully", () => {
            const item = validItem({
                activities: {
                    "cast": {
                        consumption: {
                            targets: [null, { value: "1" }]
                        }
                    }
                }
            });
            expect(() => ItemMintingService.guard(item)).not.toThrow();
        });
    });

    // ── Non-dnd5e system bypass ──────────────────────────────────────

    describe("non-dnd5e system", () => {
        it("skips dnd5e guards when systemId is pf2e", () => {
            const item = { name: "Bad Rarity", system: { rarity: "bogus" } };
            expect(() => ItemMintingService.guard(item, { systemId: "pf2e" })).not.toThrow();
        });
    });

    // ── Error message formatting ─────────────────────────────────────

    describe("error message formatting", () => {
        it("includes moduleId when provided", () => {
            expect(() => ItemMintingService.guard(null, { moduleId: "ionrift-resonance" }))
                .toThrow(/ionrift-resonance/);
        });

        it("includes recipeKey when provided", () => {
            expect(() => ItemMintingService.guard(null, { recipeKey: "berserker-axe" }))
                .toThrow(/recipe: berserker-axe/);
        });
    });
});
