/**
 * Helpers for Foundry module settings visibility.
 *
 * Foundry only honors `restricted` on registerMenu, not on register.
 * Client-scoped settings with config:true always appear for every user.
 * World-scoped settings with config:true appear only for users who can
 * modify configuration (typically GM).
 */

/** @param {object} cfg Foundry registerMenu config */
export function isPlayerVisibleMenu(cfg) {
    return cfg?.restricted !== true;
}

/**
 * Whether a registered setting appears in a non-GM Game Settings panel.
 * @param {object} cfg Foundry register config
 */
export function isPlayerVisibleSetting(cfg) {
    if (cfg?.config !== true) return false;
    const scope = cfg?.scope ?? "client";
    return scope === "client";
}

/**
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @returns {string[]}
 */
export function findPlayerVisibleSettingKeys(registrations) {
    return registrations
        .filter(({ cfg }) => isPlayerVisibleSetting(cfg))
        .map(({ key }) => key);
}

/**
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @returns {string[]}
 */
export function findPlayerVisibleMenuKeys(registrations) {
    return registrations
        .filter(({ cfg }) => isPlayerVisibleMenu(cfg))
        .map(({ key }) => key);
}

/**
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @param {string} moduleId
 */
export function assertNoPlayerConfigEntries(registrations, moduleId) {
    const settings = findPlayerVisibleSettingKeys(registrations);
    if (settings.length > 0) {
        throw new Error(
            `${moduleId}: client settings visible in Game Settings: ${settings.join(", ")}`
        );
    }
}

/**
 * @param {Array<{ key: string, cfg: object }>} menuRegistrations
 * @param {string} moduleId
 */
export function assertNoPlayerMenuEntries(menuRegistrations, moduleId) {
    const menus = findPlayerVisibleMenuKeys(menuRegistrations);
    if (menus.length > 0) {
        throw new Error(
            `${moduleId}: menus visible in Game Settings: ${menus.join(", ")}`
        );
    }
}
