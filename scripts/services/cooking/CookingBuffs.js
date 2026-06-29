/**
 * Canonical cooking/feeding buff model for the Ionrift kernel.
 *
 * Adopts Respite's buff-descriptor shape as the canonical schema and folds in
 * the three Monstrous Feast buff types (darkvision, ability-check advantage,
 * skill advantage). Consumer modules (Respite, Monstrous Feast, overlays)
 * describe a meal's effect with an {@link IonriftBuff} and let the kernel
 * produce the active-system Active Effect changes.
 *
 * The kernel ships a dnd5e mapping. On any other system the changes degrade to
 * an empty list and {@link CookingBuffs.degradeNote} supplies a "track manually"
 * line the consumer can surface.
 */

/**
 * @typedef {Object} IonriftBuff
 * @property {string} type One of {@link CookingBuffs.TYPES}.
 * @property {string} [formula] Dice or numeric formula (consumers pre-resolve dice).
 * @property {"immediate"|"untilLongRest"|"untilShortRest"|"nextSave"|"nextCheck"} [duration]
 * @property {"self"|"party"} [target]
 * @property {{ ability?: string }} [save] Saving-throw ability (advantage type).
 * @property {string} [damageType] Resistance damage type.
 * @property {number} [feet] Sense range in feet (darkvision).
 * @property {string} [ability] Ability key (check advantage).
 * @property {string} [skill] Skill key (skill advantage).
 * @property {number} [bonus] Flat bonus (passive perception, save bonus).
 * @property {number|string} [uses] Rolled charge count for Amber save_bonus (e.g. "1d4").
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

/** Active Effect change modes, resilient to a missing global CONST (tests). */
const AE_MODE_FALLBACK = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

function aeMode(name) {
    return globalThis.CONST?.ACTIVE_EFFECT_MODES?.[name] ?? AE_MODE_FALLBACK[name];
}

/** @returns {string|null} The active system id (adapter-aware, test-safe). */
function activeSystemId() {
    return game?.ionrift?.library?.system?.current?.systemId
        ?? game?.system?.id
        ?? null;
}

function isDnd5eSystem() {
    return activeSystemId() === "dnd5e";
}

/** @returns {object} The active system adapter, or null. */
function activeAdapter() {
    return game?.ionrift?.library?.system?.current ?? null;
}

/**
 * Built-in type registry. Each entry maps a buff descriptor to dnd5e Active
 * Effect changes plus human-readable summary text. `immediate` marks buffs that
 * resolve at serve time (healing, a save, a restored hit die) rather than living
 * on as an Active Effect; the kernel produces no changes for those and leaves
 * the resolution to the consumer.
 * @type {Map<string, object>}
 */
const TYPES = new Map();

function defineType(type, meta) {
    TYPES.set(type, { type, immediate: false, ...meta });
}

defineType("temp_hp", {
    label: "Temporary HP",
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [{
                key: "system.attributes.hp.temp",
                mode: aeMode("OVERRIDE"),
                value: String(formula),
                priority: 20
            }],
            description: `Temporary hit points (${formula}).`,
            summaryLine: `temp HP (${formula})`,
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("heal", {
    label: "Healing",
    immediate: true,
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [],
            description: `Healing (${formula}).`,
            summaryLine: `healing (${formula})`,
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("exhaustion_save", {
    label: "Exhaustion save",
    immediate: true,
    render(actor, buff) {
        const dc = buff.formula ?? "?";
        return {
            changes: [],
            description: `Constitution save (DC ${dc}) to remove one exhaustion level.`,
            summaryLine: `exhaustion save (DC ${dc})`,
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("hit_die", {
    label: "Hit die",
    immediate: true,
    render(actor, buff) {
        const amount = buff.formula ?? "1";
        return {
            changes: [],
            description: `Restores ${amount} spent hit die.`,
            summaryLine: `restore ${amount} hit die`,
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("advantage", {
    label: "Advantage on saves",
    render(actor, buff) {
        const ability = String(buff.save?.ability ?? buff.ability ?? buff.formula ?? "con").toLowerCase();
        const duration = buff.duration ?? "nextSave";
        const daeSpecialDuration = duration === "nextSave" ? [`isSave.${ability}`] : [];
        return {
            changes: [{
                key: `system.abilities.${ability}.save.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: `Advantage on ${ability.toUpperCase()} saving throws (${duration}).`,
            summaryLine: `advantage on ${ability.toUpperCase()} saves`,
            daeSpecialDuration
        };
    }
});

defineType("resistance", {
    label: "Damage resistance",
    render(actor, buff) {
        const damageType = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
        return {
            changes: [{
                key: "system.traits.dr.value",
                mode: aeMode("ADD"),
                value: damageType,
                priority: 20
            }],
            description: `Damage resistance (${damageType}).`,
            summaryLine: `resistance (${damageType})`,
            daeSpecialDuration: []
        };
    }
});

defineType("sense_darkvision", {
    label: "Darkvision",
    render(actor, buff) {
        const feet = Number(buff.feet ?? buff.formula ?? 60);
        return {
            changes: [{
                key: "system.attributes.senses.darkvision",
                mode: aeMode("UPGRADE"),
                value: String(feet),
                priority: 20
            }],
            description: `Darkvision ${feet}ft.`,
            summaryLine: `${feet}ft darkvision`,
            daeSpecialDuration: []
        };
    }
});

defineType("check_advantage", {
    label: "Advantage on ability checks",
    render(actor, buff) {
        const ability = String(buff.ability ?? buff.save?.ability ?? buff.formula ?? "str").toLowerCase();
        return {
            changes: [{
                key: `system.abilities.${ability}.check.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: `Advantage on ${ability.toUpperCase()} ability checks.`,
            summaryLine: `advantage on ${ability.toUpperCase()} checks`,
            daeSpecialDuration: []
        };
    }
});

defineType("skill_advantage", {
    label: "Advantage on skill checks",
    render(actor, buff) {
        const skill = String(buff.skill ?? buff.formula ?? "prc").toLowerCase();
        const dim = buff.conditions?.dimLight === true;
        const dimNote = dim ? " in dim light or darkness" : "";
        return {
            changes: [{
                key: `system.skills.${skill}.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: `Advantage on ${skill.toUpperCase()} checks${dimNote}.`,
            summaryLine: `advantage on ${skill.toUpperCase()} checks${dim ? " (dim light)" : ""}`,
            daeSpecialDuration: []
        };
    }
});

defineType("passive_perception", {
    label: "Passive Perception bonus",
    render(actor, buff) {
        const bonus = Number(buff.bonus ?? buff.formula ?? 2);
        return {
            changes: [{
                key: "system.skills.prc.passive",
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: `+${bonus} passive Perception.`,
            summaryLine: `+${bonus} passive Perception`,
            daeSpecialDuration: []
        };
    }
});

defineType("ability_bonus", {
    label: "Ability check bonus",
    render(actor, buff) {
        const ability = String(buff.ability ?? buff.formula ?? "wis").toLowerCase();
        const bonus = Number(buff.bonus ?? 1);
        return {
            changes: [{
                key: `system.abilities.${ability}.bonuses.check`,
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: `+${bonus} to ${ability.toUpperCase()} ability checks.`,
            summaryLine: `+${bonus} ${ability.toUpperCase()} checks`,
            daeSpecialDuration: []
        };
    }
});

defineType("save_bonus", {
    label: "Saving throw bonus (limited uses)",
    render(actor, buff) {
        const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
        const bonus = Number(buff.bonus ?? 1);
        const uses = buff.uses ?? buff.charges ?? 1;
        const usesLabel = typeof uses === "string" ? uses : String(uses);
        const charges = Number(buff.chargesRemaining ?? uses);
        const chargeNote = Number.isFinite(charges) && charges > 0
            ? ` (${charges} remaining, until long rest)`
            : ` (next ${usesLabel} saves, until long rest)`;
        return {
            changes: [{
                key: `system.abilities.${ability}.bonuses.save`,
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: `+${bonus} to ${ability.toUpperCase()} saves${chargeNote}.`,
            summaryLine: `+${bonus} ${ability.toUpperCase()} saves (${usesLabel} uses)`,
            daeSpecialDuration: [`isSave.${ability}`],
            chargesRemaining: Number.isFinite(charges) ? charges : null,
            chargesMax: Number(buff.chargesMax ?? charges) || null
        };
    }
});

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
     * Register a new buff type (overlay or premium extension). Replaces any
     * existing entry for the same type.
     * @param {string} type
     * @param {{ label: string, render: Function, immediate?: boolean }} meta
     */
    registerType(type, meta) {
        if (!type || typeof type !== "string") {
            throw new Error("CookingBuffs.registerType: type must be a non-empty string.");
        }
        if (typeof meta?.render !== "function") {
            throw new Error(`CookingBuffs.registerType: type "${type}" requires a render function.`);
        }
        TYPES.set(type, { type, immediate: false, ...meta });
    },

    /**
     * Whether a type is registered.
     * @param {string} type
     * @returns {boolean}
     */
    hasType(type) {
        return TYPES.has(type);
    },

    /**
     * Build the full descriptor for a buff on the active system. Returns the
     * type's render output with `changes` gated to `[]` off dnd5e.
     * @param {Actor|null} actor
     * @param {IonriftBuff} buff
     * @returns {{ changes: object[], description: string, summaryLine: string, daeSpecialDuration: string[], roll?: string|null, immediate: boolean }|null}
     */
    build(actor, buff) {
        if (!buff?.type) return null;
        const meta = TYPES.get(buff.type);
        if (!meta) return null;
        const built = meta.render(actor, buff, activeAdapter()) ?? {};
        const changes = isDnd5eSystem() && Array.isArray(built.changes) ? built.changes : [];
        return {
            changes,
            description: built.description ?? "",
            summaryLine: built.summaryLine ?? "",
            daeSpecialDuration: built.daeSpecialDuration ?? [],
            roll: built.roll ?? null,
            immediate: Boolean(meta.immediate)
        };
    },

    /**
     * Active Effect changes for a buff on the active system. `[]` off dnd5e or
     * for immediate (non-persistent) buffs such as healing.
     * @param {Actor|null} actor
     * @param {IonriftBuff} buff
     * @returns {object[]}
     */
    toActiveEffectChanges(actor, buff) {
        if (!buff?.type) return [];
        if (!isDnd5eSystem()) return [];
        const meta = TYPES.get(buff.type);
        if (!meta) return [];
        const built = meta.render(actor, buff, activeAdapter());
        return Array.isArray(built?.changes) ? built.changes : [];
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
        const meta = TYPES.get(buff.type);
        if (!meta) return buff.type;
        try {
            const built = meta.render(null, buff, activeAdapter());
            if (built?.summaryLine) return built.summaryLine;
        } catch {
            /* fall through */
        }
        return buff.type;
    },

    /**
     * The "track this manually" advisory used when the active system has no
     * Active Effect mapping for a buff (anything other than dnd5e).
     * @param {IonriftBuff} buff
     * @returns {string}
     */
    degradeNote(buff) {
        const summary = this.describe(buff);
        const duration = buff?.duration === "untilShortRest"
            ? "until the next short rest"
            : "until the next long rest";
        return summary
            ? `Gains ${summary} ${duration} (track manually).`
            : "Gains a meal buff (track manually).";
    },

    /**
     * Whether an actor already carries the anti-overeating marker: a cooking-slot
     * effect. This marker is the "well fed" gate. It is deliberately separate
     * from the stat changes it rides on; the changes give the mechanical benefit,
     * the marker is the signal that the recipient has eaten and should not take
     * another buffing meal until it clears.
     * @param {Actor|null} actor
     * @param {{ slot?: string }} [opts] When `slot` is given, only that slot counts.
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
        return false;
    }
};
