import { Logger } from "../../platform/Logger.js";

const MODULE_LABEL = "CookingBuffHandlers";

// Required keys: id, label.
const REQUIRED_KEYS = ["id", "label"];

/** @type {Map<string, object>} id to handler */
const _handlers = new Map();

/** @type {Set<string>} de-duped unknown-type warnings, logged at most once each. */
const _unknownWarnings = new Set();

function missingKeys(handler) {
    return REQUIRED_KEYS.filter(key => typeof handler?.[key] !== "string" || !handler[key].trim());
}

export const CookingBuffHandlers = {
    register(handler, meta = {}) {
        const missing = missingKeys(handler);
        if (missing.length) {
            throw new Error(`CookingBuffHandlers.register: handler missing required keys: ${missing.join(", ")}.`);
        }
        const entry = handler;
        entry._overlayId = meta.overlayId ?? null;
        entry._pluginId = meta.pluginId ?? handler.id;
        entry._source = meta.source ?? (meta.overlayId ? "overlay" : "builtin");
        _handlers.set(handler.id, entry);
        return true;
    },

    unregister(id) {
        return _handlers.delete(id);
    },

    unregisterForOverlay(overlayId) {
        let removed = 0;
        for (const [id, handler] of _handlers) {
            if (handler._overlayId === overlayId) {
                _handlers.delete(id);
                removed++;
            }
        }
        return removed;
    },

    get(id) {
        return _handlers.get(id);
    },

    has(id) {
        return _handlers.has(id);
    },

    list() {
        return [..._handlers.values()];
    },

    // Warn once per unknown type.
    warnUnknown(key, label = MODULE_LABEL) {
        if (!key || _unknownWarnings.has(key)) return;
        _unknownWarnings.add(key);
        Logger.warn(label, `No cooking buff handler registered for "${key}". Skipping.`);
    },

    _resetForTests() {
        _handlers.clear();
        _unknownWarnings.clear();
    }
};
