/**
 * Annex-owned settings formerly registered on ionrift-library.
 * Prefer Annex after migration; fall back to Library while Annex is absent.
 */

const ANNEX_ID = "ionrift-annex";
const LEGACY_CONNECT_ID = "ionrift-connect";
const LIBRARY_ID = "ionrift-library";

export const ANNEX_OWNED_MIGRATED_FLAG = "overlayRegistryMigrated";
export const ANNEX_OWNED_CLIENT_MIGRATED_FLAG = "overlayClientSettingsMigrated";

export const ANNEX_OWNED_WORLD_KEYS = Object.freeze([
    "installedPacks",
    "registryLastCheck",
    "registrySnoozed",
    "overlayDistributionEnabled",
    "overlayWorldState",
    "devOverlayRegistry"
]);

export const ANNEX_OWNED_CLIENT_KEYS = Object.freeze([
    "showPreviewContent"
]);

export const ANNEX_OWNED_SETTING_KEYS = Object.freeze([
    ...ANNEX_OWNED_WORLD_KEYS,
    ...ANNEX_OWNED_CLIENT_KEYS
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

function safeStoredGet(moduleId, key, scope) {
    try {
        const store = game.settings.storage?.get(scope);
        const setting = store?.get?.(`${moduleId}.${key}`);
        return setting?.value;
    } catch {
        return undefined;
    }
}

function legacyConnectValue(key) {
    const scope = ANNEX_OWNED_CLIENT_KEYS.includes(key) ? "client" : "world";
    return safeStoredGet(LEGACY_CONNECT_ID, key, scope);
}

function cloneDefault(key) {
    const value = LIBRARY_CLEAR_DEFAULTS[key];
    if (value === null || typeof value !== "object") return value;
    return foundry?.utils?.deepClone
        ? foundry.utils.deepClone(value)
        : structuredClone(value);
}

function annexSettingsRegistered() {
    try {
        game.settings.get(ANNEX_ID, ANNEX_OWNED_MIGRATED_FLAG);
        return true;
    } catch {
        return false;
    }
}

function worldMigrated() {
    return safeGet(ANNEX_ID, ANNEX_OWNED_MIGRATED_FLAG) === true;
}

function clientMigrated() {
    return safeGet(ANNEX_ID, ANNEX_OWNED_CLIENT_MIGRATED_FLAG) === true;
}

function keyMigrated(key) {
    if (ANNEX_OWNED_CLIENT_KEYS.includes(key)) return clientMigrated();
    return worldMigrated();
}

/**
 * Prefer Annex after migration; otherwise Library; then Annex.
 * @param {string} key
 * @param {*} [fallback]
 */
export function getWorldSetting(key, fallback = undefined) {
    if (keyMigrated(key)) {
        const value = safeGet(ANNEX_ID, key);
        return value !== undefined ? value : fallback;
    }
    const oldConnect = legacyConnectValue(key);
    if (oldConnect !== undefined) return oldConnect;
    const legacy = safeGet(LIBRARY_ID, key);
    if (legacy !== undefined) return legacy;
    const fromAnnex = safeGet(ANNEX_ID, key);
    return fromAnnex !== undefined ? fromAnnex : fallback;
}

/**
 * Write Annex when Annex settings exist; mirror to Library until migrated.
 * Soft-degrade to Library-only when Annex is absent.
 * @param {string} key
 * @param {*} value
 */
export async function setWorldSetting(key, value) {
    if (annexSettingsRegistered()) {
        await game.settings.set(ANNEX_ID, key, value);
        if (!keyMigrated(key)) {
            try {
                await game.settings.set(LIBRARY_ID, key, value);
            } catch {
                /* Library key may be absent in isolated tests */
            }
        }
        return;
    }
    await game.settings.set(LIBRARY_ID, key, value);
}

async function copyAndClear(keys) {
    for (const key of keys) {
        const oldConnect = legacyConnectValue(key);
        const legacyLibrary = safeGet(LIBRARY_ID, key);
        const source = oldConnect !== undefined ? oldConnect : legacyLibrary;
        if (source !== undefined) {
            await game.settings.set(ANNEX_ID, key, source);
        }
        try {
            await game.settings.set(LIBRARY_ID, key, cloneDefault(key));
        } catch {
            /* Library key may already be absent */
        }
    }
}

/** GM: once-per-world overlay/registry keys. */
export async function migrateOverlayRegistryFromLibrary() {
    if (!game.user?.isGM) return;
    if (worldMigrated()) return;
    if (!annexSettingsRegistered()) return;

    await copyAndClear(ANNEX_OWNED_WORLD_KEYS);
    await game.settings.set(ANNEX_ID, ANNEX_OWNED_MIGRATED_FLAG, true);
}

/** Per-client preview flag. */
export async function migrateOverlayClientSettingsFromLibrary() {
    if (clientMigrated()) return;
    if (!annexSettingsRegistered()) return;

    await copyAndClear(ANNEX_OWNED_CLIENT_KEYS);
    await game.settings.set(ANNEX_ID, ANNEX_OWNED_CLIENT_MIGRATED_FLAG, true);
}
