import { describe, expect, it } from "vitest";
import { PackManifestSchema } from "../scripts/data/PackManifestSchema.js";

function validManifest(overrides = {}) {
    return {
        packId: "test-pack",
        version: "1.0.0",
        tier: "public",
        packType: "data",
        format: "json",
        ...overrides
    };
}

describe("PackManifestSchema", () => {

    // ── validate ──────────────────────────────────────────────────────

    describe("validate", () => {
        it("accepts a minimal valid manifest", () => {
            const result = PackManifestSchema.validate(validManifest());
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("rejects null input", () => {
            const result = PackManifestSchema.validate(null);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Manifest must be an object.");
        });

        it("rejects array input", () => {
            const result = PackManifestSchema.validate([]);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Manifest must be an object.");
        });

        it("rejects string input", () => {
            const result = PackManifestSchema.validate("hello");
            expect(result.valid).toBe(false);
        });

        it("requires packId as a non-empty string", () => {
            const result = PackManifestSchema.validate(validManifest({ packId: "" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("packId"))).toBe(true);
        });

        it("requires packId to be present", () => {
            const m = validManifest();
            delete m.packId;
            const result = PackManifestSchema.validate(m);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("packId"))).toBe(true);
        });

        it("requires version as a valid semver string", () => {
            const result = PackManifestSchema.validate(validManifest({ version: "not-semver" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("semver"))).toBe(true);
        });

        it("rejects empty version", () => {
            const result = PackManifestSchema.validate(validManifest({ version: "  " }));
            expect(result.valid).toBe(false);
        });

        it("requires tier as a non-empty string", () => {
            const result = PackManifestSchema.validate(validManifest({ tier: "" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("tier"))).toBe(true);
        });

        it("rejects unknown packType", () => {
            const result = PackManifestSchema.validate(validManifest({ packType: "video" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("packType"))).toBe(true);
        });

        it("accepts all valid packTypes", () => {
            for (const packType of ["art", "sfx", "data", "mixed"]) {
                const result = PackManifestSchema.validate(validManifest({ packType }));
                expect(result.valid).toBe(true);
            }
        });

        it("rejects unknown format", () => {
            const result = PackManifestSchema.validate(validManifest({ format: "tar" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("format"))).toBe(true);
        });

        it("accepts both valid formats", () => {
            for (const format of ["zip", "json"]) {
                const result = PackManifestSchema.validate(validManifest({ format }));
                expect(result.valid).toBe(true);
            }
        });

        it("collects multiple errors at once", () => {
            const result = PackManifestSchema.validate({});
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(1);
        });

        it("accepts valid optional minModuleVersion", () => {
            const result = PackManifestSchema.validate(validManifest({ minModuleVersion: "2.1.0" }));
            expect(result.valid).toBe(true);
        });

        it("rejects invalid minModuleVersion", () => {
            const result = PackManifestSchema.validate(validManifest({ minModuleVersion: "bad" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("minModuleVersion"))).toBe(true);
        });

        it("rejects empty minModuleVersion string", () => {
            const result = PackManifestSchema.validate(validManifest({ minModuleVersion: " " }));
            expect(result.valid).toBe(false);
        });

        it("accepts valid contentTypes array", () => {
            const result = PackManifestSchema.validate(validManifest({ contentTypes: ["Actor", "Item"] }));
            expect(result.valid).toBe(true);
        });

        it("rejects non-array contentTypes", () => {
            const result = PackManifestSchema.validate(validManifest({ contentTypes: "Actor" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("contentTypes"))).toBe(true);
        });

        it("rejects contentTypes containing non-strings", () => {
            const result = PackManifestSchema.validate(validManifest({ contentTypes: [42] }));
            expect(result.valid).toBe(false);
        });

        it("accepts valid files array", () => {
            const result = PackManifestSchema.validate(validManifest({
                format: "zip",
                files: [{ path: "data/monsters.json", sha256: "abc123" }]
            }));
            expect(result.valid).toBe(true);
        });

        it("rejects files that are not an array", () => {
            const result = PackManifestSchema.validate(validManifest({ files: "nope" }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("files must be an array"))).toBe(true);
        });

        it("rejects file entries missing path", () => {
            const result = PackManifestSchema.validate(validManifest({
                files: [{ sha256: "abc" }]
            }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("path"))).toBe(true);
        });

        it("rejects file entries missing sha256", () => {
            const result = PackManifestSchema.validate(validManifest({
                files: [{ path: "foo.json" }]
            }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("sha256"))).toBe(true);
        });

        it("rejects null entries in files array", () => {
            const result = PackManifestSchema.validate(validManifest({
                files: [null]
            }));
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("files[0]"))).toBe(true);
        });

        it("allows zip format without files field", () => {
            const result = PackManifestSchema.validate(validManifest({ format: "zip" }));
            expect(result.valid).toBe(true);
        });

        it("accepts prerelease semver version", () => {
            const result = PackManifestSchema.validate(validManifest({ version: "2.0.0-beta.1" }));
            expect(result.valid).toBe(true);
        });

        it("accepts version with build metadata", () => {
            const result = PackManifestSchema.validate(validManifest({ version: "1.0.0+build.42" }));
            expect(result.valid).toBe(true);
        });
    });

    // ── compareVersions ──────────────────────────────────────────────

    describe("compareVersions", () => {
        it("returns 0 for equal versions", () => {
            expect(PackManifestSchema.compareVersions("1.0.0", "1.0.0")).toBe(0);
        });

        it("compares major versions", () => {
            expect(PackManifestSchema.compareVersions("2.0.0", "1.0.0")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.0.0", "2.0.0")).toBe(-1);
        });

        it("compares minor versions", () => {
            expect(PackManifestSchema.compareVersions("1.2.0", "1.1.0")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.1.0", "1.2.0")).toBe(-1);
        });

        it("compares patch versions", () => {
            expect(PackManifestSchema.compareVersions("1.0.2", "1.0.1")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.0.1", "1.0.2")).toBe(-1);
        });

        it("release beats prerelease with same version", () => {
            expect(PackManifestSchema.compareVersions("1.0.0", "1.0.0-beta.1")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.0.0-beta.1", "1.0.0")).toBe(-1);
        });

        it("compares numeric prerelease identifiers", () => {
            expect(PackManifestSchema.compareVersions("1.0.0-beta.2", "1.0.0-beta.1")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.0.0-beta.1", "1.0.0-beta.2")).toBe(-1);
        });

        it("compares string prerelease identifiers lexically", () => {
            expect(PackManifestSchema.compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
            expect(PackManifestSchema.compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
        });

        it("numeric prerelease sorts before string prerelease", () => {
            expect(PackManifestSchema.compareVersions("1.0.0-1", "1.0.0-alpha")).toBe(-1);
        });

        it("shorter prerelease loses to longer when all parts equal", () => {
            expect(PackManifestSchema.compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBe(-1);
        });

        it("handles both invalid as equal", () => {
            expect(PackManifestSchema.compareVersions("garbage", "trash")).toBe(0);
        });

        it("valid version sorts above invalid", () => {
            expect(PackManifestSchema.compareVersions("1.0.0", "garbage")).toBe(1);
            expect(PackManifestSchema.compareVersions("garbage", "1.0.0")).toBe(-1);
        });
    });

    // ── extractFromJson ──────────────────────────────────────────────

    describe("extractFromJson", () => {
        it("extracts a valid _manifest block", () => {
            const data = { _manifest: validManifest(), items: [] };
            const result = PackManifestSchema.extractFromJson(data);
            expect(result.valid).toBe(true);
            expect(result.manifest.packId).toBe("test-pack");
            expect(result.errors).toHaveLength(0);
            expect(result.legacy).toBeUndefined();
        });

        it("returns legacy stub for top-level array", () => {
            const result = PackManifestSchema.extractFromJson([{ name: "old item" }]);
            expect(result.valid).toBe(true);
            expect(result.legacy).toBe(true);
            expect(result.manifest.packId).toBe("legacy-import");
        });

        it("returns legacy stub for object without _manifest", () => {
            const result = PackManifestSchema.extractFromJson({ items: [] });
            expect(result.valid).toBe(true);
            expect(result.legacy).toBe(true);
        });

        it("returns legacy stub for null _manifest", () => {
            const result = PackManifestSchema.extractFromJson({ _manifest: null });
            expect(result.valid).toBe(true);
            expect(result.legacy).toBe(true);
        });

        it("parses JSON string input", () => {
            const json = JSON.stringify({ _manifest: validManifest() });
            const result = PackManifestSchema.extractFromJson(json);
            expect(result.valid).toBe(true);
            expect(result.manifest.packId).toBe("test-pack");
        });

        it("rejects invalid JSON string", () => {
            const result = PackManifestSchema.extractFromJson("{bad json}");
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("not valid JSON"))).toBe(true);
        });

        it("rejects non-object non-string input", () => {
            const result = PackManifestSchema.extractFromJson(42);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes("must be an object"))).toBe(true);
        });

        it("rejects null input", () => {
            const result = PackManifestSchema.extractFromJson(null);
            expect(result.valid).toBe(false);
        });

        it("reports validation errors from an invalid _manifest", () => {
            const result = PackManifestSchema.extractFromJson({
                _manifest: { packId: "x" }
            });
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            expect(result.manifest).not.toBeNull();
        });
    });
});
