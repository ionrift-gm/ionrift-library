/**
 * TerrainRegistry Tests
 *
 * Coverage for the kernel terrain base, register/unregister contract,
 * and the isBase/getBase API introduced in ca39c33.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { TerrainRegistry } from "../scripts/services/TerrainRegistry.js";

describe("TerrainRegistry", () => {

    let registry;

    beforeEach(() => {
        registry = new TerrainRegistry();
    });

    // ── Kernel base set ──────────────────────────────────────────

    describe("kernel base", () => {
        it("ships five base terrains", () => {
            const base = registry.getBase();
            expect(base).toHaveLength(5);
        });

        it("includes expected terrain ids", () => {
            const ids = registry.getBase().map(t => t.id);
            expect(ids).toContain("forest");
            expect(ids).toContain("swamp");
            expect(ids).toContain("desert");
            expect(ids).toContain("urban");
            expect(ids).toContain("dungeon");
        });

        it("does NOT include mountain in the base set", () => {
            const ids = registry.getBase().map(t => t.id);
            expect(ids).not.toContain("mountain");
        });

        it("base terrains have category fields", () => {
            const base = registry.getBase();
            for (const t of base) {
                expect(t.category).toBeDefined();
                expect(typeof t.category).toBe("string");
            }
        });

        it("getBase returns copies, not references to internal state", () => {
            const base1 = registry.getBase();
            base1[0].label = "MUTATED";
            const base2 = registry.getBase();
            expect(base2[0].label).not.toBe("MUTATED");
        });
    });

    // ── isBase ───────────────────────────────────────────────────

    describe("isBase", () => {
        it("returns true for kernel terrain ids", () => {
            expect(registry.isBase("forest")).toBe(true);
            expect(registry.isBase("dungeon")).toBe(true);
        });

        it("returns false for non-base terrain ids", () => {
            expect(registry.isBase("mountain")).toBe(false);
            expect(registry.isBase("tundra")).toBe(false);
        });

        it("returns false for module-registered terrains", () => {
            registry.register({ id: "tundra", label: "Tundra" });
            expect(registry.isBase("tundra")).toBe(false);
        });
    });

    // ── register ─────────────────────────────────────────────────

    describe("register", () => {
        it("adds a new terrain to the registry", () => {
            registry.register({ id: "mountain", label: "Mountain", category: "wilderness" });
            expect(registry.has("mountain")).toBe(true);
            expect(registry.get("mountain").label).toBe("Mountain");
        });

        it("overrides existing terrain with same id", () => {
            registry.register({ id: "forest", label: "Dense Forest", category: "wilderness" });
            expect(registry.get("forest").label).toBe("Dense Forest");
        });

        it("preserves flags on registered terrains", () => {
            registry.register({ id: "cave", label: "Cave", flags: { dark: true } });
            expect(registry.get("cave").flags.dark).toBe(true);
        });

        it("defaults flags to empty object when not provided", () => {
            registry.register({ id: "plains", label: "Plains" });
            expect(registry.get("plains").flags).toEqual({});
        });

        it("rejects registration without id", () => {
            registry.register({ label: "No Id" });
            expect(registry.has(undefined)).toBe(false);
        });

        it("rejects registration without label", () => {
            registry.register({ id: "nolabel" });
            expect(registry.has("nolabel")).toBe(false);
        });
    });

    // ── unregister ───────────────────────────────────────────────

    describe("unregister", () => {
        it("removes a module-registered terrain", () => {
            registry.register({ id: "tundra", label: "Tundra" });
            expect(registry.has("tundra")).toBe(true);
            const result = registry.unregister("tundra");
            expect(result).toBe(true);
            expect(registry.has("tundra")).toBe(false);
        });

        it("refuses to remove a base terrain", () => {
            const result = registry.unregister("forest");
            expect(result).toBe(false);
            expect(registry.has("forest")).toBe(true);
        });

        it("returns false for an id that was never registered", () => {
            const result = registry.unregister("nonexistent");
            expect(result).toBe(false);
        });
    });

    // ── getAll ───────────────────────────────────────────────────

    describe("getAll", () => {
        it("returns base terrains by default", () => {
            const all = registry.getAll();
            expect(all.length).toBeGreaterThanOrEqual(5);
        });

        it("includes module-registered terrains", () => {
            registry.register({ id: "coast", label: "Coast" });
            const all = registry.getAll();
            const ids = all.map(t => t.id);
            expect(ids).toContain("coast");
            expect(ids).toContain("forest");
        });
    });

    // ── get / has ────────────────────────────────────────────────

    describe("get / has", () => {
        it("get returns terrain definition for registered id", () => {
            const terrain = registry.get("forest");
            expect(terrain).toBeDefined();
            expect(terrain.id).toBe("forest");
            expect(terrain.label).toBe("Forest");
        });

        it("get returns undefined for unknown id", () => {
            expect(registry.get("volcano")).toBeUndefined();
        });

        it("has returns true for registered id", () => {
            expect(registry.has("swamp")).toBe(true);
        });

        it("has returns false for unknown id", () => {
            expect(registry.has("volcano")).toBe(false);
        });
    });
});
