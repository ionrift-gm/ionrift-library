import { isForge } from "./hosting.js";

/** Memoised FilePicker class. `undefined` unresolved; `null` none available. */
let _cachedFP = undefined;

/**
 * Platform FilePicker. Cached: Forge patches the global and v13 deprecation
 * Proxy would otherwise warn on every read during overlay renders.
 */
export function getFilePicker() {
    if (_cachedFP !== undefined) return _cachedFP;

    if (typeof foundry === "undefined" && typeof FilePicker === "undefined") {
        _cachedFP = null;
        return null;
    }

    let resolved;
    if (isForge()) {
        resolved = typeof FilePicker !== "undefined" ? FilePicker : null;
    } else if (typeof foundry !== "undefined") {
        resolved = foundry.applications?.apps?.FilePicker
            ?? (typeof FilePicker !== "undefined" ? FilePicker : null);
    } else {
        resolved = typeof FilePicker !== "undefined" ? FilePicker : null;
    }

    _cachedFP = resolved;
    return resolved;
}

/** Tests only. */
export function resetFPCache() {
    _cachedFP = undefined;
}

export function fileSource() {
    return isForge() ? "forgevtt" : "data";
}
