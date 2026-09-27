/**
 * One gate for Dice So Nice.
 *
 * Chat rolls: arm the gate, post the message (Dice So Nice starts from that
 * message), then wait. Do not also call showForRoll or the die animates twice.
 *
 * Silent rolls: presentRoll awaits showForRoll and does not post chat.
 */

const queue = [];
let listening = false;
let listenerId = null;

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

function ensureListener() {
    if (listening) return;
    const hooks = globalThis.Hooks;
    if (typeof hooks?.on !== "function") return;
    listening = true;
    listenerId = hooks.on("diceSoNiceRollComplete", () => {
        const next = queue.shift();
        next?.finish();
    });
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
    try {
        await dice3d.showForRoll(roll, user ?? globalThis.game.user, true);
    } catch {
        /* animation is optional */
    }
}

/** Test hook. Drops pending gates and lets the next arm bind a fresh listener. */
export function resetDiceSettleForTests() {
    for (const entry of queue.splice(0)) entry.finish();
    const hooks = globalThis.Hooks;
    if (listening && listenerId != null) hooks?.off?.("diceSoNiceRollComplete", listenerId);
    listening = false;
    listenerId = null;
}
