export class SidebarHelper {
    /**
     * Injects a button into a Sidebar Directory header.
     * @param {string} sidebarId - "actors", "items", "journal", etc.
     * @param {jQuery} html - The rendered HTML from the hook.
     * @param {Object} options - Button config.
     * @param {string} options.id - Unique ID to prevent duplication (e.g. "my-btn").
     * @param {string} options.label - Text label.
     * @param {string} options.icon - FontAwesome icon class.
     * @param {Function} options.onClick - Click handler.
     * @param {boolean} [options.restricted=false] - If true, only shows for GM.
     */
    static injectButton(sidebarId, html, options) {
        if (options.restricted && !game.user.isGM) return;

        // Verify we are on the right tab
        // Note: The hook usually gives us the specific app, so the caller should check app.id or app.tabName before calling this globally,
        // OR we trust the caller to call this inside `renderActorDirectory` etc.

        // Normalize jQuery
        const $html = html instanceof $ ? html : $(html);

        // Deduplication
        const btnClass = `ionrift-btn-${options.id}`;
        if ($html.find(`.${btnClass}`).length > 0) return;

        // Create Button
        const btn = $(`<button class="${btnClass}"><i class="${options.icon}"></i> ${options.label}</button>`);
        btn.click((ev) => {
            ev.preventDefault();
            options.onClick(ev);
        });

        console.log(`Ionrift Lib | SidebarHelper: Attempting to inject button for ${options.id}`);

        // Logic to locate and inject the button
        const findAndInject = () => {
            if ($html.find(`.${btnClass}`).length > 0) return;

            let actionsBlock = $html.find(".header-actions");

            // Foundry V11+ Sidebar Structure:
            // Append to .header-actions if it exists to ensure inline alignment with other action buttons.
            if (actionsBlock.length > 0) {
                // Append inside .header-actions to join the flex row.
                actionsBlock.append(btn);

                // Prevent adding custom CSS to ensure consistency with standard Foundry buttons
                // and other module buttons sharing this space.

                console.log(`Ionrift Lib | SidebarHelper: Injected ${options.id} INTO .header-actions`);
            } else {
                // Fallback: Append to directory header if actions block is missing.
                const header = $html.find(".directory-header");
                if (header.length > 0) {
                    header.append(btn);
                    // Apply fallback styles to prevent full-width expansion if it's a direct child of header.
                    btn.css({
                        "width": "calc(100% - 16px)",
                        "margin": "0 8px 8px 8px"
                    });
                }
            }
        };

        // Execution
        findAndInject();
        setTimeout(findAndInject, 100);
    }
}
