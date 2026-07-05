import { describe, expect, it } from "vitest";

import { DISMISSED, PromptQueue } from "../../apps/PromptQueue.js";

function createDeferred() {
    /** @type {(value?: unknown) => void} */
    let resolve;
    /** @type {(reason?: unknown) => void} */
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("PromptQueue", () => {
    it("runs entries in FIFO order and only one active at a time", async () => {
        const queue = new PromptQueue();
        const events = [];
        const gate = createDeferred();

        const first = queue.enqueue({
            id: "first",
            run: async () => {
                events.push("first:start");
                await gate.promise;
                events.push("first:end");
                return "first-result";
            }
        });

        const second = queue.enqueue({
            id: "second",
            run: () => {
                events.push("second:start");
                return "second-result";
            }
        });

        await Promise.resolve();
        expect(queue.busy).toBe(true);
        expect(queue.activeId).toBe("first");
        expect(queue.pending).toBe(1);
        expect(events).toEqual(["first:start"]);

        gate.resolve();

        await expect(first).resolves.toBe("first-result");
        await expect(second).resolves.toBe("second-result");
        expect(events).toEqual([
            "first:start",
            "first:end",
            "second:start"
        ]);
        expect(queue.busy).toBe(false);
        expect(queue.pending).toBe(0);
    });

    it("dismisses a waiting entry without running it", async () => {
        const queue = new PromptQueue();
        const gate = createDeferred();
        let waitingRan = false;

        const first = queue.enqueue({
            id: "active",
            run: async () => {
                await gate.promise;
                return "done";
            }
        });

        const waiting = queue.enqueue({
            id: "waiting",
            run: () => {
                waitingRan = true;
                return "should-not-run";
            }
        });

        await Promise.resolve();
        expect(queue.pending).toBe(1);

        expect(queue.dismiss("waiting")).toBe(true);
        await expect(waiting).resolves.toBe(DISMISSED);
        expect(waitingRan).toBe(false);

        gate.resolve();
        await expect(first).resolves.toBe("done");
    });

    it("dismisses the active entry, runs dismiss handlers, and advances", async () => {
        const queue = new PromptQueue();
        const onDismissCalls = [];
        const never = new Promise(() => {});

        const first = queue.enqueue({
            id: "active",
            run: (handle) => {
                handle.onDismiss(() => onDismissCalls.push("cleaned"));
                return never;
            }
        });

        const second = queue.enqueue({
            id: "next",
            run: () => "next-result"
        });

        await Promise.resolve();
        expect(queue.activeId).toBe("active");

        expect(queue.dismiss("active")).toBe(true);
        await expect(first).resolves.toBe(DISMISSED);
        await expect(second).resolves.toBe("next-result");
        expect(onDismissCalls).toEqual(["cleaned"]);
    });

    it("advances the queue after a rejected entry", async () => {
        const queue = new PromptQueue();
        const error = new Error("boom");

        const failing = queue.enqueue({
            id: "bad",
            run: () => {
                throw error;
            }
        });

        const next = queue.enqueue({
            id: "good",
            run: () => "ok"
        });

        await expect(failing).rejects.toThrow("boom");
        await expect(next).resolves.toBe("ok");
    });
});
