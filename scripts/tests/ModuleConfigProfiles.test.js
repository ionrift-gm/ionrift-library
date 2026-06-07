import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleConfigProfiles } from "../ModuleConfigProfiles.js";

const originalGame = globalThis.game;
const originalFoundry = globalThis.foundry;
const originalUi = globalThis.ui;
const originalDocument = globalThis.document;

function makeConfig() {
    return {
        moduleId: "ionrift-library",
        moduleLabel: "Ionrift Library",
        quickSetup: {
            title: "Quick Setup",
            subtitle: "Applies profile presets.",
            profiles: [
                {
                    id: "safe",
                    label: "Safe",
                    icon: "fas fa-shield",
                    desc: "Balanced defaults.",
                    values: {
                        alpha: 1,
                        beta: 2,
                        gamma: true
                    }
                }
            ],
            profileKeys: ["alpha", "beta", "gamma"],
            keyLabels: {
                alpha: "Alpha",
                beta: "Beta",
                gamma: "Gamma"
            }
        }
    };
}

describe("ModuleConfigProfiles", () => {
    beforeEach(() => {
        globalThis.game = {
            settings: {
                get: vi.fn(),
                set: vi.fn().mockResolvedValue(undefined)
            }
        };
        globalThis.foundry = {
            applications: {
                api: {
                    DialogV2: {
                        confirm: vi.fn()
                    }
                }
            }
        };
        globalThis.ui = {
            notifications: {
                info: vi.fn()
            }
        };
        globalThis.document = {
            querySelector: vi.fn(() => null)
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
        globalThis.game = originalGame;
        globalThis.foundry = originalFoundry;
        globalThis.ui = originalUi;
        globalThis.document = originalDocument;
    });

    it("profileValueChanged treats tiny number deltas as unchanged", () => {
        expect(ModuleConfigProfiles.profileValueChanged(1, 1 + 1e-10)).toBe(false);
        expect(ModuleConfigProfiles.profileValueChanged(1, 1.0001)).toBe(true);
        expect(ModuleConfigProfiles.profileValueChanged("on", "off")).toBe(true);
    });

    it("getActiveProfileId returns profile id when all values match", () => {
        game.settings.get.mockImplementation((moduleId, key) => {
            expect(moduleId).toBe("ionrift-library");
            return { alpha: 1, beta: 2, gamma: true }[key];
        });

        const active = ModuleConfigProfiles.getActiveProfileId(
            "ionrift-library",
            [
                { id: "safe", values: { alpha: 1, beta: 2, gamma: true } },
                { id: "fast", values: { alpha: 3, beta: 4, gamma: false } }
            ],
            ["alpha", "beta", "gamma"]
        );

        expect(active).toBe("safe");
    });

    it("getActiveProfileId returns null when settings access fails", () => {
        game.settings.get.mockImplementation(() => {
            throw new Error("missing setting");
        });

        const active = ModuleConfigProfiles.getActiveProfileId(
            "ionrift-library",
            [{ id: "safe", values: { alpha: 1 } }],
            ["alpha"]
        );

        expect(active).toBeNull();
    });

    it("applyProfile highlights only changed values and applies settings after confirm", async () => {
        const config = makeConfig();
        game.settings.get.mockImplementation((moduleId, key) => {
            expect(moduleId).toBe("ionrift-library");
            return {
                alpha: 1, // unchanged
                beta: 1, // changed
                gamma: false // changed
            }[key];
        });
        foundry.applications.api.DialogV2.confirm.mockResolvedValue(true);

        await ModuleConfigProfiles.applyProfile(config, "safe");

        expect(foundry.applications.api.DialogV2.confirm).toHaveBeenCalledTimes(1);
        const [dialogPayload] = foundry.applications.api.DialogV2.confirm.mock.calls[0];
        expect(dialogPayload.content).toContain("<td class=\"value\">1</td>");
        expect(dialogPayload.content).toContain("<td class=\"on\">2</td>");
        expect(dialogPayload.content).toContain("<td class=\"on\">On</td>");

        expect(game.settings.set).toHaveBeenCalledTimes(3);
        expect(game.settings.set).toHaveBeenNthCalledWith(1, "ionrift-library", "alpha", 1);
        expect(game.settings.set).toHaveBeenNthCalledWith(2, "ionrift-library", "beta", 2);
        expect(game.settings.set).toHaveBeenNthCalledWith(3, "ionrift-library", "gamma", true);
        expect(ui.notifications.info).toHaveBeenCalledWith("Ionrift Library: Safe setup applied.");
    });

    it("applyProfile does not update settings when confirmation is cancelled", async () => {
        const config = makeConfig();
        game.settings.get.mockReturnValue(0);
        foundry.applications.api.DialogV2.confirm.mockResolvedValue(false);

        await ModuleConfigProfiles.applyProfile(config, "safe");

        expect(game.settings.set).not.toHaveBeenCalled();
        expect(ui.notifications.info).not.toHaveBeenCalled();
    });
});
