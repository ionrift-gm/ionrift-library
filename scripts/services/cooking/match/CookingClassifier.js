const LIB_NAMESPACE = "ionrift-library";
const RESPITE_NAMESPACE = "ionrift-respite";

const WATER_NAMES = new Set([
    "waterskin", "water flask", "canteen",
    "water (pint)", "water, fresh (pint)", "holy water"
]);

// DnD5e: container; PF2e: backpack.
const CONTAINER_ITEM_TYPES = new Set(["container", "backpack"]);

/** Perishable cohort on names, e.g. "Bird Eggs (3d)" or "Fish (<1h)". */
export const SPOILAGE_COHORT_SUFFIX_RE = /\s+\((\d+d|<\d+h|\d+h)\)$/i;

export function stripSpoilageCohortSuffix(name) {
    if (!name) return "";
    return String(name).replace(SPOILAGE_COHORT_SUFFIX_RE, "").trim();
}

export function itemNamesMatch(itemName, targetName) {
    const left = stripSpoilageCohortSuffix(itemName).trim().toLowerCase();
    const right = stripSpoilageCohortSuffix(targetName).trim().toLowerCase();
    return Boolean(left && right && left === right);
}

// Kernel flags first, then ionrift-respite.
export function readResourceFlag(item, key) {
    const lib = item?.flags?.[LIB_NAMESPACE]?.[key];
    if (lib !== undefined && lib !== null) return lib;
    return item?.flags?.[RESPITE_NAMESPACE]?.[key];
}

export function resourceType(item) {
    return readResourceFlag(item, "resourceType") ?? null;
}

export function isWater(item) {
    if (!item) return false;
    if (resourceType(item) === "water") return true;
    const drinkType = readResourceFlag(item, "drinkType");
    if (drinkType === "water") return true;
    const name = item.name?.toLowerCase().trim() ?? "";
    return name.length > 0 && WATER_NAMES.has(name);
}

export function isContainerType(item) {
    return CONTAINER_ITEM_TYPES.has(item?.type);
}

export function hasCharges(item) {
    const uses = item?.system?.uses;
    return Boolean(uses && uses.max > 0);
}

// DnD5e v5+: uses.spent; legacy: uses.value.
export function remainingCharges(item) {
    const uses = item?.system?.uses;
    if (!uses || !(uses.max > 0)) return 0;
    const isV5 = "spent" in uses;
    const value = isV5 ? uses.max - (uses.spent ?? 0) : (uses.value ?? 0);
    return Math.max(0, value);
}

// DnD5e: system.container; PF2e: system.containerId.
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

export function iterInventoryItems(actor) {
    return actor?.items ? [...actor.items] : [];
}

// Waterskin-style containers roll contents onto the parent; backpacks do not.
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
