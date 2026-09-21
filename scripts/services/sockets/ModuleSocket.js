import { Logger } from "../platform/Logger.js";

/**
 * Kernel-level socket transport abstraction for Ionrift modules.
 *
 * Provides:
 * - Channel lifecycle management (`module.<moduleId>`) with clean hot-reload rebinding.
 * - Typed pub/sub (`on`, `off`) and wildcard listening (`listen`).
 * - Leader-elected GM handling (`onGM` via `isResponsibleGM()`) to eliminate duplicate
 *   execution across multiple connected GMs.
 * - Targeted user delivery (`emitToUser`) and GM targeting (`emitToGM`).
 * - Request/Response correlation (`request()` and `respond()`).
 * - Request deduplication with rolling TTL.
 */
export class ModuleSocket {
    /**
     * @param {string} moduleId - Foundry module ID (e.g. "ionrift-quiz-night")
     * @param {object} [options]
     * @param {string} [options.scope=null] - Optional sub-namespace for modules sharing a channel
     * @param {object} [options.logger=null] - Optional logger proxy (e.g. from createLogger)
     */
    constructor(moduleId, { scope = null, logger = null } = {}) {
        if (!moduleId || typeof moduleId !== "string") {
            throw new Error("ModuleSocket requires a valid string moduleId.");
        }
        this.moduleId = moduleId;
        this.channel = `module.${moduleId}`;
        this.scope = scope;
        this.logger = logger;

        /** @type {((data: object) => void)|null} */
        this._boundListener = null;

        /** @type {Set<(data: object) => void>} */
        this._listeners = new Set();

        /** @type {Map<string, Set<(data: object) => void>>} */
        this._typeHandlers = new Map();

        /** @type {Map<string, Set<(data: object) => (void|Promise<void>)>>} */
        this._gmHandlers = new Map();

        /** @type {Map<string, { resolve: Function, reject: Function, timer: any, type: string }>} */
        this._pendingRequests = new Map();

        /** @type {Set<string>} */
        this._seenRequests = new Set();

        this._isReady = false;
    }

    /**
     * Whether the socket is currently bound and listening.
     * @type {boolean}
     */
    get isReady() {
        return this._isReady;
    }

    /**
     * Initialize socket listening on game.socket.
     * Safe to call multiple times (cleans up any previous listener).
     * @returns {boolean} True if initialized successfully
     */
    init() {
        const socket = globalThis.game?.socket;
        if (!socket) {
            this._log("warn", "game.socket unavailable. Socket listeners not installed.");
            return false;
        }

        if (this._boundListener) {
            socket.off(this.channel, this._boundListener);
        }

        this._boundListener = (data) => this._onReceive(data);
        socket.on(this.channel, this._boundListener);
        this._isReady = true;
        this._log("log", `Socket listening on ${this.channel}`);
        return true;
    }

    /**
     * Unbind socket listeners and clear active state.
     */
    destroy() {
        const socket = globalThis.game?.socket;
        if (this._boundListener && socket) {
            socket.off(this.channel, this._boundListener);
            this._boundListener = null;
        }

        for (const [id, req] of this._pendingRequests.entries()) {
            clearTimeout(req.timer);
            req.reject(new Error(`Socket destroyed while waiting for response to "${req.type}".`));
        }
        this._pendingRequests.clear();
        this._listeners.clear();
        this._typeHandlers.clear();
        this._gmHandlers.clear();
        this._seenRequests.clear();
        this._isReady = false;
        this._log("log", `Socket destroyed on ${this.channel}`);
    }

    /**
     * Register a wildcard listener that receives all socket messages on this channel.
     * Matches legacy SocketHandler.register() behavior.
     * @param {(data: object) => void} handler
     * @returns {() => void} Unsubscribe function
     */
    listen(handler) {
        if (typeof handler !== "function") return () => {};
        this._listeners.add(handler);
        return () => this._listeners.delete(handler);
    }

    /**
     * Alias for listen() to preserve compatibility with existing SocketHandler.register.
     * @param {(data: object) => void} handler
     * @returns {() => void}
     */
    register(handler) {
        return this.listen(handler);
    }

    /**
     * Register a handler for a specific message type.
     * @param {string} type - Message type (e.g. "quiz:start")
     * @param {(data: object) => void} handler
     * @returns {() => void} Unsubscribe function
     */
    on(type, handler) {
        if (!type || typeof handler !== "function") return () => {};
        if (!this._typeHandlers.has(type)) {
            this._typeHandlers.set(type, new Set());
        }
        this._typeHandlers.get(type).add(handler);
        return () => this.off(type, handler);
    }

    /**
     * Register a handler for a specific message type that ONLY executes on the
     * responsible active GM (the lowest-id active GM). Eliminates race conditions
     * and duplicate execution when multiple GMs are connected.
     * @param {string} type
     * @param {(data: object) => (void|Promise<void>)} handler
     * @returns {() => void} Unsubscribe function
     */
    onGM(type, handler) {
        if (!type || typeof handler !== "function") return () => {};
        if (!this._gmHandlers.has(type)) {
            this._gmHandlers.set(type, new Set());
        }
        this._gmHandlers.get(type).add(handler);
        return () => this.off(type, handler);
    }

    /**
     * Unregister a handler.
     * Supports:
     * - `off(type, handler)`
     * - `off(handler)` (removes from wildcard listeners and all type maps)
     * @param {string|Function} typeOrHandler
     * @param {Function} [handler]
     */
    off(typeOrHandler, handler) {
        if (typeof typeOrHandler === "function") {
            const target = typeOrHandler;
            this._listeners.delete(target);
            for (const set of this._typeHandlers.values()) set.delete(target);
            for (const set of this._gmHandlers.values()) set.delete(target);
            return;
        }

        if (typeof typeOrHandler === "string" && typeof handler === "function") {
            this._typeHandlers.get(typeOrHandler)?.delete(handler);
            this._gmHandlers.get(typeOrHandler)?.delete(handler);
        }
    }

    /**
     * Alias for unregistering wildcard listeners.
     * @param {Function} handler
     */
    unregister(handler) {
        this.off(handler);
    }

    /**
     * Single-GM Leader Election. Returns true only for the lowest-id active GM.
     * @returns {boolean}
     */
    static isResponsibleGM() {
        const game = globalThis.game;
        if (!game?.user?.isGM) return false;
        const activeGMs = (game.users?.filter(u => u.isGM && u.active) ?? [])
            .sort((a, b) => a.id.localeCompare(b.id));
        return activeGMs[0]?.id === game.user.id;
    }

    /**
     * Instance convenience for isResponsibleGM.
     * @returns {boolean}
     */
    isResponsibleGM() {
        return ModuleSocket.isResponsibleGM();
    }

    /**
     * Returns true if at least one GM is currently active in the session.
     * @returns {boolean}
     */
    static hasActiveGM() {
        const game = globalThis.game;
        return ((game?.users?.filter(u => u.isGM && u.active) ?? []).length) > 0;
    }

    /**
     * Instance convenience for hasActiveGM.
     * @returns {boolean}
     */
    hasActiveGM() {
        return ModuleSocket.hasActiveGM();
    }

    /**
     * Emit a message to all connected clients on this channel.
     * Spreads payload properties top-level alongside metadata for 100% backwards
     * compatibility with existing message receivers.
     *
     * @param {string} type - Message type
     * @param {object} [payload={}] - Data properties
     * @param {object} [options={}] - Internal routing options
     * @returns {object|null} The emitted envelope, or null if socket is unavailable
     */
    emit(type, payload = {}, options = {}) {
        const socket = globalThis.game?.socket;
        if (!socket) {
            this._log("warn", `Cannot emit "${type}": game.socket is unavailable.`);
            return null;
        }

        const envelope = {
            type,
            senderId: globalThis.game?.user?.id,
            timestamp: Date.now(),
            ...(this.scope ? { scope: this.scope } : {}),
            ...options,
            ...payload
        };

        socket.emit(this.channel, envelope);
        this._log("log", `Socket emit: ${type}`, envelope);
        return envelope;
    }

    /**
     * Emit a message targeted exclusively to a specific user.
     * Other clients receiving the raw broadcast will silently drop it.
     *
     * @param {string} userId - Target Foundry user ID
     * @param {string} type
     * @param {object} [payload={}]
     * @returns {object|null}
     */
    emitToUser(userId, type, payload = {}) {
        if (!userId) {
            this._log("warn", `emitToUser("${type}") called without target userId.`);
            return null;
        }
        return this.emit(type, payload, { targetUserId: userId });
    }

    /**
     * Emit a message intended for GM processing.
     * Non-GM clients will drop it immediately.
     *
     * @param {string} type
     * @param {object} [payload={}]
     * @returns {object|null}
     */
    emitToGM(type, payload = {}) {
        return this.emit(type, payload, { targetGM: true });
    }

    /**
     * Send a request and wait for a correlated response via Promise.
     *
     * @param {string} type - Request action/type
     * @param {object} [payload={}]
     * @param {object} [options]
     * @param {number} [options.timeoutMs=10000] - Timeout before rejection
     * @param {string} [options.targetUserId=null] - Optional specific user target
     * @param {boolean} [options.targetGM=false] - Optional GM target
     * @returns {Promise<object>} Resolves with the response payload
     */
    async request(type, payload = {}, { timeoutMs = 10000, targetUserId = null, targetGM = false } = {}) {
        const requestId = globalThis.foundry?.utils?.randomID
            ? globalThis.foundry.utils.randomID()
            : Math.random().toString(36).substring(2, 11);

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this._pendingRequests.delete(requestId);
                reject(new Error(`Socket request "${type}" (${requestId}) timed out after ${timeoutMs}ms.`));
            }, timeoutMs);

            this._pendingRequests.set(requestId, { resolve, reject, timer, type });

            const extra = { requestId, isRequest: true };
            if (targetUserId) extra.targetUserId = targetUserId;
            if (targetGM) extra.targetGM = true;

            const emitted = this.emit(type, payload, extra);
            if (!emitted) {
                clearTimeout(timer);
                this._pendingRequests.delete(requestId);
                reject(new Error(`Failed to emit socket request "${type}".`));
            }
        });
    }

    /**
     * Respond to an incoming request message.
     *
     * @param {object} incomingData - The received request data containing requestId and senderId
     * @param {object} [responsePayload={}] - The payload to reply with
     * @returns {object|null}
     */
    respond(incomingData, responsePayload = {}) {
        if (!incomingData?.requestId) {
            this._log("warn", "respond() called on incoming data without requestId.");
            return null;
        }

        const responseType = incomingData.type ? `${incomingData.type}:response` : "response";
        return this.emit(responseType, responsePayload, {
            requestId: incomingData.requestId,
            isResponse: true,
            targetUserId: incomingData.senderId
        });
    }

    /**
     * Internal receiver: validates envelopes and dispatches to listeners.
     * @param {object} data
     * @private
     */
    _onReceive(data) {
        if (!data || typeof data !== "object") return;
        if (!data.type) return;

        // Scope filter
        if (this.scope && data.scope !== this.scope) return;

        // Target user filter
        if (data.targetUserId && data.targetUserId !== globalThis.game?.user?.id) return;

        // Target GM filter
        if (data.targetGM && !globalThis.game?.user?.isGM) return;

        this._log("log", `Socket received: ${data.type}`);

        // Correlate response to pending request
        if (data.requestId && data.isResponse && this._pendingRequests.has(data.requestId)) {
            const pending = this._pendingRequests.get(data.requestId);
            this._pendingRequests.delete(data.requestId);
            clearTimeout(pending.timer);
            pending.resolve(data);
            return;
        }

        // Deduplicate requests with requestId
        if (data.requestId && data.isRequest) {
            if (this._seenRequests.has(data.requestId)) return;
            this._seenRequests.add(data.requestId);
            setTimeout(() => this._seenRequests.delete(data.requestId), 60_000);
        }

        // 1. Wildcard listeners (SocketHandler.register)
        for (const listener of this._listeners) {
            try {
                listener(data);
            } catch (err) {
                this._log("error", `Socket wildcard listener error for ${data.type}:`, err);
            }
        }

        // 2. Specific type handlers (on)
        if (this._typeHandlers.has(data.type)) {
            for (const handler of this._typeHandlers.get(data.type)) {
                try {
                    handler(data);
                } catch (err) {
                    this._log("error", `Socket handler error for ${data.type}:`, err);
                }
            }
        }

        // 3. Responsible GM handlers (onGM)
        if (this._gmHandlers.has(data.type)) {
            if (this.isResponsibleGM()) {
                for (const handler of this._gmHandlers.get(data.type)) {
                    try {
                        handler(data);
                    } catch (err) {
                        this._log("error", `Socket GM handler error for ${data.type}:`, err);
                    }
                }
            }
        }
    }

    /**
     * Unified logging proxy.
     * @param {"log"|"info"|"warn"|"error"} level
     * @param  {...any} args
     * @private
     */
    _log(level, ...args) {
        try {
            if (this.logger && typeof this.logger[level] === "function") {
                this.logger[level](...args);
                return;
            }
            if (Logger && typeof Logger[level] === "function") {
                Logger[level]("Library", `[${this.moduleId}]`, ...args);
                return;
            }
        } catch {
            // Fall back to console if settings aren't initialized yet
        }
        if (console && typeof console[level] === "function") {
            console[level](`Ionrift [${this.moduleId}] |`, ...args);
        }
    }
}
