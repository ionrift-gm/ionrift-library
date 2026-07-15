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
        const uses = buff.uses ?? buff.charges;
        const window = buff.duration === "untilShortRest"
            ? "until short rest or 4 hours"
            : "until long rest";
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const chargeNote = Number.isFinite(charges) && charges > 0
                ? ` (${charges} poison hits remaining, ${window})`
                : ` (next ${usesLabel} poison hits, ${window})`;
            return {
                changes: [{
                    key: "system.traits.dr.value",
                    mode: aeMode("ADD"),
                    value: damageType,
                    priority: 20
                }],
                description: `Damage resistance (${damageType})${chargeNote}.`,
                summaryLine: `resistance (${damageType}, ${usesLabel} hits)`,
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
        const uses = buff.uses ?? buff.charges;
        const checkWindow = buff.duration === "untilShortRest" ? "until short rest" : "until long rest";
        if (uses) {
            const usesLabel = typeof uses === "string" ? uses : String(uses);
            const charges = Number(buff.chargesRemaining ?? uses);
            const chargeNote = Number.isFinite(charges) && charges > 0
                ? ` (${charges} remaining, ${checkWindow})`
                : ` (next ${usesLabel} checks, ${checkWindow})`;
            return {
                changes: [{
                    key: `system.abilities.${ability}.check.roll.mode`,
                    mode: aeMode("ADD"),
                    value: "1",
                    priority: 20
                }],
                description: `Advantage on ${ability.toUpperCase()} ability checks${chargeNote}.`,
                summaryLine: `advantage on ${ability.toUpperCase()} checks (${usesLabel} uses)`,
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
            description: `Advantage on ${ability.toUpperCase()} ability checks (until long rest).`,
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
        const saveWindow = buff.duration === "untilLongRest" ? "until long rest" : "until short rest";
        const chargeNote = Number.isFinite(charges) && charges > 0
            ? ` (${charges} remaining, ${saveWindow})`
            : ` (next ${usesLabel} saves, ${saveWindow})`;
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

export function registerBuffType(type, meta) {
    if (!type || typeof type !== "string") {
        throw new Error("registerBuffType: type must be a non-empty string.");
    }
    if (typeof meta?.render !== "function") {
        throw new Error(`registerBuffType: type "${type}" requires a render function.`);
    }
    TYPES.set(type, { type, immediate: false, ...meta });
}
