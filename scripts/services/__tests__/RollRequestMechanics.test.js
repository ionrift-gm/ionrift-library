import { afterEach, describe, expect, it, vi } from "vitest";
import { adapterRegistry } from "../SystemAdapterRegistry.js";
import {
    buildD20Formula,
    evaluatePassed,
    getAbilityMod,
    getNatD20FromRoll,
    pickBestSkill
} from "../RollRequestMechanics.js";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("RollRequestMechanics", () => {
    it("evaluates pass/fail for force modes and normal mode", () => {
        expect(evaluatePassed(99, 1, "force-pass")).toBe(true);
        expect(evaluatePassed(1, 99, "force-fail")).toBe(false);
        expect(evaluatePassed(null, 15, "normal")).toBeNull();
        expect(evaluatePassed(15, 14, "normal")).toBe(false);
        expect(evaluatePassed(15, 15, "normal")).toBe(true);
    });

    it("builds expected formulas for each roll mode", () => {
        expect(buildD20Formula("advantage", 3)).toBe("2d20kh1 + 3");
        expect(buildD20Formula("disadvantage", -1)).toBe("2d20kl1 + -1");
        expect(buildD20Formula("normal", 0)).toBe("1d20 + 0");
    });

    it("uses adapter ability score first, then actor fallback mod, then zero", () => {
        vi.spyOn(adapterRegistry, "getAbilityScore").mockReturnValue(18);
        expect(getAbilityMod({}, "str")).toBe(4);

        vi.spyOn(adapterRegistry, "getAbilityScore").mockReturnValue(Number.NaN);
        expect(getAbilityMod({ system: { abilities: { str: { mod: 3 } } } }, "str")).toBe(3);
        expect(getAbilityMod(null, "str")).toBe(0);
    });

    it("picks dex when no skills provided and best skill otherwise", () => {
        const actor = {
            system: {
                skills: {
                    ath: { total: 2 },
                    prc: { total: 6 },
                    sur: { total: 4 }
                }
            }
        };

        expect(pickBestSkill(actor, [])).toBe("dex");
        expect(pickBestSkill(actor, ["ath", "prc", "sur"])).toBe("prc");
    });

    it("extracts nat d20 from terms first then dice fallback", () => {
        expect(
            getNatD20FromRoll({
                terms: [{ results: [{ result: 17 }] }],
                dice: [{ results: [{ result: 1 }] }]
            })
        ).toBe(17);

        expect(
            getNatD20FromRoll({
                terms: [{ results: [{ result: "not-a-number" }] }],
                dice: [{ results: [{ result: 13 }] }]
            })
        ).toBe(13);
    });
});
