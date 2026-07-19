/**
 * Cloud install policy for full Foundry module zips (not overlays).
 *
 * Listed ionrift-library must not fetch or extract module or overlay zips.
 * Patrons get module zips from Patreon and use Foundry's Add-on Modules
 * installer. Overlay zips are unpacked into ionrift-data manually.
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
    // cloudInstall:false blocks legacy extract paths.
    if (entry?.cloudInstall === false) return true;
    if (entry?.distribution === "premium") return true;
    if (displayMeta?.distribution === "premium") return true;

    const ea = entry?.earlyAccess;
    if (ea?.version && ea?.tier) {
        if (!ea.publicAt || new Date(ea.publicAt) > new Date()) return true;
    }

    return CLOUD_MODULE_INSTALL_DENY_IDS.has(moduleId);
}
