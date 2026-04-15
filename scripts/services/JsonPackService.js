/**
 * JsonPackService
 * Library-level JSON content pack importer.
 * Consumer modules call importJsonPack() for structured data packs (events, professions, configs).
 * Mirrors ZipImporterService API. Manifest metadata stored in unified "ionrift-library.installedPacks".
 */

import { PackManifestSchema } from "../data/PackManifestSchema.js";

export class JsonPackService {
    /**
     * Full import flow: file picker -> parse -> validate -> consumer import -> metadata update.
     *
     * @param {Object} options
     * @param {string} options.moduleId
     * @param {Function} [options.schemaValidator]
     * @param {Function} [options.onImport]
     * @returns {Promise<{success: boolean, packId: string|null, version: string|null, errors: string[]}|null>}
     */
    static async importJsonPack(options = {}) {
        if (!game.user.isGM) {
            ui.notifications.warn("Only the GM can import packs.");
            return null;
        }

        const file = await this._pickFile();
        if (!file) return null;

        return this.importFromFile(file, options);
    }

    /**
     * Programmatic import from a File object.
     *
     * @param {File} file
     * @param {Object} options
     * @param {string} options.moduleId
     * @param {Function} [options.schemaValidator]
     * @param {Function} [options.onImport]
     * @returns {Promise<{success: boolean, packId: string|null, version: string|null, errors: string[]}>}
     */
    static async importFromFile(file, options = {}) {
        const {
            moduleId,
            schemaValidator = null,
            onImport = null
        } = options;

        if (!moduleId) throw new Error("JsonPackService: moduleId is required.");

        /** @type {string[]} */
        const errors = [];
        let parsedData = null;

        try {
            const text = await file.text();
            parsedData = JSON.parse(text);
        } catch (error) {
            const msg = `Failed to parse JSON file: ${error.message}`;
            console.warn("JsonPackImporter | Failed to parse file:", error);
            ui.notifications.error(msg);
            return { success: false, packId: null, version: null, errors: [msg] };
        }

        const extracted = PackManifestSchema.extractFromJson(parsedData);
        if (!extracted.valid || !extracted.manifest) {
            const manifestErrors = extracted.errors.length > 0
                ? extracted.errors
                : ["Missing or invalid _manifest object."];
            console.warn("JsonPackImporter | Manifest validation failed:", manifestErrors);
            return { success: false, packId: null, version: null, errors: manifestErrors };
        }

        const isLegacy = extracted.legacy === true;
        const manifest = extracted.manifest;
        const packId = typeof manifest.packId === "string" ? manifest.packId : null;
        const version = typeof manifest.version === "string" ? manifest.version : null;

        if (schemaValidator) {
            let validation;
            try {
                validation = schemaValidator(parsedData);
            } catch (error) {
                const msg = `Schema validator threw an error: ${error.message}`;
                console.warn("JsonPackImporter | Schema validator error:", error);
                return { success: false, packId, version, errors: [msg] };
            }

            if (!validation?.valid) {
                const schemaErrors = Array.isArray(validation?.errors) && validation.errors.length > 0
                    ? validation.errors
                    : ["Schema validation failed."];
                console.warn("JsonPackImporter | Schema validation failed:", schemaErrors);
                return { success: false, packId, version, errors: schemaErrors };
            }
        }

        if (onImport) {
            try {
                await onImport(parsedData);
            } catch (error) {
                const msg = `Import callback failed: ${error.message}`;
                console.warn("JsonPackImporter | onImport callback failed:", error);
                return { success: false, packId, version, errors: [msg] };
            }
        }

        if (isLegacy) {
            console.log("JsonPackImporter | Legacy pack imported (no metadata stored).");
        } else {
            try {
                const installedPacks = game.settings.get("ionrift-library", "installedPacks") ?? {};
                const updated = {
                    ...installedPacks,
                    [manifest.packId]: {
                        version: manifest.version,
                        tier: manifest.tier,
                        packType: manifest.packType,
                        format: "json",
                        installedAt: new Date().toISOString(),
                        fileCount: 1
                    }
                };
                await game.settings.set("ionrift-library", "installedPacks", updated);
                console.log(`JsonPackImporter | Stored manifest metadata for packId "${manifest.packId}".`);
            } catch (error) {
                const msg = `Failed to store installed pack metadata: ${error.message}`;
                console.warn("JsonPackImporter | Metadata storage failed:", error);
                return { success: false, packId, version, errors: [msg] };
            }
        }

        const label = isLegacy ? "legacy JSON pack" : `JSON pack "${manifest.packId}" (${manifest.version})`;
        console.log(`JsonPackImporter | Complete: imported ${label}.`);
        return { success: true, packId, version, errors };
    }

    /**
     * Opens a browser file picker restricted to .json files.
     * @returns {Promise<File|null>}
     */
    static _pickFile() {
        return new Promise((resolve) => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".json";
            input.addEventListener("change", (event) => {
                resolve(event.target.files?.[0] ?? null);
            });
            input.addEventListener("cancel", () => resolve(null));
            input.click();
        });
    }
}
