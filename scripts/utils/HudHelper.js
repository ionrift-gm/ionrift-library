import { Logger } from "../services/platform/Logger.js";

/**
 * Standardized Entry Point & HUD Registrar for all Ionrift modules.
 * Ensures consistent DOM placement, Obsidian Glass styling, deterministic
 * scene control ordering, and Foundry v12 / v13 dual compatibility.
 */
export class HudHelper {

    /**
     * Injects a button into an Ionrift Sidebar Directory toolbar.
     * Enforces placement in a single `.ionrift-directory-toolbar` immediately
     * below `.header-actions`, sharing the space with other Ionrift modules.
     *
     * @param {string} sidebarId - "actors", "items", "playlists", "scenes", etc.
     * @param {jQuery|HTMLElement} html - The rendered HTML from the directory hook.
     * @param {Object} options - Button configuration.
     * @param {string} options.id - Unique ID (e.g. "civic-architect", "missing-art").
     * @param {string} options.label - Button text label.
     * @param {string} options.icon - FontAwesome icon class (e.g. "fas fa-city").
     * @param {Function} options.onClick - Click handler callback.
     * @param {boolean} [options.restricted=true] - Only visible to GM.
     * @param {string} [options.title] - Tooltip title attribute.
     * @param {string} [options.className] - Additional CSS classes.
     * @param {boolean} [options.compact=false] - Icon-only square button.
     * @param {number} [options.order=50] - Toolbar position weight.
     * @returns {HTMLElement|null} The created button element, or null if ignored.
     */
    static injectDirectoryButton(sidebarId, html, options = {}) {
        if (options.restricted !== false && !game.user?.isGM) return null;

        const root = html instanceof HTMLElement ? html : (html?.[0] ?? html);
        if (!root) return null;

        const id = options.id;
        const btnClass = `ionrift-btn-${id}`;

        // Deduplication
        if (root.querySelector(`.${btnClass}`)) return null;

        // Locate or create .ionrift-directory-toolbar inside directory header
        const header = root.querySelector(".directory-header") || root;
        const actions = header.querySelector(".header-actions, .action-buttons");

        let toolbar = header.querySelector(".ionrift-directory-toolbar");
        if (!toolbar) {
            toolbar = document.createElement("div");
            toolbar.className = "ionrift-directory-toolbar";
            if (actions && actions.parentNode) {
                actions.after(toolbar);
            } else if (header.firstChild) {
                header.insertBefore(toolbar, header.firstChild);
            } else {
                header.appendChild(toolbar);
            }
        }

        if (toolbar.querySelector(`.${btnClass}`)) return null;

        // Build Button Element
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `ionrift-directory-btn ${btnClass} ${options.className || ""}`.trim();
        if (options.compact) btn.classList.add("is-compact");
        if (options.title) btn.title = options.title;
        btn.dataset.order = String(options.order ?? 50);

        const iconHtml = options.icon ? `<i class="${options.icon}" aria-hidden="true"></i>` : "";
        const labelHtml = options.compact
            ? ""
            : `<span class="ionrift-dir-text">${options.label || ""}</span>`;
        btn.innerHTML = `${iconHtml}${labelHtml}`;

        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            options.onClick?.(ev);
        });

        // Insert respecting order weight
        const existingButtons = Array.from(toolbar.querySelectorAll(".ionrift-directory-btn"));
        const targetOrder = options.order ?? 50;
        let inserted = false;
        for (const existing of existingButtons) {
            const existingOrder = parseInt(existing.dataset.order || "50", 10);
            if (targetOrder < existingOrder) {
                toolbar.insertBefore(btn, existing);
                inserted = true;
                break;
            }
        }
        if (!inserted) toolbar.appendChild(btn);

        Logger.log("Library", `HudHelper: Injected ${id} into .ionrift-directory-toolbar for ${sidebarId}`);
        return btn;
    }

    /**
     * Registers a scene control tool with dual Foundry v12 and v13+ compatibility,
     * deterministic ordering, and GM security checks.
     *
     * @param {Array|Object} controls - The controls object/array from getSceneControlButtons.
     * @param {Object} toolConfig - Tool configuration.
     * @param {string} [toolConfig.group="tokens"] - Target group ("tokens", "walls", "sounds", "regions", "drawings").
     * @param {string} toolConfig.name - Tool unique identifier.
     * @param {string} toolConfig.title - Tooltip / title (free of developer jargon).
     * @param {string} toolConfig.icon - FontAwesome icon class.
     * @param {Function} toolConfig.onClick - Click handler callback.
     * @param {number} [toolConfig.order=50] - Tool position ordering weight.
     * @param {boolean} [toolConfig.button=true] - Whether tool behaves as a push-button.
     * @param {boolean} [toolConfig.visible=true] - Visibility toggle.
     * @param {boolean} [toolConfig.gmOnly=true] - Restricted to GM users.
     */
    static registerSceneControl(controls, toolConfig) {
        if (!controls) return;
        if (toolConfig.gmOnly !== false && !game.user?.isGM) return;

        const isV13 = !Array.isArray(controls);
        const rawGroup = toolConfig.group || "tokens";

        // Group name normalization (v12 uses 'token', v13 uses 'tokens')
        let targetGroup = rawGroup;
        if (rawGroup === "token" || rawGroup === "tokens") {
            targetGroup = isV13 ? "tokens" : "token";
        }

        const group = isV13
            ? (controls[targetGroup] || (targetGroup === "tokens" ? controls.token : controls[targetGroup]))
            : controls.find(c => c.name === targetGroup || (targetGroup === "token" && c.name === "tokens"));

        if (!group) return;

        const tool = {
            name: toolConfig.name,
            title: toolConfig.title,
            icon: toolConfig.icon,
            button: toolConfig.button ?? true,
            visible: toolConfig.visible ?? true,
            order: toolConfig.order ?? 50
        };

        if (toolConfig.toggle) tool.toggle = true;
        if (toolConfig.active !== undefined) tool.active = toolConfig.active;

        if (isV13) {
            // v13 object map pattern
            tool.onChange = (event, active) => {
                toolConfig.onClick?.(event, active);
                toolConfig.onChange?.(event, active);
            };
            if (!group.tools) group.tools = {};
            group.tools[tool.name] = tool;
        } else {
            // v12 array pattern
            tool.onClick = (event) => toolConfig.onClick?.(event);
            if (!Array.isArray(group.tools)) group.tools = [];
            
            // Check if already registered
            const existingIndex = group.tools.findIndex(t => t.name === tool.name);
            if (existingIndex >= 0) {
                group.tools[existingIndex] = tool;
            } else {
                group.tools.push(tool);
            }
            // Sort tools deterministically by order
            group.tools.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
        }
    }

    /**
     * Injects a button into the Token HUD or Drawing HUD with normalized
     * DOM handling and standard Ionrift HUD classes.
     *
     * @param {jQuery|HTMLElement} html - The rendered HUD root.
     * @param {Object} buttonConfig - Button configuration.
     * @param {string} buttonConfig.id - Action identifier (data-action).
     * @param {string} buttonConfig.icon - FontAwesome icon class.
     * @param {string} [buttonConfig.column="left"] - Target column: "left" or "right".
     * @param {string} [buttonConfig.tooltip] - Localized tooltip text.
     * @param {string} [buttonConfig.className] - Additional CSS class names.
     * @param {Function} buttonConfig.onClick - Click handler callback.
     * @param {boolean} [buttonConfig.restricted=true] - Restricted to GM.
     * @returns {HTMLElement|null} The created button element.
     */
    static injectTokenHudButton(html, buttonConfig) {
        if (buttonConfig.restricted !== false && !game.user?.isGM) return null;

        const root = html instanceof HTMLElement ? html : (html?.[0] ?? html);
        if (!root) return null;

        const colSelector = buttonConfig.column === "right"
            ? "div.col.right, .col.right, .right"
            : "div.col.left, .col.left, .left";

        const col = root.querySelector(colSelector) || root.querySelector(".col.left, .col.right");
        if (!col) return null;

        // Deduplication
        const idClass = `ionrift-hud-${buttonConfig.id}`;
        if (col.querySelector(`.${idClass}`)) return null;

        const btn = document.createElement("div");
        btn.className = `control-icon ionrift-hud-btn ${idClass} ${buttonConfig.className || ""}`.trim();
        if (buttonConfig.id) btn.dataset.action = buttonConfig.id;
        if (buttonConfig.tooltip) {
            btn.setAttribute("data-tooltip", buttonConfig.tooltip);
        } else if (buttonConfig.title) {
            btn.title = buttonConfig.title;
        }

        btn.innerHTML = `<i class="${buttonConfig.icon}"></i>`;

        btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            buttonConfig.onClick?.(ev, btn);
        });

        col.appendChild(btn);
        return btn;
    }
}
