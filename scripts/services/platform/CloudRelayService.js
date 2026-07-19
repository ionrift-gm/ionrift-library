/** Retired cloud-pack facade kept as a compatibility boundary. */

export class CloudRelayService {

    static get API_URL() {
        return "https://api.ionrift.cloud";
    }

    static get CLIENT_ID() {
        return "";
    }

    static get EXPIRY_WARN_WINDOW_MS() {
        return 7 * 24 * 60 * 60 * 1000;
    }

    static get EXPIRED_COPY() {
        return "In-app Patreon connections are retired.";
    }

    static getSigil() {
        return "";
    }

    static isConnected() {
        return false;
    }

    static getSigilClaims() {
        return {};
    }

    static getTierClaim() {
        return null;
    }

    static getExpiryStatus() {
        return {
            hasExpiry: false,
            expiresAt: null,
            secondsRemaining: null,
            expired: false,
            expiringSoon: false
        };
    }

    static isAuthenticated() {
        return false;
    }

    static async connect() {
        ui.notifications?.warn?.("In-app Patreon connections are retired. Use the pack links on Patreon.");
    }

    static async disconnect() {
        return;
    }

    static async requestDownload(packId, version, options = {}) {
        const message = "In-app pack downloads are retired. Use the pack links on Patreon.";
        if (!options.silent) ui.notifications?.warn?.(message);
        return { status: 410, error: message, packId, version };
    }

    static async initSupportReport(payload) {
        return { ok: false, error: "Connected support reports are unavailable.", payload };
    }

    static async uploadSupportReport(reportId, reportJson) {
        return { ok: false, error: "Connected support reports are unavailable.", reportId, reportJson };
    }

    static async completeSupportReport(reportId) {
        return { ok: false, error: "Connected support reports are unavailable.", reportId };
    }

    static warnIfExpiringSoon(opts) {
        return { shown: "none", snoozed: false, opts };
    }

    static clearExpirySnooze() {
        return;
    }
}
