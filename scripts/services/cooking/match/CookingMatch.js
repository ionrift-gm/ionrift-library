import {
    isWater,
    isContainerType,
    remainingCharges,
    getContainerParentId,
    iterInventoryItems,
    collectWaterSourceContainerIds,
    readResourceFlag,
    itemNamesMatch
} from "./CookingClassifier.js";

/**
 * @typedef {Object} IngredientSpec
 * @property {string} [name] Primary ingredient name.
 * @property {number} [quantity] Units required (default 1).
 * @property {string[]} [accepts] Any-of substitute names.
 * @property {{ contents?: string, viaCharges?: boolean, flag?: string, foodTag?: string, flagScope?: string }} [match]
 *   Structured match descriptor. `contents: "water"` matches by classification;
 *   `viaCharges` opts into charge accounting; `flag` requires a truthy module
 *   flag; `foodTag` requires a matching food tag. `flagScope` names the flag
 *   namespace to read; when omitted, the kernel and Respite namespaces are
 *   checked (kernel first) for back-compat.
 */

function nameEquals(item, name) {
    if (!item || !name) return false;
    return itemNamesMatch(item.name, name);
}

// Kernel flags first, then ionrift-respite when reading without explicit scope.
function readMatchFlag(item, key, scope) {
    if (scope) return item?.flags?.[scope]?.[key];
    return readResourceFlag(item, key);
}

export const CookingMatch = {
    itemMatches(item, spec, ctx = {}) {
        if (!item || !spec) return false;

        if (spec.name && nameEquals(item, spec.name)) return true;
        if (Array.isArray(spec.accepts) && spec.accepts.some(n => nameEquals(item, n))) return true;

        const match = spec.match;
        if (match) {
            const flagOk = match.flag ? Boolean(readMatchFlag(item, match.flag, match.flagScope)) : null;
            const tagOk = match.foodTag ? readMatchFlag(item, "foodTag", match.flagScope) === match.foodTag : null;
            if (flagOk !== null || tagOk !== null) {
                if ((flagOk ?? true) && (tagOk ?? true)) return true;
            }
            if (match.contents === "water" && isWater(item)) return true;
        }

        return false;
    },

    count(actor, spec, ctx = {}) {
        const items = iterInventoryItems(actor);
        const chargeAware = spec?.match?.contents === "water" || spec?.match?.viaCharges === true;

        if (!chargeAware) {
            let total = 0;
            for (const item of items) {
                if (!this.itemMatches(item, spec, { actor, ...ctx })) continue;
                total += Number(item.system?.quantity ?? 1);
            }
            return total;
        }

        const waterContainerIds = collectWaterSourceContainerIds(items);
        let total = 0;
        for (const item of items) {
            if (!this.itemMatches(item, spec, { actor, ...ctx })) continue;
            const qty = Number(item.system?.quantity ?? 1);
            if (qty <= 0) continue;

            // Pints inside a water-source container are tallied on the parent.
            const parentId = getContainerParentId(item);
            if (parentId && waterContainerIds.has(parentId)) continue;

            const uses = item.system?.uses;
            const rawMax = uses && uses.max > 0 ? uses.max : 0;

            if (isContainerType(item) && rawMax <= 0) {
                let contained = 0;
                for (const child of items) {
                    if (getContainerParentId(child) !== item.id) continue;
                    if (!this.itemMatches(child, spec, { actor, ...ctx })) continue;
                    contained += Number(child.system?.quantity ?? 1);
                }
                total += contained;
                continue;
            }

            if (rawMax <= 0) {
                total += qty;
            } else {
                total += remainingCharges(item) + (qty - 1) * rawMax;
            }
        }
        return total;
    },

    findAvailable(actor, specs, quantity = 1) {
        for (const spec of specs ?? []) {
            const need = spec?.quantity ?? quantity;
            if (this.count(actor, spec) >= need) return spec;
        }
        return null;
    },

    async consume(actor, spec, quantity, ctx = {}) {
        let remaining = Number(quantity) || 0;
        if (remaining <= 0 || !actor) return 0;

        const items = iterInventoryItems(actor);
        const waterContainerIds = collectWaterSourceContainerIds(items);
        let consumed = 0;

        for (const item of items) {
            if (remaining <= 0) break;
            if (!this.itemMatches(item, spec, { actor, ...ctx })) continue;

            // Pints inside a water-source container are consumed via the parent.
            const parentId = getContainerParentId(item);
            if (parentId && waterContainerIds.has(parentId)) continue;

            const took = await this._consumeFromItem(actor, item, remaining, spec, ctx);
            consumed += took;
            remaining -= took;
        }
        return consumed;
    },

    async _consumeFromItem(actor, item, amount, spec, ctx) {
        if (!item) return 0;

        if (isContainerType(item)) {
            let consumed = 0;
            let remaining = amount;
            const children = iterInventoryItems(actor).filter(
                c => getContainerParentId(c) === item.id && this.itemMatches(c, spec, { actor, ...ctx })
            );
            for (const child of children) {
                if (remaining <= 0) break;
                const cQty = Number(child.system?.quantity ?? 1);
                const take = Math.min(remaining, cQty);
                if (cQty - take > 0) {
                    await child.update({ "system.quantity": cQty - take });
                } else {
                    await actor.deleteEmbeddedDocuments("Item", [child.id]);
                }
                consumed += take;
                remaining -= take;
            }
            return consumed;
        }

        const uses = item.system?.uses;
        const qty = Number(item.system?.quantity ?? 1);

        if (uses && uses.max > 0) {
            const isV5 = "spent" in uses;
            const currentCharges = isV5 ? uses.max - (uses.spent ?? 0) : (uses.value ?? 0);

            if (currentCharges > 0) {
                const consumed = Math.min(amount, currentCharges);
                const left = currentCharges - consumed;
                if (left <= 0 && qty > 1) {
                    await item.update(isV5
                        ? { "system.uses.spent": 0, "system.quantity": qty - 1 }
                        : { "system.uses.value": uses.max, "system.quantity": qty - 1 });
                } else if (left <= 0 && qty <= 1) {
                    await actor.deleteEmbeddedDocuments("Item", [item.id]);
                } else {
                    await item.update(isV5
                        ? { "system.uses.spent": (uses.spent ?? 0) + consumed }
                        : { "system.uses.value": left });
                }
                return consumed;
            }

            if (qty > 1) {
                await item.update(isV5
                    ? { "system.uses.spent": 1, "system.quantity": qty - 1 }
                    : { "system.uses.value": uses.max - 1, "system.quantity": qty - 1 });
                return 1;
            }
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
            return 0;
        }

        const consumed = Math.min(amount, qty);
        if (qty - consumed > 0) {
            await item.update({ "system.quantity": qty - consumed });
        } else {
            await actor.deleteEmbeddedDocuments("Item", [item.id]);
        }
        return consumed;
    }
};
