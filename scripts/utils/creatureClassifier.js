import { Logger } from "../services/platform/Logger.js";
import { getClassifierData } from "../data/classifierData.js";
import { Cascade } from "./Cascade.js";
import { classifyPf2eCreature } from "./pf2eSemanticRules.js";

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
        cascade: Cascade.build(id),
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

/** @type {WeakMap<object, { sig: string, result: object }>} */
const _actorClassCache = new WeakMap();

/** @type {Map<string, object>} */
const _stringClassCache = new Map();
const MAX_STRING_CLASS_CACHE = 512;

let _lastFrameTime = -1;
let _frameUncachedCalls = 0;
let _lastHotPathWarnAt = 0;
const HOT_PATH_FRAME_CALL_LIMIT = 20;
const HOT_PATH_WARN_COOLDOWN_MS = 30000;

function _cloneClassificationResult(res) {
    if (!res || typeof res !== "object") return res;
    return {
        ...res,
        tags: res.tags instanceof Set ? new Set(res.tags) : new Set(res.tags ?? []),
        cascade: Array.isArray(res.cascade) ? [...res.cascade] : res.cascade
    };
}

function _buildActorCacheSignature(actor, sysId) {
    const flagId = actor.flags?.[LIB_MODULE]?.classification?.id ?? "";
    const uuid = actor.uuid ?? "";
    const worldOverrideId = uuid ? (_getWorldClassificationOverrides()[uuid]?.id ?? "") : "";
    const traitsVal = actor.system?.traits?.value;
    const traitsSig = Array.isArray(traitsVal)
        ? traitsVal.join(",")
        : (traitsVal instanceof Set ? Array.from(traitsVal).join(",") : "");
    const typeVal = typeof actor.system?.details?.type?.value === "string"
        ? actor.system.details.type.value
        : "";
    const subtypeVal = typeof actor.system?.details?.type?.subtype === "string"
        ? actor.system.details.type.subtype
        : "";
    const raceVal = String(actor.system?.details?.race ?? actor.system?.ancestry ?? "");
    const rarityVal = String(actor.system?.traits?.rarity ?? "");
    const items = actor.items?.contents ?? (Array.isArray(actor.items) ? actor.items : null);
    const itemCount = items ? items.length : (actor.items?.size ?? 0);
    const firstItemName = items && items.length > 0 ? String(items[0]?.name ?? "") : "";
    const modTime = actor._stats?.modifiedTime ?? 0;
    const descLen = (actor.system?.description?.value?.length ?? 0)
        + (actor.system?.details?.publicNotes?.length ?? 0)
        + (actor.system?.details?.blurb?.length ?? 0);
    return `${sysId ?? ""}|${actor.name ?? ""}|${actor.type ?? ""}|${flagId}|${worldOverrideId}|${traitsSig}|${typeVal}|${subtypeVal}|${raceVal}|${rarityVal}|${itemCount}:${firstItemName}|${modTime}|${descLen}`;
}

function _recordUncachedClassificationCall() {
    const tickerTime = globalThis.canvas?.app?.ticker?.lastTime;
    if (typeof tickerTime !== "number" || tickerTime <= 0) return;
    if (tickerTime !== _lastFrameTime) {
        _lastFrameTime = tickerTime;
        _frameUncachedCalls = 1;
        return;
    }
    _frameUncachedCalls++;
    if (_frameUncachedCalls === HOT_PATH_FRAME_CALL_LIMIT) {
        const now = Date.now();
        if (now - _lastHotPathWarnAt >= HOT_PATH_WARN_COOLDOWN_MS) {
            _lastHotPathWarnAt = now;
            const stack = new Error().stack?.split("\n").slice(2, 6).join(" <- ") ?? "";
            Logger.warn(
                "Library",
                `Hot-path tripwire: classifyCreature executed ${_frameUncachedCalls}+ uncached times in a single render frame. Caller: ${stack}`
            );
        }
    }
}

/**
 * Clear in-memory creature classification caches.
 */
export function clearClassifierCache() {
    _stringClassCache.clear();
}

/**
 * Analyzes an actor to determine its concept (Visuals/Sound).
 * @param {Actor|string} actorOrName - The Foundry Actor or just a name string.
 * @returns {object} - { id, sound, tags: Set, confidence: number }
 */
export function classifyCreature(actorOrName) {
    if (!actorOrName) {
        return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), cascade: ["unknown", "generic"], confidence: 0 };
    }

    const sysId = typeof game !== "undefined" ? game?.system?.id : null;
    const isObj = typeof actorOrName === "object";
    let cacheSig = null;

    if (isObj) {
        if (actorOrName.type === "character") {
            return {
                id: "player",
                sound: "MONSTER_HUMANOID",
                tags: new Set(["player", "character", "adventurer"]),
                cascade: ["player"],
                confidence: 1.0
            };
        }
        const manual = _resolveActorClassificationOverride(actorOrName);
        if (manual) return manual;

        cacheSig = _buildActorCacheSignature(actorOrName, sysId);
        const cached = _actorClassCache.get(actorOrName);
        if (cached && cached.sig === cacheSig) {
            return _cloneClassificationResult(cached.result);
        }
    } else if (typeof actorOrName === "string") {
        cacheSig = `${sysId ?? ""}|${actorOrName}`;
        const cached = _stringClassCache.get(cacheSig);
        if (cached) {
            return _cloneClassificationResult(cached);
        }
    }

    _recordUncachedClassificationCall();
    const result = _computeCreatureClassification(actorOrName, sysId);

    if (isObj && cacheSig) {
        _actorClassCache.set(actorOrName, { sig: cacheSig, result });
    } else if (typeof actorOrName === "string" && cacheSig) {
        if (_stringClassCache.size >= MAX_STRING_CLASS_CACHE) {
            const oldestKey = _stringClassCache.keys().next().value;
            if (oldestKey !== undefined) _stringClassCache.delete(oldestKey);
        }
        _stringClassCache.set(cacheSig, result);
    }

    return _cloneClassificationResult(result);
}

function _computeCreatureClassification(actorOrName, sysId) {
    const name = (typeof actorOrName === 'string') ? actorOrName : (actorOrName?.name || "");
    const CLASSIFIER_DATA = getClassifierData();

    // PF2e / SF2e: Abstract morphological rules, system trait composition, and description verb/noun inference
    if (sysId === "pf2e" || sysId === "sf2e") {
        return classifyPf2eCreature(actorOrName, CLASSIFIER_DATA);
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

    if (!name) return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), cascade: ["unknown", "generic"], confidence: 0 };

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
                    cascade: Cascade.build(exception.id),
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
        return { id: "unknown", sound: "MONSTER_GENERIC", tags: new Set(), cascade: ["unknown", "generic"], confidence: 0 };
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

    const id = bestMatch.subtype ? `${bestMatch.type}_${bestMatch.subtype}` : bestMatch.type;
    return {
        id,
        type: bestMatch.type,
        subtype: bestMatch.subtype,
        cascade: Cascade.build(id),
        sound: bestMatch.data.sound || bestMatch.parentData?.sound || "MONSTER_GENERIC",
        tags: finalTags,
        confidence: Math.min(confidence, 1.0)
    };
}

/** @type {Set<string>} Classifier entity IDs representing innate flyers or hoverers */
export const AIRBORNE_ENTITY_IDS = new Set([
    "aberration_beholder",
    "undead_wraith",
    "undead_ghost",
    "elemental_air",
    "fey_sprite",
    "celestial_angel",
    "beast_avian",
    "beast_chiropteran",
    "monstrosity_harpy",
    "monstrosity_griffon",
    "monstrosity_manticore",
    "dragon",
    "dragon_wyvern",
    "dragon_pseudodragon",
    "construct_gargoyle",
    "gargoyle",
    "sprite",
    "harpy",
    "griffon",
    "manticore",
    "wraith"
]);

/** @type {Set<string>} Active status effect IDs that mark a token as airborne or non-wading */
export const AIRBORNE_STATUS_IDS = new Set([
    "flying",
    "fly",
    "hover",
    "hovering",
    "levitate",
    "levitating",
    "airborne",
    "flight",
    "incorporeal",
    "ethereal"
]);

/** @type {Set<string>} Foundry TokenDocument movement actions that do not wade through surface water */
export const AIRBORNE_MOVEMENT_ACTIONS = new Set([
    "fly",
    "hover",
    "blink",
    "teleport",
    "burrow"
]);

const FLYER_NAME_RE = /\b(butterfly|moth|flickerfly|wasp|bee|hornet|dragonfly|mosquito|stirge|bat|eagle|hawk|falcon|owl|raven|crow|vulture|roc|gull|seagull|albatross|harpy|griffon|hippogriff|pegasus|peryton|manticore|wyvern|dragon|drake|wyrm|pseudodragon|faerie dragon|dragonnel|pteranodon|quetzalcoatlus|cockatrice|couatl|gargoyle|pixie|sprite|angel|deva|planetar|solar|mephit|flameskull|demilich|beholder|spectator|gauth|death tyrant|wraith|ghost|specter|spectre|poltergeist|banshee|wisp|phantom|air elemental|djinni|invisible stalker|flying sword|cloaker|darkmantle|imp|quasit|spined devil|erinyes|vrock|chasme|aarakocra|owlin)\b/i;

const FLIGHTLESS_NAME_RE = /\b(penguin|ostrich|cassowary|emu|kiwi|dragon turtle|sea drake|river drake)\b/i;

const PASSIVE_FLIGHT_ITEM_RE = /^(fly|flight|flying|hover|hovering|incorporeal movement|air form|wings|winged|aerial\b)/i;

const NON_INNATE_ITEM_TYPES = new Set([
    "spell",
    "consumable",
    "loot",
    "equipment",
    "weapon",
    "container",
    "backpack",
    "tool"
]);

/**
 * Detect whether an actor has an innate or active fly/hover speed across D&D 5e, PF2e, SF2e, PF1e, and generic schemas.
 * @param {Actor|object|null|undefined} actor
 * @returns {boolean}
 */
export function hasActorFlySpeed(actor) {
    if (!actor?.system) return false;
    const sys = actor.system;

    // D&D 5e: system.attributes.movement.{fly, hover}
    const mov = sys.attributes?.movement;
    if (mov && (Number(mov.fly) > 0 || Boolean(mov.hover))) return true;

    // PF2e / SF2e: system.attributes.speed.otherSpeeds or system.movement.speeds.fly
    const otherSpeeds = sys.attributes?.speed?.otherSpeeds;
    if (Array.isArray(otherSpeeds)) {
        if (otherSpeeds.some(s => String(s?.type || "").toLowerCase() === "fly" && (Number(s?.value) > 0 || Number(s?.total) > 0))) {
            return true;
        }
    }
    const pf2eFly = sys.movement?.speeds?.fly;
    if (pf2eFly && (Number(pf2eFly.value) > 0 || Number(pf2eFly.total) > 0 || Number(pf2eFly) > 0)) {
        return true;
    }
    if (String(sys.attributes?.speed?.type || "").toLowerCase() === "fly") {
        return true;
    }

    // PF1e / D&D 3.5e: system.attributes.speed.fly
    const pf1eFly = sys.attributes?.speed?.fly;
    if (pf1eFly && (Number(pf1eFly.total) > 0 || Number(pf1eFly.base) > 0 || Number(pf1eFly) > 0)) {
        return true;
    }

    // Generic schemas
    if (sys.movement && (Number(sys.movement.fly) > 0 || Boolean(sys.movement.hover))) return true;
    if (sys.speed && (Number(sys.speed.fly) > 0 || Boolean(sys.speed.hover))) return true;
    if (Number(sys.flyingSpeed) > 0) return true;

    return false;
}

function _isExplicitSwimOnlyActor(actor) {
    if (!actor?.system) return false;
    const sys = actor.system;
    const mov = sys.attributes?.movement;
    if (mov && Number(mov.swim) > 0 && Number(mov.fly ?? 0) === 0 && !mov.hover) {
        return true;
    }
    const otherSpeeds = sys.attributes?.speed?.otherSpeeds;
    if (Array.isArray(otherSpeeds)) {
        const hasSwim = otherSpeeds.some(s => String(s?.type || "").toLowerCase() === "swim" && (Number(s?.value) > 0 || Number(s?.total) > 0));
        const hasFly = otherSpeeds.some(s => String(s?.type || "").toLowerCase() === "fly" && (Number(s?.value) > 0 || Number(s?.total) > 0));
        if (hasSwim && !hasFly) return true;
    }
    const pf2eSwim = sys.movement?.speeds?.swim;
    const pf2eFly = sys.movement?.speeds?.fly;
    if (pf2eSwim && (Number(pf2eSwim.value ?? pf2eSwim.total ?? pf2eSwim) > 0)) {
        const flyVal = Number(pf2eFly?.value ?? pf2eFly?.total ?? pf2eFly ?? 0);
        if (flyVal <= 0) return true;
    }
    return false;
}

function _hasAirborneStatusEffect(tokenDoc, actor) {
    const checkStatusCollection = (col) => {
        if (!col) return false;
        const iter = col instanceof Set || Array.isArray(col) ? col : null;
        if (!iter) return false;
        for (const s of iter) {
            if (typeof s === "string" && AIRBORNE_STATUS_IDS.has(s.toLowerCase())) return true;
            if (s && typeof s === "object") {
                const id = String(s.id ?? s.statusId ?? s.name ?? "").toLowerCase();
                if (AIRBORNE_STATUS_IDS.has(id)) return true;
            }
        }
        return false;
    };

    if (checkStatusCollection(actor?.statuses) || checkStatusCollection(tokenDoc?.statuses)) {
        return true;
    }

    const checkEffects = (effects) => {
        const list = effects?.contents ?? (Array.isArray(effects) ? effects : null);
        if (!list) return false;
        for (const eff of list) {
            if (!eff || eff.disabled || eff.isSuppressed) continue;
            if (checkStatusCollection(eff.statuses)) return true;
            const statusId = String(eff.statusId ?? eff.flags?.core?.statusId ?? "").toLowerCase();
            if (statusId && AIRBORNE_STATUS_IDS.has(statusId)) return true;
            const name = String(eff.name ?? eff.label ?? "").trim().toLowerCase();
            if (AIRBORNE_STATUS_IDS.has(name)) return true;
        }
        return false;
    };

    return checkEffects(actor?.effects) || checkEffects(tokenDoc?.effects);
}

/**
 * Determine whether a token, token document, actor, or creature name represents a flying,
 * hovering, or airborne entity that does not wade in or interact with surface water bodies.
 *
 * @param {Token|TokenDocument|Actor|string|null|undefined} tokenOrActor
 * @param {object} [options={}]
 * @param {number} [options.elevation]
 * @param {string} [options.movementAction]
 * @param {object} [options.changes]
 * @returns {boolean}
 */
export function isFlyingCreature(tokenOrActor, options = {}) {
    if (!tokenOrActor) return false;

    if (typeof tokenOrActor === "string") {
        if (FLIGHTLESS_NAME_RE.test(tokenOrActor)) return false;
        if (FLYER_NAME_RE.test(tokenOrActor)) return true;
        const c = classifyCreature(tokenOrActor);
        if (!c || c.id === "unknown") return false;
        const tags = c.tags instanceof Set ? c.tags : new Set(c.tags ?? []);
        return AIRBORNE_ENTITY_IDS.has(c.id)
            || c.type === "dragon"
            || String(c.id ?? "").startsWith("dragon")
            || tags.has("flying")
            || tags.has("flight")
            || tags.has("floating")
            || tags.has("incorporeal");
    }

    const tokenDoc = tokenOrActor.document
        ?? ((tokenOrActor.actor !== undefined || tokenOrActor.elevation !== undefined || tokenOrActor.movementAction !== undefined)
            ? tokenOrActor
            : null);
    const actor = tokenOrActor.actor
        ?? tokenDoc?.actor
        ?? ((tokenOrActor.system !== undefined || tokenOrActor.type !== undefined) ? tokenOrActor : null);

    // 1. Explicit positive elevation (above water surface)
    const rawElev = options.changes?.elevation
        ?? options.elevation
        ?? tokenDoc?.elevation
        ?? tokenDoc?._source?.elevation
        ?? tokenOrActor.elevation
        ?? 0;
    if ((Number(rawElev) || 0) > 0) return true;

    // 2. Foundry movement action / method (fly, hover, blink, teleport, burrow)
    const moveAction = String(
        options.changes?.movementAction
        ?? options.movementAction
        ?? tokenDoc?.movementAction
        ?? tokenDoc?._source?.movementAction
        ?? ""
    ).toLowerCase();
    if (moveAction && AIRBORNE_MOVEMENT_ACTIONS.has(moveAction)) return true;

    // 3. Active status effects / conditions (flying, hover, levitate, incorporeal, etc.)
    if (_hasAirborneStatusEffect(tokenDoc, actor)) return true;

    // 4. Explicit Actor fly or hover movement speed (D&D 5e, PF2e, SF2e, PF1e, generic)
    if (hasActorFlySpeed(actor)) return true;

    // 5. Exclude explicitly flightless or swim-only creatures (e.g. Penguin, Dragon Turtle, Otter, Shark)
    const creatureDetail = actor?.system?.details?.creature?.value ?? "";
    const typeValue = typeof actor?.system?.details?.type?.value === "string" ? actor.system.details.type.value : "";
    const subtypeValue = typeof actor?.system?.details?.type?.subtype === "string" ? actor.system.details.type.subtype : "";
    const combinedName = `${tokenDoc?.name ?? ""} ${tokenOrActor?.name ?? ""} ${actor?.name ?? ""} ${creatureDetail} ${typeValue} ${subtypeValue}`.trim();

    if (FLIGHTLESS_NAME_RE.test(combinedName)) return false;
    if (_isExplicitSwimOnlyActor(actor)) return false;

    // 6. Explicit flyer creature names (covers unlinked/minimal tokens and walkthrough flyers like "Gull")
    if (FLYER_NAME_RE.test(combinedName)) return true;

    // Grounded player characters without elevation, flying status, or fly speed are not innate flyers
    if (actor?.type === "character") return false;

    // 7. System traits (e.g. PF2e "incorporeal", or "air" elemental/spirit)
    const rawTraits = actor?.system?.traits?.value;
    if (Array.isArray(rawTraits) || rawTraits instanceof Set) {
        const sysTraits = new Set(Array.from(rawTraits).map(t => String(t).toLowerCase()));
        if (sysTraits.has("incorporeal")) return true;
        if (sysTraits.has("air") && (sysTraits.has("elemental") || sysTraits.has("spirit"))) return true;
    }

    // 8. Passive/innate flight features on non-character actors (e.g. Daggerheart adversaries)
    const items = actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : null);
    if (items) {
        const mov = actor?.system?.attributes?.movement;
        const hasExplicitGroundedWalkOnly = Boolean(mov && Number(mov.walk) > 0 && Number(mov.fly ?? 0) === 0 && !mov.hover);
        if (!hasExplicitGroundedWalkOnly) {
            for (const item of items) {
                if (!item || NON_INNATE_ITEM_TYPES.has(String(item.type ?? "").toLowerCase())) continue;
                const itemName = String(item.name ?? "").trim();
                if (PASSIVE_FLIGHT_ITEM_RE.test(itemName)) return true;
            }
        }
    }

    // 9. Ionrift Library Creature Classification
    const targetForClassifier = actor ?? (combinedName || null);
    if (!targetForClassifier) return false;
    const c = classifyCreature(targetForClassifier);
    if (!c || c.id === "unknown") return false;
    const tags = c.tags instanceof Set ? c.tags : new Set(c.tags ?? []);

    return AIRBORNE_ENTITY_IDS.has(c.id)
        || c.type === "dragon"
        || String(c.id ?? "").startsWith("dragon")
        || tags.has("flying")
        || tags.has("flight")
        || tags.has("floating")
        || tags.has("incorporeal");
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
        const vectors = await import("../data/classifierTestVectors.js");
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
            Logger.warn("Classifier", `Test FAILED for '${test.input}': ${failReason}`);
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
