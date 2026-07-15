import { IonriftBuffAdapter } from "./IonriftBuffAdapter.js";
import { Dnd5eBuffAdapter } from "./concrete/Dnd5eBuffAdapter.js";
import { Pf2eBuffAdapter } from "./concrete/Pf2eBuffAdapter.js";
import { FallbackBuffAdapter } from "./concrete/FallbackBuffAdapter.js";

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

export class BuffAdapterRegistry {
    constructor() {
        /** @type {Map<string, IonriftBuffAdapter>} */
        this._adapters = new Map();
        this._fallback = new FallbackBuffAdapter();

        this.register(new Dnd5eBuffAdapter());
        this.register(new Pf2eBuffAdapter());
    }

    register(adapter) {
        if (!(adapter instanceof IonriftBuffAdapter)) {
            throw new Error("BuffAdapterRegistry: adapter must extend IonriftBuffAdapter");
        }
        this._adapters.set(adapter.systemId, adapter);
    }

    get current() {
        const id = game?.system?.id ?? "unknown";
        return this._adapters.get(id) ?? new FallbackBuffAdapter(id);
    }

    forSystem(systemId) {
        return this._adapters.get(systemId) ?? new FallbackBuffAdapter(systemId);
    }

    fidelity(buff) {
        return this.current.fidelity(buff);
    }

    resolve(actor, buff, ctx = {}) {
        return this.current.resolve(actor, buff, ctx);
    }
}

export const buffAdapterRegistry = new BuffAdapterRegistry();
