/**
 * Generic GM-routing primitive for the cooking/feeding abstraction.
 *
 * Foundry blocks cross-owner document writes. A player serving the party often
 * needs to write Active Effects or flags onto actors they do not own, so those
 * writes are emitted over the library socket channel and applied by the
 * responsible (lowest-id active) GM. Ported from Monstrous Feast's GMRelay and
 * scoped under a `cooking` envelope so it shares the channel with
 * RollRequestService without collision.
 */

import { Logger } from "../Logger.js";

const MODULE_ID = "ionrift-library";
const CHANNEL = `module.${MODULE_ID}`;

/** Envelope scope so cooking traffic is distinct from roll-request traffic. */
const SCOPE = "cooking";

/** @type {Map<string, (payload: object) => (void|Promise<void>)>} */
const _handlers = new Map();

/** @type {Set<string>} */
const _seen = new Set();

/** @type {((data: object) => void)|null} */
let _bound = null;

let _ready = false;

/**
 * Decide where a cross-actor cooking write should run. Owners write locally;
 * everything else relays to a connected GM; with no GM online the write cannot
 * resolve.
 * @param {{ isOwner?: boolean }} ctx
 * @returns {"local"|"relay"|"blocked"}
 */
function decideRoute({ isOwner = false } = {}) {
    if (isOwner) return "local";
    if (CookingGMExec.hasActiveGM()) return "relay";
    return "blocked";
}

export const CookingGMExec = {
    /** Bind the socket listener. Idempotent; safe to call on every ready. */
    init() {
        if (!game.socket) {
            Logger.warn("Library", "CookingGMExec.init: game.socket unavailable.");
            return;
        }
        if (_bound) game.socket.off(CHANNEL, _bound);
        _bound = (data) => CookingGMExec._onMessage(data);
        game.socket.on(CHANNEL, _bound);
        if (!_ready) {
            _ready = true;
            Logger.info("Library", `CookingGMExec listening on ${CHANNEL} (scope=${SCOPE}).`);
        }
    },

    /**
     * Whether any GM is currently connected to apply relayed writes.
     * @returns {boolean}
     */
    hasActiveGM() {
        return (game.users?.filter(u => u.isGM && u.active).length ?? 0) > 0;
    },

    /**
     * Whether this client is the single GM responsible for relayed writes
     * (lowest-id active GM).
     * @returns {boolean}
     */
    isResponsibleGM() {
        if (!game.user?.isGM) return false;
        const activeGMs = game.users
            .filter(u => u.isGM && u.active)
            .sort((a, b) => a.id.localeCompare(b.id));
        return activeGMs[0]?.id === game.user.id;
    },

    /**
     * @param {{ isOwner?: boolean }} ctx
     * @returns {"local"|"relay"|"blocked"}
     */
    route(ctx = {}) {
        return decideRoute(ctx);
    },

    /**
     * Register a handler the responsible GM runs when a matching action arrives.
     * @param {string} action
     * @param {(payload: object) => (void|Promise<void>)} fn
     */
    registerHandler(action, fn) {
        if (!action || typeof fn !== "function") {
            throw new Error("CookingGMExec.registerHandler: action and handler function required.");
        }
        _handlers.set(action, fn);
    },

    /**
     * @param {string} action
     * @returns {boolean}
     */
    unregisterHandler(action) {
        return _handlers.delete(action);
    },

    /**
     * Emit an action for the responsible GM to apply. Carries a requestId so a
     * GM applies each request once even if the socket redelivers it.
     * @param {string} action
     * @param {object} [payload]
     * @returns {string|null} The requestId, or null when no socket is available.
     */
    request(action, payload = {}) {
        if (!game.socket) {
            Logger.warn("Library", "CookingGMExec.request: game.socket unavailable.");
            return null;
        }
        const requestId = foundry.utils.randomID();
        game.socket.emit(CHANNEL, { scope: SCOPE, action, requestId, payload });
        Logger.log("Library", `CookingGMExec: emitted ${action} (${requestId}).`);
        return requestId;
    },

    /**
     * @param {object} data
     * @private
     */
    async _onMessage(data) {
        if (data?.scope !== SCOPE || !data.action) return;
        if (!CookingGMExec.isResponsibleGM()) return;

        if (data.requestId) {
            if (_seen.has(data.requestId)) return;
            _seen.add(data.requestId);
            setTimeout(() => _seen.delete(data.requestId), 120_000);
        }

        const handler = _handlers.get(data.action);
        if (!handler) {
            Logger.warn("Library", `CookingGMExec: no handler for action "${data.action}".`);
            return;
        }
        try {
            await handler(data.payload ?? {});
        } catch (err) {
            Logger.warn("Library", `CookingGMExec: handler "${data.action}" failed:`, err?.message ?? err);
        }
    },

    /** @private test helper */
    _reset() {
        _handlers.clear();
        _seen.clear();
        if (_bound && game.socket) game.socket.off(CHANNEL, _bound);
        _bound = null;
        _ready = false;
    }
};
