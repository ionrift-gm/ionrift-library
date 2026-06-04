import { describe, expect, it } from "vitest";
import { CompendiumConfigGuard } from "../scripts/services/CompendiumConfigGuard.js";

describe("CompendiumConfigGuard.planRepair", () => {

    it("returns unchanged for a healthy configuration", () => {
        const folders = [{ _id: "f1", type: "Compendium", name: "Monsters" }];
        const config = { "mod.pack": { folder: "f1" } };
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: config,
            folders
        });

        expect(plan.changed).toBe(false);
        expect(plan.prunedConfigKeys).toHaveLength(0);
        expect(plan.strippedFolderRefs).toHaveLength(0);
        expect(plan.renamedFolders).toHaveLength(0);
        expect(plan.cleanedConfig).toEqual(config);
    });

    it("prunes null config entries", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: { "mod.bad": null, "mod.ok": { folder: "f1" } },
            folders: [{ _id: "f1", type: "Compendium", name: "Good" }]
        });

        expect(plan.changed).toBe(true);
        expect(plan.prunedConfigKeys).toContain("mod.bad");
        expect(plan.cleanedConfig["mod.bad"]).toBeUndefined();
        expect(plan.cleanedConfig["mod.ok"]).toEqual({ folder: "f1" });
    });

    it("prunes array config entries", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: { "mod.arr": [1, 2, 3] },
            folders: []
        });

        expect(plan.changed).toBe(true);
        expect(plan.prunedConfigKeys).toContain("mod.arr");
    });

    it("strips dangling folder references but keeps sibling properties", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "mod.pack": { folder: "ghost", ownership: { default: 0 } }
            },
            folders: []
        });

        expect(plan.changed).toBe(true);
        expect(plan.strippedFolderRefs).toContain("mod.pack");
        expect(plan.cleanedConfig["mod.pack"]).toEqual({ ownership: { default: 0 } });
    });

    it("prunes dangling folder reference when no sibling properties remain", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "mod.pack": { folder: "ghost" }
            },
            folders: []
        });

        expect(plan.changed).toBe(true);
        expect(plan.prunedConfigKeys).toContain("mod.pack");
        expect(plan.cleanedConfig["mod.pack"]).toBeUndefined();
    });

    it("renames nameless Compendium folders", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {},
            folders: [
                { _id: "f1", type: "Compendium", name: undefined },
                { _id: "f2", type: "Compendium", name: null },
                { _id: "f3", type: "Compendium", name: "  " },
                { _id: "f4", type: "Compendium", name: "" }
            ]
        });

        expect(plan.changed).toBe(true);
        expect(plan.renamedFolders).toHaveLength(4);
        expect(plan.renamedFolders.every(r => r.name === "Compendiums")).toBe(true);
    });

    it("skips non-Compendium folders when renaming", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {},
            folders: [
                { _id: "f1", type: "Actor", name: undefined }
            ]
        });

        expect(plan.renamedFolders).toHaveLength(0);
    });

    it("uses custom fallback folder name", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {},
            folders: [{ _id: "f1", type: "Compendium", name: "" }],
            fallbackFolderName: "Recovered"
        });

        expect(plan.renamedFolders[0].name).toBe("Recovered");
    });

    it("handles undefined compendiumConfiguration gracefully", () => {
        const plan = CompendiumConfigGuard.planRepair({ folders: [] });
        expect(plan.changed).toBe(false);
        expect(plan.cleanedConfig).toEqual({});
    });

    it("handles undefined folders gracefully", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: { "mod.pack": { folder: "f1" } }
        });

        expect(plan.changed).toBe(true);
        expect(plan.strippedFolderRefs).toHaveLength(0);
        expect(plan.prunedConfigKeys).toContain("mod.pack");
    });

    it("handles completely empty arguments", () => {
        const plan = CompendiumConfigGuard.planRepair();
        expect(plan.changed).toBe(false);
        expect(plan.cleanedConfig).toEqual({});
    });

    it("retains entries with valid folder references", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "a.b": { folder: "f1" },
                "c.d": { folder: "f2", ownership: { GM: 3 } }
            },
            folders: [
                { _id: "f1", type: "Compendium", name: "Pack A" },
                { _id: "f2", type: "Compendium", name: "Pack B" }
            ]
        });

        expect(plan.changed).toBe(false);
        expect(Object.keys(plan.cleanedConfig)).toHaveLength(2);
    });

    it("keeps entries that have no folder reference at all", () => {
        const plan = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: { "mod.pack": { ownership: { default: 0 } } },
            folders: []
        });

        expect(plan.changed).toBe(false);
        expect(plan.cleanedConfig["mod.pack"]).toEqual({ ownership: { default: 0 } });
    });
});
