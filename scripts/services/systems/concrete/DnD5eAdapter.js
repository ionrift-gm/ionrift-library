import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";
import { Logger } from "../../platform/Logger.js";
import { normalizeSpellSchool } from "../../../data/spellSchools.js";

export class DnD5eAdapter extends IonriftSystemAdapter {
    static #SUPPORTED = new Set([
        "signature-items", "scroll-forge", "srd-curses", "workshop",
        "qm-loot-cache", "qm-loot-pool-compile", "qm-latent-masking"
    ]);

    isSupported(featureId) { return DnD5eAdapter.#SUPPORTED.has(featureId); }

    isMagical(item) {
        if (!item) return false;
        const system = item.system ?? {};
        const props = system.properties;
        const hasMgc = props instanceof Set
            ? props.has("mgc")
            : false;
        const rarity = system.rarity || "common";
        return hasMgc || rarity !== "common" || !!system.attunement;
    }

    getPowerScoreContribution(item, weights) {
        if (!item || !this.isMagical(item)) return 0;
        const eligible = new Set(["weapon", "equipment", "tool", "container"]);
        if (!eligible.has(item.type)) return 0;
        return super.getPowerScoreContribution(item, weights);
    }

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
        return att === "required" || att === "attuned" || att === true;
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

    normalizeSkillKey(skillKey) { return skillKey; }

    getSkillTotal(actor, skillKey) {
        return actor?.system?.skills?.[skillKey]?.total ?? 0;
    }

    isSkillProficient(actor, skillKey) {
        return (actor?.system?.skills?.[skillKey]?.proficient ?? 0) > 0;
    }

    getProficiencyBonus(actor) {
        return actor?.system?.attributes?.prof ?? 2;
    }

    getSaveBonus(actor, saveKey) {
        const rollData = actor?.getRollData?.() ?? {};
        const fromRollData = rollData?.abilities?.[saveKey]?.save;
        if (typeof fromRollData === "number") return fromRollData;
        const mod = actor?.system?.abilities?.[saveKey]?.mod ?? 0;
        const prof = actor?.system?.attributes?.prof ?? 0;
        const proficient = actor?.system?.abilities?.[saveKey]?.proficient ?? 0;
        return mod + (proficient > 0 ? prof : 0);
    }

    getToolProficiencies(actor) {
        const profKeys = new Set();
        const tools = actor?.system?.tools ?? {};
        for (const [key, data] of Object.entries(tools)) {
            if ((data?.value ?? 0) > 0 || (data?.effectValue ?? 0) > 0) {
                profKeys.add(key);
            }
        }
        for (const item of actor?.items ?? []) {
            const baseItem = item.system?.type?.baseItem;
            if (baseItem) profKeys.add(baseItem);
            const nameLower = (item.name ?? "").toLowerCase();
            if (item.type === "tool" && nameLower) {
                const match = nameLower.match(/^(\w+)/);
                if (match) profKeys.add(match[1]);
            }
        }
        return [...profKeys];
    }

    isToolProficient(actor, toolKey) {
        const toolData = actor?.system?.tools?.[toolKey];
        if (toolData && (toolData.proficient ?? 0) > 0) return true;
        if (toolData && ((toolData.value ?? 0) > 0 || (toolData.effectValue ?? 0) > 0)) return true;
        return (actor?.items ?? []).some(item =>
            item.type === "tool" &&
            (item.system?.type?.value === toolKey ||
             item.system?.type?.baseItem === toolKey ||
             item.name?.toLowerCase().includes(toolKey))
        );
    }

    findItemByName(actor, name) {
        const lower = String(name ?? "").toLowerCase();
        return (actor?.items ?? []).find(item => item.name?.toLowerCase().includes(lower)) ?? null;
    }

    hasItemByName(actor, name) {
        return this.findItemByName(actor, name) !== null;
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
        const extractMembers = (party) => {
            if (!party?.system?.members) return [];

            const playerChars = party.system.playerCharacters;
            if (playerChars?.length) return [...playerChars];

            const resolved = [];
            for (const member of party.system.members) {
                const actor = member?.actor ?? game.actors.get(
                    typeof member?.actor === "string" ? member.actor : member?.actor?.id
                );
                if (actor?.system?.isCharacter) resolved.push(actor);
            }
            return resolved;
        };

        const primary = game.actors?.party;
        let members = extractMembers(primary);
        if (members.length) return members;

        // Primary party can be stale or empty while another group holds the roster.
        for (const group of game.actors.filter(a => a.type === "group")) {
            if (group.id === primary?.id) continue;
            members = extractMembers(group);
            if (members.length) {
                Logger.warn("DnD5eAdapter",
                    `Primary party "${primary?.name ?? "unset"}" has no usable members; `
                    + `using "${group.name}". Right-click that group and choose Make Primary Party.`
                );
                return members;
            }
        }

        if (primary?.system?.members) return [];
        return null;
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

    // ── Item Attack & Damage Semantics Overrides ────────────────

    getAttackCategory(item) {
        if (!item) return "utility";
        const at = item.system?.actionType;
        const type = item.type;
        if (type === "spell" || at === "msak" || at === "rsak") return "magic";
        if (at === "rwak") return "ranged";
        if (at === "mwak") return "melee";
        if (at === "heal") return "heal";
        return "utility";
    }

    getDamageTypes(item) {
        if (!item) return [];
        const types = [];
        // Legacy 5e: damage.parts [[formula, type], ...]
        if (Array.isArray(item.system?.damage?.parts)) {
            for (const [, t] of item.system.damage.parts) {
                if (t && typeof t === "string") types.push(t.toLowerCase());
            }
        }
        // Modern 5e (v3.x+): damage.base.types (Set or Array)
        if (item.system?.damage?.base?.types) {
            for (const t of item.system.damage.base.types) {
                if (t) types.push(String(t).toLowerCase());
            }
        }
        // Activities (Foundry v12+ / dnd5e 4.x+)
        if (item.system?.activities) {
            for (const act of Object.values(item.system.activities)) {
                if (act.damage?.parts) {
                    for (const p of act.damage.parts) {
                        const dt = Array.isArray(p) ? p[1] : (p?.types ? [...p.types][0] : p?.type);
                        if (dt) types.push(String(dt).toLowerCase());
                    }
                }
            }
        }
        return [...new Set(types.filter(Boolean))];
    }

    getSpellSchool(item) {
        return normalizeSpellSchool(item?.system?.school);
    }

    static #WEAPON_KEYWORDS = {
        bow: "bow", crossbow: "crossbow", longbow: "bow", shortbow: "bow",
        firearm: "firearm", pistol: "firearm", musket: "firearm", gun: "firearm",
        sling: "sling", dagger: "dagger", knife: "dagger",
        axe: "axe", hatchet: "axe", greataxe: "axe",
        sword: "sword", blade: "sword", longsword: "sword", shortsword: "sword",
        scimitar: "sword", rapier: "sword", greatsword: "sword",
        hammer: "bludgeon", mace: "bludgeon", flail: "bludgeon",
        maul: "bludgeon", club: "bludgeon", morningstar: "bludgeon",
        spear: "polearm", halberd: "polearm", glaive: "polearm",
        pike: "polearm", javelin: "polearm", trident: "polearm",
        staff: "staff", quarterstaff: "staff",
        // Natural weapons
        claw: "claw", bite: "bite", slam: "slam", tail: "tail",
        tentacle: "tentacle", sting: "sting", horn: "horn",
    };

    getWeaponFamily(item) {
        if (!item) return null;
        const baseItem = item.system?.type?.baseItem || item.system?.baseItem || "";
        const name = (item.name || "").toLowerCase();
        const search = `${name} ${baseItem}`.toLowerCase();
        for (const [keyword, family] of Object.entries(DnD5eAdapter.#WEAPON_KEYWORDS)) {
            if (search.includes(keyword)) return family;
        }
        return null;
    }

    isNaturalWeapon(item) {
        const family = this.getWeaponFamily(item);
        return ["claw", "bite", "slam", "tail", "tentacle", "sting", "horn"].includes(family);
    }
}
