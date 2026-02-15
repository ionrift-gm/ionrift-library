export const DND5E_DATA = {
    aberration: {
        id: "aberration",
        keywords: ["Aberration"],
        defaultTags: ["alien", "psionic", "tentacles", "madness"],
        sound: "MONSTER_ALIEN",
        subtypes: [
            { id: "beholder", keywords: ["Beholder", "Spectator", "Gauth"], tags: ["floating", "eye-rays"], sound: "MONSTER_ALIEN" },
            { id: "mind_flayer", keywords: ["Mind Flayer", "Illithid"], tags: ["psionic", "tentacles", "brain-eater"], sound: "MONSTER_ALIEN" },
            { id: "chuul", keywords: ["Chuul"], tags: ["aquatic", "pincers"], sound: "SFX_INSECT" }
        ]
    },
    beast: {
        id: "beast",
        keywords: ["Beast"],
        defaultTags: ["natural", "organic", "wild"],
        sound: "MONSTER_BEAST",
        subtypes: [
            { id: "ursine", keywords: ["Bear"], tags: ["claws", "fur"], sound: "MONSTER_BEAR" },
            { id: "primate", keywords: ["Ape", "Baboon"], tags: ["climb"], sound: "MONSTER_BEAR" },
            { id: "canine", keywords: ["Wolf", "Worg", "Jackal", "Fox", "Coyote", "Winter Wolf"], tags: ["pack-tactics", "fur"], sound: "MONSTER_WOLF" },
            { id: "canine_domestic", keywords: ["Dog", "Mastiff"], tags: ["loyal", "pet"], sound: "SFX_BARK" },
            { id: "cattle", keywords: ["Cow", "Ox", "Rothe", "Stench Kow", "Goat", "Sheet", "Ram", "Yak"], tags: ["horns", "farm"], sound: "MONSTER_BEAST" },
            { id: "suidae", keywords: ["Boar"], tags: ["tusks", "charge"], sound: "MONSTER_BEAST" },
            { id: "rodent", keywords: ["Rat"], tags: ["disease", "pack"], sound: "SFX_SQUEAK" },
            { id: "chiropteran", keywords: ["Bat"], tags: ["flying", "echolocation"], sound: "MONSTER_BIRD" },
            { id: "mustelid", keywords: ["Badger", "Wolverine", "Weasel", "Giant Weasel"], tags: ["burrow", "ferocious"], sound: "MONSTER_BEAST" },
            { id: "reptile", keywords: ["Crocodile", "Alligator", "Lizard", "Toad", "Frog", "Snake", "Plesiosaurus", "Lizardfolk", "Kobold"], tags: ["scales", "amphibious"], sound: "MONSTER_REPTILE" },
            { id: "hyena", keywords: ["Hyena"], tags: ["pack-tactics", "scavenger"], sound: "MONSTER_WOLF" },
            { id: "insect", keywords: ["Wasp", "Centipede", "Scorpion", "Beetle", "Crab", "Insect", "Fly"], tags: ["chitin", "poison"], sound: "SFX_INSECT" },
            { id: "arachnid", keywords: ["Spider", "Steeder", "Ettercap"], tags: ["web", "poison"], sound: "SFX_INSECT" },
            { id: "feline", keywords: ["Lion", "Tiger", "Panther", "Leopard", "Jaguar"], tags: ["claws", "pounce"], sound: "MONSTER_CAT" },
            { id: "feline_domestic", keywords: ["Cat", "Tressym"], tags: ["claws", "pounce", "pet"], sound: "SFX_MEOW" },
            { id: "avian", keywords: ["Eagle", "Hawk", "Owl", "Vulture", "Raven", "Crow", "Blood Hawk"], tags: ["flying", "beak"], sound: "MONSTER_BIRD" },
            { id: "aquatic", keywords: ["Shark", "Octopus", "Quipper", "Fish", "Whale", "Dolphin", "Sea Horse"], tags: ["swimming", "water"], sound: "SFX_WATER_ENTITY" },
            { id: "equine", keywords: ["Horse", "Pony", "Mule", "Elk", "Deer", "Centaur", "Pegasus", "Unicorn", "Camel", "Warhorse"], tags: ["hooves", "mount"], sound: "MONSTER_HORSE" }
        ]
    },
    celestial: {
        id: "celestial",
        keywords: ["Celestial"],
        defaultTags: ["divine", "good", "radiant"],
        sound: "SFX_CHOIR",
        subtypes: [
            { id: "angel", keywords: ["Angel", "Deva", "Planetar", "Solar"], tags: ["wings", "flying", "weapon"], sound: "SFX_CHOIR" }
        ]
    },
    construct: {
        id: "construct",
        keywords: ["Construct"],
        defaultTags: ["artificial", "mindless"],
        sound: "MONSTER_CONSTRUCT",
        subtypes: [
            { id: "golem", keywords: ["Golem"], tags: ["magic-resistance", "heavy"], sound: "MONSTER_CONSTRUCT" }
        ]
    },
    dragon: {
        id: "dragon",
        keywords: ["Dragon"],
        defaultTags: ["scales", "breath-weapon", "flying"],
        sound: "MONSTER_DRAGON",
        subtypes: []
    },
    elemental: {
        id: "elemental",
        keywords: ["Elemental"],
        defaultTags: ["elemental", "primordial"],
        sound: "MONSTER_ELEMENTAL",
        subtypes: [
            { id: "air", keywords: ["Air Elemental", "Djinni", "Invisible Stalker", "Steam Mephit", "Dust Mephit", "Smoke Mephit"], tags: ["air", "wind", "flying"], sound: "SFX_WIND" },
            { id: "earth", keywords: ["Earth Elemental", "Xorn", "Gargoyle", "Mud Mephit", "Dao"], tags: ["earth", "stone"], sound: "MONSTER_CONSTRUCT" },
            { id: "fire", keywords: ["Fire Elemental", "Salamander", "Azer", "Efreeti", "Magmin", "Fire Snake", "Magma Mephit"], tags: ["fire", "burn"], sound: "MONSTER_ELEMENTAL" },
            { id: "water", keywords: ["Water Elemental", "Water Weird", "Marid", "Ice Mephit"], tags: ["water", "liquid"], sound: "SFX_WATER_ENTITY" },
            { id: "generic", keywords: ["Mephit"], tags: ["small"], sound: "MONSTER_GOBLIN" } // Fallback for generic mephits
        ]
    },
    fey: {
        id: "fey",
        keywords: ["Fey"],
        defaultTags: ["nature", "trickster", "magic"],
        sound: "SFX_WIND",
        subtypes: []
    },
    fiend: {
        id: "fiend",
        keywords: ["Fiend"],
        defaultTags: ["evil", "planar"],
        sound: "MONSTER_DEMON",
        subtypes: [
            { id: "demon", keywords: ["Demon", "Dretch", "Manes", "Quasit", "Shadow Demon"], tags: ["chaotic", "abyssal"], sound: "MONSTER_DEMON" },
            { id: "devil", keywords: ["Devil", "Imp", "Spined Devil", "Bearded Devil", "Barbed Devil", "Chain Devil", "Bone Devil", "Erinyes", "Ice Devil", "Horned Devil", "Pit Fiend"], tags: ["lawful", "infernal"], sound: "MONSTER_DEMON" },
            { id: "demon_beast", keywords: ["Nalfeshnee", "Hezrou", "Glabrezu", "Barlgura", "Goristro", "Vrock"], tags: ["chaotic", "abyssal", "muscular"], sound: "MONSTER_ROAR" },
            { id: "nightmare", keywords: ["Nightmare"], tags: ["fire", "hooves"], sound: "MONSTER_HORSE" }
        ]
    },
    giant: {
        id: "giant",
        keywords: ["Giant"],
        defaultTags: ["huge", "strength"],
        sound: "MONSTER_GIANT",
        subtypes: []
    },
    humanoid: {
        id: "humanoid",
        keywords: ["Humanoid"],
        defaultTags: ["bipedal", "civilized"],
        sound: "MONSTER_HUMANOID",
        subtypes: [
            {
                id: "elf",
                keywords: ["Elf", "Elven", "Drow", "High Elf", "Wood Elf", "Eladrin", "Shadar-kai"],
                tags: ["agile", "magic", "ears", "long-lived", "fey-ancestry"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "dwarf",
                keywords: ["Dwarf", "Dwarven", "Duergar", "Mountain Dwarf", "Hill Dwarf"],
                tags: ["stout", "beard", "underground", "tough", "poison-resistance"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "halfling",
                keywords: ["Halfling", "Lightfoot", "Stout"],
                tags: ["small", "lucky", "agile", "brave"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "gnome",
                keywords: ["Gnome", "Rock Gnome", "Forest Gnome", "Deep Gnome", "Svirfneblin"],
                tags: ["small", "inventive", "magic", "illusion"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "human",
                keywords: ["Human", "Variant Human"],
                tags: ["versatile", "ambitious"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "dragonborn",
                keywords: ["Dragonborn"],
                tags: ["scales", "breath-weapon", "strong", "draconic"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "tiefling",
                keywords: ["Tiefling"],
                tags: ["horns", "tail", "infernal", "fire-resistance", "darkvision"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "half_orc",
                keywords: ["Half-Orc"],
                tags: ["strong", "relentless", "menacing", "tusks"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "half_elf",
                keywords: ["Half-Elf"],
                tags: ["versatile", "charismatic", "fey-ancestry"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "goliath",
                keywords: ["Goliath"],
                tags: ["huge", "strong", "mountain", "stones-endurance"],
                sound: "MONSTER_GIANT"
            },
            {
                id: "tabaxi",
                keywords: ["Tabaxi", "Catfolk"],
                tags: ["cat-like", "agile", "claws", "fur", "speed"],
                sound: "MONSTER_CAT"
            },
            {
                id: "tortle",
                keywords: ["Tortle"],
                tags: ["shell", "slow", "tough", "natural-armor"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "aarakocra",
                keywords: ["Aarakocra", "Birdfolk", "Owlin", "Kenku"],
                tags: ["wings", "flying", "feathers", "beak"],
                sound: "MONSTER_BIRD"
            },
            {
                id: "genasi",
                keywords: ["Genasi", "Fire Genasi", "Water Genasi", "Earth Genasi", "Air Genasi"],
                tags: ["elemental", "planar", "magic"],
                sound: "MONSTER_ELEMENTAL"
            },
            {
                id: "aasimar",
                keywords: ["Aasimar"],
                tags: ["celestial", "radiant", "healing", "light"],
                sound: "SFX_CHOIR"
            },
            {
                id: "firbolg",
                keywords: ["Firbolg"],
                tags: ["giant-kin", "nature", "magic", "gentle"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "triton",
                keywords: ["Triton", "Sea Elf"],
                tags: ["aquatic", "amphibious", "swimming"],
                sound: "SFX_WATER"
            },
            {
                id: "goblinoid",
                keywords: ["Goblin", "Hobgoblin", "Bugbear"],
                tags: ["chaotic", "stealthy", "darkvision"],
                sound: "MONSTER_GOBLIN"
            },

            {
                id: "orc",
                keywords: ["Orc"],
                tags: ["aggressive", "strong", "tusks"],
                sound: "MONSTER_HUMANOID"
            },

        ]
    },
    monstrosity: {
        id: "monstrosity",
        keywords: ["Monstrosity"],
        defaultTags: ["unnatural", "terrifying"],
        sound: "MONSTER_ROAR",
        subtypes: [
            { id: "owlbear", keywords: ["Owlbear"], tags: ["feathers", "fur", "claws", "beak"], sound: "MONSTER_BEAR" },
            { id: "ankheg", keywords: ["Ankheg"], tags: ["burrow", "acid", "chitin"], sound: "SFX_INSECT" },
            { id: "grick", keywords: ["Grick"], tags: ["tentacles", "beak", "camouflage"], sound: "MONSTER_REPTILE" },
            {
                id: "lizardfolk",
                keywords: ["Lizardfolk"],
                tags: ["reptile", "scales", "natural-armor", "bite"],
                sound: "MONSTER_REPTILE"
            },
            {
                id: "gnoll",
                keywords: ["Gnoll"],
                tags: ["hyena", "pack-tactics"],
                sound: "MONSTER_WOLF"
            },
            {
                id: "hag",
                keywords: ["Hag", "Sea Hag", "Green Hag", "Night Hag", "Annis Hag", "Bheur Hag"],
                tags: ["fey", "magic"],
                sound: "MONSTER_HUMANOID"
            }
        ]
    },
    ooze: {
        id: "ooze",
        keywords: ["Ooze"],
        defaultTags: ["amorphous", "acid"],
        sound: "SFX_SLIME",
        subtypes: []
    },
    plant: {
        id: "plant",
        keywords: ["Plant"],
        defaultTags: ["vegetation", "nature"],
        sound: "MONSTER_PLANT",
        subtypes: []
    },
    undead: {
        id: "undead",
        keywords: ["Undead"],
        defaultTags: ["dead", "nasty"],
        sound: "MONSTER_ZOMBIE",
        subtypes: [
            { id: "zombie", keywords: ["Zombie"], tags: ["rotting", "undead"], sound: "MONSTER_ZOMBIE" },
            { id: "skeleton", keywords: ["Skeleton"], tags: ["bones", "undead"], sound: "MONSTER_SKELETON" }
        ]
    },
    exceptions: {}
};

/* 
 * EXPANDED DATA SET 
 * Mapped from SRD and common homebrew patterns.
 */

// CONSTRUCTS
DND5E_DATA.construct.subtypes.push(
    { id: "animated_object", keywords: ["Animated Armor", "Flying Sword", "Rug of Smothering"], tags: ["object", "magic"], sound: "MONSTER_CONSTRUCT" },
    { id: "golem_clay", keywords: ["Clay Golem"], tags: ["clay", "heavy"], sound: "MONSTER_CONSTRUCT" },
    { id: "golem_flesh", keywords: ["Flesh Golem"], tags: ["flesh", "Undead-like"], sound: "MONSTER_ZOMBIE" },
    { id: "golem_iron", keywords: ["Iron Golem", "Steel Defender"], tags: ["metal", "heavy"], sound: "MONSTER_CONSTRUCT" },
    { id: "golem_stone", keywords: ["Stone Golem", "Shield Guardian", "Helmed Horror"], tags: ["stone", "heavy"], sound: "MONSTER_CONSTRUCT" }
);

// ELEMENTALS - Populated in main object now.
/*
DND5E_DATA.elemental.subtypes.push(
    { id: "gargoyle", keywords: ["Gargoyle"], tags: ["stone", "flying"], sound: "MONSTER_CONSTRUCT" },
    { id: "invisible_stalker", keywords: ["Invisible Stalker"], tags: ["air", "invisible"], sound: "SFX_WIND" },
    { id: "mephit", keywords: ["Mephit", "Magmin"], tags: ["small", "elemental"], sound: "MONSTER_GOBLIN" },
    { id: "xorn", keywords: ["Xorn"], tags: ["earth", "stone"], sound: "MONSTER_CONSTRUCT" },
    { id: "djinni", keywords: ["Djinni", "Air Elemental"], tags: ["air", "wind"], sound: "SFX_WIND" },
    { id: "azer", keywords: ["Azer"], tags: ["fire", "dwarf"], sound: "MONSTER_ELEMENTAL" }
);
*/

// FEY
DND5E_DATA.fey.subtypes.push(
    { id: "dryad", keywords: ["Dryad"], tags: ["tree", "charm"], sound: "MONSTER_HUMANOID" },
    { id: "satyr", keywords: ["Satyr"], tags: ["pipes", "charm"], sound: "MONSTER_HUMANOID" },
    { id: "sprite", keywords: ["Sprite", "Pixie"], tags: ["tiny", "flying", "invisibility"], sound: "SFX_CHIME" },
    { id: "blink_dog", keywords: ["Blink Dog"], tags: ["teleport", "good"], sound: "MONSTER_WOLF" }
);

// FIENDS
DND5E_DATA.fiend.subtypes.push(
    { id: "nightmare", keywords: ["Nightmare"], tags: ["fire", "hooves"], sound: "MONSTER_HORSE" },
    { id: "hell_hound", keywords: ["Hell Hound"], tags: ["fire", "breath"], sound: "MONSTER_WOLF" },
    { id: "succubus", keywords: ["Succubus", "Incubus"], tags: ["charm", "shapechanger"], sound: "MONSTER_HUMANOID" },
    { id: "rakshasa", keywords: ["Rakshasa"], tags: ["tiger", "magic-immune"], sound: "MONSTER_CAT" }
);

// GIANTS
DND5E_DATA.giant.subtypes.push(
    { id: "ogre", keywords: ["Ogre"], tags: ["dumb", "strong"], sound: "MONSTER_GIANT" },
    { id: "troll", keywords: ["Troll"], tags: ["regeneration", "claws"], sound: "MONSTER_GIANT" },
    { id: "ettin", keywords: ["Ettin"], tags: ["two-heads"], sound: "MONSTER_GIANT" },
    { id: "oni", keywords: ["Oni"], tags: ["magic", "glaive"], sound: "MONSTER_GIANT" },
    { id: "cyclops", keywords: ["Cyclops"], tags: ["one-eye"], sound: "MONSTER_GIANT" }
);

// HUMANOIDS (NPCs & Scatter)
DND5E_DATA.humanoid.subtypes.push(
    { id: "commoner", keywords: ["Commoner", "Noble", "Merchant"], tags: ["civilian"], sound: "MONSTER_HUMANOID" },
    { id: "guard", keywords: ["Guard", "Knight", "Gladitor", "Veteran", "Soldier"], tags: ["armor", "weapon"], sound: "MONSTER_HUMANOID" },
    { id: "tribal", keywords: ["Tribal Warrior", "Berserker"], tags: ["wild", "strength"], sound: "MONSTER_HUMANOID" },
    { id: "bandit", keywords: ["Bandit", "Thug", "Pirate", "Spy", "Scout", "Assassin"], tags: ["criminal", "stealth"], sound: "MONSTER_HUMANOID" },
    { id: "cultist", keywords: ["Cultist", "Cult Fanatic"], tags: ["religious", "dark"], sound: "MONSTER_HUMANOID" },
    { id: "caster", keywords: ["Mage", "Archmage", "Wizard", "Sorcerer", "Warlock", "Necromancer"], tags: ["magic"], sound: "MONSTER_HUMANOID" },
    { id: "priest", keywords: ["Priest", "Acolyte", "Druid", "Shaman"], tags: ["divine", "nature"], sound: "MONSTER_HUMANOID" },
    { id: "lycanthrope", keywords: ["Werewolf", "Wererat", "Wereboar", "Weretiger", "Werebear"], tags: ["shapechanger", "curse"], sound: "MONSTER_LYCANTHROPE" }
);

// MONSTROSITIES
DND5E_DATA.monstrosity.subtypes.push(
    { id: "bulette", keywords: ["Bulette"], tags: ["burrow", "landshark"], sound: "MONSTER_ROAR" },
    { id: "roper", keywords: ["Roper", "Piercer", "Darkmantle"], tags: ["camouflage", "tentacles"], sound: "SFX_SLIME" },
    { id: "basilisk", keywords: ["Basilisk", "Cockatrice"], tags: ["petrify"], sound: "MONSTER_REPTILE" },
    { id: "manticore", keywords: ["Manticore", "Chimera"], tags: ["spikes", "wings"], sound: "MONSTER_ROAR" },
    { id: "minotaur", keywords: ["Minotaur"], tags: ["labyrinth", "charge"], sound: "MONSTER_ROAR" },
    { id: "medusa", keywords: ["Medusa"], tags: ["petrify", "snakes"], sound: "MONSTER_HUMANOID" },
    { id: "harpy", keywords: ["Harpy"], tags: ["song", "flying"], sound: "MONSTER_BIRD" },
    { id: "griffon", keywords: ["Griffon", "Hippogriff", "Pegasus", "Peryton"], tags: ["flying", "mount"], sound: "MONSTER_BIRD" },
    { id: "phase_spider", keywords: ["Phase Spider", "Giant Spider", "Ettercap", "Drider"], tags: ["web", "poison"], sound: "MONSTER_SPIDER" },
    { id: "carrion_crawler", keywords: ["Carrion Crawler"], tags: ["paralysis", "tentacles"], sound: "SFX_SLIME" },
    { id: "rust_monster", keywords: ["Rust Monster"], tags: ["rust", "metal-eater"], sound: "SFX_INSECT" },
    { id: "umber_hulk", keywords: ["Umber Hulk"], tags: ["confusing-gaze", "burrow"], sound: "MONSTER_ROAR" },
    { id: "displacer_beast", keywords: ["Displacer Beast"], tags: ["displacement", "panther"], sound: "MONSTER_CAT" },
    { id: "doppelganger", keywords: ["Doppelganger"], tags: ["shapechanger"], sound: "MONSTER_HUMANOID" },
    { id: "hook_horror", keywords: ["Hook Horror"], tags: ["echolocation", "hooks"], sound: "SFX_INSECT" },
    { id: "purple_worm", keywords: ["Purple Worm"], tags: ["huge", "swallow"], sound: "MONSTER_ROAR" },
    { id: "merrow", keywords: ["Merrow"], tags: ["aquatic", "harpoon"], sound: "SFX_WATER_ENTITY" },
    { id: "naga", keywords: ["Naga", "Guardian Naga", "Spirit Naga", "Bone Naga"], tags: ["snake", "magic"], sound: "MONSTER_REPTILE" },
    { id: "hydra", keywords: ["Hydra"], tags: ["multi-headed", "regeneration"], sound: "MONSTER_DRAGON" }
);

// OOZES
DND5E_DATA.ooze.subtypes.push(
    { id: "gelatinous_cube", keywords: ["Gelatinous Cube"], tags: ["transparent", "engulf"], sound: "SFX_SLIME" },
    { id: "ochre_jelly", keywords: ["Ochre Jelly"], tags: ["split"], sound: "SFX_SLIME" },
    { id: "black_pudding", keywords: ["Black Pudding"], tags: ["corrosive"], sound: "SFX_SLIME" },
    { id: "gray_ooze", keywords: ["Gray Ooze"], tags: ["corrosive"], sound: "SFX_SLIME" }
);

// PLANTS
DND5E_DATA.plant.subtypes.push(
    { id: "shrieker", keywords: ["Shrieker", "Violet Fungus"], tags: ["fungus"], sound: "MONSTER_PLANT" },
    { id: "treant", keywords: ["Treant", "Awakened Tree", "Awakened Shrub"], tags: ["tree"], sound: "MONSTER_PLANT" },
    { id: "shambling_mound", keywords: ["Shambling Mound"], tags: ["engulf"], sound: "MONSTER_PLANT" },
    { id: "myconid", keywords: ["Myconid"], tags: ["spores"], sound: "MONSTER_PLANT" }
);

// UNDEAD
DND5E_DATA.undead.subtypes.push(
    { id: "ghoul", keywords: ["Ghoul", "Ghast"], tags: ["paralysis"], sound: "MONSTER_ZOMBIE" },
    { id: "wight", keywords: ["Wight"], tags: ["life-drain"], sound: "MONSTER_zOMBIE" },
    { id: "mummy", keywords: ["Mummy"], tags: ["curse", "rotting"], sound: "MONSTER_ZOMBIE" },
    { id: "vampire", keywords: ["Vampire"], tags: ["regeneration", "charm", "bite"], sound: "MONSTER_HUMANOID" },
    { id: "lich", keywords: ["Lich", "Demilich"], tags: ["spellcaster", "phylactery"], sound: "MONSTER_SKELETON" },
    { id: "wraith", keywords: ["Wraith", "Ghost", "Specter", "Shadow", "Poltergeist", "Banshee", "Will-o'-Wisp"], tags: ["incorporeal", "drain"], sound: "MONSTER_GHOST" }
);

// DRAGONS
DND5E_DATA.dragon.subtypes.push(
    { id: "wyvern", keywords: ["Wyvern"], tags: ["poison", "sting"], sound: "MONSTER_DRAGON" },
    { id: "pseudodragon", keywords: ["Pseudodragon", "Faerie Dragon"], tags: ["tiny", "fameiliar"], sound: "MONSTER_REPTILE" }
);
