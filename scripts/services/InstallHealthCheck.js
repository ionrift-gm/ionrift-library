/**
 * InstallHealthCheck
 * Post-ready diagnostic that inspects the module folder of EA modules that
 * Foundry cannot see. Surfaces actionable console warnings pointing the
 * user at the exact structural problem: ZIP left inside the folder,
 * double-nested module directory, or missing module.json.
 *
 * Runs only for the GM, only for modules the library knows it distributes
 * that are absent from game.modules.
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { Logger } from "./Logger.js";

export class InstallHealthCheck {

    static MODULE_ID = "ionrift-library";

    /**
     * Module IDs distributed through the Library EA install flow.
     * Only these are inspected; a module installed through the Foundry
     * package browser will either be in game.modules or not exist at all.
     */
    static EA_MODULES = [
        "ionrift-cursewright",
        "ionrift-quartermaster",
        "ionrift-respite",
        "ionrift-arbiter",
        "ionrift-workshop",
        "ionrift-civics",
        "ionrift-atmosphere",
        "ionrift-economy"
    ];

    /**
     * Run the health check for all EA modules not currently visible to Foundry.
     * Call from the ready hook (GM only).
     */
    static async run() {
        if (!game.user.isGM) return;

        const FP = PlatformHelper.FP;
        if (!FP) return;

        for (const moduleId of this.EA_MODULES) {
            if (game.modules.get(moduleId)) continue;
            await this._diagnose(moduleId);
        }
    }

    /**
     * Inspect a single module directory and surface any structural problems.
     * @param {string} moduleId
     */
    static async _diagnose(moduleId) {
        const dirPath = `modules/${moduleId}`;
        const source = PlatformHelper.fileSource;
        const FP = PlatformHelper.FP;

        let result;
        try {
            result = await FP.browse(source, dirPath);
        } catch {
            // Directory does not exist at all. No folder, no problem to
            // diagnose (the module was never downloaded, not a broken install).
            return;
        }

        const files = result?.files ?? [];
        const dirs = result?.dirs ?? [];

        const diagnosis = this._analyze(moduleId, files, dirs);
        if (!diagnosis) return;

        this._report(moduleId, diagnosis);
    }

    /**
     * Determine what is wrong with the folder contents.
     * @param {string} moduleId
     * @param {string[]} files  File paths in modules/{moduleId}/
     * @param {string[]} dirs   Subdirectory paths in modules/{moduleId}/
     * @returns {{ problem: string, detail: string, fix: string }|null}
     */
    static _analyze(moduleId, files, dirs) {
        const fileNames = files.map(f => f.split("/").pop().toLowerCase());
        const dirNames = dirs.map(d => d.replace(/\/$/, "").split("/").pop().toLowerCase());

        // Case 1: ZIP file left in the module folder
        const zipFile = fileNames.find(f => f.endsWith(".zip"));
        if (zipFile) {
            return {
                problem: "zip-in-folder",
                detail: `Found "${zipFile}" inside modules/${moduleId}/. The ZIP must be extracted, not placed as-is.`,
                fix: `Extract the contents of the ZIP into modules/${moduleId}/ so that module.json sits directly inside, then delete the ZIP file and restart Foundry.`
            };
        }

        // Case 2: Double-nested folder (modules/ionrift-foo/ionrift-foo/)
        const nestedDir = dirNames.find(d => d === moduleId || d === moduleId.replace("ionrift-", ""));
        if (nestedDir) {
            const nested = dirs.find(d => d.replace(/\/$/, "").split("/").pop().toLowerCase() === nestedDir);
            return {
                problem: "double-nested",
                detail: `Found a nested "${nestedDir}" folder inside modules/${moduleId}/. The module files are one level too deep.`,
                fix: `Move everything from modules/${moduleId}/${nestedDir}/ up into modules/${moduleId}/ so that module.json sits directly inside, then remove the empty nested folder and restart Foundry.`
            };
        }

        // Case 3: Folder exists but has no module.json
        const hasModuleJson = fileNames.includes("module.json");
        if (!hasModuleJson) {
            const isEmpty = files.length === 0 && dirs.length === 0;
            if (isEmpty) {
                return {
                    problem: "empty-folder",
                    detail: `modules/${moduleId}/ exists but is completely empty.`,
                    fix: `Extract the downloaded ZIP into this folder so that module.json and the rest of the module files are inside, then restart Foundry.`
                };
            }
            return {
                problem: "missing-module-json",
                detail: `modules/${moduleId}/ has files but no module.json. Foundry cannot recognise it as a module.`,
                fix: `Verify you extracted the correct ZIP. The archive should contain a module.json at its root. Re-extract if needed, then restart Foundry.`
            };
        }

        // Folder looks structurally valid but Foundry still can't see it.
        // This can happen if Foundry's module cache is stale (needs full restart).
        if (files.length > 0) {
            return {
                problem: "restart-needed",
                detail: `modules/${moduleId}/ contains a valid module.json but Foundry does not list it. A full restart (not browser refresh) may be needed.`,
                fix: `Shut down Foundry completely and relaunch it. A browser refresh alone does not re-scan the modules folder.`
            };
        }

        return null;
    }

    /**
     * Log a structured warning to the console with diagnosis and fix.
     * @param {string} moduleId
     * @param {{ problem: string, detail: string, fix: string }} diagnosis
     */
    static _report(moduleId, diagnosis) {
        console.group(`%cIonrift Install Check: ${moduleId}`, "color: #f39c12; font-weight: bold;");
        console.warn(`Problem: ${diagnosis.detail}`);
        console.info(`Fix: ${diagnosis.fix}`);
        console.groupEnd();

        Logger.warn("Library", `Install health check [${moduleId}]: ${diagnosis.problem}`);

        ui.notifications.warn(
            `${moduleId} appears to be installed incorrectly. Check the browser console (F12) for details.`,
            { permanent: false }
        );
    }
}
