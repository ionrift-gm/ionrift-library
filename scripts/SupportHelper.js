/**
 * Registers a "Get Support" menu button that opens the Ionrift Discord.
 * Can be called by any module during init.
 */
const DISCORD_INVITE = "https://discord.gg/YmgdNNu4";

export class SupportHelper {
    /**
     * Registers a "Join Discord" settings menu button for the given module.
     * @param {string} moduleId - The module ID (e.g. "ionrift-resonance")
     */
    static register(moduleId) {
        game.settings.registerMenu(moduleId, "supportLink", {
            name: "Get Support",
            label: "Join Discord",
            hint: "Bug reports, questions, and feature requests.",
            icon: "fab fa-discord",
            type: class extends FormApplication {
                render() {
                    window.open(DISCORD_INVITE, "_blank");
                    return this;
                }
            },
            restricted: false
        });
    }

    /** Returns the current Discord invite URL. */
    static get url() {
        return DISCORD_INVITE;
    }
}
