import { Logger } from "./Logger.js";
import { isPreparedMediaCloudDenied } from "../constants/PreparedMediaCloudDenyList.js";

/**
 * CloudRelayService
 * Authenticated relay for Ionrift Cloud. Handles Patreon OAuth connection,
 * Sigil (JWT) management, and tier-gated download requests.
 *
 * All cloud features (pack updates, module distribution) flow through this
 * service. The server always re-validates tier claims — client-side decoding
 * is for UI decisions only.
 */

const MODULE_LABEL = "CloudRelay";

export class CloudRelayService {

    static API_URL = "https://api.ionrift.cloud";
    static CLIENT_ID = "tc0M_ZBHMPeQUQh5UGuxf5rePVmv9c9Af0hoMeMYdbmDmxEb7d334xn51Fk-nhOy";

    /** Window before expiry that triggers the proactive warning. */
    static EXPIRY_WARN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

    /** Snooze duration applied after the GM dismisses a "soon" warning. */
    static EXPIRY_SNOOZE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

    /** Snooze duration after an "already expired" warning. Shorter — still actionable. */
    static EXPIRY_SNOOZE_EXPIRED_MS = 24 * 60 * 60 * 1000;

    /** Shared user-facing copy for an expired connection. */
    static EXPIRED_COPY = "Your Patreon connection has expired. Go to <strong>Ionrift Library</strong>, disconnect, and reconnect.";

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
     * Decode the full JWT payload. Returns an empty object on any failure so
     * callers can safely destructure.
     * @returns {object}
     */
    static getSigilClaims() {
        const sigil = this.getSigil();
        if (!sigil) return {};
        try {
            const segment = sigil.split(".")[1];
            if (!segment) return {};
            return JSON.parse(atob(segment)) ?? {};
        } catch {
            return {};
        }
    }

    /**
     * Decode tier claim from the Sigil JWT payload.
     * @returns {string|null} e.g. "Acolyte", "Weaver", null
     */
    static getTierClaim() {
        const tier = this.getSigilClaims().tier;
        return typeof tier === "string" ? (tier.trim() || null) : null;
    }

    /**
     * Inspect the local Sigil's `exp` claim. Pure client-side; never contacts
     * the server. The server is the source of truth — this exists so the UI
     * can warn before a stale token causes a 401.
     *
     * @returns {{
     *   hasExpiry: boolean,
     *   expiresAt: Date|null,
     *   secondsRemaining: number|null,
     *   expired: boolean,
     *   expiringSoon: boolean
     * }}
     */
    static getExpiryStatus() {
        const { exp } = this.getSigilClaims();
        if (typeof exp !== "number" || !Number.isFinite(exp)) {
            return {
                hasExpiry: false,
                expiresAt: null,
                secondsRemaining: null,
                expired: false,
                expiringSoon: false
            };
        }

        const expiresAt = new Date(exp * 1000);
        const msRemaining = expiresAt.getTime() - Date.now();
        return {
            hasExpiry: true,
            expiresAt,
            secondsRemaining: Math.floor(msRemaining / 1000),
            expired: msRemaining <= 0,
            expiringSoon: msRemaining > 0 && msRemaining <= this.EXPIRY_WARN_WINDOW_MS
        };
    }

    /**
     * True when a Sigil is stored AND has not expired locally. Use for "can
     * this call succeed?" gates. Use `isConnected()` for "should the menu
     * offer Connect vs Disconnect?".
     *
     * Tokens without an `exp` claim are treated as authenticated so older
     * Sigils continue to work until the server rejects them.
     *
     * @returns {boolean}
     */
    static isAuthenticated() {
        if (!this.isConnected()) return false;
        const status = this.getExpiryStatus();
        if (!status.hasExpiry) return true;
        return !status.expired;
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
        this.clearExpirySnooze();
        const tier = this.getTierClaim() || "Free";
        Logger.log(MODULE_LABEL, "Sigil stored. Tier:", tier);

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
        this.clearExpirySnooze();
        ui.notifications.info("Patreon disconnected.");
        Logger.log(MODULE_LABEL, "Sigil cleared.");
    }

    // ── Download Relay ───────────────────────────────────────

    /**
     * Request a presigned download URL for a pack or module.
     * @param {string} packId
     * @param {string} version
     * @param {{ silent?: boolean }} [options]  When true, log only; no Foundry toast.
     * @returns {Promise<{url?: string, expiresAt?: string, status?: number, error?: string}|null>}
     */
    static async requestDownload(packId, version, options = {}) {
        const { silent = false } = options;
        const label = `${packId} v${version}`;

        if (isPreparedMediaCloudDenied(packId)) {
            const msg = "This content pack installs from a downloaded zip (Patreon Library → Import zip), not one-click cloud Install.";
            Logger.warn(MODULE_LABEL, `Cloud download blocked for deny-listed pack ${label}.`);
            if (!silent) {
                ui.notifications?.warn(msg);
            }
            return { status: 403, error: msg };
        }

        const sigil = this.getSigil();
        if (!sigil) {
            Logger.warn(MODULE_LABEL, `No Sigil — cannot request download for ${label}.`);
            return { status: 401, error: "Not connected to Patreon" };
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
                Logger.warn(MODULE_LABEL, `Download denied (${response.status}) for ${label}:`, msg);
                if (!silent) {
                    this._notifyDownloadFailure(response.status, msg, packId, version);
                }
                return { status: response.status, error: msg || `HTTP ${response.status}` };
            }

            return await response.json();
        } catch (e) {
            Logger.error(MODULE_LABEL, `Download request failed for ${label}:`, e);
            if (!silent) {
                ui.notifications.error(`Download failed for ${packId} (${version}). Try again later.`);
            }
            return { status: 0, error: e?.message ?? "Network error" };
        }
    }

    // ── Support bug reports ────────────────────────────────────

    /**
     * @param {{ context: string, summary?: string, byteLength: number }} payload
     * @returns {Promise<{ ok: boolean, reportId?: string, reference?: string, error?: string }>}
     */
    static async initSupportReport(payload) {
        const sigil = this.getSigil();
        if (!sigil) return { ok: false, error: "Not connected to Patreon" };

        const { context, summary, byteLength } = payload ?? {};
        if (!context || !byteLength) {
            return { ok: false, error: "Missing report init fields" };
        }

        try {
            const response = await fetch(`${this.API_URL}/support/report-init`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${sigil}`,
                },
                body: JSON.stringify({ context, summary, byteLength }),
            });

            if (!response.ok) {
                const msg = this._sanitizeCloudError(await response.text());
                if (response.status === 429) {
                    return { ok: false, error: "Daily report limit reached. Try again tomorrow or use Discord." };
                }
                if (response.status === 401) {
                    return { ok: false, error: this.isConnected() ? this.EXPIRED_COPY : "Not connected to Patreon" };
                }
                return { ok: false, error: msg || `HTTP ${response.status}` };
            }

            const data = await response.json();
            return {
                ok: true,
                reportId:  data.reportId,
                reference: data.reference,
            };
        } catch (err) {
            Logger.error(MODULE_LABEL, "Support report init failed:", err);
            return { ok: false, error: err?.message ?? "Network error" };
        }
    }

    /**
     * Upload report JSON through middleware (no direct GCS access).
     * @param {string} reportId
     * @param {string|object} reportJson
     * @returns {Promise<{ ok: boolean, reference?: string, reportId?: string, error?: string }>}
     */
    static async uploadSupportReport(reportId, reportJson) {
        const sigil = this.getSigil();
        if (!sigil || !reportId || reportJson == null) {
            return { ok: false, error: "Missing report data" };
        }

        let report;
        try {
            report = typeof reportJson === "string" ? JSON.parse(reportJson) : reportJson;
        } catch {
            return { ok: false, error: "Invalid report payload" };
        }

        try {
            const response = await fetch(`${this.API_URL}/support/report-upload`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${sigil}`,
                },
                body: JSON.stringify({ reportId, report }),
            });

            if (!response.ok) {
                const msg = this._sanitizeCloudError(await response.text());
                if (response.status === 401) {
                    return { ok: false, error: this.isConnected() ? this.EXPIRED_COPY : "Not connected to Patreon" };
                }
                if (response.status === 403) {
                    return { ok: false, error: msg || "Report session expired. Try again." };
                }
                return { ok: false, error: msg || `Upload failed (${response.status})` };
            }

            const data = await response.json();
            return {
                ok: true,
                reportId: data.reportId ?? reportId,
                reference: data.reference,
            };
        } catch (err) {
            Logger.error(MODULE_LABEL, "Support report upload failed:", err);
            return { ok: false, error: err?.message ?? "Network error" };
        }
    }

    /**
     * @param {string} reportId
     * @returns {Promise<{ ok: boolean, reference?: string, error?: string }>}
     */
    static async completeSupportReport(reportId) {
        const sigil = this.getSigil();
        if (!sigil || !reportId) return { ok: false, error: "Missing report id" };

        try {
            const response = await fetch(`${this.API_URL}/support/report-complete`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${sigil}`,
                },
                body: JSON.stringify({ reportId }),
            });
            if (!response.ok) {
                const msg = await response.text();
                return { ok: false, error: msg || `HTTP ${response.status}` };
            }
            const data = await response.json();
            return { ok: true, reference: data.reference };
        } catch (err) {
            return { ok: false, error: err?.message ?? "Network error" };
        }
    }

    /**
     * Strip infrastructure URLs from server error text before showing to the client.
     * @param {string} msg
     * @returns {string}
     * @private
     */
    static _sanitizeCloudError(msg) {
        const text = String(msg ?? "").trim();
        if (!text) return "";
        return text
            .replace(/https?:\/\/storage\.googleapis\.com[^\s]*/gi, "[storage]")
            .replace(/https?:\/\/[^\s]*\.googleapis\.com[^\s]*/gi, "[storage]");
    }

    /**
     * Heuristic for "this auth failure is because the JWT is stale, not
     * because the request was unauthenticated". Server returns 401 with a
     * body like "Invalid authentication token: jwt expired" for stale tokens.
     *
     * @param {string} msg  Response body text
     * @returns {boolean}
     * @private
     */
    static _isExpiredAuthBody(msg) {
        const text = (msg ?? "").toLowerCase();
        if (!text) return false;
        if (text.includes("jwt expired")) return true;
        if (text.includes("token expired")) return true;
        if (text.includes("expired") && text.includes("token")) return true;
        return false;
    }

    /**
     * @param {number} status
     * @param {string} msg
     * @param {string} packId
     * @param {string} version
     * @private
     */
    static _notifyDownloadFailure(status, msg, packId, version) {
        const named = `<strong>${packId}</strong> (${version})`;
        if (status === 401) {
            // A stale Sigil also presents as 401; route those to the "expired"
            // copy so the GM disconnects + reconnects rather than trying to
            // connect a connection they already have.
            if (this.isConnected() || this._isExpiredAuthBody(msg)) {
                ui.notifications.error(this.EXPIRED_COPY, { permanent: true });
            } else {
                ui.notifications.error(
                    `Patreon connection missing. Connect in <strong>Ionrift Library</strong> before downloading ${named}.`,
                    { permanent: true }
                );
            }
            return;
        }
        if (status === 403) {
            const isAuthFailure = msg.toLowerCase().includes("invalid authentication")
                || this._isExpiredAuthBody(msg);
            if (isAuthFailure) {
                ui.notifications.error(this.EXPIRED_COPY, { permanent: true });
            } else {
                ui.notifications.warn(`Your subscription tier does not include ${named}.`);
            }
            return;
        }
        if (status === 404) {
            ui.notifications.warn(
                `Could not download ${named}. The server has no file for that pack yet. Details are in the Patreon Library panel.`
            );
            return;
        }
        ui.notifications.error(`Download failed for ${named} (HTTP ${status}). Try again from Patreon Library.`);
    }

    // ── Expiry Warning ───────────────────────────────────────

    /**
     * GM-only proactive check. If the stored Sigil has expired or expires
     * within the warning window, show a notification once and snooze it.
     * Silent in all other cases.
     *
     * Pure local check. Never calls the server. Safe to invoke on `ready`.
     *
     * @param {object} [options]
     * @param {boolean} [options.force=false]  Skip the snooze gate.
     * @returns {{ shown: "expired"|"soon"|"none", snoozed: boolean }}
     */
    static warnIfExpiringSoon({ force = false } = {}) {
        try {
            if (!game?.user?.isGM) return { shown: "none", snoozed: false };
            if (!this._expiryWarningsEnabled()) return { shown: "none", snoozed: false };
            if (!this.isConnected()) return { shown: "none", snoozed: false };

            const status = this.getExpiryStatus();
            if (!status.hasExpiry) return { shown: "none", snoozed: false };
            if (!status.expired && !status.expiringSoon) return { shown: "none", snoozed: false };

            if (!force && this._isExpirySnoozed()) {
                return { shown: "none", snoozed: true };
            }

            if (status.expired) {
                ui.notifications.error(this.EXPIRED_COPY, { permanent: true });
                this._snoozeExpiryWarning(this.EXPIRY_SNOOZE_EXPIRED_MS);
                return { shown: "expired", snoozed: false };
            }

            const days = Math.max(1, Math.ceil(status.secondsRemaining / 86400));
            ui.notifications.warn(
                `Patreon connection expires in ${days} day${days === 1 ? "" : "s"}. `
                + `Reconnect in <strong>Ionrift Library</strong> to keep automatic pack updates.`,
                { permanent: true }
            );
            this._snoozeExpiryWarning(this.EXPIRY_SNOOZE_SOON_MS);
            return { shown: "soon", snoozed: false };
        } catch (e) {
            Logger.warn(MODULE_LABEL, "warnIfExpiringSoon failed:", e);
            return { shown: "none", snoozed: false };
        }
    }

    /** @private */
    static _expiryWarningsEnabled() {
        try {
            const value = game.settings.get("ionrift-library", "expiryWarnings");
            return value !== false;
        } catch {
            return true;
        }
    }

    /** @private */
    static _isExpirySnoozed() {
        try {
            const until = Number(game.settings.get("ionrift-library", "expiryWarningSnooze")) || 0;
            return until > Date.now();
        } catch {
            return false;
        }
    }

    /**
     * @param {number} durationMs
     * @private
     */
    static _snoozeExpiryWarning(durationMs) {
        try {
            game.settings.set("ionrift-library", "expiryWarningSnooze", Date.now() + durationMs);
        } catch (e) {
            Logger.warn(MODULE_LABEL, "Failed to record expiry snooze:", e);
        }
    }

    /**
     * Clear the snooze so the next reload re-evaluates. Called after a
     * successful reconnect.
     */
    static clearExpirySnooze() {
        try {
            game.settings.set("ionrift-library", "expiryWarningSnooze", 0);
        } catch {
            /* settings not ready */
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
