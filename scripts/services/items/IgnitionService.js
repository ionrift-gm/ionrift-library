/**
 * IgnitionService — Canonical fire-starting and ignition prerequisite evaluator.
 *
 * Provides cross-module scanning for physical ignition tools (tinderbox, flint and steel),
 * fire-starting cantrips and spells, and environmental fire sources (adjacent lit tokens, campfires).
 *
 * Shared between ionrift-luminance, ionrift-respite, and other tabletop survival mechanics.
 */

import { canReachToken } from "../tokenReach/TokenReach.js";

export const PHYSICAL_IGNITION_PATTERNS = Object.freeze([
    "tinderbox",
    "flint and steel",
    "flint & steel",
    "fire striker",
    "firesteel",
    "matches",
    "matchbox"
]);

export const MAGICAL_IGNITION_PATTERNS = Object.freeze([
    // Universal & D&D 5e
    "prestidigitation",
    "produce flame",
    "fire bolt",
    "firebolt",
    "control flames",
    "create bonfire",
    "druidcraft",
    "flame blade",
    "continual flame",
    // PF2e
    "ignition",
    "spark",
    "breathe fire"
]);

export class IgnitionService {
    /**
     * Check if an actor has a physical ignition tool in their inventory.
     * @param {Actor} actor
     * @returns {{ hasIgniter: boolean, item: Item|null, name: string|null }}
     */
    static hasPhysicalIgniter(actor) {
        if (!actor || !actor.items) {
            return { hasIgniter: false, item: null, name: null };
        }

        for (const item of actor.items) {
            // Must have quantity remaining if quantity is tracked
            const qty = item.system?.quantity;
            if (typeof qty === "number" && qty <= 0) continue;

            const flagIgniter = item.flags?.["ionrift-library"]?.isIgniter ??
                               item.flags?.["ionrift-luminance"]?.isIgniter;
            if (flagIgniter === true) {
                return { hasIgniter: true, item, name: item.name };
            }

            const nameLower = (item.name || "").toLowerCase().trim();
            for (const pattern of PHYSICAL_IGNITION_PATTERNS) {
                if (nameLower.includes(pattern)) {
                    return { hasIgniter: true, item, name: item.name };
                }
            }
        }

        return { hasIgniter: false, item: null, name: null };
    }

    /**
     * Check if an actor has a fire-starting cantrip, spell, or innate feature.
     * @param {Actor} actor
     * @returns {{ hasMagic: boolean, spell: Item|null, name: string|null }}
     */
    static hasMagicalIgnition(actor) {
        if (!actor || !actor.items) {
            return { hasMagic: false, spell: null, name: null };
        }

        for (const item of actor.items) {
            const flagMagic = item.flags?.["ionrift-library"]?.isIgnitionMagic ??
                              item.flags?.["ionrift-luminance"]?.isIgnitionMagic;
            if (flagMagic === true) {
                return { hasMagic: true, spell: item, name: item.name };
            }

            const nameLower = (item.name || "").toLowerCase().trim();
            for (const pattern of MAGICAL_IGNITION_PATTERNS) {
                if (nameLower.includes(pattern)) {
                    return { hasMagic: true, spell: item, name: item.name };
                }
            }
        }

        return { hasMagic: false, spell: null, name: null };
    }

    /**
     * Check if a token is in physical reach of an active open flame on the canvas.
     * Inspects:
     *  - Adjacent tokens carrying active lights or burning forms (campfires, elementals)
     *  - Ambient light fixtures with combustion animations within reach
     *
     * @param {Token|TokenDocument} token
     * @param {object} [options]
     * @param {number} [options.maxDistance=5]
     * @param {number} [options.maxSquares=1]
     * @returns {{ hasNearbyFire: boolean, source: Token|AmbientLight|null, name: string|null }}
     */
    static hasNearbyFireSource(token, options = {}) {
        const placeable = token?.object ?? (token?.document ? token : null);
        if (!placeable || !canvas?.ready || !canvas?.tokens) {
            return { hasNearbyFire: false, source: null, name: null };
        }

        const maxDistance = options.maxDistance ?? 5;
        const maxSquares = options.maxSquares ?? 1;

        // 1. Check other tokens on the active scene
        for (const other of canvas.tokens.placeables) {
            if (other === placeable || other.id === placeable.id) continue;

            // Must be within physical reach
            const reachResult = canReachToken(placeable, other, { maxDistance, maxSquares });
            if (!reachResult.ok) continue;

            const doc = other.document;
            const nameLower = (doc.name || other.name || "").toLowerCase();

            // Check for campfire or elemental flame forms
            const isCampfire = nameLower.includes("campfire") ||
                               nameLower.includes("camp fire") ||
                               nameLower.includes("brazier") ||
                               Boolean(doc.flags?.["ionrift-respite"]?.campfire);

            if (isCampfire) {
                return { hasNearbyFire: true, source: other, name: doc.name || game.i18n.localize("ionrift-library.ignition.campfire") };
            }

            // Check if other token is actively emitting light
            const light = doc.light;
            const isLit = (light?.bright ?? 0) > 0 || (light?.dim ?? 0) > 0;
            if (isLit) {
                return { hasNearbyFire: true, source: other, name: game.i18n.format("ionrift-library.ignition.actorsLight", { name: doc.name }) };
            }
        }

        // 2. Check nearby ambient lights
        if (canvas.lights?.placeables) {
            const originX = placeable.center?.x ?? placeable.x;
            const originY = placeable.center?.y ?? placeable.y;
            const gridSize = canvas.grid?.size ?? 100;
            const gridDistance = canvas.grid?.distance ?? 5;
            const reachPixels = (maxDistance / gridDistance) * gridSize;

            for (const ambient of canvas.lights.placeables) {
                const doc = ambient.document;
                if (doc.hidden) continue;

                const cfg = doc.config ?? {};
                if ((cfg.bright ?? 0) <= 0 && (cfg.dim ?? 0) <= 0) continue;

                const dx = ambient.x - originX;
                const dy = ambient.y - originY;
                const distPixels = Math.hypot(dx, dy);

                if (distPixels <= reachPixels) {
                    const animType = cfg.animation?.type ?? "";
                    const isFlame = animType === "torch" ||
                                    animType === "flame" ||
                                    animType === "chroma" ||
                                    (cfg.color && cfg.color.toLowerCase().startsWith("#ff"));

                    if (isFlame) {
                        return { hasNearbyFire: true, source: ambient, name: game.i18n.localize("ionrift-library.ignition.openFlame") };
                    }
                }
            }
        }

        return { hasNearbyFire: false, source: null, name: null };
    }

    /**
     * Check if an adjacent ally within physical reach has fire magic or a tinderbox to help.
     *
     * @param {Token|TokenDocument} token
     * @param {object} [options]
     * @param {number} [options.maxDistance=5]
     * @param {number} [options.maxSquares=1]
     * @param {boolean} [options.strictCombat=false]
     * @returns {{
     *   hasHelper: boolean,
     *   helperActor: Actor|null,
     *   helperToken: Token|null,
     *   method: "magical"|"physical"|null,
     *   sourceName: string|null
     * }}
     */
    static hasNearbyHelper(token, options = {}) {
        const placeable = token?.object ?? (token?.document ? token : null);
        if (!placeable || !canvas?.ready || !canvas?.tokens) {
            return { hasHelper: false, helperActor: null, helperToken: null, method: null, sourceName: null };
        }

        const maxDistance = options.maxDistance ?? 5;
        const maxSquares = options.maxSquares ?? 1;
        const strictCombat = Boolean(options.strictCombat);
        const inCombat = Boolean(game.combat?.started);

        for (const other of canvas.tokens.placeables) {
            if (other === placeable || other.id === placeable.id) continue;

            const reachResult = canReachToken(placeable, other, { maxDistance, maxSquares });
            if (!reachResult.ok) continue;

            const otherActor = other.actor;
            if (!otherActor) continue;

            // 1. Ally has fire magic (instant, works anywhere in or out of combat)
            const magic = this.hasMagicalIgnition(otherActor);
            if (magic.hasMagic) {
                return {
                    hasHelper: true,
                    helperActor: otherActor,
                    helperToken: other,
                    method: "magical",
                    sourceName: magic.name
                };
            }

            // 2. Ally has physical tinderbox (if not blocked by combat strictness)
            if (!(inCombat && strictCombat)) {
                const phys = this.hasPhysicalIgniter(otherActor);
                if (phys.hasIgniter) {
                    return {
                        hasHelper: true,
                        helperActor: otherActor,
                        helperToken: other,
                        method: "physical",
                        sourceName: phys.name
                    };
                }
            }
        }

        return { hasHelper: false, helperActor: null, helperToken: null, method: null, sourceName: null };
    }

    /**
     * Comprehensive evaluation of whether a character can ignite a light source.
     *
     * @param {Actor} actor
     * @param {Token|TokenDocument|null} [token=null]
     * @param {object} [options]
     * @param {boolean} [options.allowPhysical=true]
     * @param {boolean} [options.allowMagic=true]
     * @param {boolean} [options.allowNearby=true]
     * @param {boolean} [options.allowHelper=true]
     * @param {boolean} [options.strictCombat=false] If true, tinderbox is prohibited during active combat
     * @returns {{
     *   canIgnite: boolean,
     *   method: "physical" | "magical" | "environmental" | "cooperative" | null,
     *   sourceName: string | null,
     *   item: Item | null,
     *   sourceToken: Token | null,
     *   helperActor: Actor | null,
     *   helperToken: Token | null,
     *   helperMethod: string | null,
     *   failureReason: string | null
     * }}
     */
    static evaluateIgnition(actor, token = null, options = {}) {
        const allowPhysical = options.allowPhysical !== false;
        const allowMagic = options.allowMagic !== false;
        const allowNearby = options.allowNearby !== false;
        const allowHelper = options.allowHelper !== false;
        const strictCombat = Boolean(options.strictCombat);

        // Resolve token placeable if not provided
        const activeToken = token ?? (actor?.getActiveTokens ? actor.getActiveTokens()[0] : null);
        const inCombat = Boolean(actor?.inCombat || game.combat?.started);

        // 1. Check Personal Magical Ignition (Fastest & works anywhere)
        if (allowMagic) {
            const magic = this.hasMagicalIgnition(actor);
            if (magic.hasMagic) {
                return {
                    canIgnite: true,
                    method: "magical",
                    sourceName: magic.name,
                    item: magic.spell,
                    sourceToken: null,
                    helperActor: null,
                    helperToken: null,
                    helperMethod: null,
                    failureReason: null
                };
            }
        }

        // 2. Check Environmental Proximity (Light off existing campfire or ally's active flame)
        if (allowNearby && activeToken) {
            const nearby = this.hasNearbyFireSource(activeToken, options);
            if (nearby.hasNearbyFire) {
                return {
                    canIgnite: true,
                    method: "environmental",
                    sourceName: nearby.name,
                    item: null,
                    sourceToken: nearby.source,
                    helperActor: null,
                    helperToken: null,
                    helperMethod: null,
                    failureReason: null
                };
            }
        }

        // 3. Check Personal Physical Ignition (Tinderbox, flint and steel)
        if (allowPhysical) {
            const phys = this.hasPhysicalIgniter(actor);
            if (phys.hasIgniter) {
                if (inCombat && strictCombat) {
                    // In combat strict mode, check if a nearby ally has magic before flat-out failing
                    if (allowHelper && activeToken) {
                        const helper = this.hasNearbyHelper(activeToken, { ...options, strictCombat: true });
                        if (helper.hasHelper) {
                            return {
                                canIgnite: true,
                                method: "cooperative",
                                sourceName: helper.sourceName,
                                item: null,
                                sourceToken: null,
                                helperActor: helper.helperActor,
                                helperToken: helper.helperToken,
                                helperMethod: helper.method,
                                failureReason: null
                            };
                        }
                    }

                    return {
                        canIgnite: false,
                        method: "physical",
                        sourceName: phys.name,
                        item: phys.item,
                        sourceToken: null,
                        helperActor: null,
                        helperToken: null,
                        helperMethod: null,
                        failureReason: game.i18n.localize("ionrift-library.ignition.strictCombatFailure")
                    };
                }

                return {
                    canIgnite: true,
                    method: "physical",
                    sourceName: phys.name,
                    item: phys.item,
                    sourceToken: null,
                    helperActor: null,
                    helperToken: null,
                    helperMethod: null,
                    failureReason: null
                };
            }
        }

        // 4. Check Nearby Ally Helper (Standing within 5 ft with tinderbox or fire magic)
        if (allowHelper && activeToken) {
            const helper = this.hasNearbyHelper(activeToken, options);
            if (helper.hasHelper) {
                return {
                    canIgnite: true,
                    method: "cooperative",
                    sourceName: helper.sourceName,
                    item: null,
                    sourceToken: null,
                    helperActor: helper.helperActor,
                    helperToken: helper.helperToken,
                    helperMethod: helper.method,
                    failureReason: null
                };
            }
        }

        // No valid ignition methods found
        return {
            canIgnite: false,
            method: null,
            sourceName: null,
            item: null,
            sourceToken: null,
            helperActor: null,
            helperToken: null,
            helperMethod: null,
            failureReason: game.i18n.localize("ionrift-library.ignition.noMeansFailure")
        };
    }

    /**
     * Party-wide scan for fire-starting capabilities.
     * Evaluates who in the party can light campfires or torches.
     *
     * @param {Iterable<Actor>} actors
     * @returns {{
     *   hasTinderbox: boolean,
     *   hasMagic: boolean,
     *   canIgnite: boolean,
     *   lighters: Array<{ actorId: string, actorName: string, method: "physical"|"magical", sourceName: string }>
     * }}
     */
    static getPartyIgnitionCapabilities(actors) {
        const lighters = [];
        let hasTinderbox = false;
        let hasMagic = false;

        for (const actor of actors || []) {
            if (!actor) continue;

            const phys = this.hasPhysicalIgniter(actor);
            if (phys.hasIgniter) {
                hasTinderbox = true;
                lighters.push({
                    actorId: actor.id,
                    actorName: actor.name,
                    method: "physical",
                    sourceName: phys.name
                });
            }

            const magic = this.hasMagicalIgnition(actor);
            if (magic.hasMagic) {
                hasMagic = true;
                lighters.push({
                    actorId: actor.id,
                    actorName: actor.name,
                    method: "magical",
                    sourceName: magic.name
                });
            }
        }

        return {
            hasTinderbox,
            hasMagic,
            canIgnite: lighters.length > 0,
            lighters
        };
    }
}
