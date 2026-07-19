/**
 * Historical prepared-media deny list and manual download links.
 *
 * All packs now use browser download and manual unzip. The deny list remains
 * for compatibility with older clients during the transition.
 *
 * Source of truth (preferred):
 *   - registry.json / PACK_CATALOG field `cloudInstall: false`
 *   - middleware `/packs/download` is retired
 *
 * Fallback deny-list: hard IDs for Library builds that see a stale registry
 * before Pages/CDN catch up. Prefer shrinking this list over growing it.
 *
 * Already-local overlays remain readable. Align with
 * FOUNDRY_AI_POLICY_REMEDIATION.md §2a.
 */

/** @type {ReadonlySet<string>} */
export const PREPARED_MEDIA_CLOUD_DENY_IDS = Object.freeze(new Set([
    "respite-core-overlay",
    "respite-cooking-art-overlay",
    "resonance-core-overlay",
    "respite-frost-stone-overlay",
    "respite-bone-dust-overlay",
    "respite-art-core",
    "ionrift-soundpack-core"
]));

/** Public Patreon / download pages for offline packs (browser only). */
export const PREPARED_MEDIA_OFFLINE_URLS = Object.freeze({
    "respite-core-overlay": "https://www.patreon.com/posts/154985310",
    "respite-art-core": "https://www.patreon.com/posts/154985310",
    "resonance-core-overlay": "https://www.patreon.com/posts/155880618",
    "ionrift-soundpack-core": "https://www.patreon.com/posts/155880618",
    "respite-frost-stone-overlay": "https://www.patreon.com/collection/2079931",
    "respite-bone-dust-overlay": "https://www.patreon.com/collection/2079931",
    "respite-cooking-art-overlay":
        "https://api.ionrift.cloud/packs/public/respite-cooking-art-overlay/latest"
});

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

/**
 * Prefer registry publicDownloadUrl / patreonUrl when present.
 * @param {string} packId
 * @param {{ publicDownloadUrl?: string, patreonUrl?: string }|null} [entry]
 * @returns {string|null}
 */
export function resolvePreparedMediaOfflineUrl(packId, entry = null) {
    if (entry?.publicDownloadUrl) return entry.publicDownloadUrl;
    if (entry?.patreonUrl) return entry.patreonUrl;
    return PREPARED_MEDIA_OFFLINE_URLS[packId] ?? null;
}
