import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FP is captured at module-load time via `typeof foundry`. Hoist the
// global so the const resolves to our mock instead of null.
const mocks = vi.hoisted(() => {
    const fp = {
        browse: vi.fn(() => Promise.resolve({ files: [], dirs: [] })),
        upload: vi.fn(() => Promise.resolve()),
        createDirectory: vi.fn(() => Promise.resolve())
    };
    globalThis.foundry = {
        applications: {
            apps: { FilePicker: fp },
            api: { DialogV2: { confirm: vi.fn(() => Promise.resolve(false)) } }
        }
    };
    globalThis.FilePicker = fp;
    return { fp };
});

vi.mock("../scripts/services/CloudRelayService.js", () => ({
    CloudRelayService: {
        isConnected: vi.fn(),
        requestDownload: vi.fn()
    }
}));

import { CloudRelayService } from "../scripts/services/CloudRelayService.js";
import { ModuleInstallerService } from "../scripts/services/ModuleInstallerService.js";

function setupGlobals() {
    globalThis.game = {
        system: { id: "dnd5e" },
        user: { isGM: true },
        settings: { get: vi.fn(), set: vi.fn() },
        modules: new Map(),
        ionrift: {}
    };

    globalThis.ui = {
        notifications: {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        }
    };

    globalThis.window = globalThis.window ?? {};
    globalThis.window.JSZip = makeMockJSZip();

    mocks.fp.browse.mockReset().mockResolvedValue({ files: [], dirs: [] });
    mocks.fp.upload.mockReset().mockResolvedValue();
    mocks.fp.createDirectory.mockReset().mockResolvedValue();
}

function makeMockJSZip() {
    const zipInstance = {
        file: vi.fn(),
        generateAsync: vi.fn(() => Promise.resolve(new Blob(["fake"]))),
        forEach: vi.fn(),
        loadAsync: vi.fn(() => Promise.resolve(zipInstance))
    };
    const JSZip = vi.fn(() => zipInstance);
    JSZip.loadAsync = vi.fn(() => Promise.resolve(zipInstance));
    JSZip._instance = zipInstance;
    return JSZip;
}

describe("Auth guard", () => {
    beforeEach(() => { vi.restoreAllMocks(); setupGlobals(); });
    afterEach(() => vi.restoreAllMocks());

    it("installModule() returns false and never calls fetch if not connected", async () => {
        CloudRelayService.isConnected.mockReturnValue(false);
        globalThis.fetch = vi.fn();

        const result = await ModuleInstallerService.installModule("ionrift-workshop", "1.0.0");

        expect(result).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(CloudRelayService.requestDownload).not.toHaveBeenCalled();
    });
});

describe("_pruneBackups()", () => {
    beforeEach(() => { vi.restoreAllMocks(); setupGlobals(); });
    afterEach(() => vi.restoreAllMocks());

    it("logs the oldest backup when more than MAX_BACKUPS exist", async () => {
        mocks.fp.browse.mockResolvedValue({
            files: [
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v0.7.0-2026-01-01T00-00-00.zip",
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v0.8.0-2026-02-01T00-00-00.zip",
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v0.9.0-2026-03-01T00-00-00.zip",
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v1.0.0-2026-04-01T00-00-00.zip"
            ],
            dirs: []
        });

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await ModuleInstallerService._pruneBackups("ionrift-workshop");

        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining("Backup exceeds max")
        );
        const match = logSpy.mock.calls.find(c => c[0].includes("Backup exceeds max"));
        expect(match[0]).toContain("v0.7.0");
    });

    it("does nothing when backup count is within limit", async () => {
        mocks.fp.browse.mockResolvedValue({
            files: [
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v0.8.0-2026-02-01T00-00-00.zip",
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v0.9.0-2026-03-01T00-00-00.zip",
                "ionrift-data/backups/ionrift-workshop/ionrift-workshop-v1.0.0-2026-04-01T00-00-00.zip"
            ],
            dirs: []
        });

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await ModuleInstallerService._pruneBackups("ionrift-workshop");

        const pruneLog = logSpy.mock.calls.find(c => c[0]?.includes?.("Backup exceeds max"));
        expect(pruneLog).toBeUndefined();
    });
});

describe("Module ID validation", () => {
    beforeEach(() => { vi.restoreAllMocks(); setupGlobals(); });
    afterEach(() => vi.restoreAllMocks());

    it("rejects with an error when extracted module.json id does not match", async () => {
        CloudRelayService.isConnected.mockReturnValue(true);
        CloudRelayService.requestDownload.mockResolvedValue({
            url: "https://signed.example.com/dl",
            expiresAt: "2026-05-01T00:00:00Z"
        });

        const fakeBlob = new Blob(["fake-zip"]);
        globalThis.fetch = vi.fn(() =>
            Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(fakeBlob) })
        );

        game.modules.set("ionrift-workshop", { version: "0.9.0" });

        const moduleJsonEntry = {
            async: vi.fn(() => Promise.resolve(JSON.stringify({ id: "wrong-module-id" })))
        };
        const zipInstance = window.JSZip._instance;
        zipInstance.loadAsync = vi.fn(() => Promise.resolve(zipInstance));
        zipInstance.file = vi.fn((path) => {
            if (path === "module.json") return moduleJsonEntry;
            return null;
        });
        zipInstance.forEach = vi.fn((cb) => {
            cb("module.json", { dir: false });
        });

        const result = await ModuleInstallerService._extractModule("ionrift-workshop", fakeBlob);

        expect(result).toBe(false);
        expect(ui.notifications.error).toHaveBeenCalledWith(
            expect.stringContaining("Module ID mismatch")
        );
    });
});
