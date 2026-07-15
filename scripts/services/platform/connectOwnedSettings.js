/**
 * Connect-owned settings formerly registered on ionrift-library.
 * Prefer Connect after migration; fall back to Library until then / without Connect.
 */

const CONNECT_ID = "ionrift-connect";
const LIBRARY_ID = "ionrift-library";

export const CONNECT_OWNED_MIGRATED_FLAG = "overlayRegistryMigrated";
export const CONNECT_OWNED_CLIENT_MIGRATED_FLAG = "overlayClientSettingsMigrated";

export const CONNECT_OWNED_WORLD_KEYS = Object.freeze([
    "installedPacks",
    "registryLastCheck",
    "registrySnoozed",
    "overlayDistributionEnabled",
    "overlayWorldState",
    "devOverlayRegistry"
]);

export const CONNECT_OWNED_CLIENT_KEYS = Object.freeze([
    "showPreviewContent"
]);

export const CONNECT_OWNED_SETTING_KEYS = Object.freeze([
    ...CONNECT_OWNED_WORLD_KEYS,
    ...CONNECT_OWNED_CLIENT_KEYS
]);

const LIBRARY_CLEAR_DEFAULTS = Object.freeze({
    installedPacks: {},
    registryLastCheck: { timestamp: 0, data: null },
    registrySnoozed: {},
    overlayDistributionEnabled: true,
    overlayWorldState: {},
    devOverlayRegistry: {},
    showPreviewContent: false
});

function safeGet(moduleId, key) {
    try {
        return game.settings.get(moduleId, key);
    } catch {
        return undefined;
    }
}

function cloneDefault(key) {
    const value = LIBRARY_CLEAR_DEFAULTS[key];
    if (value === null || typeof value !== "object") return value;
    return foundry?.utils?.deepClone
        ? foundry.utils.deepClone(value)
        : structuredClone(value);
}

function connectSettingsRegistered() {
    try {
        game.settings.get(CONNECT_ID, CONNECT_OWNED_MIGRATED_FLAG);
        return true;
    } catch {
        return false;
    }
}

function worldMigrated() {
    return safeGet(CONNECT_ID, CONNECT_OWNED_MIGRATED_FLAG) === true;
}

function clientMigrated() {
    return safeGet(CONNECT_ID, CONNECT_OWNED_CLIENT_MIGRATED_FLAG) === true;
}

function keyMigrated(key) {
    if (CONNECT_OWNED_CLIENT_KEYS.includes(key)) return clientMigrated();
    return worldMigrated();
}

/**
 * Prefer Connect after migration; otherwise Library; then Connect.
 * @param {string} key
 * @param {*} [fallback]
 */
export function getWorldSetting(key, fallback = undefined) {
    if (keyMigrated(key)) {
        const value = safeGet(CONNECT_ID, key);
        return value !== undefined ? value : fallback;
    }
    const legacy = safeGet(LIBRARY_ID, key);
    if (legacy !== undefined) return legacy;
    const fromConnect = safeGet(CONNECT_ID, key);
    return fromConnect !== undefined ? fromConnect : fallback;
}

/**
 * Write Connect when Connect settings exist; mirror to Library until migrated.
 * Soft-degrade to Library-only when Connect is absent.
 * @param {string} key
 * @param {*} value
 */
export async function setWorldSetting(key, value) {
    if (connectSettingsRegistered()) {
        await game.settings.set(CONNECT_ID, key, value);
        if (!keyMigrated(key)) {
            try {
                await game.settings.set(LIBRARY_ID, key, value);
            } catch {
                /* Library key may be absent in odd test setups */
            }
        }
        return;
    }
    await game.settings.set(LIBRARY_ID, key, value);
}

async function copyAndClear(keys) {
    for (const key of keys) {
        const legacy = safeGet(LIBRARY_ID, key);
        if (legacy !== undefined) {
            await game.settings.set(CONNECT_ID, key, legacy);
        }
        try {
            await game.settings.set(LIBRARY_ID, key, cloneDefault(key));
        } catch {
            /* ignore */
        }
    }
}

/** GM: once-per-world overlay/registry keys. */
export async function migrateOverlayRegistryFromLibrary() {
    if (!game.user?.isGM) return;
    if (worldMigrated()) return;
    if (!connectSettingsRegistered()) return;

    await copyAndClear(CONNECT_OWNED_WORLD_KEYS);
    await game.settings.set(CONNECT_ID, CONNECT_OWNED_MIGRATED_FLAG, true);
}

/** Per-client preview flag. */
export async function migrateOverlayClientSettingsFromLibrary() {
    if (clientMigrated()) return;
    if (!connectSettingsRegistered()) return;

    await copyAndClear(CONNECT_OWNED_CLIENT_KEYS);
    await game.settings.set(CONNECT_ID, CONNECT_OWNED_CLIENT_MIGRATED_FLAG, true);
}
