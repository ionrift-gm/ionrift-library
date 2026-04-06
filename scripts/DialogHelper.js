export class DialogHelper {
    /**
     * Shows a branded Ionrift Glass confirmation dialog.
     *
     * Uses the .ionrift-armor-modal-overlay DOM structure so that any module
     * with the standard Ionrift modal CSS gets the dark glass treatment
     * instead of Foundry's default parchment Dialog.
     *
     * @param {Object} options Configuration options.
     * @param {string} options.title Plain text dialog title.
     * @param {string} options.content HTML content of the dialog body.
     * @param {string} [options.yesLabel="Yes"] Plain text label for the confirm button.
     * @param {string} [options.noLabel="No"] Plain text label for the cancel button.
     * @param {string} [options.yesIcon="fas fa-check"] Font Awesome class for confirm button icon.
     * @param {string} [options.noIcon="fas fa-times"] Font Awesome class for cancel button icon.
     * @param {boolean} [options.defaultYes=true] Whether 'Yes' is the default button.
     * @returns {Promise<boolean>} Resolves to true if confirmed, false otherwise.
     */
    static async confirm({ title, content, yesLabel = "Yes", noLabel = "No", yesIcon = "fas fa-check", noIcon = "fas fa-times", defaultYes = true } = {}) {
        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal">
                    <h3><i class="${yesIcon}"></i> ${title}</h3>
                    ${content}
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="${yesIcon}"></i> ${yesLabel}</button>
                        <button class="btn-armor-cancel"><i class="${noIcon}"></i> ${noLabel}</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                overlay.remove();
                resolve(true);
            });
            overlay.querySelector(".btn-armor-cancel").addEventListener("click", () => {
                overlay.remove();
                resolve(false);
            });
        });
    }
}
