import { Logger } from "../platform/Logger.js";

const LABEL = "EffectAutomation";

/**
 * Canonical module ids for the effect-automation stack. Centralised so every
 * consumer detects the same way and a future id change is one edit.
 */
export const EFFECT_MODULE_IDS = {
    DAE: "dae",
    MIDI: "midi-qol",
    TIMES_UP: "times-up",
    CE: "dfreds-convenient-effects"
};

/**
 * Shared detection and small builder helpers for the Active Effect automation
 * stack (DAE, Midi-QoL, Times-Up, Convenient Effects).
 *
 * Stance (see CONDITION_AUTHORING.md "Effect automation stack"):
 *   - dnd5e system + condition registry  = catalog
 *   - DAE (+ Times-Up)                    = durations / ending conditions
 *   - Midi-QoL                            = roll automation (advantage, saves)
 *   - Convenient Effects                  = optional last-resort shortcut
 *
 * Use this instead of scattering `game.modules.get(...)?.active` across modules.
 */
export class EffectAutomation {
    /**
     * @param {string} moduleId
     * @returns {boolean}
     */
    static isActive(moduleId) {
        return Boolean(game.modules?.get?.(moduleId)?.active);
    }

    /** @returns {boolean} Dynamic Active Effects is active. */
    static hasDae() {
        return this.isActive(EFFECT_MODULE_IDS.DAE);
    }

    /** @returns {boolean} Midi-QoL is active. */
    static hasMidi() {
        return this.isActive(EFFECT_MODULE_IDS.MIDI);
    }

    /** @returns {boolean} Times-Up is active. */
    static hasTimesUp() {
        return this.isActive(EFFECT_MODULE_IDS.TIMES_UP);
    }

    /** @returns {boolean} Convenient Effects is active (last-resort path only). */
    static hasCe() {
        return this.isActive(EFFECT_MODULE_IDS.CE);
    }

    /**
     * Convenient Effects apply API, when present. Last-resort only: prefer the
     * dnd5e system catalog and the condition registry first.
     * @returns {object|null}
     */
    static ceApi() {
        if (!this.hasCe()) return null;
        return game.modules.get(EFFECT_MODULE_IDS.CE)?.api
            ?? game.dfreds?.effectInterface
            ?? null;
    }

    /**
     * Coarse capability level for one decision point.
     *   "full"      DAE + Midi-QoL: durations and roll automation both work
     *   "durations" DAE only: effects expire correctly, roll changes advisory
     *   "basic"     neither: plain Active Effects + GM advisory fallback
     * @returns {"full"|"durations"|"basic"}
     */
    static tier() {
        if (this.hasDae() && this.hasMidi()) return "full";
        if (this.hasDae()) return "durations";
        return "basic";
    }

    /**
     * Whether `flags.midi-qol.*` changes will actually affect rolls. When false,
     * such changes are inert and should be surfaced to the GM as advisory text.
     * @returns {boolean}
     */
    static supportsRollChanges() {
        return this.hasMidi();
    }

    /**
     * Full capability snapshot for diagnostics and UI.
     * @returns {{dae: boolean, midi: boolean, timesUp: boolean, ce: boolean, tier: string}}
     */
    static capabilities() {
        return {
            dae: this.hasDae(),
            midi: this.hasMidi(),
            timesUp: this.hasTimesUp(),
            ce: this.hasCe(),
            tier: this.tier()
        };
    }

    /**
     * Merge DAE special durations into an Active Effect data object. No-op when
     * the list is empty. Safe to call regardless of whether DAE is installed:
     * the flag is harmless without DAE and activates automatically once present.
     * @param {object} aeData - Active Effect creation data (mutated and returned).
     * @param {string[]} specialDurations - e.g. ["longRest", "isSave.con"].
     * @returns {object} The same aeData.
     */
    static stampDaeDuration(aeData, specialDurations) {
        const list = (specialDurations ?? []).filter(Boolean);
        if (!list.length) return aeData;
        aeData.flags = aeData.flags ?? {};
        const existing = aeData.flags.dae?.specialDuration ?? [];
        aeData.flags.dae = {
            ...(aeData.flags.dae ?? {}),
            specialDuration: [...new Set([...existing, ...list])]
        };
        return aeData;
    }

    /**
     * Build a GM-only advisory chat payload for the fallback rung: the effect was
     * applied as a bare Active Effect (or could not be), and the GM must manage
     * its duration manually because the automation stack is incomplete.
     *
     * Returns the ChatMessage data rather than posting, so callers control
     * batching and speaker. Pass to ChatMessage.create().
     *
     * @param {object} params
     * @param {string} params.title - Effect name shown in bold.
     * @param {string} [params.actorName] - Target actor, when known.
     * @param {string} [params.duration] - Human duration, e.g. "until next rest".
     * @param {string} [params.note] - Extra line, e.g. why automation is partial.
     * @param {string} [params.speakerAlias] - Defaults to "Ionrift".
     * @returns {object} ChatMessage.create() data, whispered to GMs.
     */
    static buildGmAdvisory({ title, actorName, duration, note, speakerAlias = "Ionrift" } = {}) {
        const who = actorName ? ` on <strong>${actorName}</strong>` : "";
        const dur = duration ? ` Lasts ${duration}.` : "";
        const reason = note ? `<br><span class="effect-desc">${note}</span>` : "";
        const content =
            `<div class="ionrift-effect-advisory">` +
            `<p><i class="fas fa-circle-info"></i> <strong>${title}</strong>${who}.${dur}` +
            ` Manage this effect manually.${reason}</p>` +
            `</div>`;
        const gmIds = game.users?.filter(u => u.isGM).map(u => u.id) ?? [];
        return {
            content,
            whisper: gmIds,
            speaker: { alias: speakerAlias }
        };
    }

    /**
     * Log the detected stack once, for support diagnostics. Gated on the debug
     * setting via Logger.log so it is silent in normal play.
     */
    static logCapabilities() {
        const cap = this.capabilities();
        Logger.log(LABEL, `stack: tier=${cap.tier} dae=${cap.dae} midi=${cap.midi} timesUp=${cap.timesUp} ce=${cap.ce}`);
    }
}
