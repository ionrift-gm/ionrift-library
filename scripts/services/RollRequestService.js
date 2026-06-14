import { Logger } from "./Logger.js";
import {
    executeSaveRoll,
    executeSkillRoll,
    executeAbilityRoll,
    rollForPlayer,
    evaluatePassed,
    SKILL_DISPLAY_NAMES
} from "./RollRequestMechanics.js";
import { RollRequestPromptApp } from "../apps/RollRequestPromptApp.js";

const MODULE_ID = "ionrift-library";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const SOCKET_REQUEST = "rollRequest";
const SOCKET_RESULT = "rollResult";
const RELAY_CHANNEL = "module.ionrift-cursewright";
const RELAY_REQUEST = "libraryRollRequest";
const RELAY_RESULT = "libraryRollResult";

/** @type {Map<string, { resolve: Function, reject: Function, timer?: ReturnType<typeof setTimeout> }>} */
const _pending = new Map();

/** @type {Set<string>} */
const _seenRequestIds = new Set();

/** @type {boolean} */
let _socketReady = false;

/** @type {((data: object) => void)|null} */
let _socketBound = null;

/**
 * Shared roll-request service. Promise-based player/GM roll handoff over game.socket.
 */
export class RollRequestService {
    static init() {
        if (!game.socket) {
            Logger.warn("Library", "RollRequestService.init: game.socket unavailable.");
            return;
        }

        if (_socketBound) {
            game.socket.off(SOCKET_CHANNEL, _socketBound);
        }
        _socketBound = (data) => RollRequestService._onSocketMessage(data);
        game.socket.on(SOCKET_CHANNEL, _socketBound);

        if (!_socketReady) {
            _socketReady = true;
            Logger.info("Library", `RollRequestService listening on ${SOCKET_CHANNEL} (user=${game.user.name}, id=${game.user.id}).`);
        }
    }

    /**
     * @param {object} opts
     * @returns {Promise<object>}
     */
    static async request(opts = {}) {
        RollRequestService.init();

        const actor = await RollRequestService._resolveActor(opts.actorId, opts.actorUuid);
        if (!actor) throw new Error("RollRequestService.request: actor not found");

        const requestId = foundry.utils.randomID();
        const rollMode = opts.rollMode ?? "normal";
        const dc = Number.isFinite(opts.dc) ? opts.dc : null;

        if (rollMode === "force-pass" || rollMode === "force-fail") {
            return RollRequestService._resolveForced(actor, opts, requestId, rollMode, dc);
        }

        const targetUser = RollRequestService._resolveTargetUser(actor, opts.targetUserId);
        const requesterUserId = game.user.id;

        Logger.info("Library", `RollRequest: actor=${actor.name} requestedTarget=${opts.targetUserId ?? "none"} resolved=${targetUser?.name ?? "none"}(${targetUser?.id ?? "?"}) requester=${game.user.name}`);

        if (!targetUser) {
            Logger.warn("Library", "RollRequest: no target user resolved, applying offline policy.");
            return RollRequestService._applyOfflinePolicy(actor, opts, requestId);
        }

        if (targetUser.id === requesterUserId) {
            Logger.log("Library", "RollRequest: target is requester, prompting locally.");
            return RollRequestService._promptLocal(actor, opts, requestId, "player");
        }

        Logger.info("Library", `RollRequest: emitting socket request ${requestId} to ${targetUser.name} (${targetUser.id}).`);

        return new Promise((resolve, reject) => {
            const timer = opts.timeoutMs > 0
                ? setTimeout(() => {
                    _pending.delete(requestId);
                    RollRequestService._applyOfflinePolicy(actor, opts, requestId)
                        .then(resolve)
                        .catch(reject);
                }, opts.timeoutMs)
                : undefined;

            _pending.set(requestId, { resolve, reject, timer });

            RollRequestService._broadcast({
                type: SOCKET_REQUEST,
                requestId,
                requesterUserId,
                targetUserId: targetUser.id,
                actorId: actor.id,
                actorUuid: actor.uuid,
                actorName: actor.name,
                typeKey: opts.type ?? "skill",
                key: opts.key ?? "wis",
                dc,
                rollMode,
                chatMode: opts.chatMode ?? "public",
                title: opts.title ?? "Roll Request",
                flavor: opts.flavor ?? "",
                source: opts.source ?? {}
            });
        });
    }

    /**
     * Entry point for cursewright socket relay payloads.
     * @param {object} data
     */
    static onSocketRelay(data) {
        RollRequestService._onSocketMessage(data);
    }

    /**
     * Fire-and-forget variant.
     * @param {object} opts
     * @param {(result: object) => void} callback
     */
    static requestDetached(opts, callback) {
        RollRequestService.request(opts)
            .then((result) => callback?.(result))
            .catch((err) => Logger.warn("Library", "RollRequestService.requestDetached:", err?.message ?? err));
    }

    /**
     * @param {object} data
     */
    static async _onSocketMessage(data) {
        if (!data?.type) return;

        if (data.type === SOCKET_REQUEST) {
            Logger.info("Library", `RollRequest socket received: target=${data.targetUserId} me=${game.user.id} match=${RollRequestService._isTargetUser(data.targetUserId)}`);
        }

        if (data.type === SOCKET_REQUEST && RollRequestService._isTargetUser(data.targetUserId)) {
            await RollRequestService._handleIncomingRequest(data);
            return;
        }

        if (data.type === SOCKET_RESULT && String(data.requesterUserId) === String(game.user.id)) {
            RollRequestService._handleIncomingResult(data);
        }
    }

    /**
     * @param {object} data
     */
    static async _handleIncomingRequest(data) {
        if (!RollRequestService._consumeRequestId(data.requestId)) {
            Logger.info("Library", `RollRequest duplicate ${data.requestId}, skipping.`);
            return;
        }

        const actor = await RollRequestService._resolveActor(data.actorId, data.actorUuid);
        if (!actor) {
            RollRequestService._emitResult(data.requesterUserId, {
                requestId: data.requestId,
                error: "actor-not-found"
            });
            return;
        }

        const canRoll = game.user.isGM || actor.testUserPermission(game.user, "LIMITED");
        Logger.info("Library", `RollRequest incoming for ${actor.name}: canRoll=${canRoll} (isGM=${game.user.isGM})`);
        if (!canRoll) {
            Logger.warn("Library", `RollRequest: ${game.user.name} lacks permission to roll for ${actor.name}.`);
            RollRequestService._emitResult(data.requesterUserId, {
                requestId: data.requestId,
                error: "permission-denied"
            });
            return;
        }

        try {
            const result = await RollRequestPromptApp.prompt({
                actorId: actor.id,
                actor,
                type: data.typeKey ?? "skill",
                key: data.key,
                dc: data.dc,
                rollMode: data.rollMode ?? "normal",
                chatMode: data.chatMode ?? "public",
                title: data.title,
                flavor: data.flavor
            });

            RollRequestService._emitResult(data.requesterUserId, {
                requestId: data.requestId,
                total: result.total,
                passed: result.passed,
                natD20: result.natD20 ?? null,
                rolledBy: "player",
                mode: "rolled"
            });
        } catch (err) {
            RollRequestService._emitResult(data.requesterUserId, {
                requestId: data.requestId,
                error: err?.message ?? "declined"
            });
        }
    }

    /**
     * @param {object} data
     */
    static _handleIncomingResult(data) {
        const pending = _pending.get(data.requestId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        _pending.delete(data.requestId);

        if (data.error) {
            pending.reject(new Error(data.error));
            return;
        }

        pending.resolve({
            requestId: data.requestId,
            total: data.total,
            passed: data.passed,
            natD20: data.natD20 ?? null,
            rolledBy: data.rolledBy ?? "player",
            mode: data.mode ?? "rolled"
        });
    }

    /**
     * @param {string} requesterUserId
     * @param {object} payload
     */
    static _emitResult(requesterUserId, payload) {
        RollRequestService._broadcast({
            type: SOCKET_RESULT,
            requesterUserId,
            ...payload
        });
    }

    /**
     * @param {object} data
     */
    static _broadcast(data) {
        game.socket.emit(SOCKET_CHANNEL, data);

        if (!game.modules.get("ionrift-cursewright")?.active) return;

        const relayType = data.type === SOCKET_REQUEST ? RELAY_REQUEST : RELAY_RESULT;
        game.socket.emit(RELAY_CHANNEL, { type: relayType, roll: data });
        Logger.info("Library", `RollRequest: cursewright relay ${relayType} ${data.requestId ?? ""}.`);
    }

    /**
     * @param {string|undefined} targetUserId
     * @returns {boolean}
     */
    static _isTargetUser(targetUserId) {
        if (targetUserId == null) return false;
        return String(targetUserId) === String(game.user.id);
    }

    /**
     * @param {string|undefined} requestId
     * @returns {boolean}
     */
    static _consumeRequestId(requestId) {
        if (!requestId) return true;
        if (_seenRequestIds.has(requestId)) return false;
        _seenRequestIds.add(requestId);
        setTimeout(() => _seenRequestIds.delete(requestId), 120_000);
        return true;
    }

    /**
     * Resolve an actor by world id, falling back to UUID (covers token actors).
     * @param {string|undefined} actorId
     * @param {string|undefined} actorUuid
     * @returns {Promise<Actor|null>}
     */
    static async _resolveActor(actorId, actorUuid) {
        const byId = actorId ? game.actors.get(actorId) : null;
        if (byId) return byId;
        if (actorUuid) {
            try {
                const doc = await fromUuid(actorUuid);
                const actor = doc?.actor ?? doc;
                if (actor?.documentName === "Actor") return actor;
            } catch {
                /* ignore */
            }
        }
        return null;
    }

    /**
     * @param {Actor} actor
     * @param {string|undefined} targetUserId
     * @returns {User|undefined}
     */
    static _resolveTargetUser(actor, targetUserId) {
        if (targetUserId) {
            const user = game.users.get(targetUserId);
            if (user?.active) return user;
        }

        const owner = game.users.find((user) =>
            user.active && !user.isGM && actor.testUserPermission(user, "OWNER")
        );
        if (owner) return owner;

        const limited = game.users.find((user) =>
            user.active && !user.isGM && actor.testUserPermission(user, "LIMITED")
        );
        if (limited) return limited;

        if (game.user.isGM && game.user.active) return game.user;
        return undefined;
    }

    /**
     * @param {Actor} actor
     * @param {object} opts
     * @param {string} requestId
     * @param {"force-pass"|"force-fail"} rollMode
     * @param {number|null} dc
     */
    static async _resolveForced(actor, opts, requestId, rollMode, dc) {
        const total = rollMode === "force-pass"
            ? (Number.isFinite(dc) ? dc : 20)
            : (Number.isFinite(dc) ? dc - 1 : 1);
        return {
            requestId,
            total,
            passed: evaluatePassed(dc, total, rollMode),
            natD20: rollMode === "force-pass" ? 20 : 1,
            rolledBy: "system",
            mode: rollMode === "force-pass" ? "forced-pass" : "forced-fail"
        };
    }

    /**
     * @param {Actor} actor
     * @param {object} opts
     * @param {string} requestId
     */
    static async _applyOfflinePolicy(actor, opts, requestId) {
        const policy = opts.offlinePolicy ?? "gm-fallback";
        const dc = Number.isFinite(opts.dc) ? opts.dc : null;
        const rollMode = opts.rollMode ?? "normal";
        const context = opts.flavor ?? opts.title ?? "Roll request";

        if (policy === "cancel") {
            throw new Error("Roll request cancelled: target unavailable");
        }
        if (policy === "force-pass") {
            return RollRequestService._resolveForced(actor, opts, requestId, "force-pass", dc);
        }
        if (policy === "force-fail") {
            return RollRequestService._resolveForced(actor, opts, requestId, "force-fail", dc);
        }

        if (!game.user.isGM) {
            throw new Error("Roll request failed: target unavailable and caller is not GM");
        }

        const keyLabel = SKILL_DISPLAY_NAMES[opts.key] ?? opts.key;
        const gmResult = await RollRequestService._rollGmFallback(actor, opts, dc, context);
        return {
            requestId,
            total: gmResult.total,
            passed: gmResult.passed,
            natD20: gmResult.natD20 ?? null,
            rolledBy: "gm",
            mode: "gm-fallback",
            key: opts.key,
            keyLabel
        };
    }

    /**
     * @param {Actor} actor
     * @param {object} opts
     * @param {number|null} dc
     * @param {string} context
     */
    static async _rollGmFallback(actor, opts, dc, context) {
        const chatMode = opts.chatMode ?? "public";
        const rollMode = opts.rollMode ?? "normal";
        const flavor = `<strong>${actor.name}</strong> - ${context} [GM roll]`;

        if (opts.type === "save") {
            return executeSaveRoll(actor, opts.key ?? "wis", dc, flavor, rollMode, chatMode);
        }
        if (opts.type === "skill") {
            return executeSkillRoll(actor, opts.key ?? "sur", dc, flavor, rollMode, chatMode);
        }
        return executeAbilityRoll(actor, opts.key ?? "wis", dc, flavor, rollMode, chatMode);
    }

    /**
     * @param {Actor} actor
     * @param {object} opts
     * @param {string} requestId
     * @param {"player"|"gm"} rolledBy
     */
    static async _promptLocal(actor, opts, requestId, rolledBy) {
        const result = await RollRequestPromptApp.prompt({
            actorId: actor.id,
            actor,
            type: opts.type ?? "skill",
            key: opts.key ?? "wis",
            dc: opts.dc,
            rollMode: opts.rollMode ?? "normal",
            chatMode: opts.chatMode ?? "public",
            title: opts.title,
            flavor: opts.flavor
        });

        return {
            requestId,
            total: result.total,
            passed: result.passed,
            natD20: result.natD20 ?? null,
            rolledBy,
            mode: "rolled"
        };
    }
}

/** Convenience export for consumers that import mechanics directly. */
export {
    executeSaveRoll,
    executeSkillRoll,
    executeAbilityRoll,
    rollForPlayer,
    SKILL_DISPLAY_NAMES
} from "./RollRequestMechanics.js";

Hooks.once("ready", () => RollRequestService.init());
