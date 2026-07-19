/**
 * Library-owned settings for manually installed overlays.
 *
 * Raw settings storage recovers values from retired companion modules without
 * requiring those modules to be active.
 */

const LIBRARY_ID = "ionrift-library";
const RETIRED_MODULE_IDS = Object.freeze(["ionrift-connect", "ionrift-annex"]);

export const OVERLAY_WORLD_KEYS = Object.freeze([
    "installedPacks",
    "registryLastCheck",
    "registrySnoozed",
    "overlayDistributionEnabled",
    "overlayWorldState",
    "devOverlayRegistry"
]);

export const OVERLAY_CLIENT_KEYS = Object.freeze([
    "showPreviewContent"
]);

export const OVERLAY_SETTING_KEYS = Object.freeze([
    ...OVERLAY_WORLD_KEYS,
    ...OVERLAY_CLIENT_KEYS
]);

function safeGet(moduleId, key) {
    try {
        return game.settings.get(moduleId, key);
    } catch {
        return undefined;
    }
}

function safeStoredGet(moduleId, key, scope) {
    try {
        const store = game.settings.storage?.get(scope);
        const setting = store?.get?.(`${moduleId}.${key}`);
        return setting?.value;
    } catch {
        return undefined;
    }
}

export function getWorldSetting(key, fallback = undefined) {
    const library = safeGet(LIBRARY_ID, key);
    if (library !== undefined) return library;
    const scope = OVERLAY_CLIENT_KEYS.includes(key) ? "client" : "world";
    for (const moduleId of [...RETIRED_MODULE_IDS].reverse()) {
        const stored = safeStoredGet(moduleId, key, scope);
        if (stored !== undefined) return stored;
    }
    return fallback;
}

export async function setWorldSetting(key, value) {
    await game.settings.set(LIBRARY_ID, key, value);
}

async function copyStoredValues(moduleId, keys, scope) {
    for (const key of keys) {
        const source = safeStoredGet(moduleId, key, scope);
        if (source === undefined) continue;
        await game.settings.set(LIBRARY_ID, key, source);
    }
}

/**
 * Recover settings moved out of Library by retired companion modules.
 */
export async function reclaimOverlaySettings() {
    if (game.user?.isGM && !safeGet(LIBRARY_ID, "annexWorldSettingsReclaimed")) {
        for (const moduleId of RETIRED_MODULE_IDS) {
            await copyStoredValues(moduleId, OVERLAY_WORLD_KEYS, "world");
        }
        await game.settings.set(LIBRARY_ID, "annexWorldSettingsReclaimed", true);
    }
    if (!safeGet(LIBRARY_ID, "annexClientSettingsReclaimed")) {
        for (const moduleId of RETIRED_MODULE_IDS) {
            await copyStoredValues(moduleId, OVERLAY_CLIENT_KEYS, "client");
        }
        await game.settings.set(LIBRARY_ID, "annexClientSettingsReclaimed", true);
    }
}
