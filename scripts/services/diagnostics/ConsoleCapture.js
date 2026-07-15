/**
 * Ring buffer for recent console.warn / console.error output.
 * Installed once at library init; read by BugReportService.
 */

const MAX_ENTRIES = 30;

export class ConsoleCapture {
    static _installed = false;
    static _entries = [];

    static install() {
        if (this._installed || typeof console === "undefined") return;
        this._installed = true;

        for (const level of ["warn", "error"]) {
            const original = console[level]?.bind(console);
            if (typeof original !== "function") continue;

            console[level] = (...args) => {
                this._push(level, args);
                original(...args);
            };
        }
    }

    /** @returns {object[]} */
    static getRecent() {
        return this._entries.map(entry => ({ ...entry }));
    }

    static _push(level, args) {
        const message = args.map(arg => this._stringify(arg)).join(" ");
        this._entries.push({
            at:      new Date().toISOString(),
            level,
            message: message.slice(0, 2000),
        });
        if (this._entries.length > MAX_ENTRIES) {
            this._entries.shift();
        }
    }

    static _stringify(value) {
        if (value instanceof Error) return value.stack || value.message || String(value);
        if (typeof value === "string") return value;
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
}
