/**
 * Soft-degrade bridge from listed Library API to ionrift-connect.
 * Call sites keep using game.ionrift.library.*; Connect owns the real services.
 */

import {
    getWorldSetting as getConnectOwnedSetting,
    setWorldSetting as setConnectOwnedSetting
} from "./connectOwnedSettings.js";

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

    getWorldSetting(key, fallback) {
        return getConnectOwnedSetting(key, fallback);
    },

    setWorldSetting(key, value) {
        return setConnectOwnedSetting(key, value);
    }
};

