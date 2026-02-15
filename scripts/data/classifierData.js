import { DND5E_DATA } from "./dnd5eData.js";

const DAGGERHEART_DATA = {
    // --- DRAGONS (High Priority) ---
    dragon: {
        id: "dragon",
        keywords: ["Dragon", "Wyrm", "Drake"],
        defaultTags: ["scales", "wings", "breath-weapon", "flight", "frightful", "massive"],
        sound: "MONSTER_DRAGON",
        subtypes: [
            {
                id: "chromatic",
                keywords: ["Red Dragon", "Blue Dragon", "Green Dragon", "Black Dragon", "White Dragon", "Ice Dragon", "Void Dragon", "Volcanic Dragon", "Shadow Dragon"],
                tags: ["evil", "breath-weapon"]
            },
            {
                id: "metallic",
                keywords: ["Gold Dragon", "Silver Dragon", "Bronze Dragon", "Copper Dragon", "Brass Dragon", "Platinum Dragon"],
                tags: ["noble", "breath-weapon"]
            }
        ]
    },

    // --- NEW CATEGORIES ---
    ooze: {
        id: "ooze",
        keywords: ["Ooze", "Slime", "Jelly", "Pudding", "Blob"],
        defaultTags: ["acid", "amorphous", "sticky", "slow"],
        sound: "SFX_SLIME",
        subtypes: []
    },
    fiend: {
        id: "fiend",
        defaultTags: ["evil", "planar", "dark"],
        sound: "MONSTER_DEMON",
        subtypes: [
            {
                id: "demon",
                keywords: ["Demon", "Abomination", "Corrupter", "Thrall", "Hubris", "Jealousy", "Wrath", "Avarice", "Despair"],
                tags: ["chaotic", "abyssal", "horns", "claws"],
                sound: "MONSTER_DEMON"
            },
            {
                id: "devil",
                keywords: ["Devil", "Imp", "Fiend"],
                tags: ["lawful", "infernal", "contracts"],
                sound: "MONSTER_DEMON"
            }
        ]
    },
    elemental: {
        id: "elemental",
        defaultTags: ["elemental", "magic", "primordial"],
        sound: "MONSTER_ELEMENTAL",
        subtypes: [
            { id: "fire", keywords: ["Fire", "Flame", "Magma", "Lava", "Burning", "Spark"], tags: ["fire", "hot", "burn"], sound: "SFX_FIRE" },
            { id: "earth", keywords: ["Earth", "Stone", "Rock", "Mud", "Crystal", "Gem"], tags: ["earth", "hard", "heavy"], sound: "MONSTER_CONSTRUCT" },
            { id: "water", keywords: ["Water", "Ice", "Steam", "Mist", "River", "Sea"], tags: ["water", "liquid", "cold"], sound: "SFX_WATER" },
            { id: "air", keywords: ["Air", "Wind", "Storm", "Lightning", "Cloud"], tags: ["air", "flying", "invisible"], sound: "SFX_WIND" },
            { id: "magic", keywords: ["Magic", "Arcane", "Chaos", "Mana", "Energy", "Void"], tags: ["magic", "unstable", "glowing"], sound: "MONSTER_ELEMENTAL" }
        ]
    },
    plant: {
        id: "plant",
        keywords: ["Plant", "Tree", "Fungus", "Spore", "Vine", "Bramble", "Dryad", "Treant", "Myconid", "Root", "Flower", "Sylvan", "Deeproot"],
        defaultTags: ["plant", "organic", "wood", "nature", "forest"],
        sound: "MONSTER_PLANT",
        subtypes: []
    },


    // --- UPDATES ---
    undead: {
        id: "undead",
        defaultTags: ["undead", "horror"],
        sound: "MONSTER_ZOMBIE",
        subtypes: [
            {
                id: "skeleton",
                keywords: ["Skeleton", "Bone", "Skull", "Ossuary"],
                tags: ["bones", "rattling", "ancient", "no_flesh"],
                sound: "MONSTER_SKELETON"
            },
            {
                id: "zombie",
                keywords: ["Zombie", "Dredge", "Corpse", "Rotter", "Hulk", "Legion", "Experiment"],
                tags: ["rotting", "flesh", "shambling", "groan"],
                sound: "MONSTER_ZOMBIE"
            },
            {
                id: "ghost",
                keywords: ["Ghost", "Spirit", "Wraith", "Specter", "Spectral", "Banshee", "Phantom", "Stonewraith", "Shadow"],
                tags: ["ethereal", "incorporeal", "floating", "wail", "transparent"],
                sound: "MONSTER_GHOST"
            },
            {
                id: "vampire",
                keywords: ["Vampire", "Spawn"],
                tags: ["fangs", "pale", "charming", "regeneration"],
                sound: "MONSTER_HUMANOID"
            }
        ]
    },
    humanoid: {
        id: "humanoid",
        defaultTags: ["humanoid", "bipedal", "clothes"],
        sound: "MONSTER_HUMANOID",
        subtypes: [
            {
                id: "elf",
                keywords: ["Elf", "Elven", "Drow", "High Elf", "Wood Elf"],
                tags: ["agile", "magic", "ears", "long-lived"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "dwarf",
                keywords: ["Dwarf", "Dwarven", "Duergar"],
                tags: ["stout", "beard", "underground", "tough"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "halfling",
                keywords: ["Halfling", "Hobbit"],
                tags: ["small", "lucky", "agile"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "gnome",
                keywords: ["Gnome", "Svirfneblin"],
                tags: ["small", "inventive", "magic"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "human",
                keywords: ["Human"],
                tags: ["versatile", "ambitious"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "drakona",
                keywords: ["Drakona", "Dragonborn"],
                tags: ["scales", "breath-weapon", "strong"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "katari",
                keywords: ["Katari", "Tabaxi", "Catfolk"],
                tags: ["cat-like", "agile", "claws", "fur"],
                sound: "MONSTER_CAT"
            },
            {
                id: "galapa",
                keywords: ["Galapa", "Tortle"],
                tags: ["shell", "slow", "tough"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "ribbet",
                keywords: ["Ribbet", "Bullywug", "Frogfolk"],
                tags: ["amphibious", "jump", "slime"],
                sound: "SFX_SLIME"
            },
            {
                id: "faerie",
                keywords: ["Faerie", "Fairy", "Pixie", "Sprite"],
                tags: ["wings", "small", "magic", "flying"],
                sound: "SFX_WIND"
            },
            {
                id: "faun",
                keywords: ["Faun", "Satyr"],
                tags: ["horns", "hooves", "nature"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "fungril",
                keywords: ["Fungril", "Myconid"],
                tags: ["fungus", "spores", "plant"],
                sound: "MONSTER_PLANT"
            },
            {
                id: "goblinoid",
                keywords: ["Goblin", "Hobgoblin", "Bugbear", "Fallen"],
                tags: ["chaotic", "stealthy", "pointed ears", "weapons"],
                sound: "MONSTER_GOBLIN"
            },
            {
                id: "orc",
                keywords: ["Orc", "Half-Orc"],
                tags: ["aggressive", "strong", "tusks", "weapons"],
                sound: "MONSTER_ORC"
            },
            {
                id: "cultist",
                keywords: ["Cult", "Cultist", "Adept", "Fang", "Initiate", "Ritual", "Necromancer", "Sorcerer", "Warlord", "Hexer", "Secret-Keeper"],
                tags: ["robes", "evil", "magic", "chanting"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "mage",
                keywords: ["Mage", "Wizard", "Sorcerer", "Warlock", "Spellblade", "War Wizard", "Magician", "Archmage", "Oracle"],
                tags: ["robes", "magic", "staff", "spellbook", "arcane"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "pirate",
                keywords: ["Pirate", "Corsair", "Buccaneer", "Raider", "Sailor", "Freebooter", "Privateer", "Tough", "Mate", "Deckhand"],
                tags: ["nautical", "seafaring", "cutlass", "scarf", "dirty", "pistol"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "archer",
                keywords: ["Archer", "Sniper", "Ranger", "Hunter", "Scout", "Marksm"], // Marksm matches Marksman
                tags: ["leather", "bow", "arrows", "ranged", "hood"],
                sound: "SFX_BOW"
            },
            {
                id: "rogue",
                keywords: ["Thief", "Assassin", "Spy", "Bandit", "Cutpharse", "Poisoner", "Stalker", "Jagged Knife", "Shadow", "Lackey"],
                tags: ["stealthy", "dagger", "cloak", "poison", "leather"],
                sound: "MONSTER_HUMANOID"
            },
            {
                id: "soldier",
                keywords: ["Soldier", "Guard", "Knight", "Warrior", "Captain", "Conscript", "Sellsword", "Mercenary", "Brawler", "Kneebreaker", "Weaponmaster", "Harrier"],
                tags: ["armor", "helmet", "weapons", "shield", "melee", "military"],
                sound: "SFX_ARMOR_CLANK"
            },
            {
                id: "noble",
                keywords: ["Noble", "King", "Queen", "Prince", "Princess", "Duke", "Duchess", "Baron", "Courtier", "Advisor", "Courtesan", "Monarch", "Merchant", "Aristocrat"],
                tags: ["rich", "jewelry", "clean", "robes", "crown"],
                sound: "MONSTER_HUMANOID"
            }
        ]
    },
    beast: {
        id: "beast",
        defaultTags: ["organic", "wild"],
        sound: "MONSTER_BEAST",
        subtypes: [
            { id: "ursine", keywords: ["Bear", "Owlbear"], tags: ["thick fur", "claws", "roar", "quadruped", "heavy"], sound: "MONSTER_BEAR" },
            { id: "canine", keywords: ["Wolf", "Worg", "Dog", "Hound", "Fox", "Jackal"], tags: ["fur", "fangs", "bark", "howl", "quadruped", "pack-hunter"], sound: "MONSTER_WOLF" },
            { id: "feline", keywords: ["Lion", "Tiger", "Cat", "Panther", "Cat", "Sabertooth"], tags: ["fur", "claws", "roar", "quadruped", "agile", "whiskers"], sound: "MONSTER_CAT" },
            { id: "avian", keywords: ["Eagle", "Hawk", "Roc", "Vulture", "Raven", "Owl", "Crow", "Bird", "Seraph", "Bat"], tags: ["feathers", "wings", "beak", "screech", "flight"], sound: "MONSTER_BIRD" },
            { id: "insect", keywords: ["Spider", "Scorpion", "Beetle", "Centipede", "Insect", "Wasp", "Ant", "Flickerfly", "Burrower", "Rat", "Mosquito", "Fly"], tags: ["chitin", "legs", "mandibles", "skittering", "poison"], sound: "MONSTER_INSECT" },
            { id: "reptile", keywords: ["Snake", "Lizard", "Basilisk", "Crocodile", "Reptile", "Hydra", "Gorgon", "Medusa"], tags: ["scales", "cold-blooded", "hissing", "tail"], sound: "MONSTER_REPTILE" },
            { id: "aquatic", keywords: ["Shark", "Fish", "Crab", "Octopus", "Kraken", "Siren", "Eel"], tags: ["swimming", "gills", "wet", "fins", "tentacles"], sound: "SFX_WATER" }
        ]
    },
    construct: {
        id: "construct",
        keywords: ["Construct", "Golem", "Robot", "Modron", "Vault Guardian", "Machine", "Automaton"],
        defaultTags: ["artificial", "mindless", "heavy", "metal"],
        sound: "MONSTER_CONSTRUCT",
        subtypes: []
    },
    environment: {
        id: "environment",
        keywords: ["Environment", "Trap", "Hazard", "Terrain", "Lair", "Effect", "Object", "Door", "Wall", "Chest", "Marketplace", "Tavern", "City", "Castle", "Pass", "River", "Outpost", "Ruins", "Temple", "Realm", "Court", "Domain"],
        defaultTags: ["object", "static", "scenery", "structure"],
        sound: "SFX_ENVIRONMENT",
        subtypes: []
    },
    event: {
        id: "event",
        keywords: ["Event", "Ambushed", "Ambush", "Ambushers", "Ambusher", "Battle", "Siege", "Usurpation", "Ascent", "Ritual", "Meeting", "Pitched Battle", "Chase"],
        defaultTags: ["plot", "narrative", "dynamic"],
        sound: "SFX_EVENT",
        subtypes: []
    },
    giant: {
        id: "giant",
        keywords: ["Giant", "Titan", "Ogre", "Troll", "Cyclops", "Ettin", "Minotaur"],
        defaultTags: ["huge", "strong", "clumsy", "humanoid"],
        sound: "MONSTER_GIANT",
        subtypes: []
    },

    // EXCEPTION DICTIONARY
    // These override normal classification rules with hardcoded truths.
    exceptions: {
        "flameskull": {
            id: "undead_construct",
            tags: ["fire", "flying", "skull", "magic", "no_limbs", "floating", "detached_skull", "bones"],
            sound: "MONSTER_GHOST",
            confidence: 1.0,
            override: true
        },
        "demilich": {
            id: "undead_construct",
            tags: ["flying", "skull", "magic", "no_limbs", "floating", "detached_skull", "gemstones", "bones"],
            sound: "MONSTER_GHOST",
            confidence: 1.0,
            override: true
        },
        "battle box": {
            id: "construct",
            tags: ["cube", "rune", "magic", "construct"],
            sound: "MONSTER_CONSTRUCT",
            confidence: 1.0,
            override: true
        }
    }
};

export function getClassifierData() {
    if (typeof game === 'undefined' || !game.system) return DAGGERHEART_DATA; // Startup safety fallback

    if (game.system.id === "dnd5e") {
        return DND5E_DATA;
    }

    if (game.system.id === "daggerheart") {
        return DAGGERHEART_DATA;
    }

    console.warn(`Ionrift Lib | Unsupported system: '${game.system.id}'. Creature classification disabled.`);
    return {};
}

export { DAGGERHEART_DATA };
