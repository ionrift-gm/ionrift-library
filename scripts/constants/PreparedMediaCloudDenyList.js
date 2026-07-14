/**
 * Cloud-install policy for prepared-media packs (Foundry AI policy Option A).
 *
 * Source of truth (preferred):
 *   - registry.json / PACK_CATALOG field `cloudInstall: false`
 *   - middleware `/packs/download` refuses those configs
 *
 * Fallback deny-list: hard IDs for Library builds that see a stale registry
 * before Pages/CDN catch up. Prefer shrinking this list over growing it.
 *
 * Manual zip import and already-local overlays remain allowed.
 * Align with FOUNDRY_AI_POLICY_REMEDIATION.md §2a.
 */

/** @type {ReadonlySet<string>} */
export const PREPARED_MEDIA_CLOUD_DENY_IDS = Object.freeze(new Set([
    "respite-core-overlay",
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
    "respite-bone-dust-overlay": "https://www.patreon.com/collection/2079931"
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
