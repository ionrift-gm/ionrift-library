import { beforeAll, describe, expect, test } from "vitest";
import { classifyCreature } from "../scripts/creatureClassifier.js";

/** @typedef {{ input: string, expectId?: string, minConf?: number, exactConf?: number, sound?: string, tags?: string[] }} ClassifierVector */

/**
 * @param {ReturnType<typeof classifyCreature>} result
 * @param {ClassifierVector} vector
 */
function assertVector(result, vector) {
    if (vector.expectId !== undefined) {
        expect(result.id).toBe(vector.expectId);
    }
    if (vector.minConf !== undefined) {
        expect(result.confidence).toBeGreaterThanOrEqual(vector.minConf);
    }
    if (vector.exactConf !== undefined) {
        expect(result.confidence).toBe(vector.exactConf);
    }
    if (vector.sound !== undefined) {
        expect(result.sound).toBe(vector.sound);
    }
    if (vector.tags) {
        for (const tag of vector.tags) {
            expect(result.tags.has(tag)).toBe(true);
        }
    }
}

/** Vectors copied from runSelfTests() dnd5e block in scripts/creatureClassifier.js */
const DND5E_VECTORS = /** @type {ClassifierVector[]} */ ([
    { input: "Zombie", expectId: "undead_zombie", minConf: 0.6 },
    { input: "Owlbear", expectId: "monstrosity_owlbear", tags: ["feathers"] },
    { input: "Mind Flayer", expectId: "aberration_mind_flayer", tags: ["psionic"] },
    { input: "Nalfeshnee", expectId: "fiend_demon_beast", sound: "MONSTER_ROAR" },
    { input: "Giant Boar", expectId: "beast_suidae", sound: "MONSTER_BEAST" },
    { input: "Giant Rat", expectId: "beast_rodent", sound: "SFX_SQUEAK" },
    { input: "Giant Crocodile", expectId: "beast_reptile", sound: "MONSTER_REPTILE" },
    { input: "Giant Hyena", expectId: "beast_hyena", sound: "MONSTER_WOLF" },
    { input: "Giant Wasp", expectId: "beast_insect", sound: "SFX_INSECT" },
    { input: "Giant Scorpion", expectId: "beast_insect", sound: "SFX_INSECT" },
    { input: "Giant Centipede", expectId: "beast_insect", sound: "SFX_INSECT" },
    { input: "Giant Spider", expectId: "beast_arachnid", sound: "SFX_INSECT" },
    { input: "Lion", expectId: "beast_feline", sound: "MONSTER_CAT" },
    { input: "Giant Eagle", expectId: "beast_avian", sound: "MONSTER_BIRD" },
    { input: "Warhorse", expectId: "beast_equine", sound: "MONSTER_HORSE" },
    { input: "Giant Shark", expectId: "beast_aquatic", sound: "SFX_WATER_ENTITY" },
    { input: "Vrock", expectId: "fiend_demon_beast", sound: "MONSTER_ROAR" },
    { input: "Bone Devil", expectId: "fiend_devil", sound: "MONSTER_DEMON" },
    { input: "Cat", expectId: "beast_feline_domestic", sound: "SFX_MEOW" },
    { input: "Mastiff", expectId: "beast_canine_domestic", sound: "SFX_BARK" },
    { input: "Giant Goat", expectId: "beast_cattle", sound: "MONSTER_BEAST" },
    { input: "Giant Fly", expectId: "beast_insect", sound: "SFX_INSECT" },
    { input: "Sea Horse", expectId: "beast_aquatic", sound: "SFX_WATER_ENTITY" },
    { input: "Ankheg", expectId: "monstrosity_ankheg", sound: "SFX_INSECT" },
    { input: "Grick", expectId: "monstrosity_grick", sound: "MONSTER_REPTILE" },
    { input: "Merrow", expectId: "monstrosity_merrow", sound: "SFX_WATER_ENTITY" },
    { input: "Xorn", expectId: "elemental_earth", sound: "MONSTER_CONSTRUCT" },
    { input: "Djinni", expectId: "elemental_air", sound: "SFX_WIND" },
    { input: "Guardian Naga", expectId: "monstrosity_naga", sound: "MONSTER_REPTILE" },
    { input: "Camel", expectId: "beast_equine", sound: "MONSTER_HORSE" },
    { input: "Azer", expectId: "elemental_fire", sound: "MONSTER_ELEMENTAL" },
    { input: "Giant Ape", expectId: "beast_primate", sound: "MONSTER_BEAR" },
    { input: "Hydra", expectId: "monstrosity_hydra", sound: "MONSTER_DRAGON" },
    { input: "Green Hag", expectId: "monstrosity_hag", sound: "MONSTER_HUMANOID" },
    { input: "Gnoll", expectId: "monstrosity_gnoll", sound: "MONSTER_WOLF" },
    { input: "Water Elemental", expectId: "elemental_water", sound: "SFX_WATER_ENTITY" },
    { input: "Fire Elemental", expectId: "elemental_fire", sound: "MONSTER_ELEMENTAL" },
    { input: "Earth Elemental", expectId: "elemental_earth", sound: "MONSTER_CONSTRUCT" },
    { input: "Air Elemental", expectId: "elemental_air", sound: "SFX_WIND" },
    { input: "Invisible Stalker", expectId: "elemental_air", sound: "SFX_WIND" },
    { input: "Salamander", expectId: "elemental_fire", sound: "MONSTER_ELEMENTAL" },
    { input: "Chuul", expectId: "aberration_chuul", sound: "SFX_INSECT" },
    { input: "Warhorse", expectId: "beast_equine", sound: "MONSTER_HORSE" },
    { input: "Weasel", expectId: "beast_mustelid", sound: "MONSTER_BEAST" },
    { input: "Giant Weasel", expectId: "beast_mustelid", sound: "MONSTER_BEAST" },
    { input: "Tribal Warrior", expectId: "humanoid_tribal", sound: "MONSTER_HUMANOID" }
]);

const DAGGERHEART_VECTORS = /** @type {ClassifierVector[]} */ ([
    { input: "Katari Duelist", expectId: "humanoid_katari", tags: ["cat-like"] },
    { input: "Ribbet Scout", expectId: "humanoid_ribbet", tags: ["amphibious"] },
    { input: "Galapa Defender", expectId: "humanoid_galapa", tags: ["shell"] },
    { input: "Faerie Trickster", expectId: "humanoid_faerie", tags: ["wings", "small"] },
    { input: "Drakona Warrior", expectId: "humanoid_drakona", tags: ["scales", "breath-weapon"] },
    { input: "Fungril Shaman", expectId: "humanoid_fungril", tags: ["fungus"] },
    { input: "Skeleton", expectId: "undead_skeleton", sound: "MONSTER_SKELETON" },
    { input: "Zombie", expectId: "undead_zombie", sound: "MONSTER_ZOMBIE" },
    { input: "Bear", expectId: "beast_ursine", sound: "MONSTER_BEAR" },
    { input: "Fire Elemental", expectId: "elemental_fire", sound: "SFX_FIRE" }
]);

const GENERIC_FALLBACK_VECTORS = /** @type {ClassifierVector[]} */ ([
    { input: "Zombie", expectId: "undead_zombie", minConf: 0.6 },
    { input: "Cave Bear", expectId: "beast_ursine", tags: ["claws"] },
    { input: "Flameskull", expectId: "undead_construct", tags: ["no_limbs"], exactConf: 1.0 },
    { input: "Ancient Red Dragon", expectId: "dragon_chromatic", tags: ["wings", "breath-weapon"] }
]);

describe("DnD5e", () => {
    beforeAll(() => {
        globalThis.game.system.id = "dnd5e";
    });

    DND5E_VECTORS.forEach((vector, index) => {
        test(`${vector.input} [${index}]`, () => {
            const result = classifyCreature(vector.input);
            assertVector(result, vector);
        });
    });
});

describe("Daggerheart", () => {
    beforeAll(() => {
        globalThis.game.system.id = "daggerheart";
    });

    DAGGERHEART_VECTORS.forEach((vector, index) => {
        test(`${vector.input} [${index}]`, () => {
            const result = classifyCreature(vector.input);
            assertVector(result, vector);
        });
    });
});

describe("Generic fallback", () => {
    beforeAll(() => {
        globalThis.game.system.id = "unsupported-test-system";
    });

    GENERIC_FALLBACK_VECTORS.forEach((vector, index) => {
        test(`${vector.input} [${index}]`, () => {
            const result = classifyCreature(vector.input);
            assertVector(result, vector);
        });
    });
});
