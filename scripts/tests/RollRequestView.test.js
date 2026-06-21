import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    buildEventPlayerRollContext,
    buildPromptRollContext,
    buildRollParticipants,
    buildRollRequestContext,
    buildTravelActivityRollContext
} from "../services/RollRequestView.js";

const originalGame = globalThis.game;

function makeActor(id, { name = "Actor", isOwner = false, img = "" } = {}) {
    return { id, name, isOwner, img };
}

describe("RollRequestView", () => {
    /** @type {Map<string, any>} */
    let actors;

    beforeEach(() => {
        actors = new Map();
        globalThis.game = {
            system: { id: "dnd5e" },
            actors: {
                get: (id) => actors.get(id)
            },
            users: []
        };
    });

    afterEach(() => {
        globalThis.game = originalGame;
    });

    it("buildRollParticipants marks force outcomes as non-rollable and resolves fallback names", () => {
        actors.set("a1", makeActor("a1", { name: "Aldric", isOwner: true, img: "aldric.webp" }));
        actors.set("a2", makeActor("a2", { name: "Bruna", isOwner: true }));

        const participants = buildRollParticipants(["a1", "a2", "a3"], {
            rollModes: { a1: "force-fail", a2: "normal" },
            resolvedRolls: [
                { characterId: "a2", total: 15, passed: true },
                { id: "a3", name: "Cade", total: 8, passed: false }
            ],
            rolledCharacters: new Set(["a1"])
        });

        expect(participants[0]).toMatchObject({
            id: "a1",
            forced: true,
            rolled: true,
            canRoll: false
        });
        expect(participants[1]).toMatchObject({
            id: "a2",
            rolled: true,
            total: 15,
            passed: true,
            canRoll: false
        });
        expect(participants[2]).toMatchObject({
            id: "a3",
            name: "Cade",
            rolled: true,
            isOwner: false,
            canRoll: false
        });
    });

    it("buildRollRequestContext derives partial state and owner forced outcomes", () => {
        const context = buildRollRequestContext({
            participants: [
                { id: "a1", name: "Aldric", rollMode: "force-pass", forced: true, rolled: false, isOwner: true, canRoll: false, total: null, passed: null },
                { id: "a2", name: "Bruna", rollMode: "normal", forced: false, rolled: false, isOwner: false, canRoll: true, total: null, passed: null }
            ]
        });

        expect(context.state).toBe("partial");
        expect(context.rolledCount).toBe(1);
        expect(context.totalCount).toBe(2);
        expect(context.ownerSettled).toBe(true);
        expect(context.ownerOutcome).toBe("pass");
        expect(context.allRolled).toBe(false);
    });

    it("buildEventPlayerRollContext falls back to local rolledResults map", () => {
        actors.set("a1", makeActor("a1", { name: "Aldric", isOwner: true }));
        const pendingEventRoll = {
            targets: ["a1"],
            rolledResults: new Map([["a1", { total: 18, passed: true }]]),
            rollModes: { a1: "normal" },
            rolledCharacters: new Set(),
            eventTitle: "Night Watch",
            skill: "prc",
            skillName: "Perception",
            dc: 14,
            eventIndex: 2
        };

        const context = buildEventPlayerRollContext(pendingEventRoll, null);

        expect(context).not.toBeNull();
        expect(context.state).toBe("submitted");
        expect(context.participants[0]).toMatchObject({
            id: "a1",
            total: 18,
            passed: true,
            rolled: true
        });
    });

    it("buildTravelActivityRollContext flags no-DC scouting rows", () => {
        actors.set("a1", makeActor("a1", { name: "Aldric", isOwner: true }));
        const context = buildTravelActivityRollContext({
            isOwner: true,
            actorId: "a1",
            activity: "scout",
            activityLabel: "Scouting",
            day: 3,
            skill: "sur",
            skillName: "Survival"
        });

        expect(context).not.toBeNull();
        expect(context.dc).toBe(0);
        expect(context.targetLabel).toBe("Scouting · no fixed DC");
        expect(context.meta.noDc).toBe(true);
    });

    it("buildPromptRollContext labels save requests and only surfaces valid rolled values", () => {
        const context = buildPromptRollContext({
            actor: makeActor("a1", { name: "Aldric", isOwner: true }),
            type: "save",
            key: "wis",
            rolled: true,
            total: "18",
            passed: "yes"
        });

        expect(context.skillName).toBe("Wisdom Saving Throw");
        expect(context.state).toBe("submitted");
        expect(context.participants[0]).toMatchObject({
            rolled: true,
            total: null,
            passed: null,
            canRoll: false
        });
    });
});
