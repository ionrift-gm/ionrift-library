/**
 * RollService
 * Unified entry point in ionrift-library for both interactive player roll requests
 * and arbitrary / automated checks, saves, formulas, and custom roll cards.
 *
 * Guarantees:
 * 1. Client roll mode ("client" -> core.messageMode / core.rollMode) is observed by default.
 * 2. Half-Blind ("halfblind") can be treated as Blind ("blind") for non-target/table rolls via `treatHalfBlindAsBlind: true`.
 * 3. Every chat-posted roll or custom roll card attaches `rolls: [roll]` and awaits `DiceSettle` (`settleAfter`).
 * 4. `presentRoll` is never combined with `toMessage` / `ChatMessage.create({ rolls })` (preventing double animations).
 */
import { armDiceSoNiceSettle, presentRoll, settleAfter } from "./DiceSettle.js";
import { applyRollModeToChatData, messageOptionsForMode, resolveRollMode, getClientRollMode } from "./RollModeResolver.js";
import { postRollToChat } from "./RollRequestMechanics.js";
import { RollRequestService } from "./RollRequestService.js";
import { SystemChecks } from "./checks/SystemChecks.js";

export const RollService = {
    /**
     * Interactive roll request to a player (with GM/offline fallback).
     * @param {object} opts
     */
    request(opts = {}) {
        return RollRequestService.request(opts);
    },

    /**
     * Dismiss an active roll request by ID.
     * @param {string} requestId
     */
    dismiss(requestId) {
        return RollRequestService.dismiss(requestId);
    },

    /**
     * Automated system-aware skill / perception / ability check wrapped in DiceSettle.
     * Observes the rolling client's roll mode by default.
     * @param {Actor} actor
     * @param {string} stat
     * @param {object} [opts]
     */
    check(actor, stat, opts = {}) {
        return SystemChecks.current().roll(actor, stat, opts);
    },

    /**
     * Automated system-aware saving throw wrapped in DiceSettle.
     * Observes the rolling client's roll mode by default.
     * @param {Actor} actor
     * @param {string} save
     * @param {object} [opts]
     */
    save(actor, save, opts = {}) {
        return SystemChecks.current().save(actor, save, opts);
    },

    /**
     * Evaluate an arbitrary dice formula (e.g. "1d100", "2d6 + @prof").
     * Posts to chat and settles via DiceSettle by default, or animates silently via `presentRoll`
     * when `postToChat: false, animateSilent: true`.
     *
     * @param {string} formula
     * @param {{
     *   actor?: Actor|null,
     *   data?: object|null,
     *   flavor?: string,
     *   flavorHtml?: string,
     *   chatMode?: string,
     *   treatHalfBlindAsBlind?: boolean,
     *   postToChat?: boolean,
     *   animateSilent?: boolean
     * }} [opts]
     * @returns {Promise<{ total: number, formula: string, roll: Roll, message: ChatMessage|null }>}
     */
    async formula(formula, {
        actor = null,
        data = null,
        flavor = "",
        flavorHtml = "",
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        postToChat = true,
        animateSilent = false
    } = {}) {
        const rollData = data ?? (typeof actor?.getRollData === "function" ? actor.getRollData() : {});
        const formulaStr = String(formula ?? "0");
        const roll = new Roll(formulaStr, rollData);
        await roll.evaluate();

        let message = null;
        if (postToChat) {
            const actorPrefix = actor?.name ? `<strong>${actor.name}</strong>: ` : "";
            const text = flavorHtml || (flavor ? `${actorPrefix}${flavor}` : `${actorPrefix}${formulaStr}`);
            const gate = armDiceSoNiceSettle();
            try {
                message = await postRollToChat(actor, roll, text, chatMode, { treatHalfBlindAsBlind });
            } catch (err) {
                gate.cancel();
                throw err;
            }
            await gate.wait();
        } else if (animateSilent) {
            await presentRoll(roll);
        }

        return {
            total: roll.total ?? 0,
            formula: formulaStr,
            roll,
            message: message ?? null
        };
    },

    /**
     * Post a custom HTML chat card with one or more evaluated `Roll` instances attached,
     * applying client roll mode visibility and waiting for Dice So Nice to settle.
     *
     * @param {object} chatData - Standard `ChatMessage.create` data (`content`, `speaker`, etc.)
     * @param {{
     *   rolls?: Roll[],
     *   chatMode?: string,
     *   treatHalfBlindAsBlind?: boolean,
     *   settle?: boolean
     * }} [opts]
     * @returns {Promise<ChatMessage|null>}
     */
    async postCard(chatData = {}, {
        rolls = [],
        chatMode = "client",
        treatHalfBlindAsBlind = false,
        settle = true
    } = {}) {
        const validRolls = (Array.isArray(rolls) ? rolls : [rolls]).filter(Boolean);
        const payload = applyRollModeToChatData(
            {
                ...chatData,
                ...(validRolls.length > 0 ? { rolls: validRolls } : {})
            },
            chatMode,
            { treatHalfBlindAsBlind }
        );
        const createOpts = messageOptionsForMode(chatMode, { treatHalfBlindAsBlind });

        if (validRolls.length > 0 && settle) {
            return settleAfter(() => ChatMessage.create(payload, createOpts));
        }
        return ChatMessage.create(payload, createOpts);
    },

    resolveMode: resolveRollMode,
    getClientRollMode,
    applyRollModeToChatData,
    messageOptionsForMode,
    checks: SystemChecks
};
