import { IonriftBuffAdapter } from "../IonriftBuffAdapter.js";

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
