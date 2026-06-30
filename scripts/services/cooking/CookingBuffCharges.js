/**
 * Charge tracking for limited-use cooking buffs (Amber save_bonus, check_advantage,
 * limited resistance).
 *
 * Multi-charge effects omit DAE isSave / isCheck special duration and decrement on
 * dnd5e.rollSavingThrow / dnd5e.rollAbilityCheck. Limited poison resistance
 * decrements when poison damage is applied. Single-charge effects keep the
 * matching isSave or isCheck hint so DAE removes them after one qualifying roll.
 * preDeleteActiveEffect catches multi-charge effects that still carry isSave/isCheck
 * from older serves.
 */

import {
    COOKING_BUFF_FLAG_NAMESPACE as NS,
    COOKING_BUFF_FLAG as FLAG
} from "./CookingBuffs.js";

const SAVE_BONUS_KEY_RE = /^system\.abilities\.(\w{3})\.bonuses\.save$/;
const CHECK_ADVANTAGE_KEY_RE = /^system\.abilities\.(\w{3})\.check\.roll\.mode$/;

/** @type {WeakMap<Actor, boolean>} */
const pendingPoisonHit = new WeakMap();

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
 * @returns {string|null}
 */
function checkAbilityFromEffect(effect) {
    for (const change of effect?.changes ?? []) {
        const match = CHECK_ADVANTAGE_KEY_RE.exec(change.key ?? "");
        if (match && change.value === "1") return match[1].toLowerCase();
    }
    return null;
}

/**
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function poisonResistanceFromEffect(effect) {
    return (effect?.changes ?? []).some(change =>
        change.key === "system.traits.dr.value"
        && String(change.value ?? "").toLowerCase() === "poison"
        && getCharges(effect) !== null
    );
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
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function hasCheckSpecialDuration(effect) {
    const special = effect?.flags?.dae?.specialDuration;
    return Array.isArray(special)
        && special.some(entry => entry === "isCheck" || entry.startsWith("isCheck."));
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
 * @param {object} options
 * @returns {boolean}
 */
function isCheckExpiryReason(options) {
    const reason = String(options?.["expiry-reason"] ?? "");
    return /isCheck/i.test(reason);
}

/**
 * @param {DamageDescription[]|object} damages
 * @returns {boolean}
 */
function hasIncomingPoisonDamage(damages) {
    if (!damages) return false;
    const entries = Array.isArray(damages) ? damages : Object.values(damages).filter(v => v && typeof v === "object");
    return entries.some(entry =>
        String(entry?.type ?? "").toLowerCase() === "poison"
        && Number(entry?.value) > 0
    );
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

            if (hasSaveSpecialDuration(effect) && isSaveExpiryReason(options)) {
                applyChargeDecrement(effect, charges - 1);
                return false;
            }
            if (hasCheckSpecialDuration(effect) && isCheckExpiryReason(options)) {
                applyChargeDecrement(effect, charges - 1);
                return false;
            }
        });

        Hooks.on("dnd5e.preCalculateDamage", (actor, damages) => {
            if (!actor || !hasIncomingPoisonDamage(damages)) return;
            const hasLimitedPoisonRes = cookingEffects(actor).some(effect =>
                poisonResistanceFromEffect(effect) && getCharges(effect) > 0
            );
            if (hasLimitedPoisonRes) pendingPoisonHit.set(actor, true);
        });

        Hooks.on("dnd5e.applyDamage", async (actor, amount) => {
            if (!pendingPoisonHit.get(actor)) return;
            pendingPoisonHit.delete(actor);
            if (Number(amount) <= 0) return;

            for (const effect of cookingEffects(actor)) {
                const charges = getCharges(effect);
                if (charges === null || charges <= 0) continue;
                if (!poisonResistanceFromEffect(effect)) continue;

                await applyChargeDecrement(effect, charges - 1);
                break;
            }
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

        Hooks.on("dnd5e.rollAbilityCheck", async (rolls, data) => {
            const actor = data?.subject;
            const ability = String(data?.ability ?? "").toLowerCase();
            if (!actor || !ability || !rolls?.length) return;

            for (const effect of cookingEffects(actor)) {
                const charges = getCharges(effect);
                if (charges === null || charges <= 0) continue;
                if (hasCheckSpecialDuration(effect)) continue;

                if (checkAbilityFromEffect(effect) !== ability) continue;

                await applyChargeDecrement(effect, charges - 1);
                break;
            }
        });
    },

    /** @private test helpers */
    _getCharges: getCharges,
    _saveAbilityFromEffect: saveAbilityFromEffect,
    _checkAbilityFromEffect: checkAbilityFromEffect,
    _poisonResistanceFromEffect: poisonResistanceFromEffect,
    _hasIncomingPoisonDamage: hasIncomingPoisonDamage,
    _hasSaveSpecialDuration: hasSaveSpecialDuration,
    _hasCheckSpecialDuration: hasCheckSpecialDuration,
    _isSaveExpiryReason: isSaveExpiryReason,
    _isCheckExpiryReason: isCheckExpiryReason,
    _applyChargeDecrement: applyChargeDecrement,
    _pendingPoisonHit: pendingPoisonHit
};
