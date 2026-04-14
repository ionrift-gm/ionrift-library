import { describe, expect, it } from "vitest";
import { PackManifestSchema } from "../scripts/data/PackManifestSchema.js";

describe("validate()", () => {
    it("accepts a valid manifest with all fields", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            version: "1.2.3",
            tier: "core",
            packType: "data",
            format: "json",
            minModuleVersion: "2.0.0",
            contentTypes: ["json", ".txt"],
            files: [{ path: "packs/events.json", sha256: "abc123" }]
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("rejects missing packId", () => {
        const result = PackManifestSchema.validate({
            version: "1.2.3",
            tier: "core",
            packType: "data",
            format: "json"
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("packId"))).toBe(true);
    });

    it("rejects missing version", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            tier: "core",
            packType: "data",
            format: "json"
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("version"))).toBe(true);
    });

    it("rejects invalid packType", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            version: "1.2.3",
            tier: "core",
            packType: "audio",
            format: "json"
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("packType"))).toBe(true);
    });

    it("rejects invalid format", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            version: "1.2.3",
            tier: "core",
            packType: "data",
            format: "tar"
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("format"))).toBe(true);
    });

    it("accepts a minimal valid manifest", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            version: "1.2.3",
            tier: "core",
            packType: "data",
            format: "json"
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("accepts unknown extra fields for forward compatibility", () => {
        const result = PackManifestSchema.validate({
            packId: "ionrift.respite.events.core",
            version: "1.2.3",
            tier: "core",
            packType: "data",
            format: "zip",
            experimental: { betaFlag: true },
            tags: ["future", "compat"]
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("rejects an empty object with multiple errors", () => {
        const result = PackManifestSchema.validate({});

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(5);
    });
});

describe("compareVersions()", () => {
    it("returns 0 for equal versions", () => {
        expect(PackManifestSchema.compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("returns -1 when left minor is lower", () => {
        expect(PackManifestSchema.compareVersions("1.0.0", "1.1.0")).toBe(-1);
    });

    it("returns 1 when left major is higher", () => {
        expect(PackManifestSchema.compareVersions("2.0.0", "1.9.9")).toBe(1);
    });

    it("returns -1 when left patch is lower", () => {
        expect(PackManifestSchema.compareVersions("1.0.0", "1.0.1")).toBe(-1);
    });

    it("returns 1 when left patch is higher in 0.x versions", () => {
        expect(PackManifestSchema.compareVersions("0.1.0", "0.0.9")).toBe(1);
    });
});

describe("extractFromJson()", () => {
    it("extracts a valid _manifest key", () => {
        const data = {
            _manifest: {
                packId: "ionrift.workshop.progression.basic",
                version: "2.3.0",
                tier: "plus",
                packType: "data",
                format: "json"
            },
            entries: [{ id: 1 }]
        };

        const result = PackManifestSchema.extractFromJson(data);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
        expect(result.manifest?.packId).toBe("ionrift.workshop.progression.basic");
    });

    it("returns invalid when _manifest is missing", () => {
        const result = PackManifestSchema.extractFromJson({ entries: [{ id: 1 }] });
        expect(result.valid).toBe(false);
        expect(result.manifest).toBeNull();
    });

    it("returns invalid with errors for malformed _manifest", () => {
        const result = PackManifestSchema.extractFromJson({
            _manifest: {
                packId: "ionrift.workshop.progression.basic",
                version: "bad",
                tier: "plus",
                packType: "data",
                format: "json"
            }
        });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("extracts manifest only when JSON includes extra pack data", () => {
        const result = PackManifestSchema.extractFromJson({
            _manifest: {
                packId: "ionrift.workshop.professions.advanced",
                version: "3.0.1",
                tier: "premium",
                packType: "mixed",
                format: "json",
                files: [{ path: "packs/professions.json", sha256: "hashvalue" }]
            },
            professions: [{ name: "Smith" }],
            config: { rarity: "rare" }
        });

        expect(result.valid).toBe(true);
        expect(result.manifest).toEqual({
            packId: "ionrift.workshop.professions.advanced",
            version: "3.0.1",
            tier: "premium",
            packType: "mixed",
            format: "json",
            files: [{ path: "packs/professions.json", sha256: "hashvalue" }]
        });
    });
});
