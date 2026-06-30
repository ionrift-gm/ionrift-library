/**
 * Buff-handler registry for the Ionrift cooking abstraction.
 *
 * A buff handler is a plugin keyed by a stable `id`. Consumer modules (Monstrous
 * Feast, Respite, premium overlays) register handlers that describe how a meal
 * buff renders, summarises, and applies. The kernel only stores and serves the
 * handlers; the handler shape itself is owned by the consumer, so a module can
 * carry exactly the methods it needs (summary line, Active Effect changes, a
 * resolve step) without the kernel prescribing them.
 *
 * This is the seam premium content flows through: an overlay ships a handler
 * `.mjs`, the module's overlay loader imports it and registers it here, and the
 * module's existing buff paths pick it up with no further wiring. The four
 * built-in Monstrous Feast buffs register through this same seam, so there is no
 * privileged in-code path that overlay buffs cannot reach.
 *
 * Modelled on ionrift-respite's MealBuffHandlerRegistry, lifted into the shared
 * kernel so more than one module can host its buffs here.
 */

import { Logger } from "../Logger.js";

const MODULE_LABEL = "CookingBuffHandlers";

/** Minimum shape every handler must satisfy. */
const REQUIRED_KEYS = ["id", "label"];

/** @type {Map<string, object>} id -> handler */
const _handlers = new Map();

/** @type {Set<string>} de-duped unknown-type warnings, logged at most once each. */
const _unknownWarnings = new Set();

/**
 * @param {object} handler
 * @returns {string[]} missing required keys
 */
function missingKeys(handler) {
    return REQUIRED_KEYS.filter(key => typeof handler?.[key] !== "string" || !handler[key].trim());
}

export const CookingBuffHandlers = {
    /**
     * Register a buff handler. Replaces any existing handler with the same id.
     * @param {object} handler Consumer-defined handler. Requires string `id` and `label`.
     * @param {{ overlayId?: string, pluginId?: string, source?: string }} [meta]
     * @returns {boolean} Whether the handler was registered.
     */
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

    /**
     * @param {string} id
     * @returns {boolean}
     */
    unregister(id) {
        return _handlers.delete(id);
    },

    /**
     * Remove every handler contributed by a given overlay. Called when an
     * overlay is deactivated or uninstalled.
     * @param {string} overlayId
     * @returns {number} how many handlers were removed
     */
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

    /**
     * @param {string} id
     * @returns {object|undefined}
     */
    get(id) {
        return _handlers.get(id);
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        return _handlers.has(id);
    },

    /**
     * @returns {object[]} handlers in registration order
     */
    list() {
        return [..._handlers.values()];
    },

    /**
     * Log once when a buff key has no registered handler. Keeps a missing
     * overlay handler from spamming the console while still surfacing the gap.
     * @param {string} key
     * @param {string} [label] Consumer label used in the warning.
     */
    warnUnknown(key, label = MODULE_LABEL) {
        if (!key || _unknownWarnings.has(key)) return;
        _unknownWarnings.add(key);
        Logger.warn(label, `No cooking buff handler registered for "${key}". Skipping.`);
    },

    /** @private test helper */
    _resetForTests() {
        _handlers.clear();
        _unknownWarnings.clear();
    }
};
