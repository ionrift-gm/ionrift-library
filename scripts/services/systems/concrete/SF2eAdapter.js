import { PF2eAdapter } from "./PF2eAdapter.js";

/**
 * Starfinder Second Edition (SF2e) adapter.
 * Shares core mechanics, attributes, and data structures with the PF2e Remaster engine.
 */
export class SF2eAdapter extends PF2eAdapter {
    get systemId() { return "sf2e"; }
}
