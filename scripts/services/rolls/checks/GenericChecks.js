/**
 * GenericChecks
 * System-agnostic check & save roller for ionrift-library.
 * Reads common skill/ability/save shapes (dnd5e and similar), rolls a d20 wrapped in
 * DiceSettle, and respects the active client's roll mode by default.
 */
import { settleAfter } from "../DiceSettle.js";
import { messageOptionsForMode, resolveRollMode } from "../RollModeResolver.js";

const FALLBACK_SKILLS = {
    prc: "Perception",
    inv: "Investigation",
    slt: "Sleight of Hand",
    arc: "Arcana",
    his: "History",
    rel: "Religion",
    nat: "Nature",
    sur: "Survival"
};

export class GenericChecks {
    get systemId() { return "generic"; }

    /** Stat used for Search and Listen. */
    get perceptionKey() { return "prc"; }

    /** Default skill for clues when the GM leaves it blank. */
    get investigateKey() { return "inv"; }

    /** Label for the Investigate roll. */
    get investigateLabel() { return "Investigation"; }

    /** Investigate rolls observe the active client roll mode unless overridden. */
    get investigateSecret() { return null; }

    /** @returns {Record<string, string>} key -> label */
    skillChoices() {
        const skills = globalThis.CONFIG?.DND5E?.skills;
        if (skills && typeof skills === "object") {
            return Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, localise(v?.label ?? k)]));
        }
        return { ...FALLBACK_SKILLS };
    }

    statLabel(stat) {
        return this.skillChoices()[stat] ?? capitalise(stat);
    }

    /** @returns {number} */
    modifier(actor, stat) {
        const skill = actor?.system?.skills?.[stat];
        const value = skill?.total ?? skill?.mod ?? skill?.value;
        if (Number.isFinite(Number(value))) return Number(value);
        if (stat === this.perceptionKey) return Number(actor?.system?.abilities?.wis?.mod ?? 0) || 0;
        const ability = actor?.system?.abilities?.[stat];
        if (Number.isFinite(Number(ability?.mod))) return Number(ability.mod);
        return 0;
    }

    /**
     * Roll a skill/ability/perception check wrapped in DiceSettle.
     * @param {Actor} actor
     * @param {string} stat
     * @param {{dc?: number|null, secret?: boolean|null, chatMode?: string, treatHalfBlindAsBlind?: boolean, label?: string}} [options]
     * @returns {Promise<{total: number, natD20: number|null, degree: number|null, roll: Roll}>}
     */
    async roll(actor, stat, {
        dc = null,
        secret = null,
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        label = ""
    } = {}) {
        const mod = this.modifier(actor, stat);
        const roll = await new Roll(`1d20 + ${mod}`).evaluate();
        const natD20 = roll.dice?.[0]?.total ?? roll.terms?.[0]?.results?.[0]?.result ?? null;
        const msgOpts = messageOptions(secret, chatMode, { treatHalfBlindAsBlind });
        await settleAfter(() => roll.toMessage(
            {
                speaker: globalThis.ChatMessage?.getSpeaker?.({ actor }) ?? { alias: actor?.name },
                flavor: label || `${this.statLabel(stat)} Check`
            },
            msgOpts
        ));
        const degree = Number.isFinite(dc) ? this.degreeOf({ total: roll.total, dc, natD20 }) : null;
        return { total: roll.total, natD20, degree, roll };
    }

    /**
     * Roll a saving throw wrapped in DiceSettle.
     * @param {Actor} actor
     * @param {string} save
     * @param {{dc?: number|null, secret?: boolean|null, chatMode?: string, treatHalfBlindAsBlind?: boolean, label?: string}} [options]
     * @returns {Promise<{total: number, natD20: number|null, degree: number|null, passed: boolean|null, roll: Roll|null}>}
     */
    async save(actor, save, {
        dc = null,
        secret = null,
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        label = ""
    } = {}) {
        const effectiveMode = secret === true ? "blind" : secret === false ? "public" : chatMode;
        const resolved = resolveRollMode(effectiveMode, { treatHalfBlindAsBlind });

        if (typeof actor?.rollAbilitySave === "function") {
            const saveRoll = await settleAfter(() => actor.rollAbilitySave(save, {
                dc,
                 targetValue: dc,
                chatMessage: true,
                rollMode: resolved.rollMode,
                fastForward: true
            }));
            if (saveRoll) {
                const total = saveRoll.total ?? 0;
                const natD20 = saveRoll.dice?.[0]?.total ?? saveRoll.terms?.[0]?.results?.[0]?.result ?? null;
                const degree = Number.isFinite(dc) ? this.degreeOf({ total, dc, natD20 }) : null;
                return {
                    total,
                    natD20,
                    degree,
                    passed: Number.isFinite(dc) ? total >= dc : null,
                    roll: saveRoll
                };
            }
        }

        const fallback = await this.roll(actor, save, {
            dc,
            secret,
            chatMode,
            treatHalfBlindAsBlind,
            label: label || `${capitalise(save)} Saving Throw`
        });
        return {
            ...fallback,
            passed: Number.isFinite(dc) ? fallback.total >= dc : null
        };
    }

    /** 2 success, 1 failure, 0 failure by 5 or more. */
    degreeOf({ total, dc }) {
        if (total >= dc) return 2;
        return total <= dc - 5 ? 0 : 1;
    }
}

/**
 * Chat visibility for a roll. Supports legacy `secret` boolean or `chatMode` ("client", "public", "blind", "gm", "halfblind").
 * @param {boolean|null|undefined} [secret=null]
 * @param {string} [chatMode="client"]
 * @param {{ treatHalfBlindAsBlind?: boolean }} [options]
 */
export function messageOptions(secret = null, chatMode = "client", options = {}) {
    const mode = secret === true ? "blind" : secret === false ? "public" : chatMode;
    return messageOptionsForMode(mode, options);
}

function localise(key) {
    return globalThis.game?.i18n?.localize?.(key) ?? key;
}

function capitalise(s) {
    const text = String(s ?? "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}
