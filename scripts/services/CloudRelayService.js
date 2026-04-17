/**
 * CloudRelayService
 * Authenticated relay for Ionrift Cloud. Handles Patreon OAuth connection,
 * Sigil (JWT) management, and tier-gated download requests.
 *
 * All cloud features (pack updates, module distribution) flow through this
 * service. The server always re-validates tier claims — client-side decoding
 * is for UI decisions only.
 */
export class CloudRelayService {

    static API_URL = "https://api.ionrift.cloud";
    static CLIENT_ID = "tc0M_ZBHMPeQUQh5UGuxf5rePVmv9c9Af0hoMeMYdbmDmxEb7d334xn51Fk-nhOy";

    // Lazy-loaded to avoid circular import at parse time
    static async _getDialogHelper() {
        const { DialogHelper } = await import("../DialogHelper.js");
        return DialogHelper;
    }

    // ── Sigil Access ─────────────────────────────────────────

    /**
     * Read the stored Sigil (JWT) from library settings.
     * @returns {string}
     */
    static getSigil() {
        try {
            return game.settings.get("ionrift-library", "sigil") || "";
        } catch {
            return "";
        }
    }

    /**
     * True if a Sigil is stored in settings.
     * @returns {boolean}
     */
    static isConnected() {
        return !!this.getSigil();
    }

    /**
     * Decode tier claim from the Sigil JWT payload.
     * @returns {string|null} e.g. "Acolyte", "Weaver", null
     */
    static getTierClaim() {
        const sigil = this.getSigil();
        if (!sigil) return null;
        try {
            const payload = JSON.parse(atob(sigil.split(".")[1]));
            return payload.tier?.trim() ?? null;
        } catch {
            return null;
        }
    }

    // ── OAuth Flow ───────────────────────────────────────────

    /**
     * Open Patreon OAuth popup and poll for handshake completion.
     * On success: stores Sigil in library settings and shows notification.
     */
    static async connect() {
        if (!game.user.isGM) {
            ui.notifications.warn("Only the GM can connect Patreon.");
            return;
        }

        const state = this._generateState();
        const redirectUri = `${this.API_URL}/auth/callback`;
        const authUrl = `https://www.patreon.com/oauth2/authorize`
            + `?client_id=${this.CLIENT_ID}`
            + `&redirect_uri=${encodeURIComponent(redirectUri)}`
            + `&state=${state}`
            + `&response_type=code`
            + `&scope=identity`;

        const popup = window.open(authUrl, "ionrift-patreon", "width=600,height=700");
        if (!popup) {
            // Popup blocked — provide a clickable fallback, but keep polling.
            ui.notifications.warn(
                `Popup blocked. <a href="${authUrl}" target="_blank">Click here to connect Patreon</a>.`,
                { permanent: true }
            );
        }

        ui.notifications.info("Waiting for Patreon authorization...");

        const result = await this._pollHandshake(state, 120000);
        if (!result) {
            ui.notifications.error("Patreon connection timed out. Please try again.");
            return;
        }

        await game.settings.set("ionrift-library", "sigil", result.token);
        const tier = this.getTierClaim() || "Free";
        console.log("CloudRelay | Sigil stored. Tier:", tier);

        // Branded single-button confirmation
        await new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.classList.add("ionrift-armor-modal-overlay");
            overlay.innerHTML = `
                <div class="ionrift-armor-modal">
                    <h3><i class="fas fa-check"></i> Patreon Connected</h3>
                    <p>Connected as <strong>${tier}</strong>.</p>
                    <p>Pack updates and early access content are now available.</p>
                    <div class="ionrift-armor-modal-buttons">
                        <button class="btn-armor-confirm"><i class="fas fa-check"></i> Done</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.querySelector(".btn-armor-confirm").addEventListener("click", () => {
                overlay.remove();
                resolve();
            });
        });
    }

    /**
     * Clear stored Sigil and disconnect.
     */
    static async disconnect() {
        if (!game.user.isGM) return;
        await game.settings.set("ionrift-library", "sigil", "");
        ui.notifications.info("Patreon disconnected.");
        console.log("CloudRelay | Sigil cleared.");
    }

    // ── Download Relay ───────────────────────────────────────

    /**
     * Request a presigned download URL for a pack or module.
     * @param {string} packId
     * @param {string} version
     * @returns {Promise<{url: string, expiresAt: string}|null>}
     */
    static async requestDownload(packId, version) {
        const sigil = this.getSigil();
        if (!sigil) {
            console.warn("CloudRelay | No Sigil — cannot request download.");
            return null;
        }

        try {
            const response = await fetch(`${this.API_URL}/packs/download`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${sigil}`
                },
                body: JSON.stringify({ packId, version })
            });

            if (!response.ok) {
                const msg = await response.text();
                console.warn(`CloudRelay | Download denied (${response.status}):`, msg);
                if (response.status === 401) {
                    ui.notifications.error(
                        "Patreon connection missing. Go to <strong>Ionrift Library → Patreon</strong> and connect your account.",
                        { permanent: true }
                    );
                } else if (response.status === 403) {
                    // Auth gate returns "Invalid authentication token" for expired/bad JWTs.
                    // Tier gate returns "Your subscription tier does not include this pack."
                    const isAuthFailure = msg.toLowerCase().includes("invalid authentication")
                        || msg.toLowerCase().includes("token");
                    if (isAuthFailure) {
                        ui.notifications.error(
                            "Your Patreon connection has expired. Go to <strong>Ionrift Library → Patreon</strong>, disconnect, and reconnect.",
                            { permanent: true }
                        );
                    } else {
                        ui.notifications.warn("Your subscription tier does not include this content.");
                    }
                } else if (response.status === 404) {
                    ui.notifications.warn(`Pack not found on the server. It may not be published yet.`);
                } else {
                    ui.notifications.error(`Download failed (HTTP ${response.status}). Try again later.`);
                }
                return null;
            }

            return await response.json();
        } catch (e) {
            console.error("CloudRelay | Download request failed:", e);
            return null;
        }
    }

    // ── Internal ─────────────────────────────────────────────

    /**
     * Generate a random state string for OAuth.
     * @returns {string}
     */
    static _generateState() {
        const array = new Uint8Array(24);
        crypto.getRandomValues(array);
        return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
    }

    /**
     * Poll the handshake endpoint until success or timeout.
     * @param {string} state
     * @param {number} [maxMs=60000]
     * @returns {Promise<{token: string, user: Object}|null>}
     */
    static async _pollHandshake(state, maxMs = 60000) {
        const interval = 2000;
        const deadline = Date.now() + maxMs;

        while (Date.now() < deadline) {
            try {
                const res = await fetch(`${this.API_URL}/auth/poll?state=${state}`);
                if (res.status === 200) {
                    const data = await res.json();
                    if (data.status === "success") return data;
                }
            } catch {
                // Transient network error — keep polling
            }
            await new Promise(r => setTimeout(r, interval));
        }
        return null;
    }
}
