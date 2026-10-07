/**
 * Historical prepared-media deny list.
 *
 * Source of truth (preferred):
 *   - registry.json / PACK_CATALOG field `cloudInstall: false`
 *   - middleware `/packs/download` is retired
 *
 * Fallback deny-list: hard IDs for Library builds that see a stale registry
 * before Pages/CDN catch up.
 */

/** @type {ReadonlySet<string>} */
export const PREPARED_MEDIA_CLOUD_DENY_IDS = Object.freeze(new Set([
    "respite-core-art-overlay",
    "respite-cooking-art-overlay",
    "resonance-core-overlay",
    "respite-art-core",
    "ionrift-soundpack-core"
]));

/**
 * @param {string} packId
 * @param {{ cloudInstall?: boolean }|null} [entry] Registry or catalog row when known
 * @returns {boolean}
 */
export function isPreparedMediaCloudDenied(packId, entry = null) {
    if (entry && entry.cloudInstall === false) return true;
    return typeof packId === "string" && PREPARED_MEDIA_CLOUD_DENY_IDS.has(packId);
}

/**
 * True when an older sideload client must refuse this pack.
 *
 * @param {string} packId
 * @param {{ cloudInstall?: boolean, preparedMedia?: boolean }|null} [entryOrManifest]
 * @returns {boolean}
 */
export function isPreparedMediaSideloadDenied(packId, entryOrManifest = null) {
    if (entryOrManifest?.preparedMedia === true) return true;
    return isPreparedMediaCloudDenied(packId, entryOrManifest);
}

/**
 * Canonical on-disk path for overlay unzip instructions.
 * @param {string} moduleId
 * @param {string} [sublayer]
 * @returns {string}
 */
export function formatOverlayUnzipPath(moduleId, sublayer = "core") {
    const layer = (typeof sublayer === "string" && sublayer.trim())
        ? sublayer.trim()
        : "core";
    return `ionrift-data/overlays/${moduleId}/${layer}/`;
}
