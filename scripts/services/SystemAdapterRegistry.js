import { IonriftSystemAdapter } from "./IonriftSystemAdapter.js";
import { DnD5eAdapter } from "./adapters/DnD5eAdapter.js";
import { PF2eAdapter } from "./adapters/PF2eAdapter.js";
import { DaggerheartAdapter } from "./adapters/DaggerheartAdapter.js";
import { UniversalTabletopAdapter } from "./adapters/UniversalTabletopAdapter.js";

/**
 * SystemAdapterRegistry — registration hub for system adapters.
 *
 * Modules can register their own adapters for unsupported systems:
 *   game.ionrift.library.adapterRegistry.register(new MySFRPGAdapter());
 *
 * Calling game.ionrift.library.system.getLevel(actor) routes through
 * the registered adapter for the active system. Falls back to the base
 * class (safe no-op defaults) if no adapter is registered.
 */
export class SystemAdapterRegistry {

    constructor() {
        /** @type {Map<string, IonriftSystemAdapter>} */
        this._adapters = new Map();
        this._fallback = new IonriftSystemAdapter();

        this.register(new DnD5eAdapter());
        this.register(new PF2eAdapter());
        this.register(new DaggerheartAdapter());
        this.register(new UniversalTabletopAdapter());
    }

    /**
     * Register a system adapter. Later registrations override earlier ones.
     * @param {IonriftSystemAdapter} adapter
     */
    register(adapter) {
        if (!(adapter instanceof IonriftSystemAdapter)) {
            throw new Error("SystemAdapterRegistry: adapter must extend IonriftSystemAdapter");
        }
        this._adapters.set(adapter.systemId, adapter);
    }

    /** Returns the adapter for the current game system, or the fallback. */
    get current() {
        return this._adapters.get(game.system.id) ?? this._fallback;
    }

    getLevel(actor) { return this.current.getLevel(actor); }
    getKnownSpells(actor) { return this.current.getKnownSpells(actor); }
    getClassNames(actor) { return this.current.getClassNames(actor); }
    getTraits(actor) { return this.current.getTraits(actor); }
    isPlayerCharacter(actor) { return this.current.isPlayerCharacter(actor); }
    getRarity(item) { return this.current.getRarity(item); }
    getPrice(item) { return this.current.getPrice(item); }
    getWeight(item) { return this.current.getWeight(item); }
    requiresAttunement(item) { return this.current.requiresAttunement(item); }
    getItemCategory(item) { return this.current.getItemCategory(item); }
    getHP(actor) { return this.current.getHP(actor); }
    getAbilityScore(actor, abbr) { return this.current.getAbilityScore(actor, abbr); }
    getSituationalConsumables() { return this.current.getSituationalConsumables(); }
    isSupported(featureId) { return this.current.isSupported(featureId); }
}

/** Singleton — created once, exposed as game.ionrift.library.system */
export const adapterRegistry = new SystemAdapterRegistry();
