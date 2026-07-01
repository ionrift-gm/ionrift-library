/**
 * Feed-the-party registration and dispatch for the cooking/feeding abstraction.
 *
 * Consumers register two kinds of plugin:
 *   - a provider, which knows how to serve a dish (build chat, roll temp HP,
 *     apply effects in its own house style);
 *   - a dish matcher, which recognises a dish item and supplies its buffs.
 *
 * When a dish is served, the kernel collects buffs from every matching dish
 * matcher, then hands the work to a registered provider. With no provider, a
 * Kernel default provider applies the buffs into the single shared slot
 * (`flags["ionrift-library"].cookingBuff`) and consumes the dish, so a
 * standalone module works with no extra wiring. Cross-owner writes route
 * through {@link CookingGMExec}.
 */

import { Logger } from "../Logger.js";
import { CookingBuffs, DEFAULT_COOKING_SLOT } from "./CookingBuffs.js";
import { BuffApplicator } from "./BuffApplicator.js";
import { CookingGMExec } from "./CookingGMExec.js";

/** @type {Map<string, object>} provider id -> provider */
const _providers = new Map();

/** @type {Map<string, object>} matcher id -> dish matcher */
const _dishMatchers = new Map();

/** @type {object|null} Replaceable kernel default provider. */
let _defaultProvider = null;

/**
 * Resolve a uuid to an Actor (handles token-actor wrapping).
 * @param {string} uuid
 * @returns {Promise<Actor|null>}
 */
async function resolveActor(uuid) {
    if (!uuid) return null;
    try {
        const doc = await fromUuid(uuid);
        return doc?.actor ?? doc ?? null;
    } catch {
        return null;
    }
}

export const CookingFeed = {
    /** Register socket handlers so relayed slot writes resolve on the GM. */
    init() {
        CookingGMExec.registerHandler("applyCookingBuff", async ({ actorUuid, effectData, slot }) => {
            const actor = await resolveActor(actorUuid);
            if (actor) await CookingFeed._writeSlotEffect(actor, effectData, slot);
        });
        CookingGMExec.registerHandler("clearCookingBuff", async ({ actorUuid, slot }) => {
            const actor = await resolveActor(actorUuid);
            if (actor) await CookingFeed._clearSlotEffects(actor, slot);
        });
        CookingGMExec.registerHandler("applyCookingBuffs", async ({ actorUuid, buffs, opts }) => {
            const actor = await resolveActor(actorUuid);
            if (actor) await BuffApplicator.applyBuffs(actor, buffs ?? [], opts ?? {});
        });
        if (!_defaultProvider) _defaultProvider = CookingFeed._buildDefaultProvider();
    },

    /**
     * Register a serving provider. A provider may declare `tracksRest: true` to
     * signal that it tracks rest cycles and clears the anti-overeating marker
     * itself (Respite does this). When such a provider is present, the kernel
     * enforces the block/no-replace gate; with no rest tracker, the kernel
     * replaces an existing meal buff instead, since nothing else would ever
     * clear it (standalone Monstrous Feast).
     * @param {{ id: string, canHandle: (item) => boolean, serve: (ctx) => Promise<any>, tracksRest?: boolean }} provider
     */
    registerProvider(provider) {
        if (!provider?.id || typeof provider.canHandle !== "function" || typeof provider.serve !== "function") {
            throw new Error("CookingFeed.registerProvider: { id, canHandle, serve } required.");
        }
        _providers.set(provider.id, provider);
    },

    /**
     * Whether a rest-tracking provider is registered. Drives the anti-overeating
     * branch: enforce block/no-replace only when something owns the rest cycle
     * and can clear the marker; otherwise replace on serve.
     * @returns {boolean}
     */
    tracksRest() {
        for (const provider of _providers.values()) {
            if (provider?.tracksRest === true) return true;
        }
        return false;
    },

    /**
     * Whether an actor already carries the anti-overeating marker.
     * @param {Actor|null} actor
     * @param {{ slot?: string }} [opts]
     * @returns {boolean}
     */
    isFed(actor, { slot } = {}) {
        return CookingBuffs.isWellFed(actor, { slot });
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    unregisterProvider(id) {
        return _providers.delete(id);
    },

    /**
     * Replace the kernel default provider used when no registered provider
     * handles a dish.
     * @param {{ serve: (ctx) => Promise<any> }} provider
     */
    registerDefaultProvider(provider) {
        if (typeof provider?.serve !== "function") {
            throw new Error("CookingFeed.registerDefaultProvider: provider.serve required.");
        }
        _defaultProvider = provider;
    },

    /**
     * Register a dish matcher.
     * @param {{ id: string, isDish: (item) => boolean, buffsFor: (item) => object[], onServed?: (ctx) => any }} matcher
     */
    registerDish(matcher) {
        if (!matcher?.id || typeof matcher.isDish !== "function" || typeof matcher.buffsFor !== "function") {
            throw new Error("CookingFeed.registerDish: { id, isDish, buffsFor } required.");
        }
        _dishMatchers.set(matcher.id, matcher);
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    unregisterDish(id) {
        return _dishMatchers.delete(id);
    },

    /**
     * Whether any registered dish matcher or provider recognises an item. Lets a
     * consumer's generic "Eat" action suppress or redirect to this pipeline.
     * @param {Item|object} item
     * @returns {boolean}
     */
    isManagedDish(item) {
        if (!item) return false;
        for (const matcher of _dishMatchers.values()) {
            try { if (matcher.isDish(item)) return true; } catch { /* ignore */ }
        }
        for (const provider of _providers.values()) {
            try { if (provider.canHandle(item)) return true; } catch { /* ignore */ }
        }
        return false;
    },

    /**
     * Collect buffs from every dish matcher that recognises the item.
     * @param {Item|object} item
     * @returns {object[]}
     */
    buffsForDish(item) {
        const buffs = [];
        for (const matcher of _dishMatchers.values()) {
            let isDish = false;
            try { isDish = matcher.isDish(item); } catch { isDish = false; }
            if (!isDish) continue;
            try {
                const found = matcher.buffsFor(item);
                if (Array.isArray(found)) buffs.push(...found);
            } catch (err) {
                Logger.warn("Library", `CookingFeed: dish matcher "${matcher.id}" buffsFor failed:`, err?.message ?? err);
            }
        }
        return buffs;
    },

    /**
     * Serve a dish to recipients. Collects buffs from dish matchers, then routes
     * to a registered provider or the kernel default provider.
     * @param {Item|object} item
     * @param {{ cookActor?: Actor, recipients?: Actor[], slot?: string, title?: string, consume?: boolean, opts?: object }} [args]
     * @returns {Promise<any>}
     */
    async serveDish(item, { cookActor = null, recipients = null, slot, title, consume, opts = {} } = {}) {
        const buffs = this.buffsForDish(item);
        const list = recipients ?? this._defaultRecipients();
        const provider = this._resolveProvider(item) ?? _defaultProvider ?? this._buildDefaultProvider();

        const ctx = {
            cookActor,
            item,
            recipients: list,
            buffs,
            opts: { ...opts, slot, title, consume }
        };

        const result = await provider.serve(ctx);

        for (const matcher of _dishMatchers.values()) {
            if (typeof matcher.onServed !== "function") continue;
            let isDish = false;
            try { isDish = matcher.isDish(item); } catch { isDish = false; }
            if (!isDish) continue;
            try { await matcher.onServed({ ...ctx, result }); } catch { /* ignore */ }
        }

        return result;
    },

    /**
     * Build the single-slot Active Effect document for an actor from a buff list.
     * @param {Actor} actor
     * @param {object[]} buffs
     * @param {{ item?: object, slot?: string, title?: string }} [meta]
     * @returns {object}
     */
    buildSlotEffect(actor, buffs, { item = null, slot, title } = {}) {
        return BuffApplicator.buildDnd5eSlotEffect(actor, buffs, { item, slot, title })
            ?? {
                name: title ?? (item?.name ? `Well Fed: ${item.name}` : "Well Fed"),
                img: item?.img ?? "icons/consumables/food/bowl-stew-brown.webp",
                origin: actor?.uuid,
                disabled: false,
                duration: { seconds: 0 },
                changes: [],
                description: "",
                flags: {}
            };
    },

    /**
     * Apply a prepared slot effect to an actor, routing cross-owner writes
     * through the responsible GM. Returns the route taken.
     * @param {Actor} actor
     * @param {object} effectData
     * @param {{ slot?: string }} [meta]
     * @returns {Promise<"local"|"relay"|"blocked">}
     */
    async applyToActor(actor, effectData, { slot } = {}) {
        const route = CookingGMExec.route({ isOwner: Boolean(actor?.isOwner) });
        if (route === "local") {
            await this._writeSlotEffect(actor, effectData, slot);
        } else if (route === "relay") {
            CookingGMExec.request("applyCookingBuff", { actorUuid: actor?.uuid, effectData, slot });
        }
        return route;
    },

    /**
     * Clear the shared slot on an actor, routing cross-owner removals through a
     * GM. Returns the route taken.
     * @param {Actor} actor
     * @param {{ slot?: string }} [meta]
     * @returns {Promise<"local"|"relay"|"blocked">}
     */
    async clearSlot(actor, { slot } = {}) {
        const route = CookingGMExec.route({ isOwner: Boolean(actor?.isOwner) });
        if (route === "local") {
            await this._clearSlotEffects(actor, slot);
        } else if (route === "relay") {
            CookingGMExec.request("clearCookingBuff", { actorUuid: actor?.uuid, slot });
        }
        return route;
    },

    /**
     * Clear the prior slot effect, then write the new one. The two writes run
     * together so the single slot never doubles up.
     * @private
     */
    async _writeSlotEffect(actor, effectData, slot) {
        if (!actor?.createEmbeddedDocuments) return;
        await BuffApplicator.clearCookingSlot(actor, { slot });
        if (effectData?.changes?.length) {
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
    },

    /**
     * Remove cooking-slot effects. When `slot` is given, only that slot is
     * cleared; otherwise every cooking-flagged effect is removed.
     * @private
     */
    async _clearSlotEffects(actor, slot) {
        await BuffApplicator.clearCookingSlot(actor, { slot });
    },

    /**
     * Reduce a served dish by one unit (or delete it). No-ops on plain payloads.
     * @private
     */
    async _consumeDish(item) {
        if (!item || typeof item.update !== "function") return;
        const qty = Number(item.system?.quantity ?? 1);
        if (qty > 1) await item.update({ "system.quantity": qty - 1 });
        else if (typeof item.delete === "function") await item.delete();
    },

    /** @private */
    _resolveProvider(item) {
        for (const provider of _providers.values()) {
            try { if (provider.canHandle(item)) return provider; } catch { /* ignore */ }
        }
        return null;
    },

    /** @private */
    _defaultRecipients() {
        const members = game?.ionrift?.library?.party?.getMembers?.();
        return Array.isArray(members) ? members.filter(Boolean) : [];
    },

    /**
     * The Kernel default provider: apply buffs into the shared slot and consume
     * the dish. Used when no consumer provider handles the item.
     *
     * Anti-overeating branch (per recipient):
     *   - A rest-tracking provider is registered: a recipient who already carries
     *     the marker is skipped (block, no replace). The tracker clears the marker
     *     on rest, so the recipient eats again next cycle.
     *   - No rest-tracking provider (standalone): replace the prior meal buff.
     *     Nothing else would ever clear it, so replacement is the safe fallback.
     * @private
     */
    _buildDefaultProvider() {
        return {
            id: "ionrift-library:default",
            canHandle: () => true,
            async serve({ item, recipients = [], buffs = [], opts = {} }) {
                const applied = [];
                const skipped = [];
                const enforceGate = CookingFeed.tracksRest();
                for (const actor of recipients) {
                    if (!actor) continue;
                    if (enforceGate && CookingFeed.isFed(actor, { slot: opts.slot })) {
                        skipped.push({ actorId: actor.id ?? null, reason: "well-fed" });
                        continue;
                    }

                    if (BuffApplicator.systemId() === "pf2e") {
                        const pf2eResult = await BuffApplicator.applyBuffsRouted(actor, buffs, {
                            item,
                            slot: opts.slot,
                            title: opts.title,
                            clearSlot: true
                        });
                        if (pf2eResult.applied && pf2eResult.route !== "blocked") {
                            applied.push({ actorId: actor.id ?? null, route: pf2eResult.route });
                        } else {
                            skipped.push({ actorId: actor.id ?? null, reason: pf2eResult.route === "blocked" ? "needs-gm" : "no-automation" });
                        }
                        continue;
                    }

                    const effectData = CookingFeed.buildSlotEffect(actor, buffs, {
                        item,
                        slot: opts.slot,
                        title: opts.title
                    });
                    const route = await CookingFeed.applyToActor(actor, effectData, { slot: opts.slot });
                    if (route !== "blocked") applied.push({ actorId: actor.id ?? null, route });
                }
                if (item && opts.consume !== false && applied.length) await CookingFeed._consumeDish(item);
                return { applied, skipped, buffs };
            }
        };
    },

    /** @private test helper */
    _reset() {
        _providers.clear();
        _dishMatchers.clear();
        _defaultProvider = null;
    }
};
