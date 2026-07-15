import {
    TYPES,
    registerBuffType,
    isDnd5eSystem
} from "./BuffTypeRegistry.js";
import { buffAdapterRegistry } from "../adapters/BuffAdapterRegistry.js";

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

/** Flag namespace. `flags["ionrift-library"]`. */
export const COOKING_BUFF_FLAG_NAMESPACE = "ionrift-library";

/** Boolean flag key. `flags["ionrift-library"].cookingBuff === true`. */
export const COOKING_BUFF_FLAG = "cookingBuff";

/** Slot discriminator key. `flags["ionrift-library"].slot`. */
export const COOKING_SLOT_FLAG = "slot";

/** Default slot. `flags["ionrift-library"].slot` when unnamed. */
export const DEFAULT_COOKING_SLOT = "cooking";

/** AE fallback seconds when no long-rest hook clears the buff (8 hours). */
export const LONG_REST_FALLBACK_SECONDS = 28800;

/** AE fallback seconds for untilShortRest if no short rest occurs first (4 hours). */
export const SHORT_REST_FALLBACK_SECONDS = 4 * 3600;

export const CookingBuffs = {
    /** @type {Map<string, object>} */
    TYPES,

    COOKING_BUFF_FLAG_NAMESPACE,
    COOKING_BUFF_FLAG,
    COOKING_SLOT_FLAG,
    DEFAULT_COOKING_SLOT,

    registerType(type, meta) {
        registerBuffType(type, meta);
    },

    hasType(type) {
        return TYPES.has(type);
    },

    resolve(actor, buff, ctx = {}) {
        if (!buff?.type) return null;
        if (!TYPES.has(buff.type)) return null;
        return buffAdapterRegistry.resolve(actor, buff, ctx);
    },

    fidelity(buff) {
        if (!buff?.type || !TYPES.has(buff.type)) return "manual";
        return buffAdapterRegistry.fidelity(buff);
    },

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

    toActiveEffectChanges(actor, buff) {
        const resolved = this.resolve(actor, buff);
        if (!resolved || resolved.immediateFlag) return [];
        if (!isDnd5eSystem()) return [];
        return Array.isArray(resolved.changes) ? resolved.changes : [];
    },

    // Serve-time vs persist.
    isImmediate(buff) {
        return Boolean(TYPES.get(buff?.type)?.immediate);
    },

    describe(buff) {
        if (!buff?.type) return "";
        const resolved = this.resolve(null, buff);
        if (resolved?.summaryLine) return resolved.summaryLine;
        return TYPES.get(buff.type)?.label ?? buff.type;
    },

    degradeNote(buff) {
        const fidelity = this.fidelity(buff);
        if (fidelity === "native") return "";
        const resolved = this.resolve(null, buff);
        if (resolved?.manualNote) return resolved.manualNote;
        const adapter = buffAdapterRegistry.current;
        return adapter.degradeNote(buff);
    },

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
