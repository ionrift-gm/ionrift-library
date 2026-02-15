/**
 * A helper class for managing status icons in the Foundry VTT Settings Config window.
 * used to provide immediate visual feedback (Green/Yellow/Red) without full re-renders.
 */
export class SettingsStatusHelper {

    /**
     * Updates the status icon for a specific module's Setup button.
     * Uses a global selector strategy to find the button regardless of window state.
     * 
     * @param {string} buttonKey - The data-key or data-action of the button (e.g. "ionrift-sounds.setupGuide")
     * @param {boolean} hasToken - Whether the auth token exists
     * @param {boolean} isVerified - Whether the token is verified
     */
    static update(buttonKey, hasToken, isVerified) {
        console.log(`Ionrift Lib | Updating Status Icon for: ${buttonKey} (Token: ${hasToken}, Verified: ${isVerified})`);

        // Global Selector: Find button anywhere in DOM
        let globalButton = $(`button[data-key="${buttonKey}"]`);
        if (globalButton.length === 0) globalButton = $(`button[data-action="${buttonKey}"]`);

        if (globalButton.length > 0) {
            globalButton.each((index, btn) => {
                const button = $(btn);
                const buttonDiv = button.closest('.form-group');
                const label = buttonDiv.find('label');

                // Remove existing
                label.find('.fa-check-circle, .fa-exclamation-circle, .fa-exclamation-triangle').remove();

                // Determine Icon
                let icon = '';
                if (hasToken) {
                    if (isVerified) {
                        icon = `<i class="fas fa-check-circle" style="color: #4ff; margin-left: 8px;" title="Connected & Verified"></i>`;
                    } else {
                        icon = `<i class="fas fa-exclamation-triangle" style="color: #facc15; margin-left: 8px;" title="Token Saved (Unverified)"></i>`;
                    }
                } else {
                    icon = `<i class="fas fa-exclamation-circle" style="color: #ef4444; margin-left: 8px;" title="Token Missing"></i>`;
                }

                label.append(icon);
            });
            console.log(`Ionrift Lib | Icon updated successfully.`);
        } else {
            console.warn(`Ionrift Lib | Could not find Settings Setup button: ${buttonKey}`);
        }
    }
}
