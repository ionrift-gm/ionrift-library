import { BugReportBuilder } from "./BugReportBuilder.js";
import { ConsoleCapture } from "./ConsoleCapture.js";
import { CloudRelayService } from "../platform/CloudRelayService.js";
import { Logger } from "../platform/Logger.js";

const DISCORD_URL = "https://discord.gg/vFGXf7Fncj";

/**
 * Build, copy, and optionally upload structured support bug reports.
 */
export class BugReportService {

    /**
     * @param {string} reportId
     * @returns {string}
     */
    static formatReference(reportId) {
        if (!reportId || typeof reportId !== "string") return "";
        const compact = reportId.replace(/-/g, "").toUpperCase();
        return `IR-${compact.slice(0, 8)}`;
    }

    /**
     * @param {object} [opts]
     * @param {string} [opts.context]
     * @param {string} [opts.note]
     * @returns {Promise<object>}
     */
    static async collect(opts = {}) {
        const context = opts.context ?? "manual";
        const builder = new BugReportBuilder(context);
        if (opts.note) builder.setNote(opts.note);

        const core = this._buildCoreSnapshot();
        Hooks.callAll("ionrift.collectBugReport", builder, { context });

        return builder.build({
            ...core,
            recentConsole: ConsoleCapture.getRecent(),
        });
    }

    /**
     * @param {object} [opts]
     * @returns {Promise<boolean>} True when copied to clipboard.
     */
    static async copyToClipboard(opts = {}) {
        const report = opts.report ?? await this.collect(opts);
        const json   = BugReportBuilder.serialize(report);
        BugReportBuilder.assertSize(json);

        if (typeof navigator?.clipboard?.writeText === "function") {
            await navigator.clipboard.writeText(json);
            return true;
        }

        const blob = new Blob([json], { type: "application/json" });
        const url  = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `ionrift-bug-report-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        return false;
    }

    /**
     * @param {object} [opts]
     * @returns {Promise<{ ok: boolean, reportId?: string, reference?: string, error?: string }>}
     */
    static async submit(opts = {}) {
        if (!game.user.isGM) {
            return { ok: false, error: "Only the GM can send bug reports." };
        }
        if (!CloudRelayService.isAuthenticated()) {
            return { ok: false, error: "not_connected" };
        }

        let report = opts.report ?? await this.collect(opts);
        const draftJson = BugReportBuilder.serialize(report);
        const draftBytes = new TextEncoder().encode(draftJson).length;

        try {
            const initResult = await CloudRelayService.initSupportReport({
                context:    report.context,
                summary:    this._summaryLine(report),
                byteLength: draftBytes + 256,
            });

            if (!initResult?.ok || !initResult.reportId) {
                return { ok: false, error: initResult?.error ?? "Upload init failed." };
            }

            const reportId  = initResult.reportId;
            const reference = initResult.reference ?? this.formatReference(reportId);

            report = { ...report, reportId, reference };

            const finalJson = BugReportBuilder.serialize(report);
            BugReportBuilder.assertSize(finalJson);

            const uploadResult = await CloudRelayService.uploadSupportReport(reportId, finalJson);
            if (!uploadResult?.ok) {
                return { ok: false, error: uploadResult?.error ?? "Upload failed." };
            }

            const finalReference = uploadResult.reference ?? reference;
            Logger.log("Library", `Bug report submitted: ${finalReference} (${reportId})`);
            return { ok: true, reportId, reference: finalReference };
        } catch (err) {
            Logger.warn("Library", "Bug report submit failed:", err);
            return { ok: false, error: err?.message ?? String(err) };
        }
    }

    /**
     * Modal with citeable reference for Discord follow-up.
     * @param {{ reference: string, reportId?: string }} result
     */
    static async showSubmitSuccess(result) {
        const reference = result?.reference ?? "";
        const reportId  = result?.reportId ?? "";
        const discord   = this.getDiscordUrl();

        ui.notifications.info(
            `Report received. Reference <strong>${reference}</strong>. Cite this in Discord if you follow up.`,
            { permanent: true }
        );

        await new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal ionrift-bug-report-modal">
                    <h3><i class="fas fa-check"></i> Report received</h3>
                    <p>Save this reference for Discord follow-up:</p>
                    <p class="ionrift-bug-report-ref">${reference}</p>
                    <p class="ionrift-bug-report-hint">
                        Paste <strong>${reference}</strong> in
                        <a href="${discord}" target="_blank" rel="noopener">Discord</a>
                        if you need more help.
                    </p>
                    ${reportId ? `<p class="ionrift-bug-report-id">Full id: <code>${reportId}</code></p>` : ""}
                    <div class="ionrift-armor-modal-buttons">
                        <button type="button" class="btn-copy-ref cache-btn-secondary">
                            <i class="fas fa-copy"></i> Copy reference
                        </button>
                        <button type="button" class="btn-armor-confirm cache-btn-accent">Done</button>
                    </div>
                </div>`;

            document.body.appendChild(overlay);

            const close = () => {
                overlay.remove();
                resolve();
            };

            overlay.querySelector(".btn-armor-confirm")?.addEventListener("click", close);
            overlay.querySelector(".btn-copy-ref")?.addEventListener("click", async () => {
                const citeLine = `Ionrift bug report ${reference}`;
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(citeLine);
                        ui.notifications.info(`Copied ${reference} to clipboard.`);
                    }
                } catch {
                    ui.notifications.warn("Could not copy automatically. Note the reference above.");
                }
            });
        });
    }

    /** @returns {boolean} */
    static canSubmit() {
        return !!game.user?.isGM && CloudRelayService.isAuthenticated();
    }

    static getDiscordUrl() {
        return DISCORD_URL;
    }

    /**
     * User-facing message for a failed submit.
     * @param {string} [error]
     * @returns {string}
     */
    static formatSubmitError(error) {
        if (!error) return "Upload failed.";
        if (error === "not_connected") {
            return "Connect Patreon in Ionrift Library (free tier is fine), or copy the report for Discord.";
        }
        const text = String(error);
        const lower = text.toLowerCase();
        if (lower === "not found" || lower.includes("404")) {
            return "Upload is not available on the server yet. Copy the report and paste it in Discord.";
        }
        return text;
    }

    static _buildCoreSnapshot() {
        const ionriftModules = {};
        for (const mod of game.modules?.values?.() ?? []) {
            if (!mod.id?.startsWith("ionrift-")) continue;
            ionriftModules[mod.id] = {
                version:  mod.version ?? "unknown",
                active:   mod.active ?? false,
            };
        }

        return {
            foundry: {
                version: game.version ?? "unknown",
                build:   game.build ?? null,
            },
            system: {
                id:      game.system?.id ?? "unknown",
                version: game.system?.version ?? "unknown",
            },
            modules: {
                ionrift:     ionriftModules,
                activeCount: game.modules?.filter?.(m => m.active)?.size ?? 0,
            },
            world: {
                id: game.world?.id ?? null,
            },
            reporter: {
                isGM: game.user?.isGM ?? false,
                role: game.user?.role ?? null,
            },
            client: {
                userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
            },
        };
    }

    static _summaryLine(report) {
        const skipCount = report.attachments?.quartermaster?.skippedCount
            ?? report.attachments?.quartermaster?.skippedItems?.length
            ?? 0;
        if (skipCount > 0) {
            return `QM loot pool compile: ${skipCount} compatibility skip(s)`;
        }
        return `Ionrift bug report (${report.context ?? "manual"})`;
    }
}
