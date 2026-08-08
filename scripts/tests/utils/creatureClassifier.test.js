import { describe, it, expect, beforeEach } from "vitest";
import { classifyCreature } from "../../utils/creatureClassifier.js";

describe("classifyCreature localization", () => {
    beforeEach(() => {
        globalThis.game = {
            ...(globalThis.game ?? {}),
            system: { id: "dnd5e" },
            settings: {
                settings: { has: () => false },
                get: () => ({})
            }
        };
    });

    it("still classifies English display names", () => {
        const result = classifyCreature("Hell Hound");
        expect(result.id).toBe("fiend_hell_hound");
        expect(result.confidence).toBeGreaterThan(0);
    });

    it("classifies via Babele originalName when display name is localized", () => {
        const result = classifyCreature({
            name: "Адская гончая",
            type: "npc",
            flags: { babele: { originalName: "Hell Hound" } },
            system: { details: { type: { value: "fiend" } } },
            items: []
        });
        expect(result.id).toBe("fiend_hell_hound");
        expect(result.confidence).toBeGreaterThan(0);
    });

    it("falls back to system.details.type.value when names do not match keywords", () => {
        const result = classifyCreature({
            name: "Аболет",
            type: "npc",
            system: { details: { type: { value: "aberration" } } },
            items: []
        });
        expect(result.id).toBe("aberration");
        expect(result.confidence).toBeGreaterThan(0);
    });

    it("uses top-level originalName when flags.babele is absent", () => {
        const result = classifyCreature({
            name: "Аватара смерти",
            type: "npc",
            originalName: "Avatar of Death",
            system: { details: { type: { value: "undead" } } },
            items: []
        });
        // Avatar of Death may not have a subtype keyword; type/name fallback must not be unknown
        expect(result.id).not.toBe("unknown");
        expect(result.confidence).toBeGreaterThan(0);
    });
});
