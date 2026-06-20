import { Logger } from "./services/Logger.js";
import { getClassifierData } from "./data/classifierData.js";

const LIB_MODULE = "ionrift-library";
const CLASSIFICATION_OVERRIDES_KEY = "classificationOverrides";

function _getWorldClassificationOverrides() {
    const settingKey = `${LIB_MODULE}.${CLASSIFICATION_OVERRIDES_KEY}`;
    if (!game?.settings?.settings?.has?.(settingKey)) return {};
    return game.settings.get(LIB_MODULE, CLASSIFICATION_OVERRIDES_KEY) ?? {};
}

function _isCompendiumActor(actor) {
    if (!actor) return false;
    if (actor.uuid?.startsWith("Compendium.")) return true;
    return !!actor.pack;
}

function _titleCaseId(id) {
    if (!id) return "";
    return id.split("_").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

function _lookupClassifierEntry(classId, classifierData) {
    if (!classId || classId === "unknown") return null;
    const parts = classId.split("_");
    const typeKey = parts[0];
    const typeData = classifierData[typeKey];
    if (!typeData) return null;

    let sound = typeData.sound ?? "MONSTER_GENERIC";
    const tags = new Set(typeData.defaultTags ?? []);

    if (parts.length > 1 && typeData.subtypes?.length) {
        const subtypeKey = parts.slice(1).join("_");
        const subtype = typeData.subtypes.find(s => s.id === subtypeKey);
        if (subtype) {
            sound = subtype.sound ?? sound;
            subtype.defaultTags?.forEach(t => tags.add(t));
            subtype.tags?.forEach(t => tags.add(t));
        }
    }

    return { sound, tags };
}

function _materializeClassificationOverride(raw, classifierData) {
    const id = String(raw.id ?? "").trim();
    if (!id) return null;

    const resolved = _lookupClassifierEntry(id, classifierData);
    const sound = raw.sound ?? resolved?.sound ?? "MONSTER_GENERIC";
    const tags = raw.tags?.length
        ? new Set(raw.tags)
        : (resolved?.tags ?? new Set());

    return {
        id,
        sound,
        tags,
        confidence: 1.0,
        isOverride: true
    };
}

function _resolveActorClassificationOverride(actorOrName) {
    if (typeof actorOrName !== "object" || !actorOrName) return null;
    const raw = actorOrName.flags?.[LIB_MODULE]?.classification;
    if (raw?.id) {
        return _materializeClassificationOverride(raw, getClassifierData());
    }
    const uuid = actorOrName.uuid;
    if (!uuid) return null;
    const worldRaw = _getWorldClassificationOverrides()[uuid];
    if (!worldRaw?.id) return null;
    return _materializeClassificationOverride(worldRaw, getClassifierData());
}

/**
 * List selectable classifier IDs for manual entity overrides.
 * @returns {{ id: string, label: string }[]}
 */
export function listClassifierOptions() {
    const classifierData = getClassifierData();
    const options = [];

    for (const [typeKey, typeData] of Object.entries(classifierData)) {
        if (typeKey === "exceptions") continue;
        options.push({ id: typeKey, label: _titleCaseId(typeKey) });
        for (const subtype of typeData.subtypes ?? []) {
            const id = `${typeKey}_${subtype.id}`;
            options.push({
                id,
                label: `${_titleCaseId(typeKey)} (${_titleCaseId(subtype.id)})`
            });
        }
    }

    options.sort((a, b) => a.label.localeCompare(b.label));
    return options;
}

/**
 * Set or clear a manual classification override on an actor document.
 * World actors store the override on the actor. Compendium actors use a
 * world-level map keyed by UUID because locked packs cannot be edited.
 * @param {Actor} actor
 * @param {string|null} classId - Classifier ID, or null to clear
 */
export async function setActorClassification(actor, classId) {
    if (!actor) return;

    if (_isCompendiumActor(actor)) {
        const uuid = actor.uuid;
        if (!uuid) return;
        const overrides = { ..._getWorldClassificationOverrides() };
        if (!classId) delete overrides[uuid];
        else overrides[uuid] = { id: classId };
        await game.settings.set(LIB_MODULE, CLASSIFICATION_OVERRIDES_KEY, overrides);
        return;
    }

    if (!actor.setFlag) return;
    if (!classId) {
        await actor.unsetFlag(LIB_MODULE, "classification");
        return;
    }
    await actor.setFlag(LIB_MODULE, "classification", { id: classId });
}

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

    const manual = _resolveActorClassificationOverride(actorOrName);
    if (manual) return manual;

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
        // PF2e (structured trait array: system.traits.value = ["undead", "mindless", ...])
        if (Array.isArray(actorOrName.system.traits?.value)) {
            description += " " + actorOrName.system.traits.value.join(" ").toLowerCase();
        }
        // PF2e (rarity/size can carry typing hints)
        if (actorOrName.system.traits?.rarity) {
            description += " " + String(actorOrName.system.traits.rarity).toLowerCase();
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
        if (game.system.id === "dnd5e")       tests = vectors.DND5E_VECTORS;
        else if (game.system.id === "daggerheart") tests = vectors.DAGGERHEART_VECTORS;
        else if (game.system.id === "pf2e")   tests = vectors.PF2E_VECTORS;
        else                                   tests = vectors.GENERIC_VECTORS;
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
