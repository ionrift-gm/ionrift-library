import {
    executeSaveRoll,
    executeSkillRoll,
    executeAbilityRoll,
    SKILL_DISPLAY_NAMES
} from "../services/RollRequestMechanics.js";

/**
 * Standalone player prompt for a shared roll request.
 * Uses the Ionrift Glass overlay pattern.
 */
export class RollRequestPromptApp {
    /**
     * @param {object} payload
     * @returns {Promise<{ total: number, passed: boolean|null, natD20: number|null }>}
     */
    static prompt(payload) {
        return new Promise((resolve, reject) => {
            const actor = game.actors.get(payload.actorId);
            if (!actor) {
                reject(new Error("RollRequestPromptApp: actor not found"));
                return;
            }

            const keyLabel = SKILL_DISPLAY_NAMES[payload.key] ?? String(payload.key ?? "").toUpperCase();
            const typeLabel = payload.type === "save" ? "Saving Throw"
                : payload.type === "skill" ? "Skill Check"
                    : payload.type === "ability" ? "Ability Check" : "Roll";
            const dcLine = Number.isFinite(payload.dc) ? `<p class="roll-dc">DC <strong>${payload.dc}</strong></p>` : "";
            const flavor = payload.flavor
                ? `<p class="roll-flavor">${payload.flavor}</p>`
                : "";

            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay", "ionrift-roll-request-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal ionrift-roll-request-modal">
                    <h3><i class="fas fa-dice-d20"></i> ${foundry.utils.escapeHTML(payload.title ?? typeLabel)}</h3>
                    <p class="roll-actor"><strong>${foundry.utils.escapeHTML(actor.name)}</strong></p>
                    <p class="roll-type">${foundry.utils.escapeHTML(typeLabel)}: ${foundry.utils.escapeHTML(keyLabel)}</p>
                    ${dcLine}
                    ${flavor}
                    <div class="ionrift-armor-modal-buttons">
                        <button type="button" class="btn-roll-request"><i class="fas fa-dice-d20"></i> Roll</button>
                        <button type="button" class="btn-roll-decline"><i class="fas fa-times"></i> Decline</button>
                    </div>
                </div>`;

            const cleanup = () => overlay.remove();

            overlay.querySelector(".btn-roll-decline")?.addEventListener("click", () => {
                cleanup();
                reject(new Error("Roll declined"));
            });

            overlay.querySelector(".btn-roll-request")?.addEventListener("click", async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                button.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Rolling...`;
                try {
                    const chatMode = payload.chatMode ?? "public";
                    const rollMode = payload.rollMode ?? "normal";
                    const dc = Number.isFinite(payload.dc) ? payload.dc : null;
                    const flavorText = payload.flavor
                        ? `<strong>${actor.name}</strong> - ${payload.flavor}`
                        : `<strong>${actor.name}</strong> - ${typeLabel} (${keyLabel}${Number.isFinite(dc) ? `, DC ${dc}` : ""})`;

                    let result;
                    if (payload.type === "save") {
                        result = await executeSaveRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else if (payload.type === "skill") {
                        result = await executeSkillRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    } else {
                        result = await executeAbilityRoll(actor, payload.key, dc, flavorText, rollMode, chatMode);
                    }
                    cleanup();
                    resolve({
                        total: result.total,
                        passed: result.passed,
                        natD20: result.natD20
                    });
                } catch (err) {
                    cleanup();
                    reject(err);
                }
            });

            document.body.appendChild(overlay);
        });
    }
}
