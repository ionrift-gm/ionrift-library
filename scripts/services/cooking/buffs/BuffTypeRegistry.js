// AE modes resilient when global CONST is missing (tests).
export const AE_MODE_FALLBACK = { CUSTOM: 0, MULTIPLY: 1, ADD: 2, DOWNGRADE: 3, UPGRADE: 4, OVERRIDE: 5 };

export function aeMode(name) {
    return globalThis.CONST?.ACTIVE_EFFECT_MODES?.[name] ?? AE_MODE_FALLBACK[name];
}

/** @returns {string|null} */
export function activeSystemId() {
    return game?.ionrift?.library?.system?.current?.systemId
        ?? game?.system?.id
        ?? null;
}

export function isDnd5eSystem() {
    return activeSystemId() === "dnd5e";
}

/** @returns {object|null} */
export function activeAdapter() {
    return game?.ionrift?.library?.system?.current ?? null;
}

/** @type {Map<string, object>} */
export const TYPES = new Map();

export function defineType(type, meta) {
    const entry = { type, immediate: false, ...meta };
    if (entry.labelKey && !("label" in meta)) {
        // Resolve lazily so the label follows the active language.
        Object.defineProperty(entry, "label", {
            enumerable: true,
            configurable: true,
            get() { return game.i18n.localize(entry.labelKey); }
        });
    }
    TYPES.set(type, entry);
}

defineType("temp_hp", {
    labelKey: "ionrift-library.cookingBuffTypes.tempHp",
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [{
                key: "system.attributes.hp.temp",
                mode: aeMode("OVERRIDE"),
                value: String(formula),
                priority: 20
            }],
            description: game.i18n.format("ionrift-library.cookingBuffText.tempHpDescription", { formula }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.tempHpSummary", { formula }),
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("heal", {
    labelKey: "ionrift-library.cookingBuffTypes.heal",
    immediate: true,
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [],
            description: game.i18n.format("ionrift-library.cookingBuffText.healDescription", { formula }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.healSummary", { formula }),
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("exhaustion_save", {
    labelKey: "ionrift-library.cookingBuffTypes.exhaustionSave",
    immediate: true,
    render(actor, buff) {
        const dc = buff.formula ?? "?";
        return {
            changes: [],
            description: game.i18n.format("ionrift-library.cookingBuffText.exhaustionSaveDescription", { dc }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.exhaustionSaveSummary", { dc }),
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("hit_die", {
    labelKey: "ionrift-library.cookingBuffTypes.hitDie",
    immediate: true,
    render(actor, buff) {
        const amount = buff.formula ?? "1";
        return {
            changes: [],
            description: game.i18n.format("ionrift-library.cookingBuffText.hitDieDescription", { amount }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.hitDieSummary", { amount }),
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("advantage", {
    labelKey: "ionrift-library.cookingBuffTypes.advantage",
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
            description: game.i18n.format("ionrift-library.cookingBuffText.saveAdvantageDescription", { ability: ability.toUpperCase(), duration }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.saveAdvantageSummary", { ability: ability.toUpperCase() }),
            daeSpecialDuration
        };
    }
});

defineType("resistance", {
    labelKey: "ionrift-library.cookingBuffTypes.resistance",
    render(actor, buff) {
        const damageType = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
        const uses = buff.uses ?? buff.charges;
        const shortWindow = buff.duration === "untilShortRest";
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const hasCharges = Number.isFinite(charges) && charges > 0;
            const descriptionKey = hasCharges
                ? (shortWindow ? "ionrift-library.cookingBuffText.resistanceRemainingShortDescription" : "ionrift-library.cookingBuffText.resistanceRemainingLongDescription")
                : (shortWindow ? "ionrift-library.cookingBuffText.resistanceNextShortDescription" : "ionrift-library.cookingBuffText.resistanceNextLongDescription");
            return {
                changes: [{
                    key: "system.traits.dr.value",
                    mode: aeMode("ADD"),
                    value: damageType,
                    priority: 20
                }],
                description: game.i18n.format(descriptionKey, { damageType, charges, uses: usesLabel }),
                summaryLine: game.i18n.format("ionrift-library.cookingBuffText.resistanceChargesSummary", { damageType, uses: usesLabel }),
                daeSpecialDuration: [],
                chargesRemaining: Number.isFinite(charges) ? charges : null,
                chargesMax: Number(buff.chargesMax ?? charges) || null
            };
        }
        return {
            changes: [{
                key: "system.traits.dr.value",
                mode: aeMode("ADD"),
                value: damageType,
                priority: 20
            }],
            description: game.i18n.format("ionrift-library.cookingBuffText.resistanceDescription", { damageType }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.resistanceSummary", { damageType }),
            daeSpecialDuration: []
        };
    }
});

defineType("sense_darkvision", {
    labelKey: "ionrift-library.cookingBuffTypes.senseDarkvision",
    render(actor, buff) {
        const feet = Number(buff.feet ?? buff.formula ?? 60);
        return {
            changes: [{
                key: "system.attributes.senses.darkvision",
                mode: aeMode("UPGRADE"),
                value: String(feet),
                priority: 20
            }],
            description: game.i18n.format("ionrift-library.cookingBuffText.darkvisionDescription", { feet }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.darkvisionSummary", { feet }),
            daeSpecialDuration: []
        };
    }
});

defineType("check_advantage", {
    labelKey: "ionrift-library.cookingBuffTypes.checkAdvantage",
    render(actor, buff) {
        const ability = String(buff.ability ?? buff.save?.ability ?? buff.formula ?? "str").toLowerCase();
        const uses = buff.uses ?? buff.charges;
        const shortCheckWindow = buff.duration === "untilShortRest";
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const hasCharges = Number.isFinite(charges) && charges > 0;
            const descriptionKey = hasCharges
                ? (shortCheckWindow ? "ionrift-library.cookingBuffText.checkAdvantageRemainingShortDescription" : "ionrift-library.cookingBuffText.checkAdvantageRemainingLongDescription")
                : (shortCheckWindow ? "ionrift-library.cookingBuffText.checkAdvantageNextShortDescription" : "ionrift-library.cookingBuffText.checkAdvantageNextLongDescription");
            return {
                changes: [{
                    key: `system.abilities.${ability}.check.roll.mode`,
                    mode: aeMode("ADD"),
                    value: "1",
                    priority: 20
                }],
                description: game.i18n.format(descriptionKey, { ability: ability.toUpperCase(), charges, uses: usesLabel }),
                summaryLine: game.i18n.format("ionrift-library.cookingBuffText.checkAdvantageChargesSummary", { ability: ability.toUpperCase(), uses: usesLabel }),
                daeSpecialDuration: [`isCheck.${ability}`],
                chargesRemaining: Number.isFinite(charges) ? charges : null,
                chargesMax: Number(buff.chargesMax ?? charges) || null
            };
        }
        return {
            changes: [{
                key: `system.abilities.${ability}.check.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: game.i18n.format("ionrift-library.cookingBuffText.checkAdvantageDescription", { ability: ability.toUpperCase() }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.checkAdvantageSummary", { ability: ability.toUpperCase() }),
            daeSpecialDuration: []
        };
    }
});

defineType("skill_advantage", {
    labelKey: "ionrift-library.cookingBuffTypes.skillAdvantage",
    render(actor, buff) {
        const skill = String(buff.skill ?? buff.formula ?? "prc").toLowerCase();
        const dim = buff.conditions?.dimLight === true;
        return {
            changes: [{
                key: `system.skills.${skill}.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: game.i18n.format(dim ? "ionrift-library.cookingBuffText.skillAdvantageDimDescription" : "ionrift-library.cookingBuffText.skillAdvantageDescription", { skill: skill.toUpperCase() }),
            summaryLine: game.i18n.format(dim ? "ionrift-library.cookingBuffText.skillAdvantageDimSummary" : "ionrift-library.cookingBuffText.skillAdvantageSummary", { skill: skill.toUpperCase() }),
            daeSpecialDuration: []
        };
    }
});

defineType("passive_perception", {
    labelKey: "ionrift-library.cookingBuffTypes.passivePerception",
    render(actor, buff) {
        const bonus = Number(buff.bonus ?? buff.formula ?? 2);
        return {
            changes: [{
                key: "system.skills.prc.passive",
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: game.i18n.format("ionrift-library.cookingBuffText.passivePerceptionDescription", { bonus }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.passivePerceptionSummary", { bonus }),
            daeSpecialDuration: []
        };
    }
});

defineType("ability_bonus", {
    labelKey: "ionrift-library.cookingBuffTypes.abilityBonus",
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
            description: game.i18n.format("ionrift-library.cookingBuffText.abilityBonusDescription", { bonus, ability: ability.toUpperCase() }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.abilityBonusSummary", { bonus, ability: ability.toUpperCase() }),
            daeSpecialDuration: []
        };
    }
});

defineType("save_bonus", {
    labelKey: "ionrift-library.cookingBuffTypes.saveBonus",
    render(actor, buff) {
        const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
        const bonus = Number(buff.bonus ?? 1);
        const uses = buff.uses ?? buff.charges ?? 1;
        const usesLabel = typeof uses === "string" ? uses : String(uses);
        const charges = Number(buff.chargesRemaining ?? uses);
        const longSaveWindow = buff.duration === "untilLongRest";
        const hasCharges = Number.isFinite(charges) && charges > 0;
        const descriptionKey = hasCharges
            ? (longSaveWindow ? "ionrift-library.cookingBuffText.saveBonusRemainingLongDescription" : "ionrift-library.cookingBuffText.saveBonusRemainingShortDescription")
            : (longSaveWindow ? "ionrift-library.cookingBuffText.saveBonusNextLongDescription" : "ionrift-library.cookingBuffText.saveBonusNextShortDescription");
        return {
            changes: [{
                key: `system.abilities.${ability}.bonuses.save`,
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: game.i18n.format(descriptionKey, { bonus, ability: ability.toUpperCase(), charges, uses: usesLabel }),
            summaryLine: game.i18n.format("ionrift-library.cookingBuffText.saveBonusSummary", { bonus, ability: ability.toUpperCase(), uses: usesLabel }),
            daeSpecialDuration: [`isSave.${ability}`],
            chargesRemaining: Number.isFinite(charges) ? charges : null,
            chargesMax: Number(buff.chargesMax ?? charges) || null
        };
    }
});

export function registerBuffType(type, meta) {
    if (!type || typeof type !== "string") {
        throw new Error("registerBuffType: type must be a non-empty string.");
    }
    if (typeof meta?.render !== "function") {
        throw new Error(`registerBuffType: type "${type}" requires a render function.`);
    }
    TYPES.set(type, { type, immediate: false, ...meta });
}
