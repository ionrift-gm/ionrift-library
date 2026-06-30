/** Sentinel an entry resolves with when it is dismissed before settling. */
export const DISMISSED = Symbol("ionrift.promptQueue.dismissed");

/**
 * Single-active prompt queue.
 *
 * Serialises asynchronous prompt work so only one entry runs at a time. Extra
 * entries wait FIFO and start when the active one settles. Each entry carries a
 * stable id so an outstanding prompt can be dismissed by id (e.g. a GM steps in
 * and resolves a roll on the player's behalf); dismissing the active entry tears
 * it down and advances the queue, dismissing a waiting entry drops it before it
 * ever starts. Resolve, reject, and dismiss all advance the queue, so a client
 * can never sit idle with work still queued.
 *
 * Free of Foundry/DOM dependencies so the ordering, dismiss, and advance-on
 * settle behaviour can be exercised in isolation.
 */
export class PromptQueue {
    /** @type {Entry|null} */
    #active = null;

    /** @type {Entry[]} */
    #waiting = [];

    /**
     * Queue prompt work. `run` is invoked only when the entry becomes active and
     * receives a handle whose `onDismiss(cb)` registers teardown to run if the
     * entry is dismissed while active.
     * @param {object} options
     * @param {string|null} [options.id] Stable correlation id for dismiss.
     * @param {(handle: { onDismiss: (cb: () => void) => void }) => (Promise<*>|*)} options.run
     * @returns {Promise<*>} Resolves with run's value, or {@link DISMISSED}.
     */
    enqueue({ id = null, run } = {}) {
        if (typeof run !== "function") {
            return Promise.reject(new Error("PromptQueue.enqueue: run must be a function"));
        }

        return new Promise((resolve, reject) => {
            this.#waiting.push({
                id: id ?? null,
                run,
                resolve,
                reject,
                settled: false,
                dismissHandlers: []
            });
            this.#pump();
        });
    }

    /** @returns {boolean} Whether an entry is currently active. */
    get busy() {
        return this.#active !== null;
    }

    /** @returns {number} Entries waiting behind the active one. */
    get pending() {
        return this.#waiting.length;
    }

    /** @returns {string|null} Id of the active entry, if any. */
    get activeId() {
        return this.#active?.id ?? null;
    }

    /**
     * Dismiss the entry matching id. An active match is torn down (its dismiss
     * handlers run) and resolved with {@link DISMISSED}; a waiting match is
     * dropped before it starts. Advances the queue on a hit.
     * @param {string} id
     * @returns {boolean} Whether a matching entry was found.
     */
    dismiss(id) {
        if (id === null || id === undefined) return false;

        if (this.#active && this.#active.id === id) {
            const entry = this.#active;
            for (const handler of entry.dismissHandlers) {
                try {
                    handler();
                } catch {
                    /* teardown best-effort */
                }
            }
            this.#settle(entry, () => entry.resolve(DISMISSED));
            return true;
        }

        const index = this.#waiting.findIndex((entry) => entry.id === id);
        if (index >= 0) {
            const [entry] = this.#waiting.splice(index, 1);
            entry.settled = true;
            entry.resolve(DISMISSED);
            return true;
        }

        return false;
    }

    #pump() {
        if (this.#active) return;

        const next = this.#waiting.shift();
        if (!next) return;

        this.#active = next;
        const handle = {
            onDismiss: (cb) => {
                if (typeof cb === "function") next.dismissHandlers.push(cb);
            }
        };

        Promise.resolve()
            .then(() => next.run(handle))
            .then(
                (value) => this.#settle(next, () => next.resolve(value)),
                (error) => this.#settle(next, () => next.reject(error))
            );
    }

    #settle(entry, finalise) {
        if (entry.settled) return;
        entry.settled = true;
        if (this.#active === entry) this.#active = null;
        finalise();
        this.#pump();
    }
}

/**
 * @typedef {object} Entry
 * @property {string|null} id
 * @property {(handle: object) => (Promise<*>|*)} run
 * @property {(value: *) => void} resolve
 * @property {(error: *) => void} reject
 * @property {boolean} settled
 * @property {Array<() => void>} dismissHandlers
 */
