import {
    executeSaveRoll,
    executeSkillRoll,
    executeAbilityRoll,
    SKILL_DISPLAY_NAMES
} from "../services/RollRequestMechanics.js";
import { buildPromptRollContext, centerRollRequestRoster } from "../services/RollRequestView.js";
import { ensureDcPulseAnimation } from "../services/RollRequestDcPulse.js";

const PARTIAL_NAME = "rollRequest";
const TEMPLATE_PATH = "modules/ionrift-library/templates/partials/_roll-request.hbs";

/**
 * Standalone player prompt for a shared roll request.
 * Uses the Ionrift Glass roll-request component (same as Respite).
 */
export class RollRequestPromptApp {
    /**
     * @param {object} payload
     * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null }>}
     */
    static prompt(payload) {
        return new Promise((resolve, reject) => {
            const actor = payload.actor ?? game.actors.get(payload.actorId);
            if (!actor) {
                reject(new Error("RollRequestPromptApp: actor not found"));
                return;
            }

            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay", "ionrift-roll-request-overlay");

            const panel = document.createElement("div");
            panel.classList.add("ionrift-roll-request-prompt", "ionrift-window", "glass-ui");

            const body = document.createElement("div");
            body.className = "ionrift-roll-request-prompt__body";

            const footer = document.createElement("div");
            footer.className = "ionrift-roll-request-prompt__footer";
            footer.innerHTML = `
                <button type="button" class="btn-roll-decline">
                    <i class="fas fa-times"></i> Decline
                </button>`;

            panel.append(body, footer);
            overlay.append(panel);

            let rolling = false;

            const cleanup = () => overlay.remove();

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

            const onRoll = async (event) => {
                if (rolling) return;
                rolling = true;

                const button = event.currentTarget;
                button.disabled = true;
                button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;

                const type = payload.type ?? "skill";
                const typeLabel = type === "save" ? "Saving Throw"
                    : type === "skill" ? "Skill Check"
                        : type === "ability" ? "Ability Check" : "Roll";
                const keyLabel = SKILL_DISPLAY_NAMES[payload.key] ?? String(payload.key ?? "").toUpperCase();
                const chatMode = payload.chatMode ?? "public";
                const rollMode = payload.rollMode ?? "normal";
                const dc = Number.isFinite(payload.dc) ? payload.dc : null;
                const flavorText = payload.flavor
                    ? `<strong>${actor.name}</strong> - ${payload.flavor}`
                    : `<strong>${actor.name}</strong> - ${typeLabel} (${keyLabel}${Number.isFinite(dc) ? `, DC ${dc}` : ""})`;

                try {
                    let result;
                    if (type === "save") {
                        result = await executeSaveRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else if (type === "skill") {
                        result = await executeSkillRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else {
                        result = await executeAbilityRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    }

                    await render({
                        rolled: true,
                        total: result.total,
                        passed: result.passed
                    });

                    window.setTimeout(() => {
                        cleanup();
                        resolve({
                            total: result.total,
                            passed: result.passed,
                            natD20: result.natD20
                        });
                    }, 900);
                } catch (err) {
                    rolling = false;
                    cleanup();
                    reject(err);
                }
            };

            footer.querySelector(".btn-roll-decline")?.addEventListener("click", () => {
                if (rolling) return;
                cleanup();
                reject(new Error("Roll declined"));
            });

            render().catch((err) => {
                cleanup();
                reject(err);
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
     * @param {ParentNode} root
     * @param {(event: Event) => void} handler
     */
    static #bindRollButtons(root, handler) {
        for (const button of root.querySelectorAll("[data-action=\"ionriftRoll\"]")) {
            button.addEventListener("click", handler);
        }
    }
}
