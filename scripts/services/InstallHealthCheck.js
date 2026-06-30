/**
 * InstallHealthCheck
 * Post-ready diagnostic for the GM. Looks at Ionrift module folders that are
 * present on disk but not loaded by Foundry, and surfaces a console hint only
 * when there is positive evidence the folder is a half-finished install the
 * user is actively trying to complete (a ZIP left inside the folder, or the
 * module files nested one level too deep).
 *
 * It deliberately stays quiet for empty folders, residue from a removed
 * module, or unrelated leftover files. Those are not broken installs and a
 * warning toast for them is noise.
 *
 * Candidate folders are discovered from the modules directory at runtime, so
 * nothing here enumerates a fixed module list.
 */

import { PlatformHelper } from "./PlatformHelper.js";
import { Logger } from "./Logger.js";

export class InstallHealthCheck {

    static MODULE_ID = "ionrift-library";

    /** Folders that are never a module install to diagnose. */
    static IGNORE = new Set(["ionrift-library"]);

    /** Guards against re-running within a single session. */
    static _ran = false;

    /**
     * Run the health check once per session for the GM.
     * Call from the ready hook.
     */
    static async run() {
        if (!game.user?.isGM) return;
        if (this._ran) return;
        this._ran = true;

        const FP = PlatformHelper.FP;
        if (!FP) return;

        const candidates = await this._discoverCandidates();

        const problems = [];
        for (const moduleId of candidates) {
            const diagnosis = await this._diagnose(moduleId);
            if (diagnosis) problems.push({ moduleId, diagnosis });
        }

        if (problems.length) this._report(problems);
    }

    /**
     * Find Ionrift module folders present on disk that Foundry has not loaded.
     * Derived from the modules directory listing, never a hardcoded list.
     * @returns {Promise<string[]>}
     */
    static async _discoverCandidates() {
        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;

        let result;
        try {
            result = await FP.browse(source, "modules");
        } catch {
            return [];
        }

        const dirs = result?.dirs ?? [];
        return dirs
            .map(d => d.replace(/\/$/, "").split("/").pop())
            .filter(id => id && id.startsWith("ionrift-"))
            .filter(id => !this.IGNORE.has(id))
            .filter(id => !game.modules.get(id));
    }

    /**
     * Inspect a single folder and return a diagnosis only when there is
     * positive evidence of an in-progress, mis-structured install.
     * @param {string} moduleId
     * @returns {Promise<{ problem: string, detail: string, fix: string }|null>}
     */
    static async _diagnose(moduleId) {
        const dirPath = `modules/${moduleId}`;
        const source = PlatformHelper.fileSource;
        const FP = PlatformHelper.FP;

        let result;
        try {
            result = await FP.browse(source, dirPath);
        } catch {
            return null;
        }

        const files = result?.files ?? [];
        const dirs = result?.dirs ?? [];
        const fileNames = files.map(f => f.split("/").pop().toLowerCase());

        // Already has a manifest at the root. Nothing structural to fix here;
        // a missing entry in game.modules at this point is a cache/restart
        // matter that we do not nag about.
        if (fileNames.includes("module.json")) return null;

        const zipFile = fileNames.find(f => f.endsWith(".zip"));
        if (zipFile) {
            return this._analyze(moduleId, { zipFile });
        }

        // Confirm a true double-nest by looking for a manifest one level down,
        // rather than guessing from folder names (which produces false hits).
        const nestedDir = await this._findNestedManifestDir(dirPath, dirs);
        if (nestedDir) {
            return this._analyze(moduleId, { nestedDir });
        }

        // Empty folder, removed-module residue, or unrelated files. Not an
        // actionable install problem. Keep a quiet trace for the curious.
        if (files.length || dirs.length) {
            console.debug(`Ionrift | ${moduleId}: folder present, no manifest, no install evidence; ignoring.`);
        }
        return null;
    }

    /**
     * Return the name of the first immediate subdirectory that contains a
     * module.json, or null if none do.
     * @param {string} dirPath
     * @param {string[]} dirs  Subdirectory entries from a browse() call.
     * @returns {Promise<string|null>}
     */
    static async _findNestedManifestDir(dirPath, dirs) {
        const FP = PlatformHelper.FP;
        const source = PlatformHelper.fileSource;

        for (const entry of dirs) {
            const name = entry.replace(/\/$/, "").split("/").pop();
            if (!name) continue;

            let nested;
            try {
                nested = await FP.browse(source, `${dirPath}/${name}`);
            } catch {
                continue;
            }

            const nestedNames = (nested?.files ?? []).map(f => f.split("/").pop().toLowerCase());
            if (nestedNames.includes("module.json")) return name;
        }
        return null;
    }

    /**
     * Build a diagnosis from confirmed evidence.
     * @param {string} moduleId
     * @param {{ zipFile?: string, nestedDir?: string }} evidence
     * @returns {{ problem: string, detail: string, fix: string }|null}
     */
    static _analyze(moduleId, evidence = {}) {
        const { zipFile, nestedDir } = evidence;

        if (zipFile) {
            return {
                problem: "zip-in-folder",
                detail: `Found "${zipFile}" inside modules/${moduleId}/. The archive needs to be extracted, not left as a ZIP.`,
                fix: `Extract the contents of the ZIP into modules/${moduleId}/ so that module.json sits directly inside, delete the ZIP, then restart Foundry.`
            };
        }

        if (nestedDir) {
            return {
                problem: "double-nested",
                detail: `The module files are one level too deep, inside modules/${moduleId}/${nestedDir}/.`,
                fix: `Move everything from modules/${moduleId}/${nestedDir}/ up into modules/${moduleId}/ so that module.json sits directly inside, remove the empty nested folder, then restart Foundry.`
            };
        }

        return null;
    }

    /**
     * Log per-module detail to the console and show a single consolidated toast.
     * @param {Array<{ moduleId: string, diagnosis: { problem: string, detail: string, fix: string } }>} problems
     */
    static _report(problems) {
        console.group("%cIonrift install check", "color: #f39c12; font-weight: bold;");
        for (const { moduleId, diagnosis } of problems) {
            console.warn(`${moduleId}: ${diagnosis.detail}`);
            console.info(`Fix: ${diagnosis.fix}`);
            Logger.warn("Library", `Install health check [${moduleId}]: ${diagnosis.problem}`);
        }
        console.groupEnd();

        const count = problems.length;
        const noun = count === 1 ? "module" : "modules";
        const verb = count === 1 ? "needs" : "need";
        ui.notifications.warn(
            `${count} Ionrift ${noun} ${verb} a quick fix to finish installing. Open the console (F12) for steps.`,
            { permanent: false }
        );
    }
}
