/**
 * Overlay items are authored as dnd5e pack JSON. Foreign systems reject
 * those types and then crash or flood the migrator when `system` still
 * looks like dnd5e (boolean `equipped`, numeric `weight`, `{value, denomination}`
 * price). Remap the type, then replace `system` with a stub the host can
 * ingest. Flags stay on the item; QM `containerMeta` lives there.
 *
 * Bump {@link OVERLAY_ITEM_COERCE_REV} when the foreign stub shape changes
 * so materialisers rebuild existing world compendiums.
 */

export const OVERLAY_ITEM_COERCE_REV = 2;

const PF2E_FALLBACK_TYPES = Object.freeze([
    "weapon", "armor", "shield", "equipment", "consumable",
    "treasure", "backpack", "kit", "action", "feat", "spell"
]);

const TYPE_REMAP = Object.freeze({
    container: ["backpack", "equipment"],
    loot: ["treasure", "equipment"],
    tool: ["equipment"]
});

/**
 * @param {object} [options]
 * @param {string} [options.systemId]
 * @param {Iterable<string>|Set<string>} [options.allowed]
 * @returns {Set<string>}
 */
export function overlaySystemItemTypes(options = {}) {
    if (options.allowed) return new Set(options.allowed);
    const fromSystem = game.system?.documentTypes?.Item;
    if (fromSystem && typeof fromSystem === "object") {
        return new Set(Object.keys(fromSystem));
    }
    const labels = CONFIG?.Item?.typeLabels;
    if (labels && typeof labels === "object") {
        return new Set(Object.keys(labels));
    }
    const systemId = options.systemId ?? game.system?.id;
    if (systemId === "pf2e") return new Set(PF2E_FALLBACK_TYPES);
    return new Set();
}

/**
 * Prepare one overlay item for `Item.createDocuments`.
 * @param {object} item
 * @param {object} [options]
 * @returns {object|null}
 */
export function coerceOverlayItemForSystem(item, options = {}) {
    if (!item) return item;
    const systemId = options.systemId ?? game.system?.id ?? "";
    const allowed = overlaySystemItemTypes({ ...options, systemId });

    let nextType = item.type;
    if (nextType && allowed.size && !allowed.has(nextType)) {
        nextType = _remapType(nextType, allowed);
        if (!nextType) return null;
    }

    const foreign = Boolean(systemId && systemId !== "dnd5e");
    if (!foreign && nextType === item.type) return item;

    item.type = nextType;
    if (foreign) {
        item.system = _sanitizeSystem(item.system, nextType, systemId);
        if (Array.isArray(item.effects) && item.effects.length) {
            item.effects = [];
        }
    }
    return item;
}

/**
 * @param {object[]} items
 * @param {object} [options]
 * @returns {{ prepared: object[], skipped: number }}
 */
export function prepareOverlayItemsForSystem(items, options = {}) {
    const prepared = [];
    let skipped = 0;
    for (const item of items ?? []) {
        const next = coerceOverlayItemForSystem(item, options);
        if (next) prepared.push(next);
        else skipped++;
    }
    return { prepared, skipped };
}

function _remapType(type, allowed) {
    const candidates = TYPE_REMAP[type];
    if (!candidates) return null;
    return candidates.find(candidate => allowed.has(candidate)) ?? null;
}

function _sanitizeSystem(system, type, systemId) {
    const src = system && typeof system === "object" ? system : {};
    if (systemId === "pf2e") return _pf2eStub(src, type);
    return _genericStub(src);
}

function _genericStub(src) {
    const description = src.description?.value ?? (typeof src.description === "string" ? src.description : "");
    return {
        description: { value: description },
        quantity: _quantity(src)
    };
}

function _pf2eStub(src, type) {
    const description = src.description?.value ?? (typeof src.description === "string" ? src.description : "");
    const rarity = _rarity(src);
    const stub = {
        description: { value: description },
        quantity: _quantity(src),
        price: { value: _priceToCoins(src.price) },
        bulk: { value: _weightToBulk(src.weight ?? src.bulk) },
        traits: {
            value: Array.isArray(src.traits?.value) ? [...src.traits.value] : [],
            rarity,
            otherTags: []
        },
        size: src.size ?? "med"
    };

    if (type === "backpack" || type === "container") {
        const lbs = src.capacity?.value ?? src.capacity;
        const capBulk = _weightToBulk(lbs);
        stub.bulkCapacity = { value: capBulk >= 1 ? capBulk : 1 };
        stub.collapsed = false;
        stub.stowing = true;
    }

    if (type === "consumable") {
        stub.category = _consumableCategory(src);
        stub.uses = {
            value: Number(src.uses?.value) || 1,
            max: Number(src.uses?.max) || 1,
            autoDestroy: true
        };
    }

    return stub;
}

function _quantity(src) {
    const n = Number(src.quantity);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function _rarity(src) {
    if (typeof src.rarity === "string" && src.rarity) return src.rarity;
    if (typeof src.traits?.rarity === "string" && src.traits.rarity) return src.traits.rarity;
    return "common";
}

function _priceToCoins(price) {
    const coins = { pp: 0, gp: 0, sp: 0, cp: 0 };
    if (price == null) return coins;
    if (typeof price === "number") {
        coins.gp = Math.max(0, Math.round(price));
        return coins;
    }
    if (typeof price.value === "number") {
        const n = Math.max(0, price.value);
        const den = String(price.denomination ?? "gp").toLowerCase();
        if (den === "pp") coins.pp = Math.round(n);
        else if (den === "sp") coins.sp = Math.round(n);
        else if (den === "cp") coins.cp = Math.round(n);
        else if (den === "ep") coins.sp = Math.round(n * 5);
        else coins.gp = Math.round(n);
        return coins;
    }
    if (price.value && typeof price.value === "object") {
        const v = price.value;
        coins.pp = Math.max(0, Math.round(Number(v.pp) || 0));
        coins.gp = Math.max(0, Math.round(Number(v.gp) || 0));
        coins.sp = Math.max(0, Math.round(Number(v.sp) || 0));
        coins.cp = Math.max(0, Math.round(Number(v.cp) || 0));
    }
    return coins;
}

function _weightToBulk(weight) {
    if (weight && typeof weight === "object" && weight.value != null) {
        const v = weight.value;
        if (v === "L" || v === "l") return 0.1;
        const num = Number(v);
        return Number.isFinite(num) && num >= 0 ? num : 0;
    }
    if (weight === "L" || weight === "l") return 0.1;
    const n = Number(weight);
    if (!Number.isFinite(n) || n <= 0) return 0;
    // PF2e v8 numeric bulk: 0.1 represents Light ("L") bulk; 1+ is standard bulk.
    if (n < 1) return 0.1;
    return Math.max(1, Math.round(n / 10));
}

function _consumableCategory(src) {
    const raw = src.category ?? src.type?.value ?? src.type;
    const key = typeof raw === "string" ? raw.toLowerCase() : "";
    if (key === "potion") return "potion";
    if (key === "poison") return "poison";
    if (key === "scroll") return "scroll";
    if (key === "ammo" || key === "ammunition") return "ammunition";
    return "other";
}
