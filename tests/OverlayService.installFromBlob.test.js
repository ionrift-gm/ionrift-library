/**
 * OverlayService.installFromBlob — install serialization test.
 *
 * Regression: installFromBlob was added without routing through
 * _runInstallTask, allowing manual zip imports to run concurrently
 * with cloud installs. On The Forge this causes rate doubling,
 * toast suppression races, and silent partial installs.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Foundry globals ──────────────────────────────────────────────────────
vi.hoisted(() => {
    globalThis.foundry = {
        utils: { deepClone: (o) => structuredClone(o) }
    };
    globalThis.game = {
        modules: { get: () => ({ active: true, version: "1.0.0" }) },
        settings: {
            get: () => ({}),
            set: vi.fn().mockResolvedValue(undefined)
        },
        user: { isGM: true }
    };
    globalThis.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    globalThis.Hooks = { callAll: vi.fn() };
});

// ── Mock PlatformHelper before OverlayService loads ──────────────────────
vi.mock("../scripts/services/PlatformHelper.js", () => ({
    PlatformHelper: {
        isForge: false,
        fileSource: "data",
        FP: {
            browse: vi.fn().mockResolvedValue({ dirs: [], files: [] }),
            upload: vi.fn().mockResolvedValue({})
        },
        loadJSZip: vi.fn().mockResolvedValue({
            loadAsync: vi.fn().mockResolvedValue({
                files: {},
                forEach: vi.fn()
            })
        }),
        readDataJson: vi.fn().mockResolvedValue(null),
        ensureDirectory: vi.fn().mockResolvedValue(undefined),
        withSuppressedToasts: vi.fn().mockImplementation((fn) => fn())
    }
}));

vi.mock("../scripts/services/CloudRelayService.js", () => ({
    CloudRelayService: {
        isConnected: () => true,
        getTierClaim: () => "Free"
    }
}));

vi.mock("../scripts/services/PackRegistryService.js", () => ({
    PackRegistryService: {
        TIER_ORDER: ["Free", "Initiate", "Acolyte", "Weaver", "Artificer"],
        _compareVersions: (a, b) => {
            const pa = (a || "0").split(".").map(Number);
            const pb = (b || "0").split(".").map(Number);
            for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
                if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
                if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
            }
            return 0;
        },
        _fetchRegistry: vi.fn().mockResolvedValue({ overlays: {} })
    }
}));

vi.mock("../scripts/services/Logger.js", () => ({
    Logger: {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

import { OverlayService } from "../scripts/services/OverlayService.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("OverlayService.installFromBlob — serialization", () => {

    beforeEach(() => {
        OverlayService._installChain = Promise.resolve();
        OverlayService._activeInstallCount = 0;
        OverlayService._manifestCache = new Map();
        OverlayService._contentsCache = new Map();
        OverlayService._lastError = {};
        OverlayService._devSimulateHosted = false;
    });

    it("rejects when required fields are missing (before hitting the install chain)", async () => {
        const result = await OverlayService.installFromBlob(new Blob(), {
            overlayId: "test-overlay",
            version: "1.0.0"
            // missing moduleId and tier
        });
        expect(result).toBe(false);
    });

    it("serializes through _runInstallTask (increments active count)", async () => {
        const observed = [];

        const originalRun = OverlayService._runInstallTask.bind(OverlayService);
        vi.spyOn(OverlayService, "_runInstallTask").mockImplementation(
            async function (label, taskFn) {
                observed.push(`enter:${label}`);
                const result = await originalRun(label, taskFn);
                observed.push(`exit:${label}`);
                return result;
            }
        );

        vi.spyOn(OverlayService, "_extractOverlayZip").mockResolvedValue({
            uploaded: 1, total: 1, cancelled: false
        });
        vi.spyOn(OverlayService, "_writeManifest").mockResolvedValue(undefined);

        const blob = new Blob(["zip-data"]);
        await OverlayService.installFromBlob(blob, {
            overlayId: "test-overlay",
            version: "1.0.0",
            moduleId: "test-module",
            tier: "Free",
            sublayer: "core",
            userInitiated: false
        });

        expect(observed).toContain("enter:test-overlay (zip)");
        expect(observed).toContain("exit:test-overlay (zip)");
        expect(OverlayService._runInstallTask).toHaveBeenCalledTimes(1);
    });

    it("concurrent installFromBlob calls are serialized, not parallel", async () => {
        const executionOrder = [];
        let callIndex = 0;

        vi.spyOn(OverlayService, "_extractOverlayZip").mockImplementation(async () => {
            const id = callIndex++;
            executionOrder.push(`start:${id}`);
            await new Promise((r) => setTimeout(r, 50));
            executionOrder.push(`end:${id}`);
            return { uploaded: 1, total: 1, cancelled: false };
        });
        vi.spyOn(OverlayService, "_writeManifest").mockResolvedValue(undefined);

        const blob = new Blob(["zip-data"]);
        const opts = (id) => ({
            overlayId: `overlay-${id}`,
            version: "1.0.0",
            moduleId: "test-module",
            tier: "Free",
            sublayer: `sub-${id}`,
            userInitiated: false
        });

        const p1 = OverlayService.installFromBlob(blob, opts("a"));
        const p2 = OverlayService.installFromBlob(blob, opts("b"));

        await Promise.all([p1, p2]);

        // If serialized: start:0 → end:0 → start:1 → end:1
        // If parallel:   start:0 → start:1 → end:0 → end:1
        expect(executionOrder[0]).toBe("start:0");
        expect(executionOrder[1]).toBe("end:0");
        expect(executionOrder[2]).toBe("start:1");
        expect(executionOrder[3]).toBe("end:1");
    });
});
