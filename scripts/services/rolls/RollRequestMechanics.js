/**
 * RollRequestMechanics
 * System-agnostic roll build/evaluate helpers for the shared roll-request service.
 */

import { adapterRegistry } from "../systems/SystemAdapterRegistry.js";
import { armDiceSoNiceSettle, settleAfter, waitForDiceSoNice } from "./DiceSettle.js";
import { messageOptionsForMode, resolveRollMode } from "./RollModeResolver.js";

export { armDiceSoNiceSettle, waitForDiceSoNice };

const DEFAULT_SKILL_DISPLAY_NAMES = {
    acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana",
    ath: "Athletics", dec: "Deception", his: "History",
    ins: "Insight", itm: "Intimidation", inv: "Investigation",
    med: "Medicine", nat: "Nature", prc: "Perception",
    prf: "Performance", per: "Persuasion", rel: "Religion",
    slt: "Sleight of Hand", ste: "Stealth", sur: "Survival",
    perception: "Perception", society: "Society", thievery: "Thievery",
    occultism: "Occultism", crafting: "Crafting", diplomacy: "Diplomacy",
    athletics: "Athletics", acrobatics: "Acrobatics", stealth: "Stealth",
    arcana: "Arcana", history: "History", nature: "Nature",
    religion: "Religion", medicine: "Medicine", survival: "Survival",
    deception: "Deception", intimidation: "Intimidation", performance: "Performance",
    str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};

const SKILL_DISPLAY_NAME_KEYS = {
    acr: "ionrift-library.rollRequest.skills.acr",
    ani: "ionrift-library.rollRequest.skills.ani",
    arc: "ionrift-library.rollRequest.skills.arc",
    ath: "ionrift-library.rollRequest.skills.ath",
    dec: "ionrift-library.rollRequest.skills.dec",
    his: "ionrift-library.rollRequest.skills.his",
    ins: "ionrift-library.rollRequest.skills.ins",
    itm: "ionrift-library.rollRequest.skills.itm",
    inv: "ionrift-library.rollRequest.skills.inv",
    med: "ionrift-library.rollRequest.skills.med",
    nat: "ionrift-library.rollRequest.skills.nat",
    prc: "ionrift-library.rollRequest.skills.prc",
    prf: "ionrift-library.rollRequest.skills.prf",
    per: "ionrift-library.rollRequest.skills.per",
    rel: "ionrift-library.rollRequest.skills.rel",
    slt: "ionrift-library.rollRequest.skills.slt",
    ste: "ionrift-library.rollRequest.skills.ste",
    sur: "ionrift-library.rollRequest.skills.sur",
    perception: "ionrift-library.rollRequest.skills.perception",
    society: "ionrift-library.rollRequest.skills.society",
    thievery: "ionrift-library.rollRequest.skills.thievery",
    occultism: "ionrift-library.rollRequest.skills.occultism",
    crafting: "ionrift-library.rollRequest.skills.crafting",
    diplomacy: "ionrift-library.rollRequest.skills.diplomacy",
    athletics: "ionrift-library.rollRequest.skills.athletics",
    acrobatics: "ionrift-library.rollRequest.skills.acrobatics",
    stealth: "ionrift-library.rollRequest.skills.stealth",
    arcana: "ionrift-library.rollRequest.skills.arcana",
    history: "ionrift-library.rollRequest.skills.history",
    nature: "ionrift-library.rollRequest.skills.nature",
    religion: "ionrift-library.rollRequest.skills.religion",
    medicine: "ionrift-library.rollRequest.skills.medicine",
    survival: "ionrift-library.rollRequest.skills.survival",
    deception: "ionrift-library.rollRequest.skills.deception",
    intimidation: "ionrift-library.rollRequest.skills.intimidation",
    performance: "ionrift-library.rollRequest.skills.performance",
    str: "ionrift-library.rollRequest.skills.str",
    dex: "ionrift-library.rollRequest.skills.dex",
    con: "ionrift-library.rollRequest.skills.con",
    int: "ionrift-library.rollRequest.skills.int",
    wis: "ionrift-library.rollRequest.skills.wis",
    cha: "ionrift-library.rollRequest.skills.cha"
};

export const SKILL_DISPLAY_NAMES = new Proxy(DEFAULT_SKILL_DISPLAY_NAMES, {
    get(target, prop, receiver) {
        if (typeof prop === "string" && Object.prototype.hasOwnProperty.call(SKILL_DISPLAY_NAME_KEYS, prop)) {
            return game.i18n.localize(SKILL_DISPLAY_NAME_KEYS[prop]);
        }
        return Reflect.get(target, prop, receiver);
    }
});

/**
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function getAbilityMod(actor, key) {
    const abbr = String(key ?? "").slice(0, 3).toLowerCase();
    const ability = actor?.system?.abilities?.[abbr] ?? actor?.system?.scores?.[abbr];
    if (ability && ability.mod !== null && ability.mod !== undefined && Number.isFinite(Number(ability.mod))) {
        return Number(ability.mod);
    }
    const score = adapterRegistry.getAbilityScore(actor, abbr);
    if (Number.isFinite(score)) return Math.floor((score - 10) / 2);
    return 0;
}

/**
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function getSkillMod(actor, key) {
    const skill = actor?.system?.skills?.[key] ?? actor?.skills?.[key];
    if (skill && Number.isFinite(skill.total ?? skill.mod ?? skill.value)) {
        return Number(skill.total ?? skill.mod ?? skill.value);
    }
    if (key === "perception" || key === "prc") {
        const perc = actor?.perception?.mod ?? actor?.system?.perception?.mod ?? actor?.system?.attributes?.perception?.totalModifier;
        if (Number.isFinite(perc)) return Number(perc);
        return getAbilityMod(actor, "wis");
    }
    if (key === "stealth" || key === "ste") {
        const alt = actor?.skills?.stealth ?? actor?.system?.skills?.ste ?? actor?.system?.skills?.stealth;
        if (alt && Number.isFinite(alt.total ?? alt.mod ?? alt.value)) {
            return Number(alt.total ?? alt.mod ?? alt.value);
        }
        return getAbilityMod(actor, "dex");
    }
    return getAbilityMod(actor, key);
}

/**
 * @param {Actor} actor
 * @param {string[]} skills
 * @returns {string}
 */
export function pickBestSkill(actor, skills) {
    if (!skills?.length) return "dex";
    let best = skills[0];
    let bestMod = -99;
    for (const skill of skills) {
        const mod = getSkillMod(actor, skill);
        if (mod > bestMod) {
            bestMod = mod;
            best = skill;
        }
    }
    return best;
}

/**
 * @param {"normal"|"advantage"|"disadvantage"} rollMode
 * @param {number} modifier
 * @returns {string}
 */
export function buildD20Formula(rollMode, modifier) {
    if (rollMode === "advantage") return `2d20kh1 + ${modifier}`;
    if (rollMode === "disadvantage") return `2d20kl1 + ${modifier}`;
    return `1d20 + ${modifier}`;
}

/**
 * @param {Roll} roll
 * @returns {number|null}
 */
export function getNatD20FromRoll(roll) {
    const t0 = roll?.terms?.[0];
    const r0 = t0?.results?.[0]?.result;
    if (typeof r0 === "number") return r0;
    return roll?.dice?.[0]?.results?.[0]?.result ?? roll?.dice?.[0]?.total ?? null;
}

/**
 * @param {Actor} actor
 * @param {Roll} roll
 * @param {string} flavor
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [chatMode="client"]
 * @param {{ treatHalfBlindAsBlind?: boolean }} [options]
 * @returns {Promise<ChatMessage>}
 */
export async function postRollToChat(actor, roll, flavor, chatMode = "client", options = {}) {
    const resolved = resolveRollMode(chatMode, options);
    const createOpts = messageOptionsForMode(chatMode, options);
    return roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor,
        rollMode: resolved.rollMode
    }, createOpts);
}

/**
 * @param {number|null} dc
 * @param {number} total
 * @param {"normal"|"advantage"|"disadvantage"|"force-pass"|"force-fail"} rollMode
 * @returns {boolean|null}
 */
export function evaluatePassed(dc, total, rollMode) {
    if (rollMode === "force-pass") return true;
    if (rollMode === "force-fail") return false;
    if (!Number.isFinite(dc)) return null;
    return total >= dc;
}

/**
 * @param {Actor} actor
 * @param {string} abilityKey
 * @param {number} dc
 * @param {string} flavor
 * @param {"normal"|"advantage"|"disadvantage"|"force-pass"|"force-fail"} rollMode
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [chatMode="client"]
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeAbilityRoll(actor, abilityKey, dc, flavor, rollMode = "normal", chatMode = "client") {
    if (rollMode === "force-pass") {
        const total = Number.isFinite(dc) ? dc : 20;
        return { total, passed: true, natD20: 1, roll: null };
    }
    if (rollMode === "force-fail") {
        const total = Number.isFinite(dc) ? dc - 1 : 1;
        return { total, passed: false, natD20: 1, roll: null };
    }

    const modifier = getAbilityMod(actor, abilityKey);
    const formula = buildD20Formula(rollMode, modifier);
    const roll = new Roll(formula);
    await roll.evaluate();
    const gate = armDiceSoNiceSettle();
    try {
        await postRollToChat(actor, roll, flavor, chatMode);
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();
    const total = roll.total ?? 0;
    return {
        total,
        passed: evaluatePassed(dc, total, rollMode),
        natD20: getNatD20FromRoll(roll),
        roll
    };
}

/**
 * @param {Actor} actor
 * @param {string} skillKey
 * @param {number} dc
 * @param {string} flavor
 * @param {"normal"|"advantage"|"disadvantage"|"force-pass"|"force-fail"} rollMode
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [chatMode="client"]
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeSkillRoll(actor, skillKey, dc, flavor, rollMode = "normal", chatMode = "client") {
    if (rollMode === "force-pass" || rollMode === "force-fail") {
        return executeAbilityRoll(actor, skillKey, dc, flavor, rollMode, chatMode);
    }

    const modifier = getSkillMod(actor, skillKey);
    const formula = buildD20Formula(rollMode, modifier);
    const roll = new Roll(formula);
    await roll.evaluate();
    const gate = armDiceSoNiceSettle();
    try {
        await postRollToChat(actor, roll, flavor, chatMode);
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();
    const total = roll.total ?? 0;
    return {
        total,
        passed: evaluatePassed(dc, total, rollMode),
        natD20: getNatD20FromRoll(roll),
        roll
    };
}

/**
 * @param {Actor} actor
 * @param {string} abilityKey
 * @param {number} dc
 * @param {string} flavor
 * @param {"normal"|"advantage"|"disadvantage"|"force-pass"|"force-fail"} rollMode
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [chatMode="client"]
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeSaveRoll(actor, abilityKey, dc, flavor, rollMode = "normal", chatMode = "client") {
    if (rollMode === "force-pass" || rollMode === "force-fail") {
        return executeAbilityRoll(actor, abilityKey, dc, flavor, rollMode, chatMode);
    }

    if (typeof actor.rollAbilitySave === "function") {
        const resolved = resolveRollMode(chatMode);
        const saveRoll = await settleAfter(() => actor.rollAbilitySave(abilityKey, {
            dc,
            chatMessage: true,
            rollMode: resolved.rollMode,
            fastForward: false
        }));
        const total = saveRoll?.total ?? 0;
        return {
            total,
            passed: evaluatePassed(dc, total, rollMode),
            natD20: getNatD20FromRoll(saveRoll),
            roll: saveRoll ?? null
        };
    }

    return executeAbilityRoll(actor, abilityKey, dc, flavor, rollMode, chatMode);
}

/**
 * Roll an arbitrary dice formula (no DC or pass/fail).
 * @param {Actor} actor
 * @param {string} formula
 * @param {object} [opts]
 * @param {string} [opts.flavor]
 * @param {string} [opts.flavorHtml]
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [opts.chatMode="client"]
 * @param {boolean} [opts.treatHalfBlindAsBlind=false]
 * @returns {Promise<{ total: number, formula: string, passed: null, natD20: null, roll: Roll, message: ChatMessage|null }>}
 */
export async function executeFormulaRoll(actor, formula, {
    flavor = "",
    flavorHtml = "",
    chatMode = "client",
    treatHalfBlindAsBlind = false
} = {}) {
    const rollData = typeof actor?.getRollData === "function" ? actor.getRollData() : {};
    const roll = new Roll(String(formula ?? "0"), rollData);
    await roll.evaluate();
    const actorName = actor?.name ? `<strong>${actor.name}</strong>: ` : "";
    const flavorText = flavorHtml
        || (flavor
            ? `${actorName}${flavor}`
            : `${actorName}${formula}`);
    const gate = armDiceSoNiceSettle();
    let message;
    try {
        message = await postRollToChat(actor, roll, flavorText, chatMode, { treatHalfBlindAsBlind });
    } catch (err) {
        gate.cancel();
        throw err;
    }
    await gate.wait();
    return {
        total: roll.total ?? 0,
        formula: String(formula ?? "0"),
        passed: null,
        natD20: null,
        roll,
        message: message ?? null
    };
}

/**
 * GM fallback roll.
 * @param {Actor} actor
 * @param {string|string[]} skills
 * @param {number} dc
 * @param {string} context
 * @param {"normal"|"advantage"|"disadvantage"} rollMode
 * @param {"client"|"public"|"gmroll"|"blind"|"self"|"halfblind"} [chatMode="client"]
 * @returns {Promise<{ total: number, passed: boolean|null, skill: string, natD20: number|null }>}
 */
export async function rollForPlayer(actor, skills, dc, context = game.i18n.localize("ionrift-library.rollRequest.skillCheckDefaultContext"), rollMode = "normal", chatMode = "client") {
    const skillList = Array.isArray(skills) ? skills : [skills];
    const skill = pickBestSkill(actor, skillList);
    const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill.toUpperCase();
    const modeLabel = rollMode === "advantage" ? ` [${game.i18n.localize("ionrift-library.rollRequest.tooltipAdvantage")}]`
        : rollMode === "disadvantage" ? ` [${game.i18n.localize("ionrift-library.rollRequest.tooltipDisadvantage")}]` : "";
    const flavor = game.i18n.format("ionrift-library.rollRequest.rollForPlayerFlavor", {
        actor: actor.name,
        context,
        skill: skillName,
        dc,
        mode: modeLabel
    });
    const result = await executeSkillRoll(actor, skill, dc, flavor, rollMode, chatMode);
    return {
        total: result.total,
        passed: result.passed,
        skill,
        natD20: result.natD20
    };
}
