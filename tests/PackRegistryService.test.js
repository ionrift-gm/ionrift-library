import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackRegistryService } from "../scripts/services/PackRegistryService.js";
import { CloudRelayService } from "../scripts/services/CloudRelayService.js";

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

// ── Module Updates & Early Access (schema v2) ───────────────────

const REGISTRY_V2 = {
    schemaVersion: 2,
    packs: {},
    modules: {
        "ionrift-workshop": {
            latest: "1.0.0",
            earlyAccess: {
                version: "1.1.0-beta.1",
                tier: "Acolyte",
                publishedAt: "2026-04-20T00:00:00Z",
                publicAt: "2026-05-04T00:00:00Z"
            }
        }
    }
};

function setupModuleGlobals(settingsOverrides = {}, installedModules = new Map()) {
    const settings = makeSettingsStore(settingsOverrides);

    globalThis.game = {
        system: { id: "dnd5e" },
        user: { isGM: true },
        settings,
        modules: installedModules,
        ionrift: { library: {} }
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

describe("_checkModuleUpdates()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("calls _showModuleUpdateNotification when installed version is behind", () => {
        const modules = new Map([["ionrift-workshop", { version: "0.9.0" }]]);
        setupModuleGlobals({}, modules);

        const spy = vi.spyOn(PackRegistryService, "_showModuleUpdateNotification").mockImplementation(() => {});

        PackRegistryService._checkModuleUpdates(REGISTRY_V2);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("ionrift-workshop", "0.9.0", REGISTRY_V2.modules["ionrift-workshop"]);
    });

    it("does not notify when installed version matches latest", () => {
        const modules = new Map([["ionrift-workshop", { version: "1.0.0" }]]);
        setupModuleGlobals({}, modules);

        const spy = vi.spyOn(PackRegistryService, "_showModuleUpdateNotification").mockImplementation(() => {});

        PackRegistryService._checkModuleUpdates(REGISTRY_V2);

        expect(spy).not.toHaveBeenCalled();
    });

    it("does not notify when module is not installed", () => {
        setupModuleGlobals({}, new Map());

        const spy = vi.spyOn(PackRegistryService, "_showModuleUpdateNotification").mockImplementation(() => {});

        PackRegistryService._checkModuleUpdates(REGISTRY_V2);

        expect(spy).not.toHaveBeenCalled();
    });
});

describe("_checkEarlyAccess()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("notifies when user tier qualifies and publicAt is in the future", () => {
        setupModuleGlobals({}, new Map());
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue("Acolyte");
        vi.spyOn(PackRegistryService, "_isPackSnoozed").mockReturnValue(false);

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        PackRegistryService._checkEarlyAccess(REGISTRY_V2);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith("ionrift-workshop", REGISTRY_V2.modules["ionrift-workshop"].earlyAccess);
    });

    it("stays silent when user tier is below required tier", () => {
        setupModuleGlobals({}, new Map());
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue("Initiate");
        vi.spyOn(PackRegistryService, "_isPackSnoozed").mockReturnValue(false);

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        PackRegistryService._checkEarlyAccess(REGISTRY_V2);

        expect(spy).not.toHaveBeenCalled();
    });

    it("stays silent when publicAt is in the past", () => {
        const expiredRegistry = structuredClone(REGISTRY_V2);
        expiredRegistry.modules["ionrift-workshop"].earlyAccess.publicAt = "2020-01-01T00:00:00Z";

        setupModuleGlobals({}, new Map());
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue("Acolyte");

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        PackRegistryService._checkEarlyAccess(expiredRegistry);

        expect(spy).not.toHaveBeenCalled();
    });

    it("stays silent when module is already installed at the EA version", () => {
        const modules = new Map([["ionrift-workshop", { version: "1.1.0-beta.1" }]]);
        setupModuleGlobals({}, modules);
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue("Acolyte");

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        PackRegistryService._checkEarlyAccess(REGISTRY_V2);

        expect(spy).not.toHaveBeenCalled();
    });

    it("stays silent when no sigil is stored (getTierClaim returns null)", () => {
        setupModuleGlobals({}, new Map());
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue(null);

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        PackRegistryService._checkEarlyAccess(REGISTRY_V2);

        expect(spy).not.toHaveBeenCalled();
    });

    it("does not crash when registry has no modules key (v1 schema)", () => {
        setupModuleGlobals({}, new Map());
        vi.spyOn(CloudRelayService, "getTierClaim").mockReturnValue("Acolyte");

        const spy = vi.spyOn(PackRegistryService, "_showEarlyAccessNotification").mockImplementation(() => {});

        expect(() => PackRegistryService._checkEarlyAccess({ schemaVersion: 1, packs: {} })).not.toThrow();
        expect(spy).not.toHaveBeenCalled();
    });
});
