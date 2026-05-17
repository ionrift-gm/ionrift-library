import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

export class PF2eAdapter extends IonriftSystemAdapter {
    get systemId() { return "pf2e"; }

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
