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

/** @type {Map<string, { resolve: Function, reject: Function, timer?: ReturnType<typeof setTimeout> }>} */
const _pending = new Map();

/** @type {boolean} */
let _socketReady = false;

/**
 * Shared roll-request service. Promise-based player/GM roll handoff over game.socket.
 */
export class RollRequestService {
    static init() {
        if (_socketReady) return;
        _socketReady = true;
        game.socket.on(SOCKET_CHANNEL, (data) => RollRequestService._onSocketMessage(data));
    }

    /**
     * @param {object} opts
     * @returns {Promise<object>}
     */
    static async request(opts = {}) {
        RollRequestService.init();

        const actor = game.actors.get(opts.actorId);
        if (!actor) throw new Error("RollRequestService.request: actor not found");

        const requestId = foundry.utils.randomID();
        const rollMode = opts.rollMode ?? "normal";
        const dc = Number.isFinite(opts.dc) ? opts.dc : null;

        if (rollMode === "force-pass" || rollMode === "force-fail") {
            return RollRequestService._resolveForced(actor, opts, requestId, rollMode, dc);
        }

        const targetUser = RollRequestService._resolveTargetUser(actor, opts.targetUserId);
        const requesterUserId = game.user.id;

        if (!targetUser) {
            return RollRequestService._applyOfflinePolicy(actor, opts, requestId);
        }

        if (targetUser.id === requesterUserId) {
            return RollRequestService._promptLocal(actor, opts, requestId, "player");
        }

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

            game.socket.emit(SOCKET_CHANNEL, {
                type: SOCKET_REQUEST,
                requestId,
                requesterUserId,
                targetUserId: targetUser.id,
                actorId: actor.id,
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

        if (data.type === SOCKET_REQUEST && data.targetUserId === game.user.id) {
            await RollRequestService._handleIncomingRequest(data);
            return;
        }

        if (data.type === SOCKET_RESULT && data.requesterUserId === game.user.id) {
            RollRequestService._handleIncomingResult(data);
        }
    }

    /**
     * @param {object} data
     */
    static async _handleIncomingRequest(data) {
        const actor = game.actors.get(data.actorId);
        if (!actor) {
            RollRequestService._emitResult(data.requesterUserId, {
                requestId: data.requestId,
                error: "actor-not-found"
            });
            return;
        }

        if (!actor.isOwner && !game.user.isGM) {
            return;
        }

        try {
            const result = await RollRequestPromptApp.prompt({
                actorId: data.actorId,
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
        game.socket.emit(SOCKET_CHANNEL, {
            type: SOCKET_RESULT,
            requesterUserId,
            ...payload
        });
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

        const owner = game.users.find(u => u.active && actor.ownership?.[u.id] === 3 && !u.isGM);
        if (owner) return owner;

        const anyOwner = game.users.find(u => u.active && actor.isOwner && !u.isGM);
        if (anyOwner) return anyOwner;

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
