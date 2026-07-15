import { Logger } from "../../platform/Logger.js";

const MODULE_ID = "ionrift-library";
const CHANNEL = `module.${MODULE_ID}`;

// Socket envelope; must stay distinct from RollRequestService on the same channel.
const SCOPE = "cooking";

/** @type {Map<string, (payload: object) => (void|Promise<void>)>} */
const _handlers = new Map();

/** @type {Set<string>} */
const _seen = new Set();

/** @type {((data: object) => void)|null} */
let _bound = null;

let _ready = false;

// Owners write local; else relay to lowest-id active GM; no GM: blocked.
function decideRoute({ isOwner = false } = {}) {
    if (isOwner) return "local";
    if (CookingGMExec.hasActiveGM()) return "relay";
    return "blocked";
}

export const CookingGMExec = {
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

    hasActiveGM() {
        return (game.users?.filter(u => u.isGM && u.active).length ?? 0) > 0;
    },

    isResponsibleGM() {
        if (!game.user?.isGM) return false;
        const activeGMs = game.users
            .filter(u => u.isGM && u.active)
            .sort((a, b) => a.id.localeCompare(b.id));
        return activeGMs[0]?.id === game.user.id;
    },

    route(ctx = {}) {
        return decideRoute(ctx);
    },

    registerHandler(action, fn) {
        if (!action || typeof fn !== "function") {
            throw new Error("CookingGMExec.registerHandler: action and handler function required.");
        }
        _handlers.set(action, fn);
    },

    unregisterHandler(action) {
        return _handlers.delete(action);
    },

    // Emit with requestId so redelivery does not apply twice.
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

    _reset() {
        _handlers.clear();
        _seen.clear();
        if (_bound && game.socket) game.socket.off(CHANNEL, _bound);
        _bound = null;
        _ready = false;
    }
};
