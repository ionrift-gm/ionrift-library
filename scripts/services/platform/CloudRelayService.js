/**
 * Listed-Kernel facade for the Patreon / cloud download broker.
 * Real implementation lives in ionrift-annex (`game.ionrift.annex.cloud`).
 * Without Annex, broker calls soft-degrade (no OAuth, no cloud download).
 */

function broker() {
    return game.ionrift?.annex?.cloud ?? null;
}

export class CloudRelayService {

    static get API_URL() {
        return broker()?.API_URL ?? "https://api.ionrift.cloud";
    }

    static get CLIENT_ID() {
        return broker()?.CLIENT_ID ?? "";
    }

    static get EXPIRY_WARN_WINDOW_MS() {
        return broker()?.EXPIRY_WARN_WINDOW_MS ?? (7 * 24 * 60 * 60 * 1000);
    }

    static get EXPIRED_COPY() {
        return broker()?.EXPIRED_COPY
            ?? "Your Patreon connection has expired. Install or enable Ionrift Annex, then reconnect.";
    }

    static getSigil() {
        return broker()?.getSigil?.() ?? "";
    }

    static isConnected() {
        return broker()?.isConnected?.() ?? false;
    }

    static getSigilClaims() {
        return broker()?.getSigilClaims?.() ?? {};
    }

    static getTierClaim() {
        return broker()?.getTierClaim?.() ?? null;
    }

    static getExpiryStatus() {
        return broker()?.getExpiryStatus?.() ?? {
            hasExpiry: false,
            expiresAt: null,
            secondsRemaining: null,
            expired: false,
            expiringSoon: false
        };
    }

    static isAuthenticated() {
        return broker()?.isAuthenticated?.() ?? false;
    }

    static async connect() {
        const b = broker();
        if (!b) {
            ui.notifications?.warn?.("Ionrift Annex is required to link Patreon.");
            return;
        }
        return b.connect();
    }

    static async disconnect() {
        const b = broker();
        if (!b) return;
        return b.disconnect();
    }

    static async requestDownload(packId, version, options = {}) {
        const b = broker();
        if (!b) {
            const msg = "Ionrift Annex is required for cloud downloads.";
            if (!options.silent) ui.notifications?.warn?.(msg);
            return { status: 503, error: msg };
        }
        return b.requestDownload(packId, version, options);
    }

    static async initSupportReport(payload) {
        const b = broker();
        if (!b) return { ok: false, error: "Ionrift Annex is required to submit reports." };
        return b.initSupportReport(payload);
    }

    static async uploadSupportReport(reportId, reportJson) {
        const b = broker();
        if (!b) return { ok: false, error: "Ionrift Annex is required to submit reports." };
        return b.uploadSupportReport(reportId, reportJson);
    }

    static async completeSupportReport(reportId) {
        const b = broker();
        if (!b) return { ok: false, error: "Ionrift Annex is required to submit reports." };
        return b.completeSupportReport(reportId);
    }

    static warnIfExpiringSoon(opts) {
        return broker()?.warnIfExpiringSoon?.(opts) ?? { shown: "none", snoozed: false };
    }

    static clearExpirySnooze() {
        return broker()?.clearExpirySnooze?.();
    }
}
