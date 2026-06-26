import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

export class PF2eAdapter extends IonriftSystemAdapter {
    static #SUPPORTED = new Set(["signature-items", "workshop", "qm-loot-cache", "scroll-forge"]);

    get systemId() { return "pf2e"; }

    isSupported(featureId) { return PF2eAdapter.#SUPPORTED.has(featureId); }

    isMagical(item) {
        if (!item) return false;
        const traits = item.system?.traits?.value ?? [];
        if (traits.includes("magical")) return true;
        const rarity = (this.getRarity(item) ?? "common").toLowerCase();
        return rarity !== "common" && rarity !== "none";
    }

    getPowerScoreContribution(item, weights) {
        if (!item || !this.isMagical(item)) return 0;
        const eligible = new Set(["weapon", "armor", "shield", "equipment", "consumable"]);
        if (!eligible.has(item.type)) return 0;
        const w = weights ?? {
            rarity: { common: 1, uncommon: 3, rare: 8, unique: 15 },
            attunement: 1.0,
            charges: 0.3,
            flatBonus: 2.0
        };
        const rarity = (this.getRarity(item) ?? "common").toLowerCase();
        let score = w.rarity[rarity] ?? 0;
        const traits = item.system?.traits?.value ?? [];
        if (traits.includes("invested")) score *= w.attunement ?? 1;
        const potency = item.system?.runes?.potency;
        if (potency && !Number.isNaN(Number(potency))) {
            score += Number(potency) * (w.flatBonus ?? 0);
        }
        return score;
    }

    getLevel(actor) {
        if (!actor) return 1;
        return actor.system?.details?.level?.value ?? 1;
    }

    getKnownSpells(actor) {
        const spells = new Set();
        if (!actor) return spells;
        for (const item of actor.items) {
            if (item.type === "spell") spells.add(item.name.toLowerCase());
        }
        return spells;
    }

    getClassNames(actor) {
        if (!actor) return [];
        const cls = actor.items.filter(i => i.type === "class").map(i => i.name);
        return cls;
    }

    getTraits(actor) {
        const traits = new Set();
        if (!actor) return traits;
        for (const r of actor.system?.attributes?.resistances ?? []) {
            traits.add(`${r.type}-resistance`);
        }
        return traits;
    }

    getRarity(item) {
        return item?.system?.traits?.rarity ?? "common";
    }

    getPrice(item) {
        const price = item?.system?.price?.value;
        if (!price) return 0;
        return (price.gp ?? 0) + (price.sp ?? 0) / 10 + (price.cp ?? 0) / 100;
    }

    getWeight(item) {
        const bulk = item?.system?.bulk?.value;
        if (!bulk) return 0;
        if (bulk === "L") return 1;
        return Number(bulk) * 10;
    }

    requiresAttunement(item) {
        return false;
    }

    getItemCategory(item) {
        return item?.type ?? "other";
    }

    getHP(actor) {
        const hp = actor?.system?.attributes?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 1, temp: hp?.temp ?? 0 };
    }

    getAbilityScore(actor, abbr) {
        return actor?.system?.abilities?.[abbr]?.mod ?? 0;
    }
}
