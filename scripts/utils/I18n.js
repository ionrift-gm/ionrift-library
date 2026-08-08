/**
 * Thin Foundry i18n wrappers for Ionrift modules.
 * @param {string} key
 * @returns {string}
 */
export function localize(key) {
    if (typeof game === "undefined" || !game?.i18n?.localize) return key;
    return game.i18n.localize(key);
}

/**
 * @param {string} key
 * @param {Record<string, unknown>} [data]
 * @returns {string}
 */
export function format(key, data = {}) {
    if (typeof game === "undefined" || !game?.i18n?.format) return key;
    return game.i18n.format(key, data);
}
