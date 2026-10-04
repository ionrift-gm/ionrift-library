import { HudHelper } from "./HudHelper.js";

/**
 * Legacy wrapper for directory button injection.
 * Delegates to HudHelper.injectDirectoryButton to ensure backwards compatibility
 * while guaranteeing modern Obsidian Glass styling and single-toolbar layout.
 */
export class SidebarHelper {
    /**
     * Injects a button into a Sidebar Directory toolbar.
     * @param {string} sidebarId - "actors", "items", "journal", etc.
     * @param {jQuery|HTMLElement} html - The rendered HTML from the hook.
     * @param {Object} options - Button config.
     * @param {string} options.id - Unique ID to prevent duplication (e.g. "my-btn").
     * @param {string} options.label - Text label.
     * @param {string} options.icon - FontAwesome icon class.
     * @param {Function} options.onClick - Click handler.
     * @param {boolean} [options.restricted=true] - GM only unless explicitly set to false.
     * @param {string} [options.className] - Additional classes.
     * @param {number} [options.order=50] - Weight.
     */
    static injectButton(sidebarId, html, options = {}) {
        return HudHelper.injectDirectoryButton(sidebarId, html, {
            ...options,
            restricted: options.restricted ?? true
        });
    }
}
