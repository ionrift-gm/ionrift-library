/**
 * Canonical cooking/feeding buff model for the Ionrift kernel.
 *
 * Consumer modules describe a meal's effect with an {@link IonriftBuff} and let
 * the kernel resolve it through the per-system buff adapter registry.
 */

import {
    TYPES,
    registerBuffType,
    isDnd5eSystem
} from "./BuffTypeRegistry.js";
import { buffAdapterRegistry } from "./BuffAdapterRegistry.js";

/**
 * @typedef {Object} IonriftBuff
 * @property {string} type One of the registered buff types.
 * @property {string} [formula] Dice or numeric formula (consumers pre-resolve dice).
 * @property {"immediate"|"untilLongRest"|"untilShortRest"|"nextSave"|"nextCheck"} [duration]
 * @property {"self"|"party"} [target]
 * @property {"buff"|"debuff"} [polarity] Default "buff". Marks penalties and conditions.
 * @property {string} [condition] System-neutral condition key (e.g. "frightened", "poisoned").
 * @property {{ ability?: string }} [save] Saving-throw ability (advantage type).
 * @property {string} [damageType] Resistance damage type.
 * @property {number} [feet] Sense range in feet (darkvision).
 * @property {string} [ability] Ability key (check advantage).
 * @property {string} [skill] Skill key (skill advantage).
 * @property {number} [bonus] Flat bonus (passive perception, save bonus).
 * @property {number|string} [uses] Rolled charge count (e.g. "1d4").
 * @property {{ dimLight?: boolean }} [conditions] Situational gates (flavor only).
 */

/** Flag namespace that marks the single shared cooking buff slot. */
export const COOKING_BUFF_FLAG_NAMESPACE = "ionrift-library";

/** Boolean flag key. `flags["ionrift-library"].cookingBuff === true`. */
export const COOKING_BUFF_FLAG = "cookingBuff";

/** Slot discriminator key. `flags["ionrift-library"].slot`. */
export const COOKING_SLOT_FLAG = "slot";

/** Default slot discriminator when a consumer does not name one. */
export const DEFAULT_COOKING_SLOT = "cooking";

/** Active Effect fallback when no long-rest hook clears the buff (8 hours). */
export const LONG_REST_FALLBACK_SECONDS = 28800;

/** Active Effect fallback for `untilShortRest` buffs if no short rest occurs first (4 hours). */
export const SHORT_REST_FALLBACK_SECONDS = 4 * 3600;

/**
 * Canonical buff model. Consumers describe a meal effect with an
 * {@link IonriftBuff}; the kernel maps it to the active system.
 */
export const CookingBuffs = {
    /** @type {Map<string, object>} Frozen-by-convention type registry. */
    TYPES,

    COOKING_BUFF_FLAG_NAMESPACE,
    COOKING_BUFF_FLAG,
    COOKING_SLOT_FLAG,
    DEFAULT_COOKING_SLOT,

    /**
     * Register a new buff type (overlay or premium extension).
     * @param {string} type
     * @param {{ label: string, render: Function, immediate?: boolean }} meta
     */
    registerType(type, meta) {
        registerBuffType(type, meta);
    },

    /**
     * @param {string} type
     * @returns {boolean}
     */
    hasType(type) {
        return TYPES.has(type);
    },

    /**
     * Full resolution for a buff on the active system.
     * @param {Actor|null} actor
     * @param {IonriftBuff} buff
     * @param {object} [ctx]
     * @returns {import("./ResolvedEffect.js").ResolvedEffect|null}
     */
    resolve(actor, buff, ctx = {}) {
        if (!buff?.type) return null;
        if (!TYPES.has(buff.type)) return null;
        return buffAdapterRegistry.resolve(actor, buff, ctx);
    },

    /**
     * Declared fidelity for a buff on the active system.
     * @param {IonriftBuff} buff
     * @returns {"native"|"approximate"|"manual"}
     */
    fidelity(buff) {
        if (!buff?.type || !TYPES.has(buff.type)) return "manual";
        return buffAdapterRegistry.fidelity(buff);
    },

    /**
     * Build the legacy descriptor shape for a buff on the active system.
     * @param {Actor|null} actor
     * @param {IonriftBuff} buff
     * @returns {{ changes: object[], description: string, summaryLine: string, daeSpecialDuration: string[], roll?: string|null, immediate: boolean, fidelity: string, effectItems: object[], manualNote: string|null }|null}
     */
    build(actor, buff) {
        const resolved = this.resolve(actor, buff);
        if (!resolved) return null;
        return {
            changes: isDnd5eSystem() ? resolved.changes : [],
            description: resolved.description,
            summaryLine: resolved.summaryLine,
            daeSpecialDuration: resolved.daeSpecial,
            roll: resolved.roll ?? null,
            immediate: Boolean(resolved.immediateFlag),
            fidelity: resolved.fidelity,
            effectItems: resolved.effectItems ?? [],
            manualNote: resolved.manualNote
        };
    },

    /**
     * Active Effect changes for a buff on the active system. Empty off dnd5e
     * or for immediate buffs such as healing.
     * @param {Actor|null} actor
     * @param {IonriftBuff} buff
     * @returns {object[]}
     */
    toActiveEffectChanges(actor, buff) {
        const resolved = this.resolve(actor, buff);
        if (!resolved || resolved.immediateFlag) return [];
        if (!isDnd5eSystem()) return [];
        return Array.isArray(resolved.changes) ? resolved.changes : [];
    },

    /**
     * Whether a buff resolves at serve time rather than persisting as an effect.
     * @param {IonriftBuff} buff
     * @returns {boolean}
     */
    isImmediate(buff) {
        return Boolean(TYPES.get(buff?.type)?.immediate);
    },

    /**
     * Human-readable, system-agnostic summary of a buff.
     * @param {IonriftBuff} buff
     * @returns {string}
     */
    describe(buff) {
        if (!buff?.type) return "";
        const resolved = this.resolve(null, buff);
        if (resolved?.summaryLine) return resolved.summaryLine;
        return TYPES.get(buff.type)?.label ?? buff.type;
    },

    /**
     * Advisory used when the active system cannot automate a buff.
     * @param {IonriftBuff} buff
     * @returns {string}
     */
    degradeNote(buff) {
        const fidelity = this.fidelity(buff);
        if (fidelity === "native") return "";
        const resolved = this.resolve(null, buff);
        if (resolved?.manualNote) return resolved.manualNote;
        const adapter = buffAdapterRegistry.current;
        return adapter.degradeNote(buff);
    },

    /**
     * Whether an actor already carries the anti-overeating marker.
     * @param {Actor|null} actor
     * @param {{ slot?: string }} [opts]
     * @returns {boolean}
     */
    isWellFed(actor, { slot } = {}) {
        const effects = actor?.effects ?? [];
        for (const effect of effects) {
            const f = effect?.flags?.[COOKING_BUFF_FLAG_NAMESPACE];
            if (f?.[COOKING_BUFF_FLAG] !== true) continue;
            if (slot && f?.[COOKING_SLOT_FLAG] && f[COOKING_SLOT_FLAG] !== slot) continue;
            return true;
        }
        for (const item of actor?.items ?? []) {
            const f = item?.flags?.[COOKING_BUFF_FLAG_NAMESPACE];
            if (f?.[COOKING_BUFF_FLAG] !== true) continue;
            if (slot && f?.[COOKING_SLOT_FLAG] && f[COOKING_SLOT_FLAG] !== slot) continue;
            return true;
        }
        return false;
    }
};
