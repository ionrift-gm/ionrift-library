/**
 * Cloud install policy for full Foundry module zips (not overlays).
 *
 * Option C (locked 2026-07-14): listed ionrift-library must not fetch or
 * extract premium / early-access module zips. Patrons get the zip from the
 * Patreon post and use Foundry's Add-on Modules installer. Overlay Allow
 * packs are unchanged.
 *
 * Align with FOUNDRY_AI_POLICY_REMEDIATION.md premium sever (Option C).
 */

/** Hard deny when registry is stale. Overlay IDs never belong here. */
export const CLOUD_MODULE_INSTALL_DENY_IDS = Object.freeze(new Set([
    "ionrift-cursewright",
    "ionrift-monstrous-feast",
    "ionrift-cartographer",
    "ionrift-arbiter"
]));

/**
 * @param {string} moduleId
 * @param {{ distribution?: string, cloudInstall?: boolean, earlyAccess?: { version?: string, tier?: string, publicAt?: string } }|null} [entry]
 * @param {{ distribution?: string }|null} [displayMeta]
 * @returns {boolean}
 */
export function isCloudModuleInstallBlocked(moduleId, entry = null, displayMeta = null) {
    if (!moduleId || typeof moduleId !== "string") return false;
    // cloudInstall:false blocks ModuleInstaller extract. Listed Library also
    // refuses requestDownload for these module IDs (Option C).
    if (entry?.cloudInstall === false) return true;
    if (entry?.distribution === "premium") return true;
    if (displayMeta?.distribution === "premium") return true;

    const ea = entry?.earlyAccess;
    if (ea?.version && ea?.tier) {
        if (!ea.publicAt || new Date(ea.publicAt) > new Date()) return true;
    }

    return CLOUD_MODULE_INSTALL_DENY_IDS.has(moduleId);
}
