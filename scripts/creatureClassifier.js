import { Logger } from "./services/Logger.js";
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
 * Test vectors are loaded from a separate gitignored file
 * to prevent IP leakage in public repositories.
 *
 * @param {object} options
 * @param {number} [options.limit=0] - Max number of tests to run (0 = all).
 * @param {boolean} [options.random=false] - Whether to shuffle tests (if limit > 0).
 * @returns {Promise<object>} { passed: boolean, results: Array<{input, status, details}>, skipped?: boolean }
 */
export async function runSelfTests({ limit = 0, random = false } = {}) {
    Logger.log("Library", `Running Classifier Self-Tests for ${game.system.id}...`);

    let tests = [];
    try {
        const vectors = await import("./data/classifierTestVectors.js");
        if (game.system.id === "dnd5e") tests = vectors.DND5E_VECTORS;
        else if (game.system.id === "daggerheart") tests = vectors.DAGGERHEART_VECTORS;
        else tests = vectors.GENERIC_VECTORS;
    } catch {
        Logger.log("Library", "Test vectors not available (production build). Skipping self-tests.");
        return { passed: true, results: [], skipped: true };
    }

    // Shuffle if requested
    if (random && limit > 0) {
        tests = [...tests]; // Copy before mutating
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

    Logger.log("Library", `Tests Complete. ${passedCount}/${tests.length} Passed.`);

    return {
        passed: passedCount === tests.length,
        results: results
    };
} 
