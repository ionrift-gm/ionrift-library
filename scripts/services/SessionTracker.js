export class SessionTracker {

    static get sessionLog() {
        return game.settings.get("ionrift-library", "sessionLog") || [];
    }

    static getSessionCount() {
        return this.sessionLog.length;
    }

    static getLastSession() {
        const log = this.sessionLog;
        if (!log || log.length === 0) return null;
        return log[log.length - 1];
    }

    /**
     * Helper for fairness engines: how many sessions have passed since the given timestamp
     */
    static getSessionsSince(timestampMs) {
        const log = this.sessionLog;
        if (!log || !log.length) return 0;
        
        // Count how many entries in the log have a timestamp >= the given timestamp
        let count = 0;
        for (const session of log) {
            if (session.timestamp >= timestampMs) {
                count++;
            }
        }
        return count;
    }

    /**
     * Explicit trigger logic. GM only.
     */
    static async recordSession(playerIds = []) {
        if (!game.user.isGM) return null;

        const log = this.sessionLog;
        const newSession = {
            id: foundry.utils.randomID(),
            number: log.length + 1,
            timestamp: Date.now(),
            players: playerIds
        };

        log.push(newSession);
        await game.settings.set("ionrift-library", "sessionLog", log);
        
        ui.notifications.info(`Ionrift: Game Session #${newSession.number} recorded.`);
        return newSession;
    }

    /**
     * Boot logic: run on "ready" for the GM. Waits for users to connect.
     */
    static init() {
        // Only run the detection heuristic on a GM client
        if (!game.user.isGM) return;

        // Register setting if not done elsewhere
        // But main.js usually registers it. We assume main.js registers 'sessionLog'.

        this._checkHeuristic();

        // Also check if users connect during the session (in case the GM was alone on ready)
        Hooks.on("userConnected", (user, connected) => {
            if (connected) {
                this._checkHeuristic();
            }
        });
    }

    static _hasPromptedThisLoad = false;

    static _checkHeuristic() {
        if (this._hasPromptedThisLoad) return;

        // Count connected non-GM users (players)
        const connectedPlayers = game.users.filter(u => u.active && !u.isGM);

        if (connectedPlayers.length >= 2) {
            // Heuristic met: 2 or more active players + GM
            const lastSession = this.getLastSession();
            
            let timeSinceLastMs = Infinity;
            if (lastSession) {
                timeSinceLastMs = Date.now() - lastSession.timestamp;
            }

            const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

            if (timeSinceLastMs > TWENTY_FOUR_HOURS_MS) {
                // Prompt GM
                this._promptGMRecording(connectedPlayers.map(u => u.id));
            }
        }
    }

    static _promptGMRecording(playerIds) {
        this._hasPromptedThisLoad = true;

        new Dialog({
            title: "New Game Session Detected",
            content: `
                <div style="margin-bottom: 15px; font-family: var(--ionrift-font, inherit);">
                    <p style="margin-bottom: 10px;">Multiple players have joined and it has been more than 24 hours since your last recorded session.</p>
                    <p style="color: var(--color-text-light-5); font-style: italic; font-size: 0.9em;">Ionrift modules (like Quartermaster and Respite) use this to pace milestone rewards and calculate rest frequencies.</p>
                    <h3 style="margin: 10px 0 5px 0;">Record as Session #${this.getSessionCount() + 1}?</h3>
                </div>
            `,
            buttons: {
                yes: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Yes, start session",
                    callback: () => this.recordSession(playerIds)
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "No, just prep/testing"
                }
            },
            default: "yes"
        }, { classes: ["ionrift-window", "glass-ui"] }).render(true);
    }
}
