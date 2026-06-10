/**
 * Mutable collector passed to ionrift.collectBugReport hooks.
 */

export class BugReportBuilder {
    static SCHEMA_VERSION = 1;
    static MAX_BYTES = 262144;

    constructor(context = "manual") {
        this.context = context;
        this.note = "";
        this.attachments = {};
    }

    /**
     * @param {string} section
     * @param {unknown} data
     */
    attach(section, data) {
        if (!section || typeof section !== "string") return;
        this.attachments[section] = data;
    }

    /**
     * @param {string} note
     */
    setNote(note) {
        if (typeof note === "string") this.note = note.trim().slice(0, 2000);
    }

    /**
     * @param {object} core
     * @returns {object}
     */
    build(core) {
        const report = {
            schemaVersion: BugReportBuilder.SCHEMA_VERSION,
            collectedAt:   new Date().toISOString(),
            context:       this.context,
            note:          this.note,
            ...core,
            attachments:   this.attachments,
        };
        return BugReportBuilder.scrub(report);
    }

    /**
     * Deep-clone and redact secrets before copy/upload.
     * @param {unknown} value
     * @returns {unknown}
     */
    static scrub(value) {
        if (value === null || value === undefined) return value;
        if (typeof value === "string") return BugReportBuilder._scrubString(value);
        if (Array.isArray(value)) return value.map(item => BugReportBuilder.scrub(item));
        if (typeof value !== "object") return value;

        const out = {};
        for (const [key, val] of Object.entries(value)) {
            const keyLower = key.toLowerCase();
            if (BugReportBuilder._isSensitiveKey(keyLower)) {
                out[key] = "[redacted]";
                continue;
            }
            out[key] = BugReportBuilder.scrub(val);
        }
        return out;
    }

    static _isSensitiveKey(keyLower) {
        return keyLower.includes("sigil")
            || keyLower.includes("token")
            || keyLower.includes("apikey")
            || keyLower.includes("api_key")
            || keyLower.includes("password")
            || keyLower.includes("secret")
            || keyLower === "authorization";
    }

    static _scrubString(text) {
        let out = text;
        out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]");
        out = out.replace(/\bsk-[A-Za-z0-9]{8,}\b/g, "sk-[redacted]");
        out = out.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt-redacted]");
        out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-redacted]");
        return out;
    }

    /**
     * @param {object} report
     * @returns {string}
     */
    static serialize(report) {
        return JSON.stringify(report, null, 2);
    }

    /**
     * @param {string} json
     */
    static assertSize(json) {
        const bytes = new TextEncoder().encode(json).length;
        if (bytes > BugReportBuilder.MAX_BYTES) {
            throw new Error(`Bug report exceeds ${BugReportBuilder.MAX_BYTES} bytes (${bytes}).`);
        }
    }
}
