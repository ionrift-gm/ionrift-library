import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

export class PF2eAdapter extends IonriftSystemAdapter {
    static #SUPPORTED = new Set(["signature-items", "workshop", "qm-loot-cache", "scroll-forge", "srd-curses"]);

    static SKILL_KEY_MAP = {
        acr: "acrobatics",
        ani: "nature",
        arc: "arcana",
        ath: "athletics",
        dec: "deception",
        his: "society",
        ins: "perception",
        itm: "intimidation",
        inv: "perception",
        med: "medicine",
        nat: "nature",
        prc: "perception",
        prf: "performance",
        per: "diplomacy",
        rel: "religion",
        slt: "thievery",
        ste: "stealth",
        sur: "survival"
    };

    static SAVE_KEY_MAP = {
        str: "fortitude",
        dex: "reflex",
        con: "fortitude",
        int: "will",
        wis: "will",
        cha: "will",
        fortitude: "fortitude",
        reflex: "reflex",
        will: "will"
    };

    get systemId() { return "pf2e"; }

    normalizeSkillKey(skillKey) {
        return PF2eAdapter.SKILL_KEY_MAP[skillKey] ?? skillKey;
    }

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

    getSkillTotal(actor, skillKey) {
        const key = this.normalizeSkillKey(skillKey);
        return actor?.system?.skills?.[key]?.totalModifier ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        const key = this.normalizeSkillKey(skillKey);
        return (actor?.system?.skills?.[key]?.rank ?? 0) >= 1;
    }

    getProficiencyBonus(actor) {
        const level = Math.max(1, Number(this.getLevel(actor)) || 1);
        return Math.min(6, Math.max(2, Math.floor((level - 1) / 4) + 2));
    }

    getSaveBonus(actor, saveKey) {
        const pf2eKey = PF2eAdapter.SAVE_KEY_MAP[saveKey] ?? saveKey;
        try {
            const stat = actor?.saves?.[pf2eKey];
            if (stat) return stat.totalModifier ?? stat.mod ?? 0;
        } catch {
            /* fall through */
        }
        const abilityMap = { fortitude: "con", reflex: "dex", will: "wis" };
        const abbr = abilityMap[pf2eKey] ?? saveKey;
        return actor?.system?.abilities?.[abbr]?.mod ?? 0;
    }

    getToolProficiencies(actor) {
        const profKeys = [];
        if (this.isSkillProficient(actor, "crafting")) {
            profKeys.push("crafting", "cook", "herb", "alchemist", "smith");
        }
        for (const item of actor?.items ?? []) {
            if (item.type === "lore") {
                profKeys.push(item.name?.toLowerCase().replace(/\s+lore$/i, "") ?? "");
            }
        }
        return profKeys.filter(Boolean);
    }

    isToolProficient(actor, toolKey) {
        if (toolKey === "cook" || toolKey === "cook's utensils") {
            return this.isSkillProficient(actor, "crafting");
        }
        return (actor?.items ?? []).some(item =>
            item.type === "lore" && item.name?.toLowerCase().includes(String(toolKey).toLowerCase())
        );
    }

    findItemByName(actor, name) {
        const lower = String(name ?? "").toLowerCase();
        return (actor?.items ?? []).find(item => item.name?.toLowerCase().includes(lower)) ?? null;
    }

    hasItemByName(actor, name) {
        return this.findItemByName(actor, name) !== null;
    }
}
