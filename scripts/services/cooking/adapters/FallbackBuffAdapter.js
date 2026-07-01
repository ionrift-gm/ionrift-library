import { IonriftBuffAdapter } from "../IonriftBuffAdapter.js";

/**
 * Fallback buff adapter for systems without a dedicated resolver.
 * Always returns manual fidelity with an advisory note.
 */
export class FallbackBuffAdapter extends IonriftBuffAdapter {
    /** @param {string} id */
    constructor(id = "unknown") {
        super();
        this._id = id;
    }

    get systemId() { return this._id; }

    fidelity() {
        return "manual";
    }
}
