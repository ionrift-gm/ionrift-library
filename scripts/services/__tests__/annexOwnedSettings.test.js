import { beforeEach, describe, expect, it } from "vitest";
import {
    getWorldSetting,
    setWorldSetting,
    migrateOverlayRegistryFromLibrary,
    migrateOverlayClientSettingsFromLibrary
} from "../platform/annexOwnedSettings.js";

function createHarness({
    settingsValues = {},
    worldStorageValues = {},
    clientStorageValues = {},
    isGM = true
} = {}) {
    const values = new Map(Object.entries(settingsValues));
    const worldStorage = new Map(
        Object.entries(worldStorageValues).map(([key, value]) => [key, { value }])
    );
    const clientStorage = new Map(
        Object.entries(clientStorageValues).map(([key, value]) => [key, { value }])
    );
    const setCalls = [];

    globalThis.game = {
        user: { isGM },
        settings: {
            get(moduleId, key) {
                const id = `${moduleId}.${key}`;
                if (!values.has(id)) {
                    throw new Error(`Missing setting: ${id}`);
                }
                return values.get(id);
            },
            async set(moduleId, key, value) {
                setCalls.push({ moduleId, key, value });
                values.set(`${moduleId}.${key}`, value);
                return value;
            },
            storage: {
                get(scope) {
                    const map = scope === "client" ? clientStorage : worldStorage;
                    return {
                        get(id) {
                            return map.get(id);
                        }
                    };
                }
            }
        }
    };

    globalThis.foundry = {
        utils: {
            deepClone(value) {
                return JSON.parse(JSON.stringify(value));
            }
        }
    };

    return { values, setCalls };
}

describe("annexOwnedSettings", () => {
    beforeEach(() => {
        delete globalThis.game;
        delete globalThis.foundry;
    });

    it("reads migrated world keys from annex", () => {
        createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": true,
                "ionrift-annex.installedPacks": { packA: { version: "1.0.0" } },
                "ionrift-library.installedPacks": { stale: true }
            }
        });

        expect(getWorldSetting("installedPacks", { fallback: true })).toEqual({
            packA: { version: "1.0.0" }
        });
    });

    it("returns fallback when migrated annex key is unavailable", () => {
        createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": true
            }
        });

        expect(getWorldSetting("overlayWorldState", { safe: true })).toEqual({ safe: true });
    });

    it("prefers legacy connect storage before library and annex values", () => {
        createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": false,
                "ionrift-library.registrySnoozed": { from: "library" },
                "ionrift-annex.registrySnoozed": { from: "annex" }
            },
            worldStorageValues: {
                "ionrift-connect.registrySnoozed": { from: "connect" }
            }
        });

        expect(getWorldSetting("registrySnoozed")).toEqual({ from: "connect" });
    });

    it("mirrors writes to annex and library before migration completes", async () => {
        const { setCalls, values } = createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": false
            }
        });

        await setWorldSetting("registryLastCheck", { timestamp: 50, data: { ok: true } });

        expect(setCalls).toEqual([
            {
                moduleId: "ionrift-annex",
                key: "registryLastCheck",
                value: { timestamp: 50, data: { ok: true } }
            },
            {
                moduleId: "ionrift-library",
                key: "registryLastCheck",
                value: { timestamp: 50, data: { ok: true } }
            }
        ]);
        expect(values.get("ionrift-library.registryLastCheck")).toEqual({
            timestamp: 50,
            data: { ok: true }
        });
    });

    it("writes only to annex after migration", async () => {
        const { setCalls, values } = createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": true
            }
        });

        await setWorldSetting("overlayWorldState", { overlayA: true });

        expect(setCalls).toEqual([
            {
                moduleId: "ionrift-annex",
                key: "overlayWorldState",
                value: { overlayA: true }
            }
        ]);
        expect(values.has("ionrift-library.overlayWorldState")).toBe(false);
    });

    it("copies world migration keys to annex and clears legacy library values", async () => {
        const { values } = createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": false,
                "ionrift-library.registryLastCheck": { timestamp: 200, data: { stale: true } },
                "ionrift-library.registrySnoozed": { old: true },
                "ionrift-library.overlayDistributionEnabled": false,
                "ionrift-library.overlayWorldState": { old: "state" },
                "ionrift-library.devOverlayRegistry": { debug: true }
            },
            worldStorageValues: {
                "ionrift-connect.installedPacks": { "pack-a": { version: "2.0.0" } }
            }
        });

        await migrateOverlayRegistryFromLibrary();

        expect(values.get("ionrift-annex.installedPacks")).toEqual({
            "pack-a": { version: "2.0.0" }
        });
        expect(values.get("ionrift-annex.registrySnoozed")).toEqual({ old: true });
        expect(values.get("ionrift-library.installedPacks")).toEqual({});
        expect(values.get("ionrift-library.registryLastCheck")).toEqual({ timestamp: 0, data: null });
        expect(values.get("ionrift-library.overlayDistributionEnabled")).toBe(true);
        expect(values.get("ionrift-library.overlayWorldState")).toEqual({});
        expect(values.get("ionrift-library.devOverlayRegistry")).toEqual({});
        expect(values.get("ionrift-annex.overlayRegistryMigrated")).toBe(true);
    });

    it("copies client migration keys and marks client migration complete", async () => {
        const { values } = createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": true,
                "ionrift-annex.overlayClientSettingsMigrated": false
            },
            clientStorageValues: {
                "ionrift-connect.showPreviewContent": true
            }
        });

        await migrateOverlayClientSettingsFromLibrary();

        expect(values.get("ionrift-annex.showPreviewContent")).toBe(true);
        expect(values.get("ionrift-library.showPreviewContent")).toBe(false);
        expect(values.get("ionrift-annex.overlayClientSettingsMigrated")).toBe(true);
    });

    it("skips world migration when current user is not GM", async () => {
        const { setCalls } = createHarness({
            settingsValues: {
                "ionrift-annex.overlayRegistryMigrated": false
            },
            isGM: false
        });

        await migrateOverlayRegistryFromLibrary();
        expect(setCalls).toEqual([]);
    });
});
