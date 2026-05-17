/**
 * Helpers for Foundry module settings visibility.
 *
 * A setting is player-visible in Game Settings when config is not false
 * and restricted is not true. Menus follow the same rule on registerMenu.
 */

/** @param {object} cfg Foundry setting or menu registration config */
export function isPlayerVisibleInConfig(cfg) {
    if (cfg?.config === false) return false;
    return cfg?.restricted !== true;
}

/**
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @returns {string[]} keys visible to non-GM users in Configure Settings
 */
export function findPlayerVisibleSettingKeys(registrations) {
    return registrations
        .filter(({ cfg }) => isPlayerVisibleInConfig(cfg))
        .map(({ key }) => key);
}

/**
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @returns {string[]} menu keys visible to non-GM users
 */
export function findPlayerVisibleMenuKeys(registrations) {
    return findPlayerVisibleSettingKeys(registrations);
}

/**
 * Vitest helper: assert no player-visible config entries.
 * @param {Array<{ key: string, cfg: object }>} registrations
 * @param {string} moduleId
 */
export function assertNoPlayerConfigEntries(registrations, moduleId) {
    const visible = findPlayerVisibleSettingKeys(registrations);
    if (visible.length > 0) {
        throw new Error(
            `${moduleId}: player-visible settings in Game Settings: ${visible.join(", ")}`
        );
    }
}
