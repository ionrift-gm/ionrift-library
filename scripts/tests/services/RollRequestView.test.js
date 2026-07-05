import { afterEach, describe, expect, it } from "vitest";

import {
    buildPromptRollContext,
    buildRollParticipants,
    buildRollRequestContext
} from "../../services/RollRequestView.js";

const originalGame = globalThis.game;

afterEach(() => {
    globalThis.game = originalGame;
});

describe("RollRequestView", () => {
    it("marks forced participants as settled and non-rollable", () => {
        globalThis.game = {
            actors: {
                get: (id) => ({
                    a1: { id: "a1", name: "Aldric", img: "a.png", isOwner: true },
                    a2: { id: "a2", name: "Bruna", img: "b.png", isOwner: true }
                })[id]
            }
        };

        const participants = buildRollParticipants(["a1", "a2", "a3"], {
            rollModes: {
                a1: "force-pass",
                a2: "normal",
                a3: "force-fail"
            },
            rolledCharacters: new Set(["a2"]),
            resolvedRolls: [{ characterId: "a3", name: "Cade", total: 4, passed: false }]
        });

        expect(participants).toHaveLength(3);
        expect(participants[0]).toMatchObject({
            id: "a1",
            forced: true,
            rolled: false,
            canRoll: false
        });
        expect(participants[1]).toMatchObject({
            id: "a2",
            forced: false,
            rolled: true,
            canRoll: false
        });
        expect(participants[2]).toMatchObject({
            id: "a3",
            name: "Cade",
            forced: true,
            rolled: true,
            canRoll: false,
            total: 4,
            passed: false
        });
    });

    it("derives owner outcome and partial state when owner is force-resolved", () => {
        const context = buildRollRequestContext({
            participants: [
                {
                    id: "owner",
                    name: "Owner",
                    isOwner: true,
                    rollMode: "force-pass",
                    forced: true,
                    rolled: false,
                    canRoll: false,
                    total: 17,
                    passed: true
                },
                {
                    id: "ally",
                    name: "Ally",
                    isOwner: false,
                    rollMode: "normal",
                    forced: false,
                    rolled: false,
                    canRoll: false,
                    total: null,
                    passed: null
                }
            ]
        });

        expect(context.rolledCount).toBe(1);
        expect(context.totalCount).toBe(2);
        expect(context.state).toBe("partial");
        expect(context.ownerSettled).toBe(true);
        expect(context.ownerOutcome).toBe("pass");
        expect(context.ownerTotal).toBe(17);
    });

    it("builds formula prompt contexts without DC and pulse", () => {
        const context = buildPromptRollContext({
            actor: { id: "a1", name: "Aldric", img: "a.png" },
            type: "formula",
            formula: "2d6+3",
            rolled: true,
            total: 11,
            title: "Custom Roll"
        });

        expect(context.title).toBe("Custom Roll");
        expect(context.dc).toBe(10);
        expect(context.meta).toEqual({ noDc: true });
        expect(context.dcPulseActive).toBe(false);
        expect(context.state).toBe("submitted");
        expect(context.participants[0]).toMatchObject({
            id: "a1",
            rolled: true,
            total: 11,
            canRoll: false
        });
    });
});
