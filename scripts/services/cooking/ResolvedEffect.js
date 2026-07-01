/**
 * Normalised output from an {@link IonriftBuffAdapter}. One shape for every
 * system; consumers pick the fields their system understands.
 */

/** @typedef {"native"|"approximate"|"manual"} BuffFidelity */

/**
 * @typedef {Object} ResolvedEffect
 * @property {object[]} changes dnd5e Active Effect changes.
 * @property {object[]} effectItems pf2e Effect item payloads (Rule Elements).
 * @property {string[]} daeSpecial dnd5e DAE special durations.
 * @property {object} midiFlags dnd5e midi-qol roll flags.
 * @property {object[]} immediate Act-now resolutions (heal, hit die, etc.).
 * @property {string} description
 * @property {string} summaryLine
 * @property {BuffFidelity} fidelity
 * @property {string|null} manualNote Required when fidelity is manual.
 * @property {string|null} [roll] Formula string for consumers that pre-roll.
 * @property {number|null} [chargesRemaining]
 * @property {number|null} [chargesMax]
 * @property {boolean} [immediateFlag] Whether the buff resolves at serve time.
 */

/** @returns {ResolvedEffect} */
export function emptyResolvedEffect(overrides = {}) {
    return {
        changes: [],
        effectItems: [],
        daeSpecial: [],
        midiFlags: {},
        immediate: [],
        description: "",
        summaryLine: "",
        fidelity: "manual",
        manualNote: null,
        roll: null,
        chargesRemaining: null,
        chargesMax: null,
        immediateFlag: false,
        ...overrides
    };
}
