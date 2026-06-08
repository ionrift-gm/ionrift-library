import { Logger } from "./Logger.js";

/**
 * PackNudgeService
 *
 * Shared "no content installed" banner used by Resonance (Core SFX Pack),
 * Respite (Core Art Pack), Quartermaster (forthcoming hoard pack), and any
 * other module that ships a free public zip pack.
 *
 * Consumers register a configuration during init, then call
 * `inject(moduleId, $anchor, opts)` from wherever they want the banner to
 * appear (settings page, in-app workflow, etc.). Snooze/suppress state is
 * shared across all surfaces for a given module, so one dismiss applies
 * everywhere until it expires.
 *
 * Surfaces are dedup-safe via the `.ionrift-pack-nudge` class.
 *
 * Settings keys default to `packNudgeSuppressed` and `packNudgeSnoozedUntil`
 * on the consumer module's own scope, but can be overridden for legacy
 * keys (e.g. Resonance keeps `sfxNudge*`, Respite keeps `artNudge*`).
 */

const DEFAULT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const DEDUPE_CLASS = "ionrift-pack-nudge";

const _ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
const _esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => _ESC_MAP[c]);

export class PackNudgeService {
    /** @type {Map<string, object>} */
    static #registry = new Map();

    /**
     * Register a module's nudge config.
     *
     * @param {object} config
     * @param {string} config.moduleId                                Owning module id.
     * @param {string} config.packUrl                                 Public URL for the pack download.
     * @param {() => boolean|Promise<boolean>} config.isContentInstalled
     *                                                                Returns true when content is present; banner stays hidden.
     * @param {() => (void|Promise<void>)} config.openInstaller       Primary "Install .zip" action.
     * @param {() => boolean} [config.isEnabled]                      Optional feature flag. Defaults to enabled.
     * @param {string} config.title                                   Banner heading.
     * @param {string} config.subtitle                                Banner secondary line.
     * @param {string} [config.icon]                                  FA icon class. Default "fas fa-box-open".
     * @param {string} [config.primaryLabel]                          Default "Install .zip".
     * @param {string} [config.primaryIcon]                           Default "fas fa-file-import".
     * @param {string} [config.secondaryLabel]                        Default "Get Pack".
     * @param {string} [config.secondaryIcon]                         Default "fas fa-download".
     * @param {number} [config.snoozeMs]                              Default 7 days.
     * @param {{suppressed?: string, snoozedUntil?: string}} [config.settings]
     *                                                                Override setting keys (for legacy compat).
     */
    static register(config) {
        if (!config?.moduleId) throw new Error("PackNudgeService.register: moduleId required");
        if (typeof config.isContentInstalled !== "function") {
            throw new Error(`PackNudgeService.register(${config.moduleId}): isContentInstalled is required`);
        }
        if (typeof config.openInstaller !== "function") {
            throw new Error(`PackNudgeService.register(${config.moduleId}): openInstaller is required`);
        }

        const settingsKeys = {
            suppressed: config.settings?.suppressed ?? "packNudgeSuppressed",
            snoozedUntil: config.settings?.snoozedUntil ?? "packNudgeSnoozedUntil"
        };

        this.#ensureSetting(config.moduleId, settingsKeys.suppressed, {
            scope: "world", config: false, type: Boolean, default: false
        });
        this.#ensureSetting(config.moduleId, settingsKeys.snoozedUntil, {
            scope: "world", config: false, type: String, default: ""
        });

        const stored = { ...config, _settingsKeys: settingsKeys };
        this.#registry.set(config.moduleId, stored);
        Logger.log("PackNudge", `Registered nudge for ${config.moduleId}`);
        return stored;
    }

    static #ensureSetting(moduleId, key, def) {
        if (game.settings?.settings?.has?.(`${moduleId}.${key}`)) return;
        try {
            game.settings.register(moduleId, key, def);
        } catch (e) {
            // Already registered by the consumer module during its own init.
        }
    }

    /** @returns {object|null} */
    static get(moduleId) {
        return this.#registry.get(moduleId) ?? null;
    }

    /** @returns {boolean} */
    static isRegistered(moduleId) {
        return this.#registry.has(moduleId);
    }

    /**
     * Whether the banner should currently show for `moduleId`.
     * @returns {Promise<boolean>}
     */
    static async shouldShow(moduleId) {
        const config = this.get(moduleId);
        if (!config) return false;
        if (!game.user?.isGM) return false;
        if (typeof config.isEnabled === "function") {
            try { if (!config.isEnabled()) return false; }
            catch (e) { Logger.warn("PackNudge", `${moduleId}.isEnabled threw`, e); return false; }
        }

        try {
            if (game.settings.get(config.moduleId, config._settingsKeys.suppressed)) return false;
            const snoozed = game.settings.get(config.moduleId, config._settingsKeys.snoozedUntil) || "";
            if (snoozed) {
                const d = new Date(snoozed);
                if (!isNaN(d.getTime()) && d > new Date()) return false;
            }
            const installed = await config.isContentInstalled();
            return !installed;
        } catch (e) {
            Logger.warn("PackNudge", `${moduleId}.shouldShow failed`, e);
            return false;
        }
    }

    /**
     * Build the banner element. Caller controls placement.
     *
     * Inline styles are used deliberately: Foundry's `.form-group button`
     * and `.window-content button` rules win the specificity war against
     * a plain stylesheet, which would collapse the layout (buttons go full-
     * width block, flex row breaks). Inline styles guarantee the elegant
     * card visual regardless of host context.
     *
     * @param {string} moduleId
     * @param {object} [opts]
     * @param {"compact"|"stacked"} [opts.layout]   Button orientation. Default "compact".
     * @param {boolean} [opts.showSuppress]         Render "Don't show again" checkbox. Default false.
     * @returns {jQuery|null}
     */
    static buildBanner(moduleId, opts = {}) {
        const config = this.get(moduleId);
        if (!config) return null;

        const layout = opts.layout === "stacked" ? "stacked" : "compact";
        const showSuppress = !!opts.showSuppress;

        const icon = config.icon || "fas fa-box-open";
        const primaryLabel = config.primaryLabel || "Install .zip";
        const primaryIcon = config.primaryIcon || "fas fa-file-import";
        const secondaryLabel = config.secondaryLabel || "Get Pack";
        const secondaryIcon = config.secondaryIcon || "fas fa-download";

        // Style fragments. Compact = action row sits to the right of text.
        // Stacked = action buttons stack vertically (for narrower in-app
        // contexts like the Calibration window).
        const wrapStyle = [
            "background: linear-gradient(135deg, rgba(88, 166, 255, 0.08), rgba(139, 92, 246, 0.08))",
            "border: 1px solid rgba(88, 166, 255, 0.25)",
            "border-radius: 8px",
            `padding: ${layout === "stacked" ? "14px 18px" : "12px 16px"}`,
            `margin: ${layout === "stacked" ? "0 0 16px" : "8px 0 12px"}`,
            "font-size: 13px",
            "box-sizing: border-box"
        ].join(";");

        const bodyStyle = "display: flex; align-items: center; gap: 12px;";
        const iconStyle = "font-size: 20px; color: #58a6ff; flex-shrink: 0; width: auto;";
        const textStyle = "flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px;";
        const titleStyle = "color: #c9d1d9;";
        const subtitleStyle = "color: #8b949e;";
        const actionsStyle = layout === "stacked"
            ? "display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; align-items: stretch;"
            : "display: flex; flex-direction: row; gap: 6px; flex-shrink: 0; align-items: center;";

        const btnBase = [
            "border-radius: 6px",
            "padding: 4px 10px",
            "cursor: pointer",
            "font-size: 12px",
            "line-height: 1.2",
            "display: inline-flex",
            "align-items: center",
            "gap: 6px",
            "justify-content: center",
            "white-space: nowrap",
            "width: auto"
        ].join(";");

        const secondaryBtnStyle = `${btnBase};background: rgba(88, 166, 255, 0.15);border: 1px solid rgba(88, 166, 255, 0.3);color: #58a6ff;`;
        const primaryBtnStyle = `${btnBase};background: rgba(139, 92, 246, 0.15);border: 1px solid rgba(139, 92, 246, 0.3);color: #a78bfa;`;
        const dismissBtnStyle = `${btnBase};background: transparent;border: 1px solid rgba(139, 148, 158, 0.2);color: #8b949e;padding: 4px 8px;`;

        const suppressStyle = "display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; color: #8b949e; cursor: pointer;";

        const $banner = $(`
            <div class="${DEDUPE_CLASS} ionrift-pack-nudge--${layout}" data-module-id="${_esc(config.moduleId)}" style="${wrapStyle}">
                <div class="ionrift-pack-nudge__body" style="${bodyStyle}">
                    <i class="${_esc(icon)} ionrift-pack-nudge__icon" aria-hidden="true" style="${iconStyle}"></i>
                    <div class="ionrift-pack-nudge__text" style="${textStyle}">
                        <strong class="ionrift-pack-nudge__title" style="${titleStyle}">${_esc(config.title)}</strong>
                        <span class="ionrift-pack-nudge__subtitle" style="${subtitleStyle}">${_esc(config.subtitle)}</span>
                    </div>
                    <div class="ionrift-pack-nudge__actions" style="${actionsStyle}">
                        <button type="button" class="ionrift-pack-nudge__btn ionrift-pack-nudge__btn--secondary" data-action="get" style="${secondaryBtnStyle}">
                            <i class="${_esc(secondaryIcon)}"></i> ${_esc(secondaryLabel)}
                        </button>
                        <button type="button" class="ionrift-pack-nudge__btn ionrift-pack-nudge__btn--primary" data-action="install" style="${primaryBtnStyle}">
                            <i class="${_esc(primaryIcon)}"></i> ${_esc(primaryLabel)}
                        </button>
                        <button type="button" class="ionrift-pack-nudge__btn ionrift-pack-nudge__btn--dismiss" data-action="dismiss" title="Dismiss for 7 days" style="${dismissBtnStyle}">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                ${showSuppress ? `
                    <label class="ionrift-pack-nudge__suppress" style="${suppressStyle}">
                        <input type="checkbox" data-role="suppress" style="margin: 0;" />
                        <span>Don't show again</span>
                    </label>
                ` : ""}
            </div>
        `);

        $banner.on("click", "[data-action='get']", () => {
            try { window.open(config.packUrl, "_blank"); }
            catch (e) { Logger.warn("PackNudge", `${moduleId}: failed to open packUrl`, e); }
        });
        $banner.on("click", "[data-action='install']", async () => {
            try { await config.openInstaller(); }
            catch (e) { Logger.error("PackNudge", `${moduleId}: openInstaller failed`, e); }
        });
        $banner.on("click", "[data-action='dismiss']", async () => {
            const suppress = !!$banner.find("[data-role='suppress']").prop("checked");
            await this.dismiss(moduleId, $banner, { suppress });
        });

        return $banner;
    }

    /**
     * Inject the banner into the DOM at `$anchor`.
     *
     * @param {string} moduleId
     * @param {jQuery|HTMLElement} anchor          Element or jQuery to anchor against.
     * @param {object} [opts]
     * @param {"before"|"after"|"prepend"|"append"} [opts.position]   Default "after".
     * @param {jQuery|HTMLElement} [opts.scope]    Scope for dedupe lookup. Defaults to anchor's enclosing app/body.
     * @param {"compact"|"stacked"} [opts.layout]
     * @param {boolean} [opts.showSuppress]
     * @returns {Promise<jQuery|null>}             The inserted banner, or null if not shown / already present.
     */
    static async inject(moduleId, anchor, opts = {}) {
        const $anchor = anchor?.jquery ? anchor : $(anchor);
        if (!$anchor?.length) return null;
        if (!(await this.shouldShow(moduleId))) return null;

        const $scope = opts.scope
            ? (opts.scope.jquery ? opts.scope : $(opts.scope))
            : ($anchor.closest(".application, .app, .window-app, body").first());
        if ($scope?.length && $scope.find(`.${DEDUPE_CLASS}[data-module-id="${moduleId}"]`).length) {
            return null;
        }

        const $banner = this.buildBanner(moduleId, opts);
        if (!$banner) return null;

        const position = opts.position ?? "after";
        switch (position) {
            case "before":  $anchor.before($banner);  break;
            case "prepend": $anchor.prepend($banner); break;
            case "append":  $anchor.append($banner);  break;
            case "after":
            default:        $anchor.after($banner);   break;
        }
        return $banner;
    }

    /**
     * Locate the Settings-panel anchor form-group for a registered module.
     * Tries (in order): consumer override -> `setupWizard` button -> `contentPacks`
     * button -> first module-scoped form-group.
     *
     * @param {string} moduleId
     * @param {jQuery} $html
     * @returns {{ $anchor: jQuery, position: "before"|"after"|"prepend"|"append" }|null}
     */
    static findSettingsAnchor(moduleId, $html) {
        const config = this.get(moduleId);
        if (!config || !$html?.length) return null;

        if (typeof config.findSettingsAnchor === "function") {
            try {
                const result = config.findSettingsAnchor($html);
                if (result?.$anchor?.length) return result;
                if (result?.length) return { $anchor: result, position: "after" };
            } catch (e) {
                Logger.warn("PackNudge", `${moduleId}.findSettingsAnchor threw`, e);
            }
        }

        const tryAnchor = (selector, position = "after") => {
            const $btn = $html.find(selector);
            if (!$btn.length) return null;
            const $group = $btn.closest(".form-group");
            if (!$group.length) return null;
            return { $anchor: $group, position };
        };

        return tryAnchor(`button[data-key="${moduleId}.patreonLibrary"]`)
            ?? tryAnchor(`button[data-key="${moduleId}.setupWizard"]`)
            ?? tryAnchor(`button[data-key="${moduleId}.contentPacks"]`)
            ?? this.#findFirstModuleFormGroup(moduleId, $html);
    }

    static #findFirstModuleFormGroup(moduleId, $html) {
        let $first = null;
        $html.find(".form-group").each((_, el) => {
            if ($first) return;
            const $el = $(el);
            const has = $el.find(`button[data-key^="${moduleId}."], [name^="${moduleId}."]`).length;
            if (has) $first = $el;
        });
        return $first?.length ? { $anchor: $first, position: "before" } : null;
    }

    /**
     * Inject every registered module's nudge into a Settings Config render.
     * Modules without an anchor (or whose `shouldShow` is false) are skipped.
     *
     * @param {HTMLElement|jQuery} html
     */
    static async injectAllInSettings(html) {
        const $html = html?.jquery ? html : $(html);
        if (!$html?.length) return;

        for (const moduleId of this.#registry.keys()) {
            try {
                const anchor = this.findSettingsAnchor(moduleId, $html);
                if (!anchor) continue;
                await this.inject(moduleId, anchor.$anchor, {
                    position: anchor.position,
                    scope: $html,
                    layout: "compact"
                });
            } catch (e) {
                Logger.warn("PackNudge", `${moduleId} settings inject failed`, e);
            }
        }
    }

    /**
     * Snooze (or suppress) the nudge for `moduleId` and remove the banner DOM.
     */
    static async dismiss(moduleId, banner, { suppress = false } = {}) {
        const config = this.get(moduleId);
        if (!config) return;
        try {
            if (suppress) {
                await game.settings.set(config.moduleId, config._settingsKeys.suppressed, true);
            } else {
                const snoozeMs = config.snoozeMs ?? DEFAULT_SNOOZE_MS;
                const until = new Date(Date.now() + snoozeMs).toISOString();
                await game.settings.set(config.moduleId, config._settingsKeys.snoozedUntil, until);
            }
        } catch (e) {
            Logger.warn("PackNudge", `${moduleId}.dismiss persist failed`, e);
        } finally {
            const $b = banner?.jquery ? banner : (banner ? $(banner) : null);
            $b?.remove?.();
        }
    }

    /** Clear snooze + suppress so the banner becomes eligible again. */
    static async reset(moduleId) {
        const config = this.get(moduleId);
        if (!config) return;
        await game.settings.set(config.moduleId, config._settingsKeys.suppressed, false);
        await game.settings.set(config.moduleId, config._settingsKeys.snoozedUntil, "");
    }
}
