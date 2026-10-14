import { Cascade } from "./Cascade.js";

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Word-boundary matcher that supports simple English inflections (-s, -es, -ed, -ing)
 * while preventing substring false positives (e.g. "unholy" != "holy", "fury" != "fur").
 */
export function hasWord(text, word) {
    if (!text || !word) return false;
    const escaped = escapeRegex(word.trim());
    return new RegExp(`\\b${escaped}(?:e?s|ed|ing)?\\b`, "i").test(text);
}

/**
 * Strip HTML tags and normalize whitespace from rich-text notes.
 */
export function stripHtml(html) {
    if (!html || typeof html !== "string") return "";
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * 1. Morphological Suffix & Compound Head-Noun Rules
 * Matches linguistic roots at the end of words (e.g., "-daemon", "-wyrm", "-saurus",
 * "-hound", "-wraith", "-mancer", "-stalker", "-spawn") rather than listing proper nouns.
 */
const MORPHOLOGICAL_RULES = [
    { pattern: /(?:^|\b|[a-z]{3,})(daemon)s?\b/i,                         type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",     tags: ["fiend", "daemon", "unholy"] },
    { pattern: /(?:^|\b|[a-z]{3,})(demon|devil|fiend)s?\b/i,              type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",     tags: ["fiend", "evil"] },
    { pattern: /(?:^|\b|[a-z]{3,})(wyrm|drake|dragon|linnorm|lisk)s?\b/i, type: "dragon",     subtype: "wyvern",          sound: "MONSTER_DRAGON",    tags: ["dragon", "scales", "wings"] },
    { pattern: /(?:^|\b|[a-z]{3,})(saurus|raptor|tops|dactyl)s?\b/i,      type: "beast",      subtype: "reptile",         sound: "MONSTER_REPTILE",   tags: ["beast", "dinosaur", "scales"] },
    { pattern: /(?:^|\b|[a-z]{2,})(snake|serpent|viper|cobra|python|anaconda|lizard|chameleon|gecko|iguana|toad|frog|gator|croc|caiman|gharial|turtle|tortoise|terrapin)s?\b/i, type: "beast", subtype: "reptile", sound: "MONSTER_REPTILE", tags: ["beast", "scales"] },
    { pattern: /(?:^|\b|[a-z]{2,})(spider|tarantula|arachnid|web)s?\b/i,  type: "beast",      subtype: "arachnid",        sound: "SFX_INSECT",        tags: ["beast", "spider", "web", "chitin"] },
    { pattern: /(?:^|\b|[a-z]{2,})(wasp|beetle|mantis|pede|scorpion|fly|moth|tick|roach|locust|worm|maggot|grub|slug|leech|mosquito|flea|solifugid|eurypterid)s?\b/i, type: "beast", subtype: "insect", sound: "SFX_INSECT", tags: ["beast", "chitin", "insect"] },
    { pattern: /(?:^|\b|[a-z]{2,})(hound|wolf|wolves|worg|warg|jackal|hyena|fox|coyote|dingo|dog)s?\b/i, type: "beast", subtype: "canine", sound: "MONSTER_WOLF", tags: ["beast", "fur", "fangs"] },
    { pattern: /(?:^|\b|[a-z]{2,})(lion|tiger|panther|leopard|jaguar|cougar|cheetah|puma|lynx|bobcat|smilodon|sphinx|tooth)s?\b/i, type: "beast", subtype: "feline", sound: "MONSTER_CAT", tags: ["beast", "fur", "claws"] },
    { pattern: /(?:^|\b|[a-z]{2,})(bear|grizzly|panda)s?\b/i,             type: "beast",      subtype: "ursine",          sound: "MONSTER_BEAR",      tags: ["beast", "fur", "claws"] },
    { pattern: /(?:^|\b|[a-z]{2,})(ape|monkey|gorilla|baboon|mandrill|orangutan|chimpanzee|simian|yeti|sasquatch)s?\b/i, type: "beast", subtype: "primate", sound: "MONSTER_BEAR", tags: ["beast", "climb", "fur"] },
    { pattern: /(?:^|\b|[a-z]{2,})(hawk|eagle|owl|crow|raven|vulture|condor|falcon|shrike|bird|roc|gull|swan|heron|stork|pelican|ostrich|cassowary|parrot|peacock|penguin)s?\b/i, type: "beast", subtype: "avian", sound: "MONSTER_BIRD", tags: ["beast", "feathers", "wings", "beak"] },
    { pattern: /(?:^|\b|[a-z]{2,})(shark|fish|whale|narwhal|dolphin|orca|porpoise|squid|octopus|kraken|crab|lobster|crayfish|eel|moray|ray|urchin|jellyfish|seal|walrus)s?\b/i, type: "beast", subtype: "aquatic", sound: "SFX_WATER_ENTITY", tags: ["beast", "aquatic", "swimming"] },
    { pattern: /(?:^|\b|[a-z]{2,})(horse|steed|pony|stag|elk|deer|moose|caribou|camel|zebra|giraffe|centaur|unicorn|pegasus|hippocampus|kirin)s?\b/i, type: "beast", subtype: "equine", sound: "MONSTER_HORSE", tags: ["beast", "hooves", "mount"] },
    { pattern: /(?:^|\b|[a-z]{2,})(bull|ox|oxen|cow|bison|buffalo|aurochs|yak|goat|ram|sheep|antelope|rhino|rhinoceros|hippo|hippopotamus|elephant|mastodon|mammoth|gorgon)s?\b/i, type: "beast", subtype: "cattle", sound: "MONSTER_BEAST", tags: ["beast", "horns", "heavy"] },
    { pattern: /(?:^|\b|[a-z]{2,})(boar|pig|hog|warthog)s?\b/i,           type: "beast",      subtype: "suidae",          sound: "MONSTER_BEAST",     tags: ["beast", "tusks", "charge"] },
    { pattern: /(?:^|\b|[a-z]{2,})(rat|mouse|squirrel|porcupine|beaver|capybara|marmot|rabbit|hare|opossum)s?\b/i, type: "beast", subtype: "rodent", sound: "SFX_SQUEAK", tags: ["beast", "rodent", "fur"] },
    { pattern: /(?:^|\b|[a-z]{2,})(badger|wolverine|weasel|ferret|otter|skunk|mink|marten|sloth|armadillo|pangolin|platypus)s?\b/i, type: "beast", subtype: "mustelid", sound: "MONSTER_BEAST", tags: ["beast", "burrow", "claws"] },
    { pattern: /(?:^|\b|[a-z]{2,})(bat)s?\b/i,                            type: "beast",      subtype: "chiropteran",     sound: "MONSTER_BIRD",      tags: ["beast", "flying", "echolocation"] },
    { pattern: /(?:^|\b|[a-z]{2,})(wraith|ghost|specter|phantom|spirit|banshee|gheist|poltergeist)s?\b/i, type: "undead", subtype: "wraith", sound: "MONSTER_WRAITH", tags: ["undead", "incorporeal", "spirit"] },
    { pattern: /(?:^|\b|[a-z]{2,})(skeleton|skeletal|skull|bone|ossuary)s?\b/i, type: "undead", subtype: "skeleton",       sound: "MONSTER_SKELETON",  tags: ["undead", "bones", "rattling"] },
    { pattern: /(?:^|\b|[a-z]{2,})(zombie|corpse|ghoul|ghast|mummy|draugr)s?\b/i, type: "undead", subtype: "zombie",       sound: "MONSTER_ZOMBIE",    tags: ["undead", "rotting"] },
    { pattern: /(?:^|\b|[a-z]{2,})(golem|automaton|clockwork|effigy)s?\b/i, type: "construct", subtype: "golem",           sound: "MONSTER_CONSTRUCT", tags: ["construct", "artificial", "heavy"] },
    { pattern: /(?:^|\b|[a-z]{2,})(ooze|slime|jelly|pudding|blob|amoeba)s?\b/i, type: "ooze", subtype: "ochre_jelly",     sound: "SFX_SLIME",         tags: ["ooze", "amorphous", "acid"] },
    { pattern: /(?:^|\b|[a-z]{2,})(treant|tree|vine|bush|shrub|flytrap|topiary|fungus|spore|mold|mushroom|leshy|weed|flower|moss|heap)s?\b/i, type: "plant", subtype: "shambling_mound", sound: "MONSTER_PLANT", tags: ["plant", "nature"] },
    { pattern: /(?:^|\b|[a-z]{2,})(mancer|mage|wizard|witch|sorcerer|warlock|priest|cleric|druid|oracle|shaman|adept|bard|illusionist|evoker|necromancer)s?\b/i, type: "humanoid", subtype: "caster", sound: "MONSTER_HUMANOID", tags: ["humanoid", "magic"] },
    { pattern: /(?:^|\b|[a-z]{2,})(stalker|skulker|slayer|hunter|trapper|assassin|thief|rogue|bandit|pirate|raider|sniper|archer|scout|strangler|infiltrator|creeper|grenadier)s?\b/i, type: "humanoid", subtype: "bandit", sound: "MONSTER_HUMANOID", tags: ["humanoid", "stealth"] },
    { pattern: /(?:^|\b|[a-z]{2,})(guard|soldier|warrior|knight|champion|paladin|monk|brawler|gladiator|warden|sentinel|mauler|leader|captain|berserker|bully)s?\b/i, type: "humanoid", subtype: "guard", sound: "MONSTER_HUMANOID", tags: ["humanoid", "armor", "weapon"] },
    { pattern: /(?:^|\b|[a-z]{3,})(spawn)s?\b/i,                          type: "aberration", subtype: "mind_flayer",     sound: "MONSTER_ALIEN",     tags: ["aberration", "mutant", "claws"] }
];

/**
 * 2. System Trait Ontology (PF2e system traits -> canonical Ionrift archetypes)
 */
const SYSTEM_TRAIT_ONTOLOGY = [
    { trait: "demon",        type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",      tags: ["fiend", "demon", "abyssal", "unholy"] },
    { trait: "qlippoth",     type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",      tags: ["fiend", "abyssal", "tentacles", "unholy"] },
    { trait: "devil",        type: "fiend",      subtype: "devil",           sound: "MONSTER_DEMON",      tags: ["fiend", "devil", "infernal", "lawful", "unholy"] },
    { trait: "velstrac",     type: "fiend",      subtype: "devil",           sound: "MONSTER_DEMON",      tags: ["fiend", "chains", "shadow", "unholy"] },
    { trait: "asura",        type: "fiend",      subtype: "devil",           sound: "MONSTER_DEMON",      tags: ["fiend", "unholy", "martial"] },
    { trait: "div",          type: "fiend",      subtype: "devil",           sound: "MONSTER_DEMON",      tags: ["fiend", "unholy", "evil"] },
    { trait: "sahkil",       type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",      tags: ["fiend", "ethereal", "fear", "unholy"] },
    { trait: "daemon",       type: "fiend",      subtype: "demon",           sound: "MONSTER_DEMON",      tags: ["fiend", "daemon", "unholy", "evil"] },
    { trait: "rakshasa",     type: "fiend",      subtype: "rakshasa",        sound: "MONSTER_CAT",        tags: ["fiend", "shapechanger", "magic", "claws"] },
    { trait: "angel",        type: "celestial",  subtype: "angel",           sound: "SFX_CHOIR",          tags: ["celestial", "wings", "flying", "holy"] },
    { trait: "archon",       type: "celestial",  subtype: "angel",           sound: "SFX_CHOIR",          tags: ["celestial", "lawful", "holy"] },
    { trait: "azata",        type: "celestial",  subtype: "angel",           sound: "SFX_CHOIR",          tags: ["celestial", "chaotic", "holy"] },
    { trait: "agathion",     type: "celestial",  subtype: "angel",           sound: "MONSTER_BEAST",      tags: ["celestial", "beast-kin", "holy"] },
    { trait: "couatl",       type: "celestial",  subtype: "angel",           sound: "MONSTER_REPTILE",    tags: ["celestial", "wings", "feathers", "scales"] },
    { trait: "inevitable",   type: "construct",  subtype: "animated_object", sound: "MONSTER_CONSTRUCT",  tags: ["construct", "monitor", "lawful", "metal"] },
    { trait: "psychopomp",   type: "undead",     subtype: "wraith",          sound: "MONSTER_GHOST",      tags: ["monitor", "spirit", "death"] },
    { trait: "protean",      type: "aberration", subtype: "mind_flayer",     sound: "MONSTER_REPTILE",    tags: ["monitor", "chaotic", "scales"] },
    { trait: "aeon",         type: "aberration", subtype: "mind_flayer",     sound: "MONSTER_ALIEN",      tags: ["monitor", "cosmic", "floating"] },
    { trait: "aesir",        type: "celestial",  subtype: "angel",           sound: "MONSTER_HUMANOID",   tags: ["monitor", "warrior", "planar"] },
    { trait: "skeleton",     type: "undead",     subtype: "skeleton",        sound: "MONSTER_SKELETON",   tags: ["undead", "bones", "rattling"] },
    { trait: "zombie",       type: "undead",     subtype: "zombie",          sound: "MONSTER_ZOMBIE",     tags: ["undead", "rotting", "shambling"] },
    { trait: "vampire",      type: "undead",     subtype: "vampire",         sound: "MONSTER_VAMPIRE",    tags: ["undead", "fangs", "blood", "regeneration"] },
    { trait: "ghoul",        type: "undead",     subtype: "ghoul",           sound: "MONSTER_ZOMBIE",     tags: ["undead", "claws", "fangs", "paralysis"] },
    { trait: "mummy",        type: "undead",     subtype: "mummy",           sound: "MONSTER_MUMMY",      tags: ["undead", "curse", "rotting"] },
    { trait: "ghost",        type: "undead",     subtype: "wraith",          sound: "MONSTER_WRAITH",     tags: ["undead", "incorporeal", "spirit"] },
    { trait: "wraith",       type: "undead",     subtype: "wraith",          sound: "MONSTER_WRAITH",     tags: ["undead", "incorporeal", "drain"] },
    { trait: "phantom",      type: "undead",     subtype: "wraith",          sound: "MONSTER_WRAITH",     tags: ["undead", "incorporeal", "spirit"] },
    { trait: "wight",        type: "undead",     subtype: "wight",           sound: "MONSTER_ZOMBIE",     tags: ["undead", "life-drain"] },
    { trait: "graveknight",  type: "undead",     subtype: "wight",           sound: "MONSTER_ZOMBIE",     tags: ["undead", "armor", "curse"] },
    { trait: "lich",         type: "undead",     subtype: "lich",            sound: "MONSTER_LICH",       tags: ["undead", "spellcaster", "bones"] },
    { trait: "mortic",       type: "undead",     subtype: "ghoul",           sound: "MONSTER_ZOMBIE",     tags: ["undead", "humanoid"] },
    { trait: "darvakka",     type: "undead",     subtype: "wraith",          sound: "MONSTER_WRAITH",     tags: ["undead", "void", "darkness"] },
    { trait: "golem",        type: "construct",  subtype: "golem",           sound: "MONSTER_CONSTRUCT",  tags: ["construct", "golem", "heavy", "mindless"] },
    { trait: "clockwork",    type: "construct",  subtype: "animated_object", sound: "MONSTER_CONSTRUCT",  tags: ["construct", "clockwork", "mechanical", "metal"] },
    { trait: "automaton",    type: "construct",  subtype: "animated_object", sound: "MONSTER_CONSTRUCT",  tags: ["construct", "automaton", "arcane", "metal"] },
    { trait: "soulbound",    type: "construct",  subtype: "animated_object", sound: "MONSTER_CONSTRUCT",  tags: ["construct", "soulbound", "animated", "magic"] },
    { trait: "leshy",        type: "plant",      subtype: "myconid",         sound: "MONSTER_PLANT",      tags: ["plant", "leshy", "nature", "small"] },
    { trait: "fungus",       type: "plant",      subtype: "myconid",         sound: "MONSTER_PLANT",      tags: ["plant", "fungus", "spores"] },
    { trait: "sprite",       type: "fey",        subtype: "sprite",          sound: "SFX_CHIME",          tags: ["fey", "sprite", "wings", "tiny", "flying"] },
    { trait: "nymph",        type: "fey",        subtype: "dryad",           sound: "MONSTER_HUMANOID",   tags: ["fey", "nymph", "nature"] },
    { trait: "gremlin",      type: "fey",        subtype: "satyr",           sound: "MONSTER_GOBLIN",     tags: ["fey", "gremlin", "trickster", "small"] },
    { trait: "tane",         type: "fey",        subtype: "satyr",           sound: "MONSTER_ROAR",       tags: ["fey", "tane", "primal", "massive"] },
    { trait: "kami",         type: "fey",        subtype: "dryad",           sound: "MONSTER_ELEMENTAL",  tags: ["fey", "kami", "spirit", "nature"] },
    { trait: "troll",        type: "giant",      subtype: "troll",           sound: "MONSTER_GIANT",      tags: ["giant", "troll", "regeneration", "claws"] },
    { trait: "oni",          type: "giant",      subtype: "oni",             sound: "MONSTER_GIANT",      tags: ["giant", "oni", "magic", "glaive"] },
    { trait: "titan",        type: "giant",      subtype: "cyclops",         sound: "MONSTER_GIANT",      tags: ["giant", "titan", "colossal", "strength"] },
    { trait: "dinosaur",     type: "beast",      subtype: "reptile",         sound: "MONSTER_REPTILE",    tags: ["beast", "dinosaur", "scales", "tail"] },
    { trait: "hag",          type: "monstrosity",subtype: "hag",             sound: "MONSTER_HUMANOID",   tags: ["hag", "fey", "magic", "claws"] },
    { trait: "werecreature", type: "humanoid",   subtype: "lycanthrope",     sound: "MONSTER_LYCANTHROPE",tags: ["humanoid", "shapechanger", "curse", "claws", "fur"] },
    { trait: "kholo",        type: "monstrosity",subtype: "gnoll",           sound: "MONSTER_WOLF",       tags: ["humanoid", "hyena", "pack-tactics", "fur"] },
    { trait: "gnoll",        type: "monstrosity",subtype: "gnoll",           sound: "MONSTER_WOLF",       tags: ["humanoid", "hyena", "pack-tactics", "fur"] },
    { trait: "lizardfolk",   type: "monstrosity",subtype: "lizardfolk",      sound: "MONSTER_REPTILE",    tags: ["humanoid", "reptile", "scales", "tail"] },
    { trait: "kobold",       type: "beast",      subtype: "reptile",         sound: "MONSTER_REPTILE",    tags: ["humanoid", "kobold", "scales", "small"] },
    { trait: "serpentfolk",  type: "monstrosity",subtype: "naga",            sound: "MONSTER_REPTILE",    tags: ["humanoid", "snake", "scales", "magic"] },
    { trait: "xulgath",      type: "monstrosity",subtype: "lizardfolk",      sound: "MONSTER_REPTILE",    tags: ["humanoid", "reptile", "scales", "underground"] },
    { trait: "boggard",      type: "beast",      subtype: "reptile",         sound: "MONSTER_REPTILE",    tags: ["humanoid", "amphibious", "frog", "scales"] },
    { trait: "tripkee",      type: "beast",      subtype: "reptile",         sound: "MONSTER_REPTILE",    tags: ["humanoid", "amphibious", "frog", "agile"] },
    { trait: "goblin",       type: "humanoid",   subtype: "goblinoid",       sound: "MONSTER_GOBLIN",     tags: ["humanoid", "goblin", "chaotic", "stealthy"] },
    { trait: "hobgoblin",    type: "humanoid",   subtype: "goblinoid",       sound: "MONSTER_GOBLIN",     tags: ["humanoid", "hobgoblin", "martial", "armor"] },
    { trait: "bugbear",      type: "humanoid",   subtype: "goblinoid",       sound: "MONSTER_GOBLIN",     tags: ["humanoid", "bugbear", "stealthy", "fur"] },
    { trait: "orc",          type: "humanoid",   subtype: "orc",             sound: "MONSTER_HUMANOID",   tags: ["humanoid", "orc", "strong", "tusks"] },
    { trait: "elf",          type: "humanoid",   subtype: "elf",             sound: "MONSTER_HUMANOID",   tags: ["humanoid", "elf", "agile", "magic"] },
    { trait: "drow",         type: "humanoid",   subtype: "elf",             sound: "MONSTER_HUMANOID",   tags: ["humanoid", "elf", "underground", "magic"] },
    { trait: "dwarf",        type: "humanoid",   subtype: "dwarf",           sound: "MONSTER_HUMANOID",   tags: ["humanoid", "dwarf", "stout", "tough"] },
    { trait: "duergar",      type: "humanoid",   subtype: "dwarf",           sound: "MONSTER_HUMANOID",   tags: ["humanoid", "dwarf", "underground", "stout"] },
    { trait: "gnome",        type: "humanoid",   subtype: "gnome",           sound: "MONSTER_HUMANOID",   tags: ["humanoid", "gnome", "small", "magic"] },
    { trait: "halfling",     type: "humanoid",   subtype: "halfling",        sound: "MONSTER_HUMANOID",   tags: ["humanoid", "halfling", "small", "agile"] },
    { trait: "catfolk",      type: "humanoid",   subtype: "tabaxi",          sound: "MONSTER_CAT",        tags: ["humanoid", "cat-like", "agile", "claws", "fur"] },
    { trait: "tengu",        type: "humanoid",   subtype: "aarakocra",       sound: "MONSTER_BIRD",       tags: ["humanoid", "beak", "feathers", "wings"] },
    { trait: "azarketi",     type: "humanoid",   subtype: "triton",          sound: "SFX_WATER",          tags: ["humanoid", "aquatic", "amphibious", "swimming"] },
    { trait: "ratfolk",      type: "beast",      subtype: "rodent",          sound: "SFX_SQUEAK",         tags: ["humanoid", "rodent", "fur", "small"] }
];

/**
 * 3. Semantic Action-Verb & Anatomical-Noun Rules
 * Evaluates behavioral verbs (+2 weight) and anatomical/sensory nouns (+1 weight)
 * inside description/publicNotes/items within the creature's trait domain.
 */
const SEMANTIC_VERB_NOUN_RULES = [
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "arachnid", sound: "SFX_INSECT", tags: ["spider", "web", "chitin"],
        verbs: ["spin", "weave", "ensnare", "cocoon", "skitter", "envenom", "inject"],
        nouns: ["spider", "arachnid", "web", "webbing", "silk", "spinneret", "eight-legged", "tarantula"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "insect", sound: "SFX_INSECT", tags: ["chitin", "mandibles", "insect"],
        verbs: ["swarm", "buzz", "drone", "molt", "infest", "parasitize", "sting", "scuttle", "bore", "suck", "sucking"],
        nouns: ["insect", "beetle", "mantis", "centipede", "millipede", "wasp", "ant", "mosquito", "stirge", "proboscis", "tick", "leech", "slug", "worm", "larva", "grub", "maggot", "chitin", "chitinous", "carapace", "mandible", "antenna", "thorax", "abdomen", "pincer", "stinger", "hive", "colony", "arthropod", "parasite", "vermin"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "avian", sound: "MONSTER_BIRD", tags: ["feathers", "wings", "beak", "flying"],
        verbs: ["swoop", "soar", "glide", "roost", "perch", "peck", "screech", "squawk", "caw", "shriek", "flap", "nest"],
        nouns: ["bird", "avian", "beak", "talon", "feather", "feathered", "plumage", "wingspan", "flock", "raptor", "waterfowl", "songbird"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "aquatic", sound: "SFX_WATER_ENTITY", tags: ["aquatic", "swimming", "water"],
        verbs: ["swim", "submerge", "breach", "shoal", "drown", "capsize", "dive"],
        nouns: ["fish", "shark", "whale", "dolphin", "octopus", "squid", "eel", "stingray", "manta", "crab", "lobster", "crustacean", "fin", "flipper", "gill", "tentacle", "blowhole", "marine", "ocean", "reef", "kelp", "underwater"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "reptile", sound: "MONSTER_REPTILE", tags: ["scales", "cold-blooded"],
        verbs: ["slither", "coil", "constrict", "hiss", "bask", "croak", "hop", "petrify", "camouflage", "spit"],
        nouns: ["reptile", "reptilian", "lizard", "serpent", "serpentine", "snake", "viper", "cobra", "python", "crocodile", "alligator", "turtle", "tortoise", "frog", "toad", "amphibian", "amphibious", "salamander", "dinosaur", "sauropod", "scales", "scaled", "scaly", "cold-blooded", "shell", "gullet", "webbed"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "canine", sound: "MONSTER_WOLF", tags: ["fur", "fangs", "pack-tactics"],
        verbs: ["howl", "bark", "bay", "snarl", "growl", "pant", "scent", "track"],
        nouns: ["canine", "lupine", "wolf", "wolves", "hound", "dog", "jackal", "hyena", "fox", "coyote", "muzzle", "snout", "pack"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "feline", sound: "MONSTER_CAT", tags: ["fur", "claws", "pounce"],
        verbs: ["pounce", "prowl", "purr", "roar", "rake", "stalk", "ambush", "sprint"],
        nouns: ["feline", "cat", "lion", "tiger", "panther", "leopard", "jaguar", "cougar", "cheetah", "lynx", "sphinx", "whisker", "mane", "pride"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "ursine", sound: "MONSTER_BEAR", tags: ["fur", "claws", "heavy"],
        verbs: ["maul", "hibernate", "lumber", "rear", "hug", "rend", "crush"],
        nouns: ["bear", "ursine", "grizzly", "polar", "cub", "den"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "equine", sound: "MONSTER_HORSE", tags: ["hooves", "mount"],
        verbs: ["gallop", "trot", "canter", "rear", "trample", "neigh", "whinny", "stomp"],
        nouns: ["horse", "equine", "stallion", "mare", "steed", "mount", "pegasus", "unicorn", "centaur", "stag", "deer", "elk", "moose", "camel", "hoof", "hooves"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "cattle", sound: "MONSTER_BEAST", tags: ["horns", "heavy"],
        verbs: ["graze", "stampede", "gore", "trample", "charge", "bellow", "plow"],
        nouns: ["bovine", "ox", "oxen", "bull", "cow", "cattle", "bison", "buffalo", "yak", "goat", "ram", "sheep", "herd", "horn", "horned", "tusk", "tusked", "mammoth", "mastodon", "elephant", "trunk", "rhino", "hippo"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "mustelid", sound: "MONSTER_BEAST", tags: ["burrow", "claws", "fur"],
        verbs: ["burrow", "dig", "tunnel", "excavate", "gnaw", "scurry", "climb", "cling"],
        nouns: ["badger", "wolverine", "weasel", "ferret", "otter", "skunk", "sloth", "armadillo", "porcupine", "quill", "rodent", "squirrel", "rat", "mouse", "mammal", "marsupial", "pouch", "fur", "claw", "fang", "jaw", "predator"]
    },
    {
        forTraits: ["animal", "beast"],
        type: "beast", subtype: "primate", sound: "MONSTER_BEAR", tags: ["climb", "fur"],
        verbs: ["swing", "brachiate", "climb", "hoot", "grasp", "throw", "pound"],
        nouns: ["ape", "monkey", "gorilla", "baboon", "simian", "primate", "canopy", "jungle"]
    },
    {
        forTraits: ["aberration"],
        type: "aberration", subtype: "chuul", sound: "SFX_INSECT", tags: ["aberration", "aquatic", "pincers"],
        verbs: ["swim", "submerge", "wade", "scuttle", "pinch"],
        nouns: ["aquatic", "amphibious", "swamp", "bog", "marsh", "chitin", "carapace", "pincer", "crustacean", "insectoid"]
    },
    {
        forTraits: ["aberration", "astral", "dream", "time", "mental", "illusion"],
        type: "aberration", subtype: "mind_flayer", sound: "MONSTER_ALIEN", tags: ["aberration", "alien", "psionic"],
        verbs: ["dominate", "enslave", "whisper", "devour", "warp", "consume", "stalk", "feed", "mutate", "corrupt", "shriek", "twist", "lurk", "hunt", "hallucinate", "project"],
        nouns: ["mind", "brain", "psychic", "telepathy", "mental", "illusion", "occult", "astral", "dream", "nightmare", "time", "dimension", "tentacle", "flesh", "maw", "mouth", "eye", "claw", "horror", "aberration"]
    },
    {
        forTraits: ["construct", "mindless"],
        type: "construct", subtype: "golem", sound: "MONSTER_CONSTRUCT", tags: ["construct", "heavy", "mindless"],
        verbs: ["crush", "smash", "stomp", "trample", "lumber", "sculpt", "forge", "hew", "shatter"],
        nouns: ["golem", "colossus", "juggernaut", "hulking", "massive", "giant", "stone", "iron", "clay", "flesh", "bone", "wood", "glass", "metal", "boulder"]
    },
    {
        forTraits: ["construct", "mindless"],
        type: "construct", subtype: "animated_object", sound: "MONSTER_CONSTRUCT", tags: ["construct", "object", "magic"],
        verbs: ["animate", "guard", "patrol", "ward", "inscribe", "carve", "enchant", "construct", "build", "craft"],
        nouns: ["statue", "doll", "armor", "weapon", "rune", "graffiti", "clockwork", "gear", "automaton", "guardian", "sentinel", "effigy", "construct", "creation", "servant"]
    },
    {
        forTraits: ["undead", "spirit", "shade", "shadow", "ethereal"],
        type: "undead", subtype: "skeleton", sound: "MONSTER_SKELETON", tags: ["undead", "bones"],
        verbs: ["rattle", "clatter", "shatter", "reassemble"],
        nouns: ["skeleton", "skeletal", "bone", "skull", "rib", "spine", "ossuary"]
    },
    {
        forTraits: ["undead", "spirit", "shade", "shadow", "ethereal"],
        type: "undead", subtype: "wraith", sound: "MONSTER_WRAITH", tags: ["undead", "incorporeal", "spirit"],
        verbs: ["haunt", "possess", "wail", "phase", "drift", "float", "lament", "drain", "whisper", "curse"],
        nouns: ["spirit", "ghost", "wraith", "specter", "phantom", "banshee", "shadow", "shade", "incorporeal", "ethereal", "soul", "apparition"]
    },
    {
        forTraits: ["undead"],
        type: "undead", subtype: "zombie", sound: "MONSTER_ZOMBIE", tags: ["undead", "rotting"],
        verbs: ["shamble", "lurch", "rot", "decay", "devour", "bite", "claw", "feed", "groan", "rise", "kill", "murder"],
        nouns: ["corpse", "cadaver", "flesh", "zombie", "ghoul", "undead", "grave", "tomb", "dead", "body", "hand", "head", "blood"]
    },
    {
        forTraits: ["fey"],
        type: "fey", subtype: "dryad", sound: "MONSTER_HUMANOID", tags: ["fey", "nature", "magic"],
        verbs: ["charm", "lure", "sing", "dance", "bloom", "guard", "protect", "ward", "bless", "curse", "trick", "prank"],
        nouns: ["fey", "nature", "forest", "wood", "tree", "river", "water", "spring", "spirit", "nymph", "fairy", "magic", "primal", "crossroads", "guardian"]
    },
    {
        forTraits: ["plant", "fungus"],
        type: "plant", subtype: "shambling_mound", sound: "MONSTER_PLANT", tags: ["plant", "nature", "vegetation"],
        verbs: ["grow", "sprout", "entangle", "engulf", "strangle", "pollinate", "decay", "root", "bloom"],
        nouns: ["plant", "vine", "root", "leaf", "leaves", "branch", "bark", "tree", "flower", "thorn", "seed", "spore", "fungus", "mushroom", "mold", "moss", "kelp", "seaweed", "vegetation", "flora"]
    },
    {
        forTraits: ["ooze"],
        type: "ooze", subtype: "ochre_jelly", sound: "SFX_SLIME", tags: ["ooze", "amorphous", "acid"],
        verbs: ["dissolve", "engulf", "seep", "ooze", "slither", "digest", "corrode", "split", "absorb"],
        nouns: ["ooze", "slime", "jelly", "pudding", "mucus", "acid", "amorphous", "blob", "tar", "protoplasm"]
    },
    {
        forTraits: ["giant"],
        type: "giant", subtype: "ogre", sound: "MONSTER_GIANT", tags: ["giant", "huge", "strength"],
        verbs: ["smash", "crush", "hurl", "bellow", "roar", "stomp", "tower", "devour"],
        nouns: ["giant", "colossal", "towering", "massive", "boulder", "rock", "club", "strength", "clan", "tribe"]
    },
    {
        forTraits: ["humanoid"],
        type: "humanoid", subtype: "caster", sound: "MONSTER_HUMANOID", tags: ["humanoid", "magic"],
        verbs: ["cast", "chant", "invoke", "summon", "conjure", "hex", "curse", "enchant", "channel", "study", "pray"],
        nouns: ["spell", "spellcaster", "magic", "magical", "wizard", "mage", "sorcerer", "witch", "warlock", "necromancer", "druid", "cleric", "priest", "oracle", "bard", "arcane", "occult", "divine", "staff", "wand", "scroll", "ritual"]
    },
    {
        forTraits: ["humanoid"],
        type: "humanoid", subtype: "bandit", sound: "MONSTER_HUMANOID", tags: ["humanoid", "stealth"],
        verbs: ["sneak", "ambush", "stalk", "skulk", "steal", "rob", "raid", "plunder", "assassinate", "backstab", "poison", "kidnap", "lurk", "hunt", "hide"],
        nouns: ["thief", "rogue", "assassin", "bandit", "pirate", "raider", "smuggler", "spy", "scout", "hunter", "trapper", "dagger", "poison", "cloak", "shadow", "stealth", "darkness", "underground"]
    },
    {
        forTraits: ["humanoid"],
        type: "humanoid", subtype: "guard", sound: "MONSTER_HUMANOID", tags: ["humanoid", "armor", "weapon"],
        verbs: ["guard", "defend", "patrol", "march", "command", "charge", "parry", "duel", "cleave", "brawl", "fight", "strike", "attack", "wield"],
        nouns: ["soldier", "guard", "warrior", "knight", "champion", "paladin", "monk", "gladiator", "mercenary", "brawler", "captain", "commander", "warden", "sentinel", "armor", "shield", "sword", "spear", "weapon", "blade", "axe", "hammer", "bow", "martial", "battle", "combat"]
    },
    {
        forTraits: ["humanoid"],
        type: "humanoid", subtype: "commoner", sound: "MONSTER_HUMANOID", tags: ["humanoid", "civilian"],
        verbs: ["trade", "barter", "farm", "harvest", "craft", "brew", "heal", "tend", "govern", "judge", "live", "work"],
        nouns: ["merchant", "farmer", "villager", "citizen", "noble", "scholar", "healer", "herbalist", "alchemist", "judge", "humanoid", "person", "people", "society", "community"]
    }
];

const PRIMARY_TRAIT_FALLBACK = {
    dragon: "dragon", undead: "undead", fiend: "fiend", celestial: "celestial",
    elemental: "elemental", construct: "construct", ooze: "ooze", plant: "plant",
    fungus: "plant", fey: "fey", giant: "giant", aberration: "aberration",
    animal: "beast", beast: "monstrosity", humanoid: "humanoid",
    astral: "aberration", ethereal: "undead", shadow: "undead", dream: "aberration",
    time: "aberration", spirit: "undead", mindless: "construct", mental: "aberration",
    illusion: "aberration"
};

const ENRICHMENT_TRAITS = [
    "wings", "horns", "tail", "claws", "scales", "fur", "feathers", "ethereal",
    "tentacles", "fangs", "chitin", "shell", "web", "hooves", "beak", "acid",
    "fire", "cold", "electricity", "poison", "aquatic", "amphibious", "incorporeal",
    "mindless", "swarm", "troop", "unholy", "holy"
];

const GROUP_KEYWORDS = ["swarm", "pack", "legion", "horde", "squad", "troop", "army", "rabble", "gang", "mob"];

/**
 * Classify a PF2e actor or creature name using abstract morphological rules,
 * system trait ontology, and verb/noun semantic inference.
 */
export function classifyPf2eCreature(actorOrName, classifierData) {
    const isObject = typeof actorOrName === "object" && actorOrName !== null;
    const name = isObject ? (actorOrName.name || "") : String(actorOrName || "");
    if (!name) {
        return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), cascade: ["unknown", "generic"], confidence: 0 };
    }

    const traits = new Set(
        isObject && Array.isArray(actorOrName.system?.traits?.value)
            ? actorOrName.system.traits.value.map(t => String(t).toLowerCase())
            : []
    );

    const rawDesc = isObject
        ? (actorOrName.system?.details?.publicNotes
            || actorOrName.system?.description?.value
            || actorOrName.system?.details?.biography?.value
            || "")
        : "";
    const notesText = stripHtml(rawDesc);

    let itemsText = "";
    if (isObject && actorOrName.items) {
        const list = Array.isArray(actorOrName.items) ? actorOrName.items : Array.from(actorOrName.items);
        itemsText = list.map(i => `${i.name || ""} ${stripHtml(i.system?.description?.value || "")}`).join(" ").toLowerCase();
    }

    const corpus = `${name.toLowerCase()} ${[...traits].join(" ")} ${notesText} ${itemsText}`.trim();

    // 0. Hazard / Trap / Haunt Rule
    if ((isObject && actorOrName.type === "hazard") || traits.has("hazard") || traits.has("trap") || traits.has("haunt") || traits.has("environmental")) {
        const isHaunt = traits.has("haunt");
        const id = isHaunt ? "undead_wraith" : "environment";
        const sound = isHaunt ? "MONSTER_WRAITH" : "SFX_ENVIRONMENT";
        const tags = new Set(["hazard", ...(isHaunt ? ["undead", "incorporeal", "spirit"] : ["object", "static", "structure", "trap"]), ...traits]);
        return {
            id,
            type: isHaunt ? "undead" : "environment",
            subtype: isHaunt ? "wraith" : null,
            cascade: Cascade.build(id),
            sound,
            tags,
            confidence: 0.9
        };
    }

    // 1. Exception Check (preserve compatibility with shared exceptions)
    const nameLower = name.toLowerCase();
    if (classifierData.exceptions) {
        for (const [key, exception] of Object.entries(classifierData.exceptions)) {
            if (nameLower.includes(key)) {
                return {
                    id: exception.id,
                    sound: exception.sound,
                    tags: new Set(exception.tags),
                    cascade: Cascade.build(exception.id),
                    confidence: exception.confidence,
                    isException: true
                };
            }
        }
    }

    const isSizeGiantOnly = !traits.has("giant") && (traits.has("animal") || traits.has("beast") || traits.has("ooze") || traits.has("plant") || traits.has("fungus"));
    const isNonDragonHumanoid = traits.has("humanoid") && !traits.has("dragon");

    let bestMatch = null;

    // 2. Archetype Subtype & Type Scan (full scan without early 0.6 break, guarded by traits)
    for (const [typeKey, typeData] of Object.entries(classifierData)) {
        if (typeKey === "exceptions") continue;
        if (typeKey === "giant" && isSizeGiantOnly) continue;
        if (typeKey === "dragon" && isNonDragonHumanoid) continue;

        if (typeData.subtypes) {
            for (const sub of typeData.subtypes) {
                if (sub.keywords.some(k => hasWord(name, k))) {
                    bestMatch = {
                        type: typeKey,
                        subtype: sub.id,
                        data: sub,
                        parentData: typeData,
                        score: 0.8
                    };
                    break;
                }
            }
        }
        if (bestMatch && bestMatch.score >= 0.8) break;

        if (!bestMatch && typeData.keywords?.some(k => hasWord(name, k))) {
            bestMatch = {
                type: typeKey,
                subtype: null,
                data: typeData,
                score: 0.6
            };
        }
    }

    // 3. Morphological Compound Suffix / Stem Rules on Name
    if (!bestMatch || bestMatch.score < 0.8) {
        for (const morph of MORPHOLOGICAL_RULES) {
            if (morph.type === "giant" && isSizeGiantOnly) continue;
            if (morph.type === "dragon" && isNonDragonHumanoid) continue;
            if (morph.pattern.test(name)) {
                bestMatch = {
                    type: morph.type,
                    subtype: morph.subtype,
                    data: { sound: morph.sound, tags: morph.tags },
                    parentData: classifierData[morph.type],
                    score: 0.8
                };
                break;
            }
        }
    }

    // 4. System Trait Ontology & Compositional Trait Algebra
    if (!bestMatch || bestMatch.score < 0.8) {
        for (const rule of SYSTEM_TRAIT_ONTOLOGY) {
            if (traits.has(rule.trait)) {
                bestMatch = {
                    type: rule.type,
                    subtype: rule.subtype,
                    data: { sound: rule.sound, tags: rule.tags },
                    parentData: classifierData[rule.type],
                    score: 0.8
                };
                break;
            }
        }
    }

    if (!bestMatch || bestMatch.score < 0.8) {
        if (traits.has("elemental")) {
            if (traits.has("fire")) bestMatch = { type: "elemental", subtype: "fire", data: { sound: "MONSTER_ELEMENTAL", tags: ["fire", "burn", "elemental"] }, parentData: classifierData.elemental, score: 0.85 };
            else if (traits.has("water") || traits.has("aquatic") || traits.has("cold")) bestMatch = { type: "elemental", subtype: "water", data: { sound: "SFX_WATER_ENTITY", tags: ["water", "liquid", "elemental"] }, parentData: classifierData.elemental, score: 0.85 };
            else if (traits.has("air") || traits.has("electricity")) bestMatch = { type: "elemental", subtype: "air", data: { sound: "SFX_WIND", tags: ["air", "wind", "flying", "elemental"] }, parentData: classifierData.elemental, score: 0.85 };
            else bestMatch = { type: "elemental", subtype: "earth", data: { sound: "MONSTER_CONSTRUCT", tags: ["earth", "stone", "heavy", "elemental"] }, parentData: classifierData.elemental, score: 0.85 };
        } else if (traits.has("dragon")) {
            const sub = (traits.has("good") || traits.has("divine") || traits.has("holy")) ? "metallic" : "chromatic";
            bestMatch = { type: "dragon", subtype: sub, data: { sound: "MONSTER_DRAGON", tags: ["dragon", "scales", "wings", "breath-weapon"] }, parentData: classifierData.dragon, score: 0.85 };
        } else if ((traits.has("undead") || traits.has("spirit") || traits.has("shade")) && (traits.has("incorporeal") || traits.has("spirit") || traits.has("shade"))) {
            bestMatch = { type: "undead", subtype: "wraith", data: { sound: "MONSTER_WRAITH", tags: ["undead", "incorporeal", "spirit", "ethereal"] }, parentData: classifierData.undead, score: 0.8 };
        } else if ((traits.has("animal") || traits.has("beast")) && traits.has("aquatic")) {
            bestMatch = { type: "beast", subtype: "aquatic", data: { sound: "SFX_WATER_ENTITY", tags: ["beast", "aquatic", "swimming", "water"] }, parentData: classifierData.beast, score: 0.8 };
        } else if ((traits.has("animal") || traits.has("beast")) && traits.has("swarm")) {
            bestMatch = { type: "beast", subtype: "insect", data: { sound: "SFX_INSECT", tags: ["beast", "swarm", "chitin", "multitude"] }, parentData: classifierData.beast, score: 0.8 };
        }
    }

    // 5. Semantic Action-Verb & Anatomical-Noun Scoring on Description / Notes / Items
    if (!bestMatch || bestMatch.score < 0.8) {
        let bestSemantic = null;
        for (const rule of SEMANTIC_VERB_NOUN_RULES) {
            if (traits.size > 0 && !rule.forTraits.some(t => traits.has(t))) continue;
            let hits = 0;
            const matchedTags = new Set(rule.tags);
            for (const v of rule.verbs) {
                if (hasWord(corpus, v)) {
                    hits += 2;
                    matchedTags.add(v);
                }
            }
            for (const n of rule.nouns) {
                if (hasWord(corpus, n)) {
                    hits += 1;
                    matchedTags.add(n);
                }
            }
            if (hits > 0 && (!bestSemantic || hits > bestSemantic.hits)) {
                bestSemantic = {
                    type: rule.type,
                    subtype: rule.subtype,
                    data: { sound: rule.sound, tags: [...matchedTags] },
                    parentData: classifierData[rule.type],
                    score: hits >= 2 ? 0.8 : 0.75,
                    hits
                };
            }
        }
        if (bestSemantic) bestMatch = bestSemantic;
    }

    // 6. Primary Creature-Type Trait Fallback
    if (!bestMatch) {
        for (const t of traits) {
            const typeKey = PRIMARY_TRAIT_FALLBACK[t];
            if (typeKey && classifierData[typeKey]) {
                bestMatch = {
                    type: typeKey,
                    subtype: null,
                    data: classifierData[typeKey],
                    score: 0.7
                };
                break;
            }
        }
    }

    if (!bestMatch) {
        return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), cascade: ["unknown", "generic"], confidence: 0 };
    }

    // 7. Assemble Tags & Corroborate Confidence
    const finalTags = new Set(bestMatch.parentData?.defaultTags || []);
    bestMatch.data?.defaultTags?.forEach(t => finalTags.add(t));
    bestMatch.data?.tags?.forEach(t => finalTags.add(t));
    traits.forEach(t => finalTags.add(t));

    let confidence = bestMatch.score;
    for (const et of ENRICHMENT_TRAITS) {
        if (hasWord(corpus, et)) {
            finalTags.add(et);
            confidence += 0.05;
        }
    }
    if (notesText.length > 20) confidence += 0.05;

    if (GROUP_KEYWORDS.some(k => hasWord(name, k)) || traits.has("swarm") || traits.has("troop")) {
        finalTags.add("swarm");
        finalTags.add("group");
        finalTags.add("multitude");
    }

    const id = bestMatch.subtype ? `${bestMatch.type}_${bestMatch.subtype}` : bestMatch.type;
    return {
        id,
        type: bestMatch.type,
        subtype: bestMatch.subtype,
        cascade: Cascade.build(id),
        sound: bestMatch.data?.sound || bestMatch.parentData?.sound || "MONSTER_GENERIC",
        tags: finalTags,
        confidence: Math.min(confidence, 1.0)
    };
}
