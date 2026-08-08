import { localize, format } from "../../../utils/I18n.js";

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

/** @param {string} type @param {object} meta */
function resolveBuffMeta(type, meta) {
    const { labelKey, label: rawLabel, ...rest } = meta;
    return {
        type,
        immediate: false,
        ...rest,
        labelKey: labelKey ?? null,
        label: labelKey ? localize(labelKey) : rawLabel
    };
}

export function defineType(type, meta) {
    TYPES.set(type, resolveBuffMeta(type, meta));
}

defineType("temp_hp", {
    labelKey: "IONRIFT.LIBRARY.BUFF.TempHP",
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [{
                key: "system.attributes.hp.temp",
                mode: aeMode("OVERRIDE"),
                value: String(formula),
                priority: 20
            }],
            description: format("IONRIFT.LIBRARY.BUFF.TempHPDesc", { formula }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.TempHPSummary", { formula }),
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("heal", {
    labelKey: "IONRIFT.LIBRARY.BUFF.Healing",
    immediate: true,
    render(actor, buff) {
        const formula = buff.formula ?? "0";
        return {
            changes: [],
            description: format("IONRIFT.LIBRARY.BUFF.HealingDesc", { formula }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.HealingSummary", { formula }),
            daeSpecialDuration: [],
            roll: String(formula)
        };
    }
});

defineType("exhaustion_save", {
    labelKey: "IONRIFT.LIBRARY.BUFF.ExhaustionSave",
    immediate: true,
    render(actor, buff) {
        const dc = buff.formula ?? "?";
        return {
            changes: [],
            description: format("IONRIFT.LIBRARY.BUFF.ExhaustionSaveDesc", { dc }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.ExhaustionSaveSummary", { dc }),
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("hit_die", {
    labelKey: "IONRIFT.LIBRARY.BUFF.HitDie",
    immediate: true,
    render(actor, buff) {
        const amount = buff.formula ?? "1";
        return {
            changes: [],
            description: format("IONRIFT.LIBRARY.BUFF.HitDieDesc", { amount }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.HitDieSummary", { amount }),
            daeSpecialDuration: [],
            roll: null
        };
    }
});

defineType("advantage", {
    labelKey: "IONRIFT.LIBRARY.BUFF.AdvantageOnSaves",
    render(actor, buff) {
        const ability = String(buff.save?.ability ?? buff.ability ?? buff.formula ?? "con").toLowerCase();
        const durationRaw = buff.duration ?? "nextSave";
        const duration = durationRaw === "nextSave" ? localize("IONRIFT.LIBRARY.BUFF.DurationNextSave") : durationRaw;
        const daeSpecialDuration = durationRaw === "nextSave" ? [`isSave.${ability}`] : [];
        return {
            changes: [{
                key: `system.abilities.${ability}.save.roll.mode`,
                mode: aeMode("ADD"),
                value: "1",
                priority: 20
            }],
            description: format("IONRIFT.LIBRARY.BUFF.AdvantageOnSavesDesc", { ability: ability.toUpperCase(), duration }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.AdvantageOnSavesSummary", { ability: ability.toUpperCase() }),
            daeSpecialDuration
        };
    }
});

defineType("resistance", {
    labelKey: "IONRIFT.LIBRARY.BUFF.DamageResistance",
    render(actor, buff) {
        const damageType = String(buff.damageType ?? buff.formula ?? "poison").toLowerCase();
        const uses = buff.uses ?? buff.charges;
        const window = buff.duration === "untilShortRest"
            ? localize("IONRIFT.LIBRARY.BUFF.WindowUntilShortRestOr4Hours")
            : localize("IONRIFT.LIBRARY.BUFF.WindowUntilLongRest");
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const isRemaining = Number.isFinite(charges) && charges > 0;
            const description = isRemaining
                ? format("IONRIFT.LIBRARY.BUFF.DamageResistanceDescHitsRemaining", { damageType, charges, window })
                : format("IONRIFT.LIBRARY.BUFF.DamageResistanceDescHitsNext", { damageType, usesLabel, window });
            
            return {
                changes: [{
                    key: "system.traits.dr.value",
                    mode: aeMode("ADD"),
                    value: damageType,
                    priority: 20
                }],
                description,
                summaryLine: format("IONRIFT.LIBRARY.BUFF.DamageResistanceSummaryHits", { damageType, usesLabel }),
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
            description: format("IONRIFT.LIBRARY.BUFF.DamageResistanceDesc", { damageType }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.DamageResistanceSummary", { damageType }),
            daeSpecialDuration: []
        };
    }
});

defineType("sense_darkvision", {
    labelKey: "IONRIFT.LIBRARY.BUFF.Darkvision",
    render(actor, buff) {
        const feet = Number(buff.feet ?? buff.formula ?? 60);
        return {
            changes: [{
                key: "system.attributes.senses.darkvision",
                mode: aeMode("UPGRADE"),
                value: String(feet),
                priority: 20
            }],
            description: format("IONRIFT.LIBRARY.BUFF.DarkvisionDesc", { feet }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.DarkvisionSummary", { feet }),
            daeSpecialDuration: []
        };
    }
});

defineType("check_advantage", {
    labelKey: "IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecks",
    render(actor, buff) {
        const ability = String(buff.ability ?? buff.save?.ability ?? buff.formula ?? "str").toLowerCase();
        const uses = buff.uses ?? buff.charges;
        const checkWindow = buff.duration === "untilShortRest" 
            ? localize("IONRIFT.LIBRARY.BUFF.WindowUntilShortRest") 
            : localize("IONRIFT.LIBRARY.BUFF.WindowUntilLongRest");
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const isRemaining = Number.isFinite(charges) && charges > 0;
            const description = isRemaining
                ? format("IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecksDescRemaining", { ability: ability.toUpperCase(), charges, checkWindow })
                : format("IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecksDescNext", { ability: ability.toUpperCase(), usesLabel, checkWindow });
            
            return {
                changes: [{
                    key: `system.abilities.${ability}.check.roll.mode`,
                    mode: aeMode("ADD"),
                    value: "1",
                    priority: 20
                }],
                description,
                summaryLine: format("IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecksSummaryUses", { ability: ability.toUpperCase(), usesLabel }),
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
            description: format("IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecksDesc", { ability: ability.toUpperCase() }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecksSummary", { ability: ability.toUpperCase() }),
            daeSpecialDuration: []
        };
    }
});

defineType("skill_advantage", {
    labelKey: "IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecks",
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
            description: dim 
                ? format("IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecksDescDim", { skill: skill.toUpperCase() })
                : format("IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecksDesc", { skill: skill.toUpperCase() }),
            summaryLine: dim
                ? format("IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecksSummaryDim", { skill: skill.toUpperCase() })
                : format("IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecksSummary", { skill: skill.toUpperCase() }),
            daeSpecialDuration: []
        };
    }
});

defineType("passive_perception", {
    labelKey: "IONRIFT.LIBRARY.BUFF.PassivePerceptionBonus",
    render(actor, buff) {
        const bonus = Number(buff.bonus ?? buff.formula ?? 2);
        return {
            changes: [{
                key: "system.skills.prc.passive",
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description: format("IONRIFT.LIBRARY.BUFF.PassivePerceptionBonusDesc", { bonus }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.PassivePerceptionBonusSummary", { bonus }),
            daeSpecialDuration: []
        };
    }
});

defineType("ability_bonus", {
    labelKey: "IONRIFT.LIBRARY.BUFF.AbilityCheckBonus",
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
            description: format("IONRIFT.LIBRARY.BUFF.AbilityCheckBonusDesc", { ability: ability.toUpperCase(), bonus }),
            summaryLine: format("IONRIFT.LIBRARY.BUFF.AbilityCheckBonusSummary", { ability: ability.toUpperCase(), bonus }),
            daeSpecialDuration: []
        };
    }
});

defineType("save_bonus", {
    labelKey: "IONRIFT.LIBRARY.BUFF.SavingThrowBonusLimitedUses",
    render(actor, buff) {
        const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
        const bonus = Number(buff.bonus ?? 1);
        const uses = buff.uses ?? buff.charges ?? 1;
        const usesLabel = typeof uses === "string" ? uses : String(uses);
        const charges = Number(buff.chargesRemaining ?? uses);
        const saveWindow = buff.duration === "untilLongRest" 
            ? localize("IONRIFT.LIBRARY.BUFF.WindowUntilLongRest") 
            : localize("IONRIFT.LIBRARY.BUFF.WindowUntilShortRest");
        
        const isRemaining = Number.isFinite(charges) && charges > 0;
        const description = isRemaining
            ? format("IONRIFT.LIBRARY.BUFF.SavingThrowBonusDescRemaining", { ability: ability.toUpperCase(), bonus, charges, saveWindow })
            : format("IONRIFT.LIBRARY.BUFF.SavingThrowBonusDescNext", { ability: ability.toUpperCase(), bonus, usesLabel, saveWindow });
            
        return {
            changes: [{
                key: `system.abilities.${ability}.bonuses.save`,
                mode: aeMode("ADD"),
                value: String(bonus),
                priority: 20
            }],
            description,
            summaryLine: format("IONRIFT.LIBRARY.BUFF.SavingThrowBonusSummary", { ability: ability.toUpperCase(), bonus, usesLabel }),
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
    TYPES.set(type, resolveBuffMeta(type, meta));
}
