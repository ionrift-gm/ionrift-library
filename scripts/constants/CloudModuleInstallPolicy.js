/**
 * Cloud install policy for full Foundry module zips (not overlays).
 *
 * Listed ionrift-library must not extract/install premium or early-access
 * module zips via ModuleInstallerService. Patrons get a signed CDN zip in
 * the browser (CloudRelayService.requestDownload → window.open), then use
 * Foundry's Add-on Modules installer. Overlay Allow packs are unchanged.
 *
 * Align with FOUNDRY_AI_POLICY_REMEDIATION.md premium sever.
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
    // cloudInstall:false on overlays blocks ModuleInstaller too; module rows
    // usually omit it so signed /packs/download can still mint a browser URL.
    if (entry?.cloudInstall === false) return true;
    if (entry?.distribution === "premium") return true;
    if (displayMeta?.distribution === "premium") return true;

    const ea = entry?.earlyAccess;
    if (ea?.version && ea?.tier) {
        if (!ea.publicAt || new Date(ea.publicAt) > new Date()) return true;
    }

    return CLOUD_MODULE_INSTALL_DENY_IDS.has(moduleId);
}
