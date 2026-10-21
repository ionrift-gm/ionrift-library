/**
 * One gate for Dice So Nice.
 *
 * Chat rolls: arm the gate, post the message (Dice So Nice starts from that
 * message), then wait. Do not also call showForRoll or the die animates twice.
 *
 * Silent rolls: presentRoll awaits showForRoll and does not post chat.
 */

const queue = [];
const idleWaiters = [];
let listening = false;
let listenerId = null;
let startListenerId = null;
let inFlight = 0;
let silentInFlight = 0;

/**
 * @returns {boolean}
 */
export function diceSoNiceActive() {
    const gameRef = globalThis.game;
    if (!gameRef?.modules?.get?.("dice-so-nice")?.active) return false;
    const dice3d = gameRef.dice3d;
    if (!dice3d) return false;
    if (typeof dice3d.isEnabled === "function") return !!dice3d.isEnabled();
    return true;
}

/**
 * Returns true when Dice So Nice's 3D physics box is present in the live client
 * and has no active or queued throw. Used to self-heal `inFlight` if an external
 * caller invokes `game.dice3d.showForRoll` directly (which emits `diceSoNiceRollStart`
 * with `messageId = null` without a matching `diceSoNiceRollComplete`).
 * @returns {boolean}
 */
function isLiveBoxPhysicallyIdle() {
    const d3d = globalThis.game?.dice3d;
    if (!d3d?.box) return false;
    return !d3d.box.rolling && !d3d.box._preparingThrow && (d3d.queue?.length ?? 0) === 0;
}

function flushIdleWaiters() {
    if (inFlight > 0 && silentInFlight === 0 && isLiveBoxPhysicallyIdle()) {
        inFlight = 0;
    }
    if (inFlight > 0) return;
    const waiters = idleWaiters.splice(0);
    for (const finish of waiters) finish();
}

function noteRollStart() {
    inFlight += 1;
}

function noteRollComplete() {
    if (inFlight > 0) inFlight -= 1;
    flushIdleWaiters();
}

function ensureListener() {
    if (listening) return;
    const hooks = globalThis.Hooks;
    if (typeof hooks?.on !== "function") return;
    listening = true;
    listenerId = hooks.on("diceSoNiceRollComplete", () => {
        noteRollComplete();
        const next = queue.shift();
        next?.finish();
    });
    startListenerId = hooks.on("diceSoNiceRollStart", (messageId) => {
        if (silentInFlight > 0 && messageId === null) return;
        noteRollStart();
    });
}

/** Bind the Dice So Nice start/complete observers. Safe to call more than once. */
export function observeDiceSoNice() {
    ensureListener();
}

/**
 * Register before the roll is posted. wait() resolves when that animation
 * finishes, immediately when Dice So Nice is inactive, or after timeoutMs.
 * cancel() when the roll produced no animation, so a later roll is not consumed.
 * @param {number} [timeoutMs=5000]
 * @returns {{ wait: () => Promise<void>, cancel: () => void }}
 */
export function armDiceSoNiceSettle(timeoutMs = 5000) {
    if (!diceSoNiceActive()) {
        return { wait: async () => {}, cancel() {} };
    }
    ensureListener();
    let settled = false;
    let resolveWait = () => {};
    const pending = new Promise((resolve) => { resolveWait = resolve; });
    const entry = {
        finish() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolveWait();
        }
    };
    queue.push(entry);
    const timer = setTimeout(() => {
        const idx = queue.indexOf(entry);
        if (idx >= 0) queue.splice(idx, 1);
        entry.finish();
    }, timeoutMs);
    return {
        wait: () => pending,
        cancel() {
            const idx = queue.indexOf(entry);
            if (idx >= 0) queue.splice(idx, 1);
            entry.finish();
        }
    };
}

/**
 * Run work that posts a roll, then wait for Dice So Nice.
 * A null result cancels the wait (cancelled or empty roll).
 * @template T
 * @param {() => Promise<T>} work
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<T>}
 */
export async function settleAfter(work, timeoutMs = 5000) {
    const gate = armDiceSoNiceSettle(timeoutMs);
    try {
        const result = await work();
        if (result == null) {
            gate.cancel();
            return result;
        }
        await gate.wait();
        return result;
    } catch (err) {
        gate.cancel();
        throw err;
    }
}

/**
 * @param {Roll} roll
 * @param {object} messageData
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<ChatMessage|null>}
 */
export function postRollAndSettle(roll, messageData, timeoutMs = 5000) {
    return settleAfter(() => roll.toMessage(messageData), timeoutMs);
}

/**
 * Wait for an animation that is already in flight.
 * Prefer armDiceSoNiceSettle before the roll when the caller controls timing.
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<void>}
 */
export async function waitForDiceSoNice(timeoutMs = 5000) {
    const gate = armDiceSoNiceSettle(timeoutMs);
    await gate.wait();
}

/**
 * Wait until Dice So Nice has no throw in the air.
 * Resolves immediately when Dice So Nice is inactive or idle.
 * A short grace window catches a throw that starts on the same hook turn.
 * @param {{ graceMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function waitForInFlightDice({ graceMs = 200, timeoutMs = 8000 } = {}) {
    if (!diceSoNiceActive()) return;
    ensureListener();
    if (inFlight <= 0 && graceMs > 0) {
        await new Promise((resolve) => { setTimeout(resolve, graceMs); });
    }
    if (inFlight > 0 && silentInFlight === 0 && isLiveBoxPhysicallyIdle()) {
        inFlight = 0;
    }
    if (inFlight <= 0) return;

    await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
        };
        idleWaiters.push(finish);
        if (inFlight <= 0 || (silentInFlight === 0 && isLiveBoxPhysicallyIdle())) {
            if (silentInFlight === 0 && isLiveBoxPhysicallyIdle()) inFlight = 0;
            const idx = idleWaiters.indexOf(finish);
            if (idx >= 0) idleWaiters.splice(idx, 1);
            finish();
            return;
        }
        timer = setTimeout(() => {
            const idx = idleWaiters.indexOf(finish);
            if (idx >= 0) idleWaiters.splice(idx, 1);
            finish();
        }, timeoutMs);
    });
}

/**
 * Animate a roll that was not posted to chat. Awaiting this is the settle.
 * Do not use on a roll that was also sent to chat.
 * @param {Roll} roll
 * @param {User} [user]
 * @returns {Promise<void>}
 */
export async function presentRoll(roll, user) {
    if (!roll || !diceSoNiceActive()) return;
    const dice3d = globalThis.game?.dice3d;
    if (typeof dice3d?.showForRoll !== "function") return;
    ensureListener();
    silentInFlight += 1;
    noteRollStart();
    try {
        await dice3d.showForRoll(roll, user ?? globalThis.game.user, true);
    } catch {
        /* animation is optional */
    } finally {
        silentInFlight = Math.max(0, silentInFlight - 1);
        noteRollComplete();
    }
}

/** Test hook. Drops pending gates and lets the next arm bind a fresh listener. */
export function resetDiceSettleForTests() {
    for (const entry of queue.splice(0)) entry.finish();
    inFlight = 0;
    silentInFlight = 0;
    flushIdleWaiters();
    const hooks = globalThis.Hooks;
    if (listening && listenerId != null) hooks?.off?.("diceSoNiceRollComplete", listenerId);
    if (startListenerId != null) hooks?.off?.("diceSoNiceRollStart", startListenerId);
    listening = false;
    listenerId = null;
    startListenerId = null;
}
