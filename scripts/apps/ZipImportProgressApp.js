/**
 * ZipImportProgressApp
 *
 * Ionrift Glass styled modal showing ZIP import progress.
 * Created by ZipImporterService during import and updated
 * as files are extracted and uploaded.
 */
export class ZipImportProgressApp extends foundry.applications.api.ApplicationV2 {

    /** @type {string} */
    #fileName;

    /** @type {number} */
    #totalFiles;

    /** @type {number} */
    #currentFile = 0;

    /** @type {string} */
    #currentFileName = "";

    /** @type {boolean} */
    cancelled = false;

    /** @type {boolean} */
    #complete = false;

    /** @type {string} */
    #statusMessage = "Preparing...";

    /** @type {number} Epoch ms when the upload phase started, or 0 if not started. */
    #uploadStartedAt = 0;

    constructor(fileName, totalFiles) {
        super();
        this.#fileName = fileName;
        this.#totalFiles = totalFiles;
    }

    static DEFAULT_OPTIONS = {
        id: "ionrift-zip-import-progress",
        window: {
            title: "Importing Pack",
            icon: "fas fa-file-archive",
            resizable: false,
            minimizable: false
        },
        position: { width: 420, height: "auto" },
        classes: ["ionrift-window"]
    };

    /** @override */
    async _prepareContext() {
        const pct = this.#totalFiles > 0
            ? Math.round((this.#currentFile / this.#totalFiles) * 100)
            : 0;

        return {
            fileName: this.#fileName,
            totalFiles: this.#totalFiles,
            currentFile: this.#currentFile,
            currentFileName: this.#currentFileName,
            percentage: pct,
            statusMessage: this.#statusMessage,
            etaText: this.#computeEtaText(),
            complete: this.#complete,
            cancelled: this.cancelled
        };
    }

    /**
     * Estimated time remaining, based on the average upload rate since the
     * upload phase started. Returns an empty string until enough data has
     * been gathered to make a meaningful estimate.
     * @returns {string}
     */
    #computeEtaText() {
        if (!this.#uploadStartedAt || this.#currentFile <= 0) return "";
        if (this.#totalFiles <= 0 || this.#currentFile >= this.#totalFiles) return "";

        const elapsedSec = (Date.now() - this.#uploadStartedAt) / 1000;
        // Need at least a couple of seconds of data for a stable estimate.
        if (elapsedSec < 2) return "";

        const rate = this.#currentFile / elapsedSec;
        if (rate <= 0) return "";

        const remainingSec = (this.#totalFiles - this.#currentFile) / rate;
        return this.#formatDuration(remainingSec);
    }

    /**
     * @param {number} seconds
     * @returns {string}
     */
    #formatDuration(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return "";
        if (seconds < 60) return `about ${Math.max(1, Math.ceil(seconds))}s remaining`;
        const mins = Math.ceil(seconds / 60);
        if (mins < 60) return `about ${mins} min remaining`;
        const hours = Math.floor(mins / 60);
        const rem = mins % 60;
        return rem > 0 ? `about ${hours}h ${rem}m remaining` : `about ${hours}h remaining`;
    }

    /** @override */
    async _renderHTML(context) {
        const el = document.createElement("div");
        el.classList.add("zip-import-progress");

        if (context.complete) {
            el.innerHTML = `
                <div class="zip-progress-header">
                    <i class="fas fa-check-circle zip-complete-icon"></i>
                    <span class="zip-filename">${context.fileName}</span>
                </div>
                <div class="zip-progress-status complete">${context.statusMessage}</div>
            `;
        } else if (context.cancelled) {
            el.innerHTML = `
                <div class="zip-progress-header">
                    <i class="fas fa-times-circle zip-cancel-icon"></i>
                    <span class="zip-filename">${context.fileName}</span>
                </div>
                <div class="zip-progress-status cancelled">${context.statusMessage}</div>
            `;
        } else if (context.totalFiles === 0) {
            // Preparing phase — no file count yet
            el.innerHTML = `
                <div class="zip-progress-header">
                    <i class="fas fa-file-archive"></i>
                    <span class="zip-filename">${context.fileName}</span>
                </div>
                <div class="zip-progress-preparing">
                    <i class="fas fa-spinner fa-spin"></i>
                    <span>${context.statusMessage}</span>
                </div>
                <div class="zip-progress-actions">
                    <button type="button" class="zip-cancel-btn">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            `;

            const cancelBtn = el.querySelector(".zip-cancel-btn");
            cancelBtn?.addEventListener("click", () => {
                this.cancelled = true;
                this.#statusMessage = "Cancelled.";
                this.render({ force: true });
            });
        } else {
            const etaLine = context.etaText
                ? `<div class="zip-progress-eta">${context.etaText}</div>`
                : "";
            el.innerHTML = `
                <div class="zip-progress-header">
                    <i class="fas fa-file-archive"></i>
                    <span class="zip-filename">${context.fileName}</span>
                </div>
                <div class="zip-progress-bar-container">
                    <div class="zip-progress-bar-fill" style="width: ${context.percentage}%"></div>
                    <span class="zip-progress-bar-label">${context.currentFile} / ${context.totalFiles}</span>
                </div>
                <div class="zip-progress-current">${context.currentFileName || "Starting..."}</div>
                ${etaLine}
                <div class="zip-progress-actions">
                    <button type="button" class="zip-cancel-btn">
                        <i class="fas fa-times"></i> Cancel
                    </button>
                </div>
            `;

            const cancelBtn = el.querySelector(".zip-cancel-btn");
            cancelBtn?.addEventListener("click", () => {
                this.cancelled = true;
                this.#statusMessage = "Cancelled.";
                this.render({ force: true });
            });
        }

        return el;
    }

    /** @override */
    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    /**
     * Update progress during import.
     * @param {number} current
     * @param {string} fileName
     */
    update(current, fileName) {
        if (!this.#uploadStartedAt && current > 0) {
            this.#uploadStartedAt = Date.now();
        }
        this.#currentFile = current;
        this.#currentFileName = fileName;
        this.#statusMessage = `Uploading ${fileName}...`;
        this.render({ force: true });
    }

    /**
     * Update the status message (used during parse/validate phases).
     * @param {string} msg
     */
    setStatus(msg) {
        this.#statusMessage = msg;
        this.render({ force: true });
    }

    /**
     * Set the total file count once known (after filtering).
     * @param {number} total
     */
    setTotal(total) {
        this.#totalFiles = total;
        this.render({ force: true });
    }

    /**
     * Mark the import as complete with summary.
     * @param {number} imported
     * @param {number} skipped
     * @param {string[]} errors
     */
    complete(imported, skipped, errors) {
        this.#complete = true;
        this.#currentFile = this.#totalFiles;

        const parts = [`${imported} files imported`];
        if (skipped > 0) parts.push(`${skipped} skipped`);
        if (errors.length > 0) parts.push(`${errors.length} errors`);
        this.#statusMessage = parts.join(", ") + ".";

        this.render({ force: true });

        // Auto-close after a few seconds on clean import
        if (errors.length === 0 && !this.cancelled) {
            setTimeout(() => {
                if (!this.closing) this.close();
            }, 3000);
        }
    }
}
