import { describe, expect, it, beforeEach } from "vitest";
import {
    TerrainRegistry,
    normalizeTerrainCategory,
    TERRAIN_CATEGORY_ALIASES
} from "../scripts/services/TerrainRegistry.js";

describe("normalizeTerrainCategory", () => {
    it("returns canonical categories unchanged", () => {
        expect(normalizeTerrainCategory("wilderness")).toBe("wilderness");
        expect(normalizeTerrainCategory("built")).toBe("built");
        expect(normalizeTerrainCategory("safe-haven")).toBe("safe-haven");
    });

    it("resolves legacy dungeon alias to built", () => {
        expect(normalizeTerrainCategory("dungeon")).toBe("built");
    });

    it("resolves legacy urban alias to built", () => {
        expect(normalizeTerrainCategory("urban")).toBe("built");
    });

    it("returns null for unknown categories", () => {
        expect(normalizeTerrainCategory("underwater")).toBeNull();
    });

    it("returns null for null input", () => {
        expect(normalizeTerrainCategory(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
        expect(normalizeTerrainCategory(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
        expect(normalizeTerrainCategory("")).toBeNull();
    });
});

describe("TERRAIN_CATEGORY_ALIASES", () => {
    it("maps dungeon to built", () => {
        expect(TERRAIN_CATEGORY_ALIASES.dungeon).toBe("built");
    });

    it("maps urban to built", () => {
        expect(TERRAIN_CATEGORY_ALIASES.urban).toBe("built");
    });

    it("is frozen", () => {
        expect(Object.isFrozen(TERRAIN_CATEGORY_ALIASES)).toBe(true);
    });
});

describe("TerrainRegistry", () => {
    /** @type {TerrainRegistry} */
    let registry;

    beforeEach(() => {
        registry = new TerrainRegistry();
    });

    describe("base terrains", () => {
        it("ships five base terrains", () => {
            const base = registry.getBase();
            expect(base).toHaveLength(5);
        });

        it("includes forest, swamp, desert, urban, dungeon by default", () => {
            const ids = registry.getBase().map(t => t.id);
            expect(ids).toEqual(["forest", "swamp", "desert", "urban", "dungeon"]);
        });

        it("getBase returns copies without affecting the registry", () => {
            const base = registry.getBase();
            base[0].label = "Mutated";
            expect(registry.get("forest").label).toBe("Forest");
        });

        it("has() returns true for base terrains", () => {
            expect(registry.has("forest")).toBe(true);
            expect(registry.has("dungeon")).toBe(true);
        });

        it("isBase() returns true for base terrain ids", () => {
            expect(registry.isBase("forest")).toBe(true);
            expect(registry.isBase("desert")).toBe(true);
        });

        it("isBase() returns false for non-base ids", () => {
            expect(registry.isBase("tundra")).toBe(false);
        });
    });

    describe("register", () => {
        it("adds a new terrain", () => {
            registry.register({ id: "tundra", label: "Tundra", category: "wilderness" });
            expect(registry.has("tundra")).toBe(true);
            expect(registry.get("tundra").label).toBe("Tundra");
        });

        it("overrides an existing terrain with the same id", () => {
            registry.register({ id: "forest", label: "Dark Forest", category: "wilderness" });
            expect(registry.get("forest").label).toBe("Dark Forest");
        });

        it("defaults flags to empty object", () => {
            registry.register({ id: "coast", label: "Coast" });
            expect(registry.get("coast").flags).toEqual({});
        });

        it("ignores registration with missing id", () => {
            const before = registry.getAll().length;
            registry.register({ label: "No Id" });
            expect(registry.getAll().length).toBe(before);
        });

        it("ignores registration with missing label", () => {
            const before = registry.getAll().length;
            registry.register({ id: "nolabel" });
            expect(registry.getAll().length).toBe(before);
        });

        it("ignores null registration", () => {
            const before = registry.getAll().length;
            registry.register(null);
            expect(registry.getAll().length).toBe(before);
        });
    });

    describe("unregister", () => {
        it("removes a module-added terrain", () => {
            registry.register({ id: "tundra", label: "Tundra" });
            expect(registry.unregister("tundra")).toBe(true);
            expect(registry.has("tundra")).toBe(false);
        });

        it("refuses to remove a base terrain", () => {
            expect(registry.unregister("forest")).toBe(false);
            expect(registry.has("forest")).toBe(true);
        });

        it("returns false for non-existent id", () => {
            expect(registry.unregister("nonexistent")).toBe(false);
        });
    });

    describe("getAll", () => {
        it("returns base terrains plus registered ones", () => {
            registry.register({ id: "tundra", label: "Tundra" });
            const all = registry.getAll();
            expect(all.length).toBe(6);
            expect(all.find(t => t.id === "tundra")).toBeDefined();
        });
    });

    describe("getCategory", () => {
        it("returns the category for a base terrain", () => {
            expect(registry.getCategory("forest")).toBe("wilderness");
            expect(registry.getCategory("urban")).toBe("built");
        });

        it("returns wilderness as default for unknown terrain id", () => {
            expect(registry.getCategory("nonexistent")).toBe("wilderness");
        });

        it("normalizes legacy categories via getCategory", () => {
            registry.register({ id: "crypt", label: "Crypt", category: "dungeon" });
            expect(registry.getCategory("crypt")).toBe("built");
        });
    });
});
