/**
 * ItemMintingService
 * Validates item source data before create/update/pack writes.
 * System dispatch via game.system.id; dnd5e is the first implementation.
 */

const DND5E_RARITIES = new Set([
    "common", "uncommon", "rare", "veryRare", "legendary", "artifact", ""
]);

const DND5E_ATTUNEMENT = new Set(["", "required", "optional"]);

const SLUG_RE = /^[a-z0-9-]+$/;
const ACTIVITY_KEY_RE = /^[a-zA-Z0-9]+$/;

export class ItemMintingService {

    /**
     * Validate and normalise item source data. Returns a deep copy.
     * Throws on hard validation failures (formula, enum, slug).
     *
     * @param {object} source
     * @param {object} [options]
     * @param {string} [options.moduleId]
     * @param {string} [options.recipeKey]
     * @param {"create"|"update"|"pack"} [options.mode]
     * @param {string} [options.systemId]
     * @returns {object}
     */
    static guard(source, options = {}) {
        return ItemMintingService.assertValid(source, options);
    }

    /**
     * Strict validation. Throws on failure.
     *
     * @param {object} source
     * @param {object} [options]
     * @returns {object}
     */
    static assertValid(source, options = {}) {
        if (!source || typeof source !== "object") {
            throw ItemMintingService._error("source must be a plain object", options);
        }

        const systemId = options.systemId
            ?? (typeof game !== "undefined" ? game?.system?.id : null)
            ?? "dnd5e";

        const clone = foundry?.utils?.deepClone
            ? foundry.utils.deepClone(source)
            : structuredClone(source);

        if (systemId === "dnd5e") {
            ItemMintingService._guardDnd5e(clone, options);
        }

        return clone;
    }

    /**
     * Validate a single formula string against the active system's parser.
     *
     * @param {string|null|undefined} formula
     * @param {object} [options]
     * @param {boolean} [options.deterministic=false]
     * @param {string} [options.fieldPath=""]
     * @returns {{ valid: boolean, error?: string, normalised?: string }}
     */
    static validateFormula(formula, options = {}) {
        const fieldPath = options.fieldPath ?? "";
        try {
            const normalised = ItemMintingService._normaliseFormulaString(formula);
            ItemMintingService._assertRollParsable(normalised, options.deterministic === true);
            return { valid: true, normalised };
        } catch (err) {
            return {
                valid: false,
                error: fieldPath
                    ? `${fieldPath}: ${err.message}`
                    : err.message
            };
        }
    }

    /**
     * Validate every item document in a batch. Throws on the first failure.
     * Does not mutate the input array.
     *
     * @param {object[]} sources
     * @param {object} [options]
     */
    static guardAll(sources, options = {}) {
        if (!Array.isArray(sources)) {
            throw ItemMintingService._error("sources must be an array", options);
        }
        for (let idx = 0; idx < sources.length; idx++) {
            const item = sources[idx];
            try {
                ItemMintingService.assertValid(item, options);
            } catch (err) {
                const label = item?.name ? `"${item.name}"` : `#${idx}`;
                err.message = `${err.message} (item: ${label})`;
                throw err;
            }
        }
    }

    /**
     * Validate an update patch shaped like Quartermaster promotion output.
     * Assembles nested system data from dot-path keys, then runs guard().
     *
     * @param {object} patch
     * @param {object} [options]
     * @returns {object} The original patch (unchanged). Throws on failure.
     */
    static guardPatch(patch, options = {}) {
        if (!patch || typeof patch !== "object") {
            throw ItemMintingService._error("patch must be a plain object", options);
        }

        const assembled = { name: patch.name, img: patch.img };
        const system = {};

        for (const [key, value] of Object.entries(patch)) {
            if (key === "name" || key === "img") continue;
            if (key.startsWith("system.")) {
                foundry.utils.setProperty(system, key.slice("system.".length), value);
            }
        }

        if (Object.keys(system).length) assembled.system = system;

        ItemMintingService.assertValid(assembled, options);
        return patch;
    }

    // ── dnd5e ────────────────────────────────────────────────────────

    /** @private */
    static _guardDnd5e(data, options) {
        const system = data.system;
        if (!system || typeof system !== "object") return;

        if ("rarity" in system) {
            ItemMintingService._assertEnum(
                system.rarity,
                DND5E_RARITIES,
                "system.rarity",
                options
            );
        }

        if ("attunement" in system) {
            ItemMintingService._assertEnum(
                system.attunement,
                DND5E_ATTUNEMENT,
                "system.attunement",
                options
            );
        }

        if (typeof system.identifier === "string" && system.identifier.length) {
            ItemMintingService._assertSlug(system.identifier, "system.identifier", options);
        }

        ItemMintingService._guardDamageBlock(system.damage, "system.damage", options);

        if (system.activities && typeof system.activities === "object") {
            for (const [actId, activity] of Object.entries(system.activities)) {
                if (actId && !SLUG_RE.test(actId) && !ACTIVITY_KEY_RE.test(actId)) {
                    throw ItemMintingService._error(
                        `system.activities key "${actId}" is not a valid identifier`,
                        options,
                        `system.activities.${actId}`
                    );
                }
                ItemMintingService._guardActivity(activity, `system.activities.${actId}`, options);
            }
        }
    }

    /** @private */
    static _guardDamageBlock(damage, path, options) {
        if (!damage || typeof damage !== "object") return;

        if (damage.base) {
            ItemMintingService._guardDamagePart(damage.base, `${path}.base`, options);
        }
        if (damage.versatile) {
            ItemMintingService._guardDamagePart(damage.versatile, `${path}.versatile`, options);
        }
        if ("bonus" in damage) {
            ItemMintingService._assertFormulaField(
                damage, "bonus", `${path}.bonus`, options
            );
        }
    }

    /** @private */
    static _guardDamagePart(part, path, options) {
        if (!part || typeof part !== "object") return;

        if ("bonus" in part) {
            ItemMintingService._assertFormulaField(part, "bonus", `${path}.bonus`, options);
        }

        const custom = part.custom;
        if (custom && typeof custom === "object" && "formula" in custom) {
            ItemMintingService._assertFormulaField(
                custom, "formula", `${path}.custom.formula`, options
            );
        }

        if (Array.isArray(part.types)) {
            for (let idx = 0; idx < part.types.length; idx++) {
                ItemMintingService._assertDamageType(part.types[idx], `${path}.types[${idx}]`, options);
            }
        }

        if (Array.isArray(part.parts)) {
            for (let idx = 0; idx < part.parts.length; idx++) {
                ItemMintingService._guardDamagePart(part.parts[idx], `${path}.parts[${idx}]`, options);
            }
        }
    }

    /** @private */
    static _guardActivity(activity, path, options) {
        if (!activity || typeof activity !== "object") return;

        const damage = activity.damage;
        if (damage?.parts?.length) {
            for (let idx = 0; idx < damage.parts.length; idx++) {
                ItemMintingService._guardDamagePart(
                    damage.parts[idx],
                    `${path}.damage.parts[${idx}]`,
                    options
                );
            }
        }

        const healing = activity.healing;
        if (healing) {
            if ("bonus" in healing) {
                ItemMintingService._assertFormulaField(
                    healing, "bonus", `${path}.healing.bonus`, options
                );
            }
            if (healing.custom && "formula" in healing.custom) {
                ItemMintingService._assertFormulaField(
                    healing.custom, "formula", `${path}.healing.custom.formula`, options
                );
            }
        }

        const targets = activity.consumption?.targets;
        if (Array.isArray(targets)) {
            for (let idx = 0; idx < targets.length; idx++) {
                const target = targets[idx];
                if (!target) continue;
                if ("value" in target) {
                    ItemMintingService._assertFormulaField(
                        target, "value", `${path}.consumption.targets[${idx}].value`, options
                    );
                }
                if (target.scaling && "formula" in target.scaling) {
                    ItemMintingService._assertFormulaField(
                        target.scaling,
                        "formula",
                        `${path}.consumption.targets[${idx}].scaling.formula`,
                        options
                    );
                }
            }
        }
    }

    /** @private */
    static _assertFormulaField(parent, key, fieldPath, options) {
        const result = ItemMintingService.validateFormula(parent[key], { fieldPath });
        if (!result.valid) {
            throw ItemMintingService._error(result.error ?? "invalid formula", options, fieldPath);
        }
        parent[key] = result.normalised;
    }

    /** @private */
    static _normaliseFormulaString(formula) {
        if (formula === null || formula === undefined) return "";
        if (typeof formula !== "string") {
            throw new Error("must be a string");
        }
        return formula.trim();
    }

    /**
     * Mirrors dnd5e FormulaField._validateType: substitute @refs, then evaluateSync.
     * @private
     */
    static _assertRollParsable(formula, deterministic) {
        if (formula === "") return;

        const RollClass = globalThis.Roll;
        if (!RollClass) {
            ItemMintingService._assertRollParsableFallback(formula);
            return;
        }

        const substituted = formula.replace(/@([a-z.0-9_-]+)/gi, "1");
        const roll = new RollClass(substituted);

        if (typeof roll.evaluateSync === "function") {
            roll.evaluateSync({ strict: false });
            if (deterministic && roll.isDeterministic === false) {
                throw new Error(`must not contain dice terms: ${formula}`);
            }
            return;
        }

        ItemMintingService._assertRollParsableFallback(substituted);
    }

    /** @private */
    static _assertRollParsableFallback(formula) {
        if (!formula) return;
        if (/\]/.test(formula) || /\[/.test(formula)) {
            throw new Error(`Expected "[", [%*/], [+\\-], [^ (){}[\\]$+\\-*/], end of input, or whitespace but "]" found.`);
        }
        if (!/^[\d\s+d+\-*/().]+$/i.test(formula)) {
            throw new Error("formula contains invalid characters");
        }
    }

    /** @private */
    static _assertDamageType(type, fieldPath, options) {
        if (!type || typeof type !== "string") return;
        const known = globalThis.CONFIG?.DND5E?.damageTypes
            ?? globalThis.CONFIG?.DND5E?.healingTypes;
        if (!known) return;
        if (!(type in known)) {
            throw ItemMintingService._error(`unknown damage type "${type}"`, options, fieldPath);
        }
    }

    /** @private */
    static _assertEnum(value, allowed, fieldPath, options) {
        if (typeof value !== "string") return;
        if (!allowed.has(value)) {
            throw ItemMintingService._error(`unknown value "${value}"`, options, fieldPath);
        }
    }

    /** @private */
    static _assertSlug(value, fieldPath, options) {
        if (!SLUG_RE.test(value)) {
            throw ItemMintingService._error(`invalid slug "${value}"`, options, fieldPath);
        }
    }

    /** @private */
    static _error(message, options, fieldPath = "") {
        const parts = [];
        if (options.moduleId) parts.push(options.moduleId);
        parts.push("ItemMintingService");
        const prefix = parts.join(" | ");
        const pathBit = fieldPath ? `${fieldPath}: ` : "";
        const recipeBit = options.recipeKey ? ` (recipe: ${options.recipeKey})` : "";
        return new Error(`${prefix}: ${pathBit}${message}${recipeBit}`);
    }
}
