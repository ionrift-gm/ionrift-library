import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackRegistryService } from "../scripts/services/PackRegistryService.js";

const REGISTRY_WITH_UPDATE = {
    schemaVersion: 1,
    packs: {
        "ionrift.respite.events.core": { latest: "2.0.0", patreonUrl: "https://patreon.com/example" },
        "ionrift.resonance.sfx.core": { latest: "1.5.0" }
    }
};

const REGISTRY_UP_TO_DATE = {
    schemaVersion: 1,
    packs: {
        "ionrift.respite.events.core": { latest: "1.0.0" }
    }
};

function makeSettingsStore(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        get: vi.fn((module, key) => {
            const value = store.get(`${module}.${key}`);
            if (value !== undefined) return value;
            if (key === "registryLastCheck") return { timestamp: 0, data: null };
            if (key === "installedPacks") return {};
            return undefined;
        }),
        set: vi.fn(async (module, key, value) => {
            store.set(`${module}.${key}`, value);
        }),
        _store: store
    };
}

function setupGlobals(settingsOverrides = {}) {
    const settings = makeSettingsStore(settingsOverrides);

    globalThis.game = {
        system: { id: "dnd5e" },
        user: { isGM: true },
        settings,
        ionrift: {}
    };

    globalThis.ui = {
        notifications: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        }
    };

    return { settings };
}

function mockFetch(data, ok = true) {
    globalThis.fetch = vi.fn(() =>
        Promise.resolve({
            ok,
            status: ok ? 200 : 500,
            json: () => Promise.resolve(data)
        })
    );
}

function mockFetchError() {
    globalThis.fetch = vi.fn(() => Promise.reject(new TypeError("Network error")));
}

describe("checkForUpdates()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("shows notification when installed pack is outdated", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {
                "ionrift.respite.events.core": { version: "1.0.0", tier: "core" }
            }
        });
        mockFetch(REGISTRY_WITH_UPDATE);

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).toHaveBeenCalledTimes(1);
        expect(ui.notifications.info.mock.calls[0][0]).toContain("v2.0.0");
        expect(ui.notifications.info.mock.calls[0][0]).toContain("v1.0.0");
    });

    it("shows no notification when installed pack is up to date", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {
                "ionrift.respite.events.core": { version: "1.0.0", tier: "core" }
            }
        });
        mockFetch(REGISTRY_UP_TO_DATE);

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).not.toHaveBeenCalled();
    });

    it("shows no notification for registry packs not installed locally", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {}
        });
        mockFetch(REGISTRY_WITH_UPDATE);

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).not.toHaveBeenCalled();
    });

    it("shows no notification for installed packs not in registry", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {
                "ionrift.custom.homebrew": { version: "1.0.0", tier: "custom" }
            }
        });
        mockFetch(REGISTRY_UP_TO_DATE);

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).not.toHaveBeenCalled();
    });

    it("does not crash on network error and logs a warning", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {
                "ionrift.respite.events.core": { version: "1.0.0" }
            }
        });
        mockFetchError();
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("includes Patreon link in notification when available", async () => {
        setupGlobals({
            "ionrift-library.installedPacks": {
                "ionrift.respite.events.core": { version: "1.0.0", tier: "core" }
            }
        });
        mockFetch(REGISTRY_WITH_UPDATE);

        await PackRegistryService.checkForUpdates();

        expect(ui.notifications.info).toHaveBeenCalledTimes(1);
        expect(ui.notifications.info.mock.calls[0][0]).toContain("patreon.com");
    });
});

describe("cache behavior", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("fetches from network on first check", async () => {
        const { settings } = setupGlobals({
            "ionrift-library.installedPacks": {}
        });
        mockFetch(REGISTRY_UP_TO_DATE);

        await PackRegistryService.checkForUpdates();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(settings.set).toHaveBeenCalledWith(
            "ionrift-library",
            "registryLastCheck",
            expect.objectContaining({ data: REGISTRY_UP_TO_DATE })
        );
    });

    it("uses cache within 24 hours and does not fetch", async () => {
        setupGlobals({
            "ionrift-library.registryLastCheck": {
                timestamp: Date.now() - 1000,
                data: REGISTRY_UP_TO_DATE
            },
            "ionrift-library.installedPacks": {}
        });
        mockFetch(REGISTRY_WITH_UPDATE);

        await PackRegistryService.checkForUpdates();

        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("fetches again after 24 hours", async () => {
        setupGlobals({
            "ionrift-library.registryLastCheck": {
                timestamp: Date.now() - (25 * 60 * 60 * 1000),
                data: REGISTRY_UP_TO_DATE
            },
            "ionrift-library.installedPacks": {}
        });
        mockFetch(REGISTRY_UP_TO_DATE);

        await PackRegistryService.checkForUpdates();

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
});
