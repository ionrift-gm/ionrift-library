/**
 * PF2eChecks
 * Uses PF2e/SF2e Statistic rolls so every modifier, feat, and rule element applies,
 * wrapped in DiceSettle and respecting the rolling client's roll mode.
 */
import { GenericChecks, messageOptions } from "./GenericChecks.js";
import { settleAfter } from "../DiceSettle.js";
import { resolveRollMode } from "../RollModeResolver.js";
import { Logger } from "../../platform/Logger.js";

const SAVE_MAP = {
    fort: "fortitude",
    fortitude: "fortitude",
    con: "fortitude",
    ref: "reflex",
    reflex: "reflex",
    dex: "reflex",
    will: "will",
    wis: "will"
};

export class PF2eChecks extends GenericChecks {
    get systemId() { return "pf2e"; }

    get perceptionKey() { return "perception"; }

    get stealthKey() { return "stealth"; }

    /** Investigate is a Recall Knowledge check with whatever skill fits. */
    get investigateKey() { return "society"; }

    get investigateLabel() { return "Recall Knowledge"; }

    /** Observe the active client's roll mode unless explicitly overridden. */
    get investigateSecret() { return null; }

    skillChoices() {
        const out = { perception: localise("PF2E.PerceptionLabel", "Perception") };
        const skills = globalThis.CONFIG?.PF2E?.skills ?? {};
        for (const [slug, entry] of Object.entries(skills)) {
            out[slug] = localise(entry?.label ?? slug, slug);
        }
        return out;
    }

    statistic(actor, stat) {
        if (stat === "perception" || stat === "prc") return actor?.perception ?? null;
        if (stat === "ste") return actor?.skills?.stealth ?? actor?.skills?.ste ?? null;
        return actor?.skills?.[stat] ?? null;
    }

    saveStatistic(actor, save) {
        const key = SAVE_MAP[String(save ?? "").toLowerCase()] ?? save;
        return actor?.saves?.[key] ?? null;
    }

    modifier(actor, stat) {
        return Number(this.statistic(actor, stat)?.mod ?? 0) || 0;
    }

    async roll(actor, stat, {
        dc = null,
        secret = null,
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        label = "",
        token = null,
        options = []
    } = {}) {
        const statistic = this.statistic(actor, stat);
        const effectiveMode = secret === true ? "blind" : secret === false ? "public" : chatMode;
        const resolved = resolveRollMode(effectiveMode, { treatHalfBlindAsBlind });
        const isBlind = resolved.isBlind;

        if (statistic?.roll) {
            try {
                const roll = await settleAfter(() => statistic.roll({
                    dc: Number.isFinite(dc) ? { value: dc } : null,
                    skipDialog: true,
                    ...messageOptions(secret, chatMode, { treatHalfBlindAsBlind }),
                    label: label || undefined,
                    token: token ?? undefined,
                    extraRollOptions: [...options, ...(isBlind ? ["secret"] : [])]
                }));
                if (roll) {
                    const natD20 = roll.dice?.[0]?.total ?? null;
                    const degree = Number.isFinite(roll.degreeOfSuccess)
                        ? roll.degreeOfSuccess
                        : (Number.isFinite(dc) ? this.degreeOf({ total: roll.total, dc, natD20 }) : null);
                    return { total: roll.total, natD20, degree, roll };
                }
            } catch (err) {
                Logger.warn("Library", `PF2e ${stat} roll failed, using a plain d20:`, err);
            }
        }
        return super.roll(actor, stat, { dc, secret, chatMode, treatHalfBlindAsBlind, label });
    }

    async save(actor, save, {
        dc = null,
        secret = null,
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        label = "",
        token = null,
        options = []
    } = {}) {
        const statistic = this.saveStatistic(actor, save);
        const effectiveMode = secret === true ? "blind" : secret === false ? "public" : chatMode;
        const resolved = resolveRollMode(effectiveMode, { treatHalfBlindAsBlind });
        const isBlind = resolved.isBlind;

        if (statistic?.roll) {
            try {
                const roll = await settleAfter(() => statistic.roll({
                    dc: Number.isFinite(dc) ? { value: dc } : null,
                    skipDialog: true,
                    ...messageOptions(secret, chatMode, { treatHalfBlindAsBlind }),
                    label: label || undefined,
                    token: token ?? undefined,
                    extraRollOptions: [...options, ...(isBlind ? ["secret"] : [])]
                }));
                if (roll) {
                    const natD20 = roll.dice?.[0]?.total ?? null;
                    const degree = Number.isFinite(roll.degreeOfSuccess)
                        ? roll.degreeOfSuccess
                        : (Number.isFinite(dc) ? this.degreeOf({ total: roll.total, dc, natD20 }) : null);
                    return {
                        total: roll.total,
                        natD20,
                        degree,
                        passed: Number.isFinite(degree) ? degree >= 2 : (Number.isFinite(dc) ? roll.total >= dc : null),
                        roll
                    };
                }
            } catch (err) {
                Logger.warn("Library", `PF2e ${save} save failed, using fallback:`, err);
            }
        }
        return super.save(actor, save, { dc, secret, chatMode, treatHalfBlindAsBlind, label });
    }

    /** Four degrees of success with natural 20/1 adjustments. */
    degreeOf({ total, dc, natD20 }) {
        let degree = total >= dc + 10 ? 3 : total >= dc ? 2 : total > dc - 10 ? 1 : 0;
        if (natD20 === 20) degree += 1;
        if (natD20 === 1) degree -= 1;
        return Math.max(0, Math.min(3, degree));
    }
}

function localise(key, fallback) {
    const text = globalThis.game?.i18n?.localize?.(key);
    return text && text !== key ? text : capitalise(fallback ?? key);
}

function capitalise(s) {
    const text = String(s ?? "");
    return text.charAt(0).toUpperCase() + text.slice(1);
}
