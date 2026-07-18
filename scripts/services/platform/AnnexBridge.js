/**
 * Soft-degrade API bridge from listed Library to private ionrift-annex.
 * Annex owns the Patreon UI and broker services.
 */

import {
    getWorldSetting as getAnnexOwnedSetting,
    setWorldSetting as setAnnexOwnedSetting
} from "./annexOwnedSettings.js";

const ANNEX_REQUIRED = "Ionrift Annex is required for the Patreon Library.";

function annex() {
    return game.ionrift?.annex ?? null;
}

function warnMissing() {
    ui.notifications?.warn?.(ANNEX_REQUIRED);
}

function annexProxy(field, fallback = undefined) {
    return new Proxy({}, {
        get(_target, property) {
            const service = annex()?.[field];
            if (!service) {
                if (fallback !== undefined && property in (fallback || {})) {
                    const value = fallback[property];
                    return typeof value === "function" ? value.bind(fallback) : value;
                }
                return undefined;
            }
            const value = service[property];
            return typeof value === "function" ? value.bind(service) : value;
        }
    });
}

export const AnnexBridge = {
    ANNEX_REQUIRED,

    get bag() {
        return annex();
    },

    isPresent() {
        return Boolean(annex());
    },

    openPatreonLibrary(options = {}) {
        const service = annex();
        if (!service?.openPatreonLibrary) {
            warnMissing();
            return;
        }
        return service.openPatreonLibrary(options);
    },

    installModule(moduleId, version) {
        const install = annex()?.installModule;
        if (!install) {
            warnMissing();
            return null;
        }
        return install(moduleId, version);
    },

    importZipPack(options) {
        const importZip = annex()?.importZipPack;
        if (!importZip) {
            warnMissing();
            return null;
        }
        return importZip(options);
    },

    importZipFromFile(file, options) {
        const importZip = annex()?.importZipFromFile;
        if (!importZip) {
            warnMissing();
            return null;
        }
        return importZip(file, options);
    },

    getZipTargetDir(moduleId, assetType) {
        return annex()?.getZipTargetDir?.(moduleId, assetType) ?? null;
    },

    downloadPackUpdate(packId) {
        const download = annex()?.downloadPackUpdate;
        if (!download) {
            warnMissing();
            return null;
        }
        return download(packId);
    },

    previewEADialog(moduleId, overrides) {
        return annex()?.previewEADialog?.(moduleId, overrides);
    },

    previewPremiumDialog(moduleId, overrides) {
        return annex()?.previewPremiumDialog?.(moduleId, overrides);
    },

    debugApplyRegistry(registryData) {
        return annex()?.debugApplyRegistry?.(registryData);
    },

    installOverlay(overlayId) {
        return annex()?.installOverlay?.(overlayId);
    },

    installAllPending() {
        return annex()?.installAllPending?.();
    },

    installById(overlayId, entry) {
        return annex()?.installById?.(overlayId, entry);
    },

    isOverlayDistributionActive() {
        return annex()?.isOverlayDistributionActive?.() ?? false;
    },

    setOverlayActive(overlayId, active, meta) {
        return annex()?.setOverlayActive?.(overlayId, active, meta);
    },

    uninstallOverlay(overlayId, moduleId, sublayer) {
        return annex()?.uninstallOverlay?.(overlayId, moduleId, sublayer);
    },

    reinstallOverlay(overlayId) {
        return annex()?.reinstallOverlay?.(overlayId);
    },

    getOverlayState(overlayId, moduleId, sublayer) {
        return annex()?.getOverlayState?.(overlayId, moduleId, sublayer);
    },

    collectDestructiveWarnings(payload) {
        return annex()?.collectDestructiveWarnings?.(payload) ?? [];
    },

    confirmDestructiveAction(options) {
        const confirm = annex()?.confirmDestructiveAction;
        if (!confirm) return true;
        return confirm(options);
    },

    get overlay() {
        return annexProxy("overlay");
    },

    get packRegistry() {
        return annexProxy("packRegistry");
    },

    packNudge: {
        register: (...args) => annex()?.packNudge?.register?.(...args),
        inject: (...args) => annex()?.packNudge?.inject?.(...args),
        injectAllInSettings: (...args) => annex()?.packNudge?.injectAllInSettings?.(...args),
        isRegistered: (...args) => annex()?.packNudge?.isRegistered?.(...args) ?? false,
        get: (...args) => annex()?.packNudge?.get?.(...args) ?? null,
        shouldShow: (...args) => annex()?.packNudge?.shouldShow?.(...args) ?? Promise.resolve(false),
        buildBanner: (...args) => annex()?.packNudge?.buildBanner?.(...args) ?? null,
        dismiss: (...args) => annex()?.packNudge?.dismiss?.(...args)
    },

    getWorldSetting(key, fallback) {
        return getAnnexOwnedSetting(key, fallback);
    },

    setWorldSetting(key, value) {
        return setAnnexOwnedSetting(key, value);
    }
};
