/**
 * Charge tracking for limited-use cooking save bonuses (Amber save_bonus).
 *
 * Multi-charge effects omit DAE isSave special duration and decrement on
 * dnd5e.rollSavingThrow. Single-charge effects keep isSave so DAE removes them
 * after one qualifying save. preDeleteActiveEffect catches multi-charge effects
 * that still carry isSave from older serves.
 */

import {
    COOKING_BUFF_FLAG_NAMESPACE as NS,
    COOKING_BUFF_FLAG as FLAG
} from "./CookingBuffs.js";

const SAVE_BONUS_KEY_RE = /^system\.abilities\.(\w{3})\.bonuses\.save$/;

function cookingEffects(actor) {
    return (actor?.effects ?? []).filter(effect =>
        effect.flags?.[NS]?.[FLAG] === true
        && !effect.disabled
    );
}

/**
 * @param {ActiveEffect} effect
 * @returns {number|null}
 */
function getCharges(effect) {
    const charges = Number(effect?.flags?.[NS]?.chargesRemaining);
    return Number.isFinite(charges) ? charges : null;
}

/**
 * @param {ActiveEffect} effect
 * @returns {string|null}
 */
function saveAbilityFromEffect(effect) {
    for (const change of effect?.changes ?? []) {
        const match = SAVE_BONUS_KEY_RE.exec(change.key ?? "");
        if (match) return match[1].toLowerCase();
    }
    return null;
}

/**
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function hasSaveSpecialDuration(effect) {
    const special = effect?.flags?.dae?.specialDuration;
    return Array.isArray(special)
        && special.some(entry => entry === "isSave" || entry.startsWith("isSave."));
}

/**
 * @param {object} options
 * @returns {boolean}
 */
function isSaveExpiryReason(options) {
    const reason = String(options?.["expiry-reason"] ?? "");
    return /isSave/i.test(reason);
}

/**
 * @param {ActiveEffect} effect
 * @param {number} next
 */
async function applyChargeDecrement(effect, next) {
    if (next <= 0) {
        await effect.delete();
        return;
    }
    await effect.update({ [`flags.${NS}.chargesRemaining`]: next });
}

export const CookingBuffCharges = {
    /**
     * Register charge-decrement hooks. Call once from initCooking().
     */
    init() {
        if (game.system?.id !== "dnd5e") return;

        Hooks.on("preDeleteActiveEffect", (effect, options) => {
            const charges = getCharges(effect);
            if (charges === null || charges <= 1) return;
            if (!hasSaveSpecialDuration(effect)) return;
            if (!isSaveExpiryReason(options)) return;

            applyChargeDecrement(effect, charges - 1);
            return false;
        });

        Hooks.on("dnd5e.rollSavingThrow", async (rolls, data) => {
            const actor = data?.subject;
            const ability = String(data?.ability ?? "").toLowerCase();
            if (!actor || !ability || !rolls?.length) return;

            for (const effect of cookingEffects(actor)) {
                const charges = getCharges(effect);
                if (charges === null || charges <= 0) continue;
                if (hasSaveSpecialDuration(effect)) continue;

                if (saveAbilityFromEffect(effect) !== ability) continue;

                await applyChargeDecrement(effect, charges - 1);
                break;
            }
        });
    },

    /** @private test helpers */
    _getCharges: getCharges,
    _saveAbilityFromEffect: saveAbilityFromEffect,
    _hasSaveSpecialDuration: hasSaveSpecialDuration,
    _isSaveExpiryReason: isSaveExpiryReason,
    _applyChargeDecrement: applyChargeDecrement
};
