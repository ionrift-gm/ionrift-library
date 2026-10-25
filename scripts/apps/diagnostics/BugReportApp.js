import { Logger } from "../../services/platform/Logger.js";
import { BugReportService } from "../../services/diagnostics/BugReportService.js";

export const LIBRARY_BUG_REPORT_CONTEXT = "library-settings";

/**
 * Settings-tab context slug for bug report payloads.
 * @param {string} moduleId
 * @returns {string}
 */
export function bugReportContextForModule(moduleId) {
    const slug = String(moduleId ?? "").replace(/^ionrift-/, "") || "unknown";
    return `${slug}-settings`;
}

const STATUS_ICONS = {
    copying:   "fa-spinner fa-spin",
    submitting: "fa-spinner fa-spin",
    success:   "fa-check-circle",
    error:     "fa-exclamation-circle",
};

/**
 * GM settings entry point for collecting and submitting scrubbed bug reports.
 */
export class BugReportApp extends FormApplication {

    /** @type {string} */
    static bugReportContext = LIBRARY_BUG_REPORT_CONTEXT;

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-bug-report",
            title: game.i18n.localize("ionrift-library.bugReport.title"),
            template: "modules/ionrift-library/templates/apps/bug-report.hbs",
            width: 440,
            height: "auto",
            classes: ["ionrift", "sheet", "bug-report", "ionrift-window", "glass-ui"],
        });
    }

    /**
     * FormApplication subclass scoped to one module's settings tab.
     * @param {string} moduleId
     * @returns {typeof BugReportApp}
     */
    static forModule(moduleId) {
        const context = bugReportContextForModule(moduleId);
        return class ModuleBugReportApp extends BugReportApp {
            static bugReportContext = context;
        };
    }

    /** @returns {string} */
    _context() {
        return this.constructor.bugReportContext ?? LIBRARY_BUG_REPORT_CONTEXT;
    }

    getData() {
        const bugReport = BugReportService;
        return {
            canSubmit: bugReport.canSubmit(),
            discordUrl: bugReport.getDiscordUrl(),
            context: this._context(),
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find("[data-action='copy']").on("click", async (event) => {
            event.preventDefault();
            await this._onCopy();
        });

        html.find("[data-action='send']").on("click", async (event) => {
            event.preventDefault();
            await this._onSend();
        });
    }

    _note() {
        const raw = this.element?.find?.("[name='note']")?.val?.() ?? "";
        return String(raw).trim();
    }

    /**
     * @param {"idle"|"copying"|"submitting"|"success"|"error"} state
     * @param {string} [message]
     * @param {string} [detail]
     */
    _setStatus(state, message = "", detail = "") {
        const $panel = this.element?.find?.("[data-status-panel]");
        if (!$panel?.length) return;

        $panel.removeClass("is-hidden is-copying is-submitting is-success is-error");

        if (!state || state === "idle") {
            $panel.addClass("is-hidden");
            return;
        }

        $panel.addClass(`is-${state}`);
        const iconClass = STATUS_ICONS[state] ?? "";
        $panel.find(".status-icon").attr("class", `status-icon fas ${iconClass}`);
        $panel.find(".status-text").text(message);

        const $detail = $panel.find(".status-detail");
        if (detail) {
            $detail.text(detail).show();
        } else {
            $detail.text("").hide();
        }

        this._afterStatusChange(state);
    }

    /**
     * Keep status feedback visible inside the scrollable window.
     * @param {string} state
     */
    _afterStatusChange(state) {
        const $footnote = this.element?.find?.("[data-footnote]");
        if ($footnote?.length) {
            if (state && state !== "idle") $footnote.hide();
            else $footnote.show();
        }

        const $panel = this.element?.find?.("[data-status-panel]");
        if (!$panel?.length || $panel.hasClass("is-hidden")) return;

        queueMicrotask(() => {
            try {
                this.setPosition?.({ height: "auto" });
            } catch {
                // Window may not be positioned yet.
            }

            const contentEl = this.element?.find?.(".window-content")?.[0];
            const panelEl   = $panel[0];
            if (!contentEl || !panelEl) return;

            const panelBottom = panelEl.offsetTop + panelEl.offsetHeight;
            const viewBottom  = contentEl.scrollTop + contentEl.clientHeight;
            if (panelBottom > viewBottom - 12) {
                contentEl.scrollTop = Math.max(0, panelBottom - contentEl.clientHeight + 20);
            }
        });
    }

    /** @param {boolean} busy */
    _setFormBusy(busy) {
        const $root = this.element;
        if (!$root?.length) return;
        $root.find("[data-action='copy'], [data-action='send']").prop("disabled", busy);
        $root.find("[name='note']").prop("disabled", busy);
    }

    async _onCopy() {
        this._setFormBusy(true);
        this._setStatus("copying", game.i18n.localize("ionrift-library.bugReport.preparingStatus"));

        try {
            const note = this._note();
            const copied = await BugReportService.copyToClipboard({
                context: this._context(),
                note: note || undefined,
            });
            const detail = copied
                ? game.i18n.localize("ionrift-library.bugReport.reportCopiedDetail")
                : game.i18n.localize("ionrift-library.bugReport.downloadedJson");
            this._setStatus("success", game.i18n.localize("ionrift-library.bugReport.readyToPasteStatus"), detail);
            ui.notifications.info(detail);
        } catch (err) {
            Logger.error("BugReport", "Copy bug report failed:", err);
            this._setStatus(
                "error",
                game.i18n.localize("ionrift-library.bugReport.copyErrorStatus"),
                game.i18n.localize("ionrift-library.bugReport.copyErrorDetail")
            );
            ui.notifications.error(game.i18n.localize("ionrift-library.bugReport.copyErrorToast"));
        } finally {
            this._setFormBusy(false);
        }
    }

    async _onSend() {
        if (!BugReportService.canSubmit()) {
            this._setStatus(
                "error",
                game.i18n.localize("ionrift-library.bugReport.directUnavailableStatus"),
                game.i18n.localize("ionrift-library.bugReport.directUnavailableDetail")
            );
            ui.notifications.warn(
                game.i18n.localize("ionrift-library.bugReport.directUnavailableDetail"),
                { permanent: true }
            );
            return;
        }

        this._setFormBusy(true);
        this._setStatus(
            "submitting",
            game.i18n.localize("ionrift-library.bugReport.submittingStatus"),
            game.i18n.localize("ionrift-library.bugReport.submittingDetail")
        );

        try {
            const note = this._note();
            const result = await BugReportService.submit({
                context: this._context(),
                note: note || undefined,
            });

            if (!result?.ok) {
                const msg = BugReportService.formatSubmitError(result?.error);
                this._setStatus("error", game.i18n.localize("ionrift-library.bugReport.sendErrorStatus"), msg);
                ui.notifications.error(msg, { permanent: true });
                return;
            }

            const reference = result.reference ?? "";
            this._setStatus(
                "success",
                game.i18n.localize("ionrift-library.bugReport.receivedStatus"),
                reference
                    ? game.i18n.format("ionrift-library.bugReport.receivedRefDetail", { reference })
                    : game.i18n.localize("ionrift-library.bugReport.receivedNoRefDetail")
            );

            await BugReportService.showSubmitSuccess(result);
        } catch (err) {
            Logger.error("BugReport", "Send bug report failed:", err);
            const msg = BugReportService.formatSubmitError(err?.message ?? String(err));
            this._setStatus("error", game.i18n.localize("ionrift-library.bugReport.sendErrorStatus"), msg);
            ui.notifications.error(game.i18n.localize("ionrift-library.bugReport.sendErrorToast"));
        } finally {
            this._setFormBusy(false);
        }
    }
}
