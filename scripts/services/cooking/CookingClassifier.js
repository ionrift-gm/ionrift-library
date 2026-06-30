/**
 * Minimal, read-only classification core for the cooking/feeding abstraction.
 *
 * This is deliberately a small primitive: water detection, charge accounting,
 * and container parentage. It does NOT model Respite's full diet/essence
 * system. Resource flags are read from `flags["ionrift-library"]` first, then
 * `flags["ionrift-respite"]` for back-compat with content authored before the
 * kernel owned the namespace.
 */

/** Primary (kernel) flag namespace. */
const LIB_NAMESPACE = "ionrift-library";

/** Legacy (Respite) flag namespace, read as a fallback. */
const RESPITE_NAMESPACE = "ionrift-respite";

/** Built-in water item names (lowercase). */
const WATER_NAMES = new Set([
    "waterskin", "water flask", "canteen",
    "water (pint)", "water, fresh (pint)", "holy water"
]);

/** Item types that hold other items. DnD5e uses "container"; PF2e "backpack". */
const CONTAINER_ITEM_TYPES = new Set(["container", "backpack"]);

/** Perishable cohort labels on item names, e.g. "Bird Eggs (3d)" or "Fish (<1h)". */
export const SPOILAGE_COHORT_SUFFIX_RE = /\s+\((\d+d|<\d+h|\d+h)\)$/i;

/**
 * Strip a spoilage cohort suffix from a display name for recipe and classification matching.
 * @param {string} name
 * @returns {string}
 */
export function stripSpoilageCohortSuffix(name) {
    if (!name) return "";
    return String(name).replace(SPOILAGE_COHORT_SUFFIX_RE, "").trim();
}

/**
 * Case-insensitive item name match, ignoring spoilage cohort suffixes on inventory rows.
 * @param {string} itemName
 * @param {string} targetName
 * @returns {boolean}
 */
export function itemNamesMatch(itemName, targetName) {
    const left = stripSpoilageCohortSuffix(itemName).trim().toLowerCase();
    const right = stripSpoilageCohortSuffix(targetName).trim().toLowerCase();
    return Boolean(left && right && left === right);
}

/**
 * Read a resource flag across both namespaces (kernel first, Respite fallback).
 * @param {Item|object} item
 * @param {string} key
 * @returns {*}
 */
export function readResourceFlag(item, key) {
    const lib = item?.flags?.[LIB_NAMESPACE]?.[key];
    if (lib !== undefined && lib !== null) return lib;
    return item?.flags?.[RESPITE_NAMESPACE]?.[key];
}

/**
 * @param {Item|object} item
 * @returns {"food"|"water"|"fuel"|"ingredient"|"essence"|"none"|null}
 */
export function resourceType(item) {
    return readResourceFlag(item, "resourceType") ?? null;
}

/**
 * Whether an item reads as water. Flag-first (dual namespace), then a small
 * name list. Intentionally diet-agnostic: the kernel primitive does not know
 * about per-actor diets.
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isWater(item) {
    if (!item) return false;
    if (resourceType(item) === "water") return true;
    const drinkType = readResourceFlag(item, "drinkType");
    if (drinkType === "water") return true;
    const name = item.name?.toLowerCase().trim() ?? "";
    return name.length > 0 && WATER_NAMES.has(name);
}

/**
 * @param {Item|object} item
 * @returns {boolean}
 */
export function isContainerType(item) {
    return CONTAINER_ITEM_TYPES.has(item?.type);
}

/**
 * Whether an item carries a charge/uses pool (rather than plain quantity).
 * @param {Item|object} item
 * @returns {boolean}
 */
export function hasCharges(item) {
    const uses = item?.system?.uses;
    return Boolean(uses && uses.max > 0);
}

/**
 * Remaining charges on an item's uses pool. Handles DnD5e v5+ (`uses.spent`,
 * value = max - spent, read-only) and legacy (`uses.value` writable).
 * @param {Item|object} item
 * @returns {number}
 */
export function remainingCharges(item) {
    const uses = item?.system?.uses;
    if (!uses || !(uses.max > 0)) return 0;
    const isV5 = "spent" in uses;
    const value = isV5 ? uses.max - (uses.spent ?? 0) : (uses.value ?? 0);
    return Math.max(0, value);
}

/**
 * Get the id of the container an item lives inside, if any.
 * DnD5e 5.x: `system.container` (string). PF2e 8.x: `system.containerId`.
 * @param {Item|object} item
 * @returns {string|null}
 */
export function getContainerParentId(item) {
    if (!item) return null;

    const dnd = item.system?.container;
    if (typeof dnd === "string" && dnd) return dnd;
    if (dnd && typeof dnd === "object") {
        const id = dnd.id ?? dnd._id ?? dnd.value;
        if (typeof id === "string" && id) return id;
    }

    const pf2 = item.system?.containerId;
    if (typeof pf2 === "string" && pf2) return pf2;
    if (pf2 && typeof pf2 === "object") {
        const id = pf2.value ?? pf2.id ?? pf2._id;
        if (typeof id === "string" && id) return id;
    }

    try {
        const container = item.container;
        if (container?.id) return container.id;
    } catch {
        /* Item document getter unavailable in tests */
    }

    return null;
}

/**
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function iterInventoryItems(actor) {
    return actor?.items ? [...actor.items] : [];
}

/**
 * Container ids whose contents roll up onto the parent water entry
 * (waterskin-style containers, not mundane backpacks).
 * @param {Iterable<Item>} items
 * @returns {Set<string>}
 */
export function collectWaterSourceContainerIds(items) {
    const containerIds = new Set();
    for (const item of items) {
        if (isContainerType(item)) containerIds.add(item.id);
    }
    const waterContainerIds = new Set();
    for (const item of items) {
        if (!isContainerType(item)) continue;
        if (!containerIds.has(item.id)) continue;
        if (isWater(item)) waterContainerIds.add(item.id);
    }
    return waterContainerIds;
}
