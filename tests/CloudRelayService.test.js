import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudRelayService } from "../scripts/services/CloudRelayService.js";

const STUB_SIGIL = "header.eyJ0aWVyIjoiQWNvbHl0ZSJ9.sig";

function makeSettingsStore(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        get: vi.fn((module, key) => {
            const value = store.get(`${module}.${key}`);
            if (value !== undefined) return value;
            if (key === "sigil") return "";
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
            json: () => Promise.resolve(data),
            text: () => Promise.resolve(JSON.stringify(data))
        })
    );
}

describe("isConnected()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("returns true when a sigil is stored", () => {
        setupGlobals({ "ionrift-library.sigil": STUB_SIGIL });
        expect(CloudRelayService.isConnected()).toBe(true);
    });

    it("returns false when sigil is empty", () => {
        setupGlobals({ "ionrift-library.sigil": "" });
        expect(CloudRelayService.isConnected()).toBe(false);
    });

    it("returns false when sigil setting is missing", () => {
        setupGlobals();
        expect(CloudRelayService.isConnected()).toBe(false);
    });
});

describe("getTierClaim()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("returns 'Acolyte' from a valid stub JWT", () => {
        setupGlobals({ "ionrift-library.sigil": STUB_SIGIL });
        expect(CloudRelayService.getTierClaim()).toBe("Acolyte");
    });

    it("returns null when no sigil is stored", () => {
        setupGlobals();
        expect(CloudRelayService.getTierClaim()).toBeNull();
    });

    it("returns null on malformed JWT (missing segments)", () => {
        setupGlobals({ "ionrift-library.sigil": "not-a-jwt" });
        expect(CloudRelayService.getTierClaim()).toBeNull();
    });

    it("returns null on malformed JWT (invalid base64 payload)", () => {
        setupGlobals({ "ionrift-library.sigil": "a.!!!.b" });
        expect(CloudRelayService.getTierClaim()).toBeNull();
    });
});

describe("requestDownload()", () => {
    beforeEach(() => vi.restoreAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("returns null immediately when not connected (no fetch call)", async () => {
        setupGlobals();
        globalThis.fetch = vi.fn();
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await CloudRelayService.requestDownload("some-pack", "1.0.0");

        expect(result).toBeNull();
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("calls fetch with correct URL and Authorization header when connected", async () => {
        setupGlobals({ "ionrift-library.sigil": STUB_SIGIL });
        const payload = { url: "https://signed.example.com/dl", expiresAt: "2026-05-01T00:00:00Z" };
        mockFetch(payload);

        const result = await CloudRelayService.requestDownload("ionrift-workshop", "1.0.0");

        expect(result).toEqual(payload);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        const [url, opts] = globalThis.fetch.mock.calls[0];
        expect(url).toBe(`${CloudRelayService.API_URL}/packs/download`);
        expect(opts.method).toBe("POST");
        expect(opts.headers["Authorization"]).toBe(`Bearer ${STUB_SIGIL}`);
        expect(JSON.parse(opts.body)).toEqual({ packId: "ionrift-workshop", version: "1.0.0" });
    });
});
