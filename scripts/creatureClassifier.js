import { getClassifierData } from "./data/classifierData.js";

/**
 * Analyzes an actor to determine its concept (Visuals/Sound).
 * @param {Actor|string} actorOrName - The Foundry Actor or just a name string.
 * @returns {object} - { id, sound, tags: Set, confidence: number }
 */
export function classifyCreature(actorOrName) {
    const name = (typeof actorOrName === 'string') ? actorOrName : (actorOrName?.name || "");
    const isPlayer = (typeof actorOrName === 'object' && actorOrName.type === "character");
    const CLASSIFIER_DATA = getClassifierData();

    // Quick return for Players if we want to separate them
    if (isPlayer) {
        return {
            id: "player",
            sound: "MONSTER_HUMANOID",
            tags: new Set(["player", "character", "adventurer"]),
            confidence: 1.0
        };
    }

    // Extract Description
    let description = (typeof actorOrName === 'object' && actorOrName.system?.description?.value)
        ? actorOrName.system.description.value.toLowerCase()
        : "";

    // Extract Ancestry/Race (Context-Aware)
    if (typeof actorOrName === 'object' && actorOrName.system) {
        // Daggerheart
        if (actorOrName.system.ancestry) {
            description += " " + actorOrName.system.ancestry.toLowerCase();
        }
        // DnD5e (Character)
        if (actorOrName.system.details?.race) {
            description += " " + actorOrName.system.details.race.toLowerCase();
        }
        // DnD5e (NPC - often in type or details.type.value)
        if (actorOrName.system.details?.type?.value) {
            description += " " + actorOrName.system.details.type.value.toLowerCase();
        }
    }

    // Extract Item Data for Context (Attack names, Spells)
    // We append this to the description for searching purposes
    if (typeof actorOrName === 'object' && actorOrName.items) {
        const itemNames = actorOrName.items.map(i => i.name).join(" ");
        const itemDescs = actorOrName.items.map(i => i.system?.description?.value || "").join(" ");
        description += " " + itemNames.toLowerCase() + " " + itemDescs.toLowerCase();
    }

    if (!name) return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), confidence: 0 };

    const nameLower = name.toLowerCase();

    // Helper: Check for word match (prevents "Dredge" matching "Red")
    const hasKeyword = (text, keyword) => {
        // Matches "Keyword", "Keywords", "Keywordes" (simpler than full english rules)
        const pattern = new RegExp(`\\b${keyword}(?:e?s)?\\b`, 'i');
        return pattern.test(text);
    };

    // 1. Exception Check
    // We check purely based on name for exceptions
    if (CLASSIFIER_DATA.exceptions) {
        for (const [key, exception] of Object.entries(CLASSIFIER_DATA.exceptions)) {
            if (nameLower.includes(key)) { // Exceptions use substring (e.g. "ancient red dragon" matches "dragon")
                return {
                    id: exception.id,
                    sound: exception.sound,
                    tags: new Set(exception.tags),
                    confidence: exception.confidence,
                    isException: true
                };
            }
        }
    }

    // 2. Standard Classification
    let bestMatch = null;

    // Scan Types
    for (const [typeKey, typeData] of Object.entries(CLASSIFIER_DATA)) {
        if (typeKey === 'exceptions') continue;


        // Check Type Keywords
        if (typeData.keywords && typeData.keywords.some(k => hasKeyword(name, k))) {
            const newScore = 0.6;
            if (!bestMatch || newScore > bestMatch.score) {
                bestMatch = {
                    type: typeKey,
                    subtype: null, // Matched parent
                    data: typeData,
                    score: newScore
                };
            }
        }

        // Check Subtypes
        if (typeData.subtypes) {
            for (const subtype of typeData.subtypes) {
                if (subtype.keywords.some(k => hasKeyword(name, k))) {
                    const newScore = 0.8;
                    if (!bestMatch || newScore > bestMatch.score) {
                        bestMatch = {
                            type: typeKey,
                            subtype: subtype.id,
                            data: subtype,
                            parentData: typeData,
                            score: newScore // Higher base score for specific subtype
                        };
                    }
                    break;
                }
            }
        }
        if (bestMatch && bestMatch.score >= 0.6) break;
    }

    if (!bestMatch) {
        return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), confidence: 0 };
    }

    // 3. Assemble Tags & Boost Confidence via Description
    const finalTags = new Set(bestMatch.parentData?.defaultTags || []); // Inherit parent tags
    if (bestMatch.data.defaultTags) bestMatch.data.defaultTags.forEach(t => finalTags.add(t));
    if (bestMatch.data.tags) bestMatch.data.tags.forEach(t => finalTags.add(t)); // Add specific tags

    let confidence = bestMatch.score;

    // Scan description for ANY known tags from the entire system? 
    // Or just check if the assigned tags are present to boost confidence? 
    // Better: Check for "Features" in description.
    // For now, simple logic: If a tag exists in description words, +0.05 confidence.
    // Also if we find tags from OTHER categories, we might reduce confidence? (Too complex for now)

    // We can also have a list of "Universal Traits" to scan for (wings, horns, etc) if not already in tags
    const universalTraits = ["wings", "horns", "tails", "claws", "scales", "fur", "feathers", "ethereal"];

    universalTraits.forEach(trait => {
        if (description.includes(trait)) {
            finalTags.add(trait); // Add it if found
            confidence += 0.05;
        }
    });

    // Validated specific tags existing in description
    finalTags.forEach(tag => {
        if (description.includes(tag)) {
            confidence += 0.05;
        }
    });

    // 4. Group/Swarm Detection
    const groupKeywords = ["swarm", "pack", "legion", "horde", "squad", "troop", "army", "rabble", "gang", "mob"];
    if (groupKeywords.some(k => hasKeyword(name, k))) {
        finalTags.add("swarm");
        finalTags.add("group");
        finalTags.add("multitude");
    }

    return {
        id: bestMatch.subtype ? `${bestMatch.type}_${bestMatch.subtype}` : bestMatch.type,
        type: bestMatch.type,
        subtype: bestMatch.subtype,
        sound: bestMatch.data.sound || bestMatch.parentData?.sound || "MONSTER_GENERIC",
        tags: finalTags,
        confidence: Math.min(confidence, 1.0)
    };
}

/**
 * Runs self-verification tests on startup.
 * @param {object} options
 * @param {number} [options.limit=0] - Max number of tests to run (0 = all).
 * @param {boolean} [options.random=false] - Whether to shuffle tests (if limit > 0).
 * @returns {object} { passed: boolean, results: Array<{input, status: "pass"|"fail"|"warn", details}> }
 */
export function runSelfTests({ limit = 0, random = false } = {}) {
    console.log(`Ionrift Lib | Running Classifier Self-Tests for ${game.system.id}...`);

    let tests = [];
    if (game.system.id === "dnd5e") {
        tests = [
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
            // Refinement Tests
            { input: "Cat", expectId: "beast_feline_domestic", sound: "SFX_MEOW" },
            { input: "Mastiff", expectId: "beast_canine_domestic", sound: "SFX_BARK" },
            { input: "Giant Goat", expectId: "beast_cattle", sound: "MONSTER_BEAST" },
            { input: "Giant Fly", expectId: "beast_insect", sound: "SFX_INSECT" },
            { input: "Sea Horse", expectId: "beast_aquatic", sound: "SFX_WATER_ENTITY" },
            // Exceptions & Overrides
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
            // Elemental Fidelity
            { input: "Water Elemental", expectId: "elemental_water", sound: "SFX_WATER_ENTITY" },
            { input: "Fire Elemental", expectId: "elemental_fire", sound: "MONSTER_ELEMENTAL" },
            { input: "Earth Elemental", expectId: "elemental_earth", sound: "MONSTER_CONSTRUCT" },
            { input: "Air Elemental", expectId: "elemental_air", sound: "SFX_WIND" },
            { input: "Invisible Stalker", expectId: "elemental_air", sound: "SFX_WIND" },
            { input: "Salamander", expectId: "elemental_fire", sound: "MONSTER_ELEMENTAL" },
            { input: "Chuul", expectId: "aberration_chuul", sound: "SFX_INSECT" },
            // Specific User Requests Round 4
            { input: "Warhorse", expectId: "beast_equine", sound: "MONSTER_HORSE" },
            { input: "Weasel", expectId: "beast_mustelid", sound: "MONSTER_BEAST" },
            { input: "Giant Weasel", expectId: "beast_mustelid", sound: "MONSTER_BEAST" },
            { input: "Tribal Warrior", expectId: "humanoid_tribal", sound: "MONSTER_HUMANOID" }
        ];
    } else {
        tests = [
            { input: "Zombie", expectId: "undead_zombie", minConf: 0.6 },
            { input: "Cave Bear", expectId: "beast_ursine", tags: ["claws"] },
            { input: "Flameskull", expectId: "undead_construct", tags: ["no_limbs"], exactConf: 1.0 },
            { input: "Ancient Red Dragon", expectId: "dragon_chromatic", tags: ["wings", "breath-weapon"] },
            // New Race Tests
            { input: "Wood Elf", expectId: "humanoid_elf", tags: ["ears"] },
            { input: "Duergar", expectId: "humanoid_dwarf", tags: ["underground"] },
            { input: "Katari Duelist", expectId: "humanoid_katari", tags: ["cat-like"] }
        ];
    }

    // Shuffle if requested
    if (random && limit > 0) {
        for (let i = tests.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tests[i], tests[j]] = [tests[j], tests[i]];
        }
    }

    // Apply Limit
    if (limit > 0 && limit < tests.length) {
        tests = tests.slice(0, limit);
    }

    let passedCount = 0;
    const results = [];

    tests.forEach(test => {
        const result = classifyCreature(test.input);
        let failReason = "";

        if (test.expectId && result.id !== test.expectId) failReason += `ID mismatch (${result.id} != ${test.expectId}). `;
        if (test.minConf && result.confidence < test.minConf) failReason += `Low confidence (${result.confidence} < ${test.minConf}). `;
        if (test.exactConf && result.confidence !== test.exactConf) failReason += `Exact confidence mismatch (${result.confidence}). `;
        if (test.tags) {
            const missing = test.tags.filter(t => !result.tags.has(t));
            if (missing.length > 0) failReason += `Missing tags: ${missing.join(", ")}. `;
        }

        if (failReason) {
            console.warn(`Ionrift Lib | Test FAILED for '${test.input}': ${failReason}`);
            results.push({
                input: test.input,
                status: "fail",
                details: failReason
            });
        } else {
            passedCount++;
            results.push({
                input: test.input,
                status: "pass",
                details: `Matched: ${result.id} (${(result.confidence * 100).toFixed(0)}%)`
            });
        }
    });

    console.log(`Ionrift Lib | Tests Complete. ${passedCount}/${tests.length} Passed.`);

    return {
        passed: passedCount === tests.length,
        results: results
    };
} 
