import { IonriftBuffAdapter, manualAdvisory } from "../IonriftBuffAdapter.js";
import { emptyResolvedEffect } from "../ResolvedEffect.js";
import { TYPES } from "../BuffTypeRegistry.js";

const SAVE_SELECTOR = {
    str: "fortitude",
    con: "fortitude",
    dex: "reflex",
    int: "will",
    wis: "will",
    cha: "will",
    fortitude: "fortitude",
    reflex: "reflex",
    will: "will"
};

const ABILITY_CHECK_SELECTOR = {
    str: "str-check",
    dex: "dex-check",
    con: "con-check",
    int: "int-check",
    wis: "wis-check",
    cha: "cha-check"
};

/** v1 high-confidence native types on PF2e. */
const NATIVE_TYPES = new Set([
    "temp_hp", "heal", "exhaustion_save", "hit_die",
    "resistance", "save_bonus", "ability_bonus", "sense_darkvision"
]);

/** Approximate stand-ins (advantage family). */
const APPROXIMATE_TYPES = new Set([
    "advantage", "check_advantage", "skill_advantage"
]);

/** Manual until a PF2e passive-Perception equivalent is defined. */
const MANUAL_TYPES = new Set(["passive_perception"]);

function pf2eDuration(buff) {
    if (buff.duration === "untilShortRest") {
        return { value: 4, unit: "hours", sustained: false, expiry: null };
    }
    if (buff.duration === "nextSave" || buff.duration === "nextCheck") {
        return { value: 1, unit: "rounds", sustained: false, expiry: "turn-end" };
    }
    return { value: 8, unit: "hours", sustained: false, expiry: null };
}

function buildEffectItem(name, rules, buff) {
    return {
        type: "effect",
        name,
        img: "icons/magic/life/heart-cross-green.webp",
        system: {
            description: { value: "" },
            rules,
            duration: pf2eDuration(buff),
            tokenIcon: { show: true },
            badge: null,
            context: null,
            traits: { value: [] },
            level: { value: 1 },
            start: { value: 0, initiative: null },
            target: null
        },
        flags: {
            "ionrift-library": { cookingBuffEffect: true }
        }
    };
}

function saveSelector(ability) {
    return SAVE_SELECTOR[String(ability ?? "con").toLowerCase()] ?? "fortitude";
}

function abilityCheckSelector(ability) {
    return ABILITY_CHECK_SELECTOR[String(ability ?? "wis").toLowerCase()] ?? "wis-check";
}

function approxBonus(buff) {
    const bonus = Number(buff.bonus);
    if (Number.isFinite(bonus) && bonus > 0) return Math.min(2, bonus);
    return 2;
}

export class Pf2eBuffAdapter extends IonriftBuffAdapter {
    get systemId() { return "pf2e"; }

    fidelity(buff) {
        if (!buff?.type || !TYPES.has(buff.type)) return "manual";
        if (TYPES.get(buff.type)?.immediate) return "native";
        if (NATIVE_TYPES.has(buff.type)) return "native";
        if (APPROXIMATE_TYPES.has(buff.type)) return "approximate";
        if (MANUAL_TYPES.has(buff.type)) return "manual";
        return "manual";
    }

    resolve(actor, buff, ctx = {}) {
        if (!buff?.type) return emptyResolvedEffect();
        const meta = TYPES.get(buff.type);
        if (!meta) {
            return emptyResolvedEffect({
                manualNote: "Gains a meal buff (track manually)."
            });
        }

        const fidelity = this.fidelity(buff);
        if (meta.immediate) {
            const built = meta.render(actor, buff) ?? {};
            return emptyResolvedEffect({
                description: built.description ?? "",
                summaryLine: built.summaryLine ?? "",
                fidelity: "native",
                roll: built.roll ?? null,
                immediateFlag: true
            });
        }

        if (fidelity === "manual") {
            const built = meta.render(actor, buff) ?? {};
            return emptyResolvedEffect({
                description: built.description ?? meta.label ?? buff.type,
                summaryLine: built.summaryLine ?? meta.label ?? buff.type,
                fidelity: "manual",
                manualNote: manualAdvisory(buff, built.summaryLine ?? meta.label)
            });
        }

        const effectItems = [];
        let description = "";
        let summaryLine = "";
        let daeSpecial = [];
        let chargesRemaining = null;
        let chargesMax = null;
        let manualNote = null;

        switch (buff.type) {
            case "temp_hp": {
                const formula = buff.formula ?? "0";
                effectItems.push(buildEffectItem("Meal: Temporary HP", [{
                    key: "TempHP",
                    value: String(formula)
                }], buff));
                description = `Temporary hit points (${formula}).`;
                summaryLine = `temp HP (${formula})`;
                break;
            }
            case "resistance": {
                const damageType = String(buff.damageType ?? "poison").toLowerCase();
                const uses = buff.uses ?? buff.charges;
                const rules = [{
                    key: "Resistance",
                    type: damageType,
                    value: 5
                }];
                const item = buildEffectItem(`Meal: ${damageType} resistance`, rules, buff);
                if (uses) {
                    const usesLabel = typeof uses === "string" ? uses : String(uses);
                    chargesRemaining = Number(buff.chargesRemaining ?? uses) || null;
                    chargesMax = Number(buff.chargesMax ?? chargesRemaining) || null;
                    item.system.badge = {
                        type: "counter",
                        value: chargesRemaining ?? 1,
                        labels: ["", usesLabel],
                        loop: false
                    };
                    description = `Resistance to ${damageType} (${usesLabel} hits).`;
                    summaryLine = `resistance (${damageType}, ${usesLabel} hits)`;
                } else {
                    description = `Resistance to ${damageType}.`;
                    summaryLine = `resistance (${damageType})`;
                }
                effectItems.push(item);
                break;
            }
            case "save_bonus": {
                const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
                const bonus = Number(buff.bonus ?? 1);
                const selector = saveSelector(ability);
                const uses = buff.uses ?? buff.charges;
                const rules = [{
                    key: "FlatModifier",
                    selector,
                    type: "circumstance",
                    value: bonus
                }];
                const item = buildEffectItem(`Meal: +${bonus} ${ability.toUpperCase()} saves`, rules, buff);
                if (uses) {
                    const usesLabel = typeof uses === "string" ? uses : String(uses);
                    chargesRemaining = Number(buff.chargesRemaining ?? uses) || null;
                    chargesMax = Number(buff.chargesMax ?? chargesRemaining) || null;
                    item.system.badge = {
                        type: "counter",
                        value: chargesRemaining ?? 1,
                        labels: ["", usesLabel],
                        loop: false
                    };
                    description = `+${bonus} to ${ability.toUpperCase()} saves (${usesLabel} uses).`;
                    summaryLine = `+${bonus} ${ability.toUpperCase()} saves (${usesLabel} uses)`;
                } else {
                    description = `+${bonus} to ${ability.toUpperCase()} saves.`;
                    summaryLine = `+${bonus} ${ability.toUpperCase()} saves`;
                }
                effectItems.push(item);
                break;
            }
            case "ability_bonus": {
                const ability = String(buff.ability ?? "wis").toLowerCase();
                const bonus = Number(buff.bonus ?? 1);
                const selector = abilityCheckSelector(ability);
                effectItems.push(buildEffectItem(`Meal: +${bonus} ${ability.toUpperCase()} checks`, [{
                    key: "FlatModifier",
                    selector,
                    type: "circumstance",
                    value: bonus
                }], buff));
                description = `+${bonus} to ${ability.toUpperCase()} ability checks.`;
                summaryLine = `+${bonus} ${ability.toUpperCase()} checks`;
                break;
            }
            case "sense_darkvision": {
                const feet = Number(buff.feet ?? 60);
                effectItems.push(buildEffectItem(`Meal: Darkvision ${feet}ft`, [{
                    key: "Sense",
                    selector: "darkvision",
                    range: feet
                }], buff));
                description = `Darkvision ${feet}ft.`;
                summaryLine = `${feet}ft darkvision`;
                break;
            }
            case "advantage": {
                const ability = String(buff.save?.ability ?? buff.ability ?? "con").toLowerCase();
                const bonus = approxBonus(buff);
                const selector = saveSelector(ability);
                effectItems.push(buildEffectItem(`Meal: +${bonus} ${ability.toUpperCase()} saves (approx.)`, [{
                    key: "FlatModifier",
                    selector,
                    type: "circumstance",
                    value: bonus
                }], buff));
                description = `+${bonus} circumstance bonus to ${ability.toUpperCase()} saves (approximates advantage).`;
                summaryLine = `+${bonus} ${ability.toUpperCase()} saves (approx.)`;
                manualNote = `Approximated on Pathfinder: +${bonus} circumstance to ${ability.toUpperCase()} saves instead of advantage.`;
                break;
            }
            case "check_advantage": {
                const ability = String(buff.ability ?? "str").toLowerCase();
                const bonus = approxBonus(buff);
                const selector = abilityCheckSelector(ability);
                const uses = buff.uses ?? buff.charges;
                const item = buildEffectItem(`Meal: +${bonus} ${ability.toUpperCase()} checks (approx.)`, [{
                    key: "FlatModifier",
                    selector,
                    type: "circumstance",
                    value: bonus
                }], buff);
                if (uses) {
                    const usesLabel = typeof uses === "string" ? uses : String(uses);
                    chargesRemaining = Number(buff.chargesRemaining ?? uses) || null;
                    chargesMax = Number(buff.chargesMax ?? chargesRemaining) || null;
                    item.system.badge = {
                        type: "counter",
                        value: chargesRemaining ?? 1,
                        labels: ["", usesLabel],
                        loop: false
                    };
                    daeSpecial = [];
                    description = `+${bonus} circumstance to ${ability.toUpperCase()} checks for ${usesLabel} uses (approximates advantage).`;
                    summaryLine = `+${bonus} ${ability.toUpperCase()} checks (${usesLabel} uses, approx.)`;
                } else {
                    description = `+${bonus} circumstance to ${ability.toUpperCase()} checks (approximates advantage).`;
                    summaryLine = `+${bonus} ${ability.toUpperCase()} checks (approx.)`;
                }
                effectItems.push(item);
                manualNote = `Approximated on Pathfinder: +${bonus} circumstance to ${ability.toUpperCase()} checks instead of advantage.`;
                break;
            }
            case "skill_advantage": {
                const skill = String(buff.skill ?? "prc").toLowerCase();
                const bonus = approxBonus(buff);
                effectItems.push(buildEffectItem(`Meal: +${bonus} ${skill.toUpperCase()} (approx.)`, [{
                    key: "FlatModifier",
                    selector: `${skill}-based`,
                    type: "circumstance",
                    value: bonus
                }], buff));
                description = `+${bonus} circumstance to ${skill.toUpperCase()} checks (approximates advantage).`;
                summaryLine = `+${bonus} ${skill.toUpperCase()} checks (approx.)`;
                manualNote = `Approximated on Pathfinder: +${bonus} circumstance to ${skill.toUpperCase()} instead of advantage.`;
                break;
            }
            default:
                return emptyResolvedEffect({
                    fidelity: "manual",
                    manualNote: manualAdvisory(buff, meta.label)
                });
        }

        return emptyResolvedEffect({
            effectItems,
            daeSpecial,
            description,
            summaryLine,
            fidelity,
            manualNote: fidelity === "approximate" ? manualNote : null,
            chargesRemaining,
            chargesMax
        });
    }
}
