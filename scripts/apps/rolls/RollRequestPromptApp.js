import {
    executeSaveRoll,
    executeSkillRoll,
    executeAbilityRoll,
    executeFormulaRoll,
    SKILL_DISPLAY_NAMES
} from "../../services/rolls/RollRequestMechanics.js";
import { buildPromptRollContext, centerRollRequestRoster } from "../../services/rolls/RollRequestView.js";
import { ensureDcPulseAnimation } from "../../services/rolls/RollRequestDcPulse.js";
import { PromptQueue, DISMISSED } from "./PromptQueue.js";

const PARTIAL_NAME = "rollRequest";
const TEMPLATE_PATH = "modules/ionrift-library/templates/partials/_roll-request.hbs";

/** Marks a prompt promise that was dismissed externally rather than rolled. */
export class RollRequestDismissedError extends Error {
    constructor(requestId) {
        super("Roll request dismissed");
        this.name = "RollRequestDismissedError";
        this.code = "dismissed";
        this.requestId = requestId ?? null;
    }
}

/**
 * Standalone player prompt for a shared roll request.
 * Uses the Ionrift Glass roll-request component (same as Respite).
 * Closing the overlay (backdrop, Escape) executes the roll; there is no decline path.
 *
 * A single-active queue keeps at most one overlay on a client at a time;
 * additional requests wait FIFO and render when the active one settles. Each
 * prompt is keyed by its request id so a resolved-elsewhere or abandoned request
 * can be dismissed by id and the queue advances.
 */
export class RollRequestPromptApp {
    /** @type {PromptQueue} */
    static #queue = new PromptQueue();

    /**
     * @param {object} payload
     * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null }>}
     */
    static prompt(payload) {
        const actor = payload.actor ?? game.actors.get(payload.actorId);
        if (!actor) {
            return Promise.reject(new Error("RollRequestPromptApp: actor not found"));
        }

        return RollRequestPromptApp.#queue.enqueue({
            id: payload.requestId ?? null,
            run: (handle) => RollRequestPromptApp.#renderOverlay(payload, actor, handle)
        }).then((result) => {
            if (result === DISMISSED) {
                throw new RollRequestDismissedError(payload.requestId);
            }
            return result;
        });
    }

    /**
     * Dismiss an open or queued prompt by request id (e.g. a GM resolved it). The
     * matching prompt's promise rejects with {@link RollRequestDismissedError} and
     * the queue advances.
     * @param {string} requestId
     * @returns {boolean} Whether a matching prompt was found.
     */
    static dismiss(requestId) {
        return RollRequestPromptApp.#queue.dismiss(requestId);
    }

    /**
     * @param {object} payload
     * @param {Actor} actor
     * @param {{ onDismiss: (cb: () => void) => void }} handle
     * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null }>}
     */
    static #renderOverlay(payload, actor, handle) {
        return new Promise((resolve, reject) => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay", "ionrift-roll-request-overlay");

            const panel = document.createElement("div");
            panel.classList.add("ionrift-roll-request-prompt", "ionrift-window", "glass-ui");

            const body = document.createElement("div");
            body.className = "ionrift-roll-request-prompt__body";

            panel.append(body);
            overlay.append(panel);

            let rolling = false;
            let settled = false;
            let finishTimer = null;

            const cleanup = () => {
                if (finishTimer !== null) {
                    window.clearTimeout(finishTimer);
                    finishTimer = null;
                }
                overlay.removeEventListener("click", onOverlayClick);
                document.removeEventListener("keydown", onKeyDown, true);
                overlay.remove();
            };

            const finish = (result, delay = 900) => {
                if (settled) return;
                settled = true;
                finishTimer = window.setTimeout(() => {
                    finishTimer = null;
                    cleanup();
                    resolve(result);
                }, delay);
            };

            const fail = (err) => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(err);
            };

            handle.onDismiss(() => {
                if (settled) return;
                settled = true;
                cleanup();
            });

            const render = async (viewPayload = {}) => {
                const rollRequest = buildPromptRollContext({
                    ...payload,
                    actor,
                    ...viewPayload
                });
                const html = await RollRequestPromptApp.#renderPartial({ rollRequest });
                body.innerHTML = html;
                centerRollRequestRoster(body);
                ensureDcPulseAnimation(body);
                RollRequestPromptApp.#bindRollButtons(body, onRoll);
            };

            const performRoll = async (triggerButton = null) => {
                if (rolling || settled) return;
                rolling = true;

                const button = triggerButton
                    ?? body.querySelector("[data-action=\"ionriftRoll\"]");
                if (button instanceof HTMLButtonElement) {
                    button.disabled = true;
                    button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;
                }

                const type = payload.type ?? "skill";
                const typeLabel = type === "save" ? "Saving Throw"
                    : type === "skill" ? "Skill Check"
                        : type === "formula" ? "Roll"
                            : type === "ability" ? "Ability Check" : "Roll";
                const keyLabel = type === "formula"
                    ? (payload.formula ?? "dice")
                    : (SKILL_DISPLAY_NAMES[payload.key] ?? String(payload.key ?? "").toUpperCase());
                const chatMode = payload.chatMode ?? "public";
                const rollMode = payload.rollMode ?? "normal";
                const dc = Number.isFinite(payload.dc) ? payload.dc : null;
                const tableNote = payload.tableLabel
                    ? `${payload.tableLabel}${payload.flavor ? `. ${payload.flavor}` : ""}`
                    : "";
                const flavorText = tableNote
                    ? `<strong>${actor.name}</strong>: ${tableNote}`
                    : payload.flavor
                        ? `<strong>${actor.name}</strong> - ${payload.flavor}`
                        : type === "formula"
                            ? `<strong>${actor.name}</strong> - ${payload.formula ?? "Roll"}`
                            : `<strong>${actor.name}</strong> - ${typeLabel} (${keyLabel}${Number.isFinite(dc) ? `, DC ${dc}` : ""})`;

                try {
                    let result;
                    if (type === "save") {
                        result = await executeSaveRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else if (type === "skill") {
                        result = await executeSkillRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else if (type === "formula") {
                        result = await executeFormulaRoll(actor, payload.formula ?? "1d4", {
                            flavorHtml: flavorText,
                            chatMode
                        });
                    } else {
                        result = await executeAbilityRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    }

                    let outcomeText = "";
                    if (payload.tableLabel) {
                        await render({
                            rolled: true,
                            total: result.total,
                            passed: result.passed,
                            outcomeText: ""
                        });
                        outcomeText = await RollRequestPromptApp.#lookupOutcome(payload, result.total);
                        await RollRequestPromptApp.#appendOutcomeToChat(result.message, flavorText, outcomeText);
                    }

                    await render({
                        rolled: true,
                        total: result.total,
                        passed: result.passed,
                        outcomeText
                    });

                    finish({
                        total: result.total,
                        passed: result.passed,
                        natD20: result.natD20
                    }, payload.tableLabel ? 2600 : 900);
                } catch (err) {
                    rolling = false;
                    fail(err);
                }
            };

            const onRoll = (event) => {
                performRoll(event.currentTarget instanceof HTMLButtonElement
                    ? event.currentTarget
                    : null);
            };

            const onOverlayClick = (event) => {
                if (event.target !== overlay) return;
                event.preventDefault();
                performRoll();
            };

            const onKeyDown = (event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                performRoll();
            };

            overlay.addEventListener("click", onOverlayClick);
            document.addEventListener("keydown", onKeyDown, true);

            render().catch((err) => {
                fail(err);
            });

            document.body.appendChild(overlay);
        });
    }

    /**
     * @param {object} context
     * @returns {Promise<string>}
     */
    static async #renderPartial(context) {
        const partial = Handlebars.partials[PARTIAL_NAME];
        if (typeof partial === "function") {
            return partial(context);
        }
        if (typeof partial === "string") {
            const compiled = Handlebars.compile(partial);
            return compiled(context);
        }

        const template = await foundry.applications.handlebars.getTemplate(TEMPLATE_PATH);
        return template(context);
    }

    /**
     * Resolve the table row for a formula roll. A local describer wins.
     * A remote prompt asks the requester, who owns the grant.
     * @param {object} payload
     * @param {number} total
     * @returns {Promise<string>}
     */
    static async #lookupOutcome(payload, total) {
        try {
            if (typeof payload.describeOutcome === "function") {
                const text = await payload.describeOutcome({ total });
                return String(text || "Nothing on this row");
            }
            if (typeof payload.requestOutcome === "function") {
                const text = await payload.requestOutcome(total);
                if (text == null) return `Rolled ${total}`;
                return String(text || "Nothing on this row");
            }
        } catch (err) {
            console.warn("Roll request outcome lookup failed", err);
        }
        return `Rolled ${total}`;
    }

    /**
     * Add the table row under the dice flavor so chat shows the find.
     * @param {ChatMessage|null|undefined} message
     * @param {string} flavorText
     * @param {string} outcomeText
     */
    static async #appendOutcomeToChat(message, flavorText, outcomeText) {
        if (!outcomeText || outcomeText.startsWith("Rolled ")) return;
        if (typeof message?.update !== "function") return;
        const safe = String(outcomeText)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        try {
            await message.update({ flavor: `${flavorText}<br><strong>${safe}</strong>` });
        } catch (err) {
            console.warn("Roll request could not record the table row on the dice message", err);
        }
    }

    /**
     * @param {ParentNode} root
     * @param {(event: Event) => void} handler
     */
    static #bindRollButtons(root, handler) {
        for (const button of root.querySelectorAll("[data-action=\"ionriftRoll\"]")) {
            button.addEventListener("click", handler);
        }
    }
}
