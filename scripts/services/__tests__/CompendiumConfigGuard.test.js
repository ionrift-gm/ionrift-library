import { describe, expect, it } from "vitest";
import { CompendiumConfigGuard } from "../CompendiumConfigGuard.js";

describe("CompendiumConfigGuard.planRepair", () => {
    it("prunes null/non-object entries and preserves valid ones", () => {
        const result = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "ionrift.packA": null,
                "ionrift.packB": 7,
                "ionrift.packC": { folder: "f1" }
            },
            folders: [{ _id: "f1", type: "Compendium", name: "Valid Folder" }]
        });

        expect(result.prunedConfigKeys.sort()).toEqual(["ionrift.packA", "ionrift.packB"]);
        expect(result.cleanedConfig).toEqual({
            "ionrift.packC": { folder: "f1" }
        });
        expect(result.changed).toBe(true);
    });

    it("strips dangling folder references but keeps sibling ownership", () => {
        const result = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "ionrift.packA": {
                    folder: "missing-folder",
                    ownership: { PLAYER: 1 }
                }
            },
            folders: [{ _id: "f1", type: "Compendium", name: "Existing" }]
        });

        expect(result.strippedFolderRefs).toEqual(["ionrift.packA"]);
        expect(result.prunedConfigKeys).toEqual([]);
        expect(result.cleanedConfig["ionrift.packA"]).toEqual({
            ownership: { PLAYER: 1 }
        });
    });

    it("prunes entries that only contain dangling folder refs", () => {
        const result = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "ionrift.packA": { folder: "missing-folder" }
            },
            folders: [{ _id: "f1", type: "Compendium", name: "Existing" }]
        });

        expect(result.prunedConfigKeys).toEqual(["ionrift.packA"]);
        expect(result.strippedFolderRefs).toEqual([]);
        expect(result.cleanedConfig).toEqual({});
    });

    it("renames blank compendium folders to fallback name", () => {
        const result = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {},
            folders: [
                { _id: "f1", type: "Compendium", name: "" },
                { _id: "f2", type: "Compendium", name: "   " },
                { _id: "f3", type: "Compendium", name: "Named" },
                { _id: "f4", type: "Actor", name: "" }
            ],
            fallbackFolderName: "Compendiums"
        });

        expect(result.renamedFolders).toEqual([
            { _id: "f1", name: "Compendiums" },
            { _id: "f2", name: "Compendiums" }
        ]);
        expect(result.changed).toBe(true);
    });

    it("returns unchanged plan for already-healthy data", () => {
        const result = CompendiumConfigGuard.planRepair({
            compendiumConfiguration: {
                "ionrift.packA": { folder: "f1", ownership: { PLAYER: 1 } }
            },
            folders: [{ _id: "f1", type: "Compendium", name: "Folder A" }]
        });

        expect(result.cleanedConfig).toEqual({
            "ionrift.packA": { folder: "f1", ownership: { PLAYER: 1 } }
        });
        expect(result.prunedConfigKeys).toEqual([]);
        expect(result.strippedFolderRefs).toEqual([]);
        expect(result.renamedFolders).toEqual([]);
        expect(result.changed).toBe(false);
    });
});
