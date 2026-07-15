import { IonriftSystemAdapter } from "./IonriftSystemAdapter.js";
import { DnD5eAdapter } from "./concrete/DnD5eAdapter.js";
import { PF2eAdapter } from "./concrete/PF2eAdapter.js";
import { DaggerheartAdapter } from "./concrete/DaggerheartAdapter.js";
import { UniversalTabletopAdapter } from "./concrete/UniversalTabletopAdapter.js";

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

    register(adapter) {
        if (!(adapter instanceof IonriftSystemAdapter)) {
            throw new Error("SystemAdapterRegistry: adapter must extend IonriftSystemAdapter");
        }
        this._adapters.set(adapter.systemId, adapter);
    }

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
    hasFeat(actor, nameOrSlug) { return this.current.hasFeat(actor, nameOrSlug); }
    normalizeSkillKey(skillKey) { return this.current.normalizeSkillKey(skillKey); }
    getSkillTotal(actor, skillKey) { return this.current.getSkillTotal(actor, skillKey); }
    isSkillProficient(actor, skillKey) { return this.current.isSkillProficient(actor, skillKey); }
    getProficiencyBonus(actor) { return this.current.getProficiencyBonus(actor); }
    getSaveBonus(actor, saveKey) { return this.current.getSaveBonus(actor, saveKey); }
    isToolProficient(actor, toolKey) { return this.current.isToolProficient(actor, toolKey); }
    getToolProficiencies(actor) { return this.current.getToolProficiencies(actor); }
    findItemByName(actor, name) { return this.current.findItemByName(actor, name); }
    hasItemByName(actor, name) { return this.current.hasItemByName(actor, name); }
    getSituationalConsumables() { return this.current.getSituationalConsumables(); }
    isSupported(featureId) { return this.current.isSupported(featureId); }
    isMagical(item) { return this.current.isMagical(item); }
    getPowerScoreContribution(item, weights) {
        return this.current.getPowerScoreContribution(item, weights);
    }
}

export const adapterRegistry = new SystemAdapterRegistry();
