/**
 * ConnectFacade
 *
 * Soft-degrade bridge from listed Library API to ionrift-connect.
 * Call sites keep using game.ionrift.library.*; Connect owns the real services.
 */

const CONNECT_REQUIRED = "Ionrift Connect is required for the content Library.";

function connect() {
    return game.ionrift?.connect ?? null;
}

function warnMissing() {
    ui.notifications?.warn?.(CONNECT_REQUIRED);
}

/**
 * Proxy that forwards property access to a Connect bag field at call time.
 * @param {string} field
 * @param {*} [fallback]
 */
function connectProxy(field, fallback = undefined) {
    return new Proxy({}, {
        get(_target, prop) {
            const svc = connect()?.[field];
            if (!svc) {
                if (fallback !== undefined && prop in (fallback || {})) {
                    const value = fallback[prop];
                    return typeof value === "function" ? value.bind(fallback) : value;
                }
                return undefined;
            }
            const value = svc[prop];
            return typeof value === "function" ? value.bind(svc) : value;
        }
    });
}

export const ConnectFacade = {
    CONNECT_REQUIRED,

    /** @returns {object|null} */
    get bag() {
        return connect();
    },

    /** @returns {boolean} */
    isPresent() {
        return Boolean(connect());
    },

    openPatreonLibrary(options = {}) {
        const c = connect();
        if (!c?.openPatreonLibrary) {
            warnMissing();
            return;
        }
        return c.openPatreonLibrary(options);
    },

    installModule(moduleId, version) {
        const fn = connect()?.installModule;
        if (!fn) {
            warnMissing();
            return null;
        }
        return fn(moduleId, version);
    },

    importZipPack(opts) {
        const fn = connect()?.importZipPack;
        if (!fn) {
            warnMissing();
            return null;
        }
        return fn(opts);
    },

    importZipFromFile(file, opts) {
        const fn = connect()?.importZipFromFile;
        if (!fn) {
            warnMissing();
            return null;
        }
        return fn(file, opts);
    },

    getZipTargetDir(moduleId, assetType) {
        return connect()?.getZipTargetDir?.(moduleId, assetType) ?? null;
    },

    downloadPackUpdate(packId) {
        const fn = connect()?.downloadPackUpdate;
        if (!fn) {
            warnMissing();
            return null;
        }
        return fn(packId);
    },

    previewEADialog(moduleId, overrides) {
        return connect()?.previewEADialog?.(moduleId, overrides);
    },

    previewPremiumDialog(moduleId, overrides) {
        return connect()?.previewPremiumDialog?.(moduleId, overrides);
    },

    debugApplyRegistry(registryData) {
        return connect()?.debugApplyRegistry?.(registryData);
    },

    installOverlay(overlayId) {
        return connect()?.installOverlay?.(overlayId);
    },

    installAllPending() {
        return connect()?.installAllPending?.();
    },

    installById(overlayId, entry) {
        return connect()?.installById?.(overlayId, entry);
    },

    isOverlayDistributionActive() {
        return connect()?.isOverlayDistributionActive?.() ?? false;
    },

    setOverlayActive(overlayId, active, meta) {
        return connect()?.setOverlayActive?.(overlayId, active, meta);
    },

    uninstallOverlay(overlayId, moduleId, sublayer) {
        return connect()?.uninstallOverlay?.(overlayId, moduleId, sublayer);
    },

    reinstallOverlay(overlayId) {
        return connect()?.reinstallOverlay?.(overlayId);
    },

    getOverlayState(overlayId, moduleId, sublayer) {
        return connect()?.getOverlayState?.(overlayId, moduleId, sublayer);
    },

    collectDestructiveWarnings(payload) {
        return connect()?.collectDestructiveWarnings?.(payload) ?? [];
    },

    confirmDestructiveAction(options) {
        const fn = connect()?.confirmDestructiveAction;
        if (!fn) return true;
        return fn(options);
    },

    /** Live OverlayService when Connect is present. */
    get overlay() {
        return connectProxy("overlay");
    },

    /** Live PackRegistryService when Connect is present. */
    get packRegistry() {
        return connectProxy("packRegistry");
    },

    packNudge: {
        register: (...args) => connect()?.packNudge?.register?.(...args),
        inject: (...args) => connect()?.packNudge?.inject?.(...args),
        injectAllInSettings: (...args) => connect()?.packNudge?.injectAllInSettings?.(...args),
        isRegistered: (...args) => connect()?.packNudge?.isRegistered?.(...args) ?? false,
        get: (...args) => connect()?.packNudge?.get?.(...args) ?? null,
        shouldShow: (...args) => connect()?.packNudge?.shouldShow?.(...args) ?? Promise.resolve(false),
        buildBanner: (...args) => connect()?.packNudge?.buildBanner?.(...args) ?? null,
        dismiss: (...args) => connect()?.packNudge?.dismiss?.(...args)
    },

    /**
     * Dev console helpers that read OverlayService / PackRegistry from Connect.
     * @param {{ Logger: object, PlatformHelper: object }} deps
     */
    buildDevHelpers({ Logger, PlatformHelper }) {
        const overlay = () => connect()?.overlay;
        const packRegistry = () => connect()?.packRegistry;

        return {
            simulateHostedInstall(enabled) {
                const svc = overlay();
                if (!svc) {
                    warnMissing();
                    return false;
                }
                if (enabled === undefined) return svc._devSimulateHosted;
                svc._devSimulateHosted = Boolean(enabled);
                Logger.log("Library", `Hosted install simulation: ${svc._devSimulateHosted ? "on" : "off"}.`);
                return svc._devSimulateHosted;
            },
            installPerFileDelayMs(ms) {
                const svc = overlay();
                if (!svc) {
                    warnMissing();
                    return 0;
                }
                if (ms === undefined) return svc._devPerFileDelayMs;
                const value = Math.max(0, Number(ms) || 0);
                svc._devPerFileDelayMs = value;
                Logger.log("Library", `Per-file install delay: ${value}ms.`);
                return value;
            },
            resetInstallSimulation() {
                const svc = overlay();
                if (!svc) {
                    warnMissing();
                    return;
                }
                svc._devSimulateHosted = false;
                svc._devPerFileDelayMs = 0;
                Logger.log("Library", "Install simulation reset.");
            },
            async inspectOverlayFiles(spec) {
                const OverlayService = overlay();
                const PackRegistryService = packRegistry();
                if (!OverlayService) {
                    warnMissing();
                    return null;
                }

                let targetDir = null;
                let overlayLabel = "(unknown)";

                if (typeof spec === "string") {
                    overlayLabel = spec;
                    const pending = OverlayService.pendingOverlays?.find(p => p.overlayId === spec);
                    if (pending) {
                        targetDir = `${OverlayService.OVERLAY_ROOT}/${pending.entry.moduleId}/${pending.sublayer}`;
                    } else if (PackRegistryService) {
                        try {
                            const registry = await PackRegistryService._fetchRegistry();
                            const entry = registry?.overlays?.[spec];
                            if (entry) {
                                const sublayer = OverlayService.resolveSublayer(entry);
                                targetDir = `${OverlayService.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
                            }
                        } catch (e) {
                            Logger.warn("Library", `inspectOverlayFiles: registry lookup failed: ${e?.message ?? e}`);
                        }
                    }
                } else if (spec?.moduleId && spec?.sublayer) {
                    targetDir = `${OverlayService.OVERLAY_ROOT}/${spec.moduleId}/${spec.sublayer}`;
                    overlayLabel = spec.overlayId ?? `${spec.moduleId}/${spec.sublayer}`;
                }

                if (!targetDir) {
                    Logger.warn("Library", "inspectOverlayFiles: could not resolve target directory.");
                    Logger.warn("Library", "  Try: game.ionrift.library.dev.listOverlays()");
                    Logger.warn("Library", '  Or:  game.ionrift.library.dev.inspectOverlayFiles({ moduleId: "ionrift-resonance", sublayer: "core" })');
                    return null;
                }

                const source = PlatformHelper.fileSource;
                const FP = PlatformHelper.FP;
                if (!FP) {
                    Logger.warn("Library", "inspectOverlayFiles: FilePicker unavailable.");
                    return null;
                }

                const allFiles = [];
                const allDirs = [];
                const walk = async (dir) => {
                    try {
                        const result = await FP.browse(source, dir);
                        for (const filePath of result?.files ?? []) {
                            allFiles.push(filePath);
                        }
                        for (const subDir of result?.dirs ?? []) {
                            allDirs.push(subDir);
                            await walk(subDir);
                        }
                    } catch (e) {
                        Logger.warn("Library", `inspectOverlayFiles: browse failed for ${dir}: ${e?.message ?? e}`);
                    }
                };

                allDirs.push(targetDir);
                await walk(targetDir);

                Logger.info("Library", `inspectOverlayFiles: ${overlayLabel}`);
                Logger.info("Library", `  targetDir: ${targetDir}`);
                Logger.info("Library", `  source:    ${source}`);
                Logger.info("Library", `  dirs:      ${allDirs.length}`);
                Logger.info("Library", `  files:     ${allFiles.length}`);
                if (allFiles.length > 0) {
                    Logger.info("Library", `  first 5 files: ${allFiles.slice(0, 5).join(", ")}`);
                }
                return { targetDir, files: allFiles, dirs: allDirs };
            },
            async listOverlays() {
                const OverlayService = overlay();
                const PackRegistryService = packRegistry();
                if (!OverlayService) {
                    warnMissing();
                    return [];
                }

                const rows = [];
                const pending = OverlayService.pendingOverlays ?? [];
                let registry = null;
                try {
                    registry = await PackRegistryService?._fetchRegistry?.();
                } catch (e) {
                    Logger.warn("Library", `listOverlays: registry fetch failed (${e?.message ?? e}). Showing pending only.`);
                }

                const seen = new Set();
                const overlayEntries = registry?.overlays ?? {};
                for (const [overlayId, entry] of Object.entries(overlayEntries)) {
                    const sublayer = OverlayService.resolveSublayer(entry);
                    const targetDir = `${OverlayService.OVERLAY_ROOT}/${entry.moduleId}/${sublayer}`;
                    rows.push({
                        overlayId,
                        moduleId: entry.moduleId,
                        sublayer,
                        targetDir,
                        pending: pending.some(p => p.overlayId === overlayId)
                    });
                    seen.add(overlayId);
                }
                for (const item of pending) {
                    if (seen.has(item.overlayId)) continue;
                    rows.push({
                        overlayId: item.overlayId,
                        moduleId: item.entry?.moduleId ?? "?",
                        sublayer: item.sublayer ?? "?",
                        targetDir: `${OverlayService.OVERLAY_ROOT}/${item.entry?.moduleId}/${item.sublayer}`,
                        pending: true
                    });
                }

                Logger.info("Library", `Known overlays (${rows.length}):`);
                for (const row of rows) {
                    Logger.info("Library", `  ${row.pending ? "[pending]" : "[ok]    "} ${row.overlayId.padEnd(36)} -> ${row.targetDir}`);
                }
                return rows;
            }
        };
    }
};
