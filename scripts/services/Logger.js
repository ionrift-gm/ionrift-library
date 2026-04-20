export class Logger {
    static get debugEnabled() {
        if (!game.settings.settings.has("ionrift-library.debug")) return false;
        return game.settings.get("ionrift-library", "debug");
    }

    static log(module, ...args) {
        if (!this.debugEnabled) return;
        const prefix = `Ionrift ${module} |`;
        console.log(prefix, ...args);
    }

    static info(module, ...args) {
        const prefix = `Ionrift ${module} |`;
        console.log(prefix, ...args);
    }

    static warn(module, ...args) {
        const prefix = `Ionrift ${module} |`;
        console.warn(prefix, ...args);
    }

    static error(module, ...args) {
        const prefix = `Ionrift ${module} |`;
        console.error(prefix, ...args);
    }

    /**
     * Creates a module-specific Logger proxy object.
     *
     * Returns an object with the same `log`, `info`, `warn`, `error` interface
     * that consumer modules can use without importing the Logger class directly
     * or writing their own delegation wrapper.
     *
     * - `log()` is gated on the library's debug setting (silent when off).
     * - `info()`, `warn()`, `error()` are always visible.
     * - Falls back to `console.*` if the Logger class is unreachable.
     *
     * Usage in consumer modules:
     * ```js
     * const Logger = game.ionrift?.library?.createLogger?.("Respite")
     *     ?? { log(){}, info: console.log, warn: console.warn, error: console.error };
     * ```
     *
     * @param {string} label - The module label (e.g. "Respite", "Quartermaster").
     * @returns {{log: Function, info: Function, warn: Function, error: Function}}
     */
    static createModuleProxy(label) {
        const Self = this;
        return {
            log(...args)   { Self.log(label, ...args); },
            info(...args)  { Self.info(label, ...args); },
            warn(...args)  { Self.warn(label, ...args); },
            error(...args) { Self.error(label, ...args); }
        };
    }
}
