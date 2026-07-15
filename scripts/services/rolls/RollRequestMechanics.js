/**
 * RollRequestMechanics
 * System-agnostic roll build/evaluate helpers for the shared roll-request service.
 */

import { adapterRegistry } from "../systems/SystemAdapterRegistry.js";

export const SKILL_DISPLAY_NAMES = {
    acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana",
    ath: "Athletics", dec: "Deception", his: "History",
    ins: "Insight", itm: "Intimidation", inv: "Investigation",
    med: "Medicine", nat: "Nature", prc: "Perception",
    prf: "Performance", per: "Persuasion", rel: "Religion",
    slt: "Sleight of Hand", ste: "Stealth", sur: "Survival",
    str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma"
};

/**
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function getAbilityMod(actor, key) {
    const abbr = String(key ?? "").slice(0, 3).toLowerCase();
    const score = adapterRegistry.getAbilityScore(actor, abbr);
    if (Number.isFinite(score)) return Math.floor((score - 10) / 2);
    const ability = actor?.system?.abilities?.[abbr];
    if (ability && Number.isFinite(ability.mod)) return ability.mod;
    return 0;
}

/**
 * @param {Actor} actor
 * @param {string} key
 * @returns {number}
 */
export function getSkillMod(actor, key) {
    const skill = actor?.system?.skills?.[key];
    if (skill) return skill.total ?? skill.mod ?? 0;
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
    return roll?.dice?.[0]?.results?.[0]?.result ?? null;
}

/**
 * @param {Actor} actor
 * @param {Roll} roll
 * @param {string} flavor
 * @param {"public"|"gmroll"|"blind"|"self"} [chatMode="public"]
 * @returns {Promise<ChatMessage>}
 */
export async function postRollToChat(actor, roll, flavor, chatMode = "public") {
    return roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor,
        rollMode: chatMode
    });
}

/**
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
export async function waitForDiceSoNice(timeoutMs = 5000) {
    if (!game.modules?.get?.("dice-so-nice")?.active) return;
    return new Promise((resolve) => {
        const timeout = setTimeout(resolve, timeoutMs);
        Hooks.once("diceSoNiceRollComplete", () => {
            clearTimeout(timeout);
            resolve();
        });
    });
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
 * @param {"public"|"gmroll"|"blind"|"self"} chatMode
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeAbilityRoll(actor, abilityKey, dc, flavor, rollMode = "normal", chatMode = "public") {
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
    await postRollToChat(actor, roll, flavor, chatMode);
    await waitForDiceSoNice();
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
 * @param {"public"|"gmroll"|"blind"|"self"} chatMode
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeSkillRoll(actor, skillKey, dc, flavor, rollMode = "normal", chatMode = "public") {
    if (rollMode === "force-pass" || rollMode === "force-fail") {
        return executeAbilityRoll(actor, skillKey, dc, flavor, rollMode, chatMode);
    }

    const modifier = getSkillMod(actor, skillKey);
    const formula = buildD20Formula(rollMode, modifier);
    const roll = new Roll(formula);
    await roll.evaluate();
    await postRollToChat(actor, roll, flavor, chatMode);
    await waitForDiceSoNice();
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
 * @param {"public"|"gmroll"|"blind"|"self"} chatMode
 * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null, roll: Roll|null }>}
 */
export async function executeSaveRoll(actor, abilityKey, dc, flavor, rollMode = "normal", chatMode = "public") {
    if (rollMode === "force-pass" || rollMode === "force-fail") {
        return executeAbilityRoll(actor, abilityKey, dc, flavor, rollMode, chatMode);
    }

    if (typeof actor.rollAbilitySave === "function") {
        const saveRoll = await actor.rollAbilitySave(abilityKey, {
            dc,
            chatMessage: true,
            rollMode: chatMode,
            fastForward: false
        });
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
 * @param {"public"|"gmroll"|"blind"|"self"} [opts.chatMode="public"]
 * @returns {Promise<{ total: number, formula: string, passed: null, natD20: null, roll: Roll }>}
 */
export async function executeFormulaRoll(actor, formula, { flavor = "", chatMode = "public" } = {}) {
    const rollData = typeof actor?.getRollData === "function" ? actor.getRollData() : {};
    const roll = new Roll(String(formula ?? "0"), rollData);
    await roll.evaluate();
    const flavorText = flavor
        ? `<strong>${actor.name}</strong> - ${flavor}`
        : `<strong>${actor.name}</strong> - ${formula}`;
    await postRollToChat(actor, roll, flavorText, chatMode);
    await waitForDiceSoNice();
    return {
        total: roll.total ?? 0,
        formula: String(formula ?? "0"),
        passed: null,
        natD20: null,
        roll
    };
}

/**
 * GM fallback roll.
 * @param {Actor} actor
 * @param {string|string[]} skills
 * @param {number} dc
 * @param {string} context
 * @param {"normal"|"advantage"|"disadvantage"} rollMode
 * @returns {Promise<{ total: number, passed: boolean|null, skill: string, natD20: number|null }>}
 */
export async function rollForPlayer(actor, skills, dc, context = "Skill check", rollMode = "normal") {
    const skillList = Array.isArray(skills) ? skills : [skills];
    const skill = pickBestSkill(actor, skillList);
    const skillName = SKILL_DISPLAY_NAMES[skill] ?? skill.toUpperCase();
    const modeLabel = rollMode === "advantage" ? " [Advantage]"
        : rollMode === "disadvantage" ? " [Disadvantage]" : "";
    const flavor = `<strong>${actor.name}</strong> - ${context} (${skillName}, DC ${dc}) [GM roll]${modeLabel}`;
    const result = await executeSkillRoll(actor, skill, dc, flavor, rollMode, "public");
    return {
        total: result.total,
        passed: result.passed,
        skill,
        natD20: result.natD20
    };
}
