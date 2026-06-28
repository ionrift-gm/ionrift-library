import { describe, expect, it } from "vitest";

import { PF2eAdapter } from "../../services/adapters/PF2eAdapter.js";

describe("PF2eAdapter", () => {
    const adapter = new PF2eAdapter();

    describe("isSupported", () => {
        it("supports recently added feature gates", () => {
            expect(adapter.isSupported("scroll-forge")).toBe(true);
            expect(adapter.isSupported("srd-curses")).toBe(true);
        });

        it("rejects unknown feature identifiers", () => {
            expect(adapter.isSupported("non-existent-feature")).toBe(false);
        });
    });

    describe("isMagical", () => {
        it("returns true when magical trait is present", () => {
            const item = {
                system: {
                    traits: { value: ["magical"], rarity: "common" }
                }
            };
            expect(adapter.isMagical(item)).toBe(true);
        });

        it("returns true when rarity is above common", () => {
            const item = {
                system: {
                    traits: { value: [], rarity: "rare" }
                }
            };
            expect(adapter.isMagical(item)).toBe(true);
        });

        it("returns false for null and non-magical common items", () => {
            expect(adapter.isMagical(null)).toBe(false);

            const item = {
                system: {
                    traits: { value: [], rarity: "common" }
                }
            };
            expect(adapter.isMagical(item)).toBe(false);
        });
    });

    describe("getPowerScoreContribution", () => {
        it("returns zero for ineligible item types", () => {
            const ineligible = {
                type: "spell",
                system: {
                    traits: { value: ["magical"], rarity: "rare" }
                }
            };
            expect(adapter.getPowerScoreContribution(ineligible)).toBe(0);
        });

        it("returns zero for eligible but non-magical items", () => {
            const mundane = {
                type: "weapon",
                system: {
                    traits: { value: [], rarity: "common" }
                }
            };
            expect(adapter.getPowerScoreContribution(mundane)).toBe(0);
        });

        it("applies rarity, invested multiplier, and potency bonuses", () => {
            const item = {
                type: "weapon",
                system: {
                    traits: { value: ["invested"], rarity: "rare" },
                    runes: { potency: 3 }
                }
            };
            const weights = {
                rarity: { common: 1, uncommon: 3, rare: 10, unique: 25 },
                attunement: 2,
                flatBonus: 1.5
            };

            expect(adapter.getPowerScoreContribution(item, weights)).toBe(24.5);
        });
    });
});
