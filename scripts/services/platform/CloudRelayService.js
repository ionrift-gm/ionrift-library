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
        const { context, summary, byteLength } = payload ?? {};
        if (!context || !byteLength) {
            return { ok: false, error: "Missing report init fields." };
        }

        try {
            const response = await fetch(`${this.API_URL}/support/report-init`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ context, summary, byteLength }),
            });

            if (!response.ok) {
                if (response.status === 429) {
                    return { ok: false, error: "Daily report limit reached. Try again tomorrow or use Discord." };
                }
                const msg = await response.text();
                return { ok: false, error: msg || `HTTP ${response.status}` };
            }

            const data = await response.json();
            return {
                ok: true,
                reportId: data.reportId,
                reference: data.reference,
            };
        } catch (err) {
            return { ok: false, error: err?.message ?? "Network error." };
        }
    }

    static async uploadSupportReport(reportId, reportJson) {
        if (!reportId || reportJson == null) {
            return { ok: false, error: "Missing report data." };
        }

        let report;
        try {
            report = typeof reportJson === "string" ? JSON.parse(reportJson) : reportJson;
        } catch {
            return { ok: false, error: "Invalid report format." };
        }

        try {
            const response = await fetch(`${this.API_URL}/support/report-upload`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportId, report }),
            });

            if (!response.ok) {
                if (response.status === 403) {
                    return { ok: false, error: "Report session expired. Try again." };
                }
                const msg = await response.text();
                return { ok: false, error: msg || `Upload failed (${response.status})` };
            }

            const data = await response.json();
            return {
                ok: true,
                reportId: data.reportId,
                reference: data.reference,
            };
        } catch (err) {
            return { ok: false, error: err?.message ?? "Network error." };
        }
    }

    static async completeSupportReport(reportId) {
        if (!reportId) return { ok: false, error: "Missing reportId." };
        try {
            const response = await fetch(`${this.API_URL}/support/report-complete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reportId }),
            });
            if (!response.ok) {
                return { ok: false, error: `Complete failed (${response.status})` };
            }
            const data = await response.json();
            return { ok: true, reportId: data.reportId, reference: data.reference };
        } catch (err) {
            return { ok: false, error: err?.message ?? "Network error." };
        }
    }

    static warnIfExpiringSoon(opts) {
        return { shown: "none", snoozed: false, opts };
    }

    static clearExpirySnooze() {
        return;
    }
}
