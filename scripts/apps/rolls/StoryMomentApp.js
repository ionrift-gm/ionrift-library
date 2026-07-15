/**
 * GM-only story moment panel for cursed item beats and similar table guidance.
 * Uses Ionrift Glass modal styling (.ionrift-window / ionrift-armor-modal-overlay).
 */
export class StoryMomentApp {
    /**
     * @param {object} options
     * @param {string} options.title Plain text title.
     * @param {string} options.content HTML body content.
     * @param {Array<{ id: string, label: string, icon?: string }>} [options.actions]
     * @returns {Promise<string|null>} Chosen action id, or null when dismissed.
     */
    static open({ title, content, actions = [] } = {}) {
        if (!game.user?.isGM) {
            return Promise.resolve(null);
        }

        if (typeof document === "undefined" || !document.body) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            let settled = false;

            const finish = (actionId) => {
                if (settled) return;
                settled = true;
                overlay.remove();
                resolve(actionId);
            };

            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");

            const buttons = Array.isArray(actions) && actions.length > 0
                ? actions
                : [{ id: "done", label: "Done", icon: "fas fa-check" }];

            const actionHtml = buttons.map((action) => {
                const icon = action.icon ? `<i class="${action.icon}"></i> ` : "";
                const label = String(action.label ?? action.id ?? "Done");
                return `<button type="button" class="btn-armor-confirm story-moment-action" data-action-id="${action.id}">${icon}${label}</button>`;
            }).join("");

            overlay.innerHTML = `
                <div class="ionrift-armor-modal ionrift-window glass-ui">
                    <h3>${title}</h3>
                    ${content}
                    <div class="ionrift-armor-modal-buttons">
                        ${actionHtml}
                    </div>
                </div>`;

            for (const button of overlay.querySelectorAll(".story-moment-action")) {
                button.addEventListener("click", () => {
                    finish(button.dataset.actionId ?? null);
                });
            }

            overlay.addEventListener("click", (event) => {
                if (event.target !== overlay) return;
                finish(null);
            });

            const onKeyDown = (event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                finish(null);
            };

            document.addEventListener("keydown", onKeyDown, true);
            overlay.addEventListener("remove", () => {
                document.removeEventListener("keydown", onKeyDown, true);
            }, { once: true });

            document.body.appendChild(overlay);
        });
    }
}
