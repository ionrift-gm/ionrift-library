import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

export class DnD5eAdapter extends IonriftSystemAdapter {
    static #SUPPORTED = new Set(["signature-items", "scroll-forge", "srd-curses", "workshop"]);

    isSupported(featureId) { return DnD5eAdapter.#SUPPORTED.has(featureId); }

    get systemId() { return "dnd5e"; }

    getLevel(actor) {
        if (!actor) return 1;
        return actor.system?.details?.level ?? 1;
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
        return Object.values(actor.classes || {}).map(c => c.name);
    }

    getTraits(actor) {
        const traits = new Set();
        if (!actor) return traits;
        if ((actor.system?.attributes?.senses?.darkvision ?? 0) > 0) traits.add("darkvision");
        for (const dr of actor.system?.traits?.dr?.value ?? []) traits.add(`${dr}-resistance`);
        for (const ci of actor.system?.traits?.ci?.value ?? []) traits.add(`${ci}-immunity`);
        return traits;
    }

    getRarity(item) {
        return item?.system?.rarity ?? "common";
    }

    getPrice(item) {
        const raw = item?.system?.price;
        if (!raw) return 0;
        const denom = raw.denomination ?? "gp";
        const val = raw.value ?? 0;
        const toGp = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 };
        return val * (toGp[denom] ?? 1);
    }

    getWeight(item) {
        return item?.system?.weight?.value ?? 0;
    }

    requiresAttunement(item) {
        const att = item?.system?.attunement;
        return att === "required" || att === "attuned";
    }

    getItemCategory(item) {
        return item?.type ?? "other";
    }

    getSituationalConsumables() {
        return new Set([
            "potion of climbing",
            "potion of swimming",
            "potion of water breathing",
            "potion of animal friendship",
            "potion of gaseous form",
            "potion of growth",
            "potion of diminution",
            "potion of longevity",
            "oil of slipperiness",
            "philter of love",
        ]);
    }

    getHP(actor) {
        const hp = actor?.system?.attributes?.hp;
        return { value: hp?.value ?? 0, max: hp?.max ?? 1, temp: hp?.temp ?? 0 };
    }

    getAbilityScore(actor, abbr) {
        return actor?.system?.abilities?.[abbr]?.value ?? 10;
    }

    /**
     * dnd5e exposes the designated primary party as a Group actor via
     * game.actors.party (backed by the "dnd5e.primaryParty" setting). Its
     * members live in system.members, each entry resolving an actor through
     * the `.actor` accessor. We mirror only character-type members to keep
     * parity with the curated roster the rest of the suite assumes.
     * @returns {Actor[]|null}
     */
    getNativePartyMembers() {
        const party = game.actors?.party;
        const members = party?.system?.members;
        if (!members) return null;
        try {
            return members
                .map(m => m.actor ?? m)
                .filter(a => a && a.type === "character");
        } catch {
            return null;
        }
    }

    openNativePartyManagement() {
        const party = game.actors?.party;
        if (party?.sheet) {
            party.sheet.render(true);
            return true;
        }
        ui.notifications?.warn(
            "No primary party is set. Right-click a party group actor in the Actors sidebar and choose Make Primary Party."
        );
        return true;
    }

    /**
     * Native party changes surface two ways in dnd5e: reassigning the primary
     * party (the "dnd5e.primaryParty" Setting document) and editing the group
     * actor's members (an update to the party group actor, whose system.members
     * holds the roster). Watch both and debounce so a single user action fires
     * one downstream refresh.
     */
    watchNativeParty(callback) {
        const fire = foundry.utils.debounce(() => callback(), 100);

        const onSetting = (setting) => {
            if (setting?.key === "dnd5e.primaryParty") fire();
        };
        Hooks.on("createSetting", onSetting);
        Hooks.on("updateSetting", onSetting);

        Hooks.on("updateActor", (actor) => {
            const partyId = game.actors?.party?.id;
            if (partyId && actor?.id === partyId) fire();
        });
    }
}
