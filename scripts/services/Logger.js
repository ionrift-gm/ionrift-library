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
}
