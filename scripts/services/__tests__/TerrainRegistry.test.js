import { describe, expect, it } from "vitest";
import { TerrainRegistry, normalizeTerrainCategory } from "../TerrainRegistry.js";

describe("normalizeTerrainCategory", () => {
    it("normalizes legacy aliases and rejects unknown categories", () => {
        expect(normalizeTerrainCategory("dungeon")).toBe("built");
        expect(normalizeTerrainCategory("urban")).toBe("built");
        expect(normalizeTerrainCategory("safe-haven")).toBe("safe-haven");
        expect(normalizeTerrainCategory("wilderness")).toBe("wilderness");
        expect(normalizeTerrainCategory("space")).toBeNull();
        expect(normalizeTerrainCategory("")).toBeNull();
        expect(normalizeTerrainCategory(null)).toBeNull();
    });
});

describe("TerrainRegistry", () => {
    it("returns normalized categories with wilderness fallback", () => {
        const registry = new TerrainRegistry();
        registry.register({ id: "city", label: "City", category: "urban" });
        registry.register({ id: "mystery", label: "Mystery", category: "unknown-category" });

        expect(registry.getCategory("city")).toBe("built");
        expect(registry.getCategory("mystery")).toBe("wilderness");
        expect(registry.getCategory("does-not-exist")).toBe("wilderness");
    });

    it("protects base terrains from unregister and removes custom ids", () => {
        const registry = new TerrainRegistry();
        registry.register({ id: "moon", label: "Moon", category: "wilderness" });

        expect(registry.unregister("forest")).toBe(false);
        expect(registry.has("forest")).toBe(true);

        expect(registry.unregister("moon")).toBe(true);
        expect(registry.has("moon")).toBe(false);
    });
});
