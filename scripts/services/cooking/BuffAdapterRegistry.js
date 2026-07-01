import { IonriftBuffAdapter } from "./IonriftBuffAdapter.js";
import { Dnd5eBuffAdapter } from "./adapters/Dnd5eBuffAdapter.js";
import { Pf2eBuffAdapter } from "./adapters/Pf2eBuffAdapter.js";
import { FallbackBuffAdapter } from "./adapters/FallbackBuffAdapter.js";

/**
 * Declared fidelity per buff type and system. Encoded for testharness parity
 * checks against {@link BuffAdapterRegistry}.
 */
export const BUFF_CAPABILITY_MATRIX = Object.freeze({
    dnd5e: Object.freeze({
        temp_hp: "native",
        heal: "native",
        exhaustion_save: "native",
        hit_die: "native",
        advantage: "native",
        resistance: "native",
        sense_darkvision: "native",
        check_advantage: "native",
        skill_advantage: "native",
        passive_perception: "native",
        ability_bonus: "native",
        save_bonus: "native"
    }),
    pf2e: Object.freeze({
        temp_hp: "native",
        heal: "native",
        exhaustion_save: "native",
        hit_die: "native",
        advantage: "approximate",
        resistance: "native",
        sense_darkvision: "native",
        check_advantage: "approximate",
        skill_advantage: "approximate",
        passive_perception: "manual",
        ability_bonus: "native",
        save_bonus: "native"
    })
});

/**
 * Registration hub for per-system buff resolvers.
 */
export class BuffAdapterRegistry {
    constructor() {
        /** @type {Map<string, IonriftBuffAdapter>} */
        this._adapters = new Map();
        this._fallback = new FallbackBuffAdapter();

        this.register(new Dnd5eBuffAdapter());
        this.register(new Pf2eBuffAdapter());
    }

    /**
     * @param {IonriftBuffAdapter} adapter
     */
    register(adapter) {
        if (!(adapter instanceof IonriftBuffAdapter)) {
            throw new Error("BuffAdapterRegistry: adapter must extend IonriftBuffAdapter");
        }
        this._adapters.set(adapter.systemId, adapter);
    }

    /** @returns {IonriftBuffAdapter} */
    get current() {
        const id = game?.system?.id ?? "unknown";
        return this._adapters.get(id) ?? new FallbackBuffAdapter(id);
    }

    /**
     * @param {string} systemId
     * @returns {IonriftBuffAdapter}
     */
    forSystem(systemId) {
        return this._adapters.get(systemId) ?? new FallbackBuffAdapter(systemId);
    }

    fidelity(buff) {
        return this.current.fidelity(buff);
    }

    /**
     * @param {Actor|null} actor
     * @param {import("./CookingBuffs.js").IonriftBuff} buff
     * @param {object} [ctx]
     * @returns {import("./ResolvedEffect.js").ResolvedEffect}
     */
    resolve(actor, buff, ctx = {}) {
        return this.current.resolve(actor, buff, ctx);
    }
}

/** Singleton exposed as game.ionrift.library.cooking.buffAdapters */
export const buffAdapterRegistry = new BuffAdapterRegistry();
