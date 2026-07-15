import { Logger } from "../../platform/Logger.js";
import { CookingBuffs, DEFAULT_COOKING_SLOT } from "../buffs/CookingBuffs.js";
import { BuffApplicator } from "../buffs/BuffApplicator.js";
import { CookingGMExec } from "./CookingGMExec.js";

/** @type {Map<string, object>} provider id to provider */
const _providers = new Map();

/** @type {Map<string, object>} matcher id to dish matcher */
const _dishMatchers = new Map();

/** @type {object|null} Replaceable kernel default provider. */
let _defaultProvider = null;

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

    registerProvider(provider) {
        if (!provider?.id || typeof provider.canHandle !== "function" || typeof provider.serve !== "function") {
            throw new Error("CookingFeed.registerProvider: { id, canHandle, serve } required.");
        }
        _providers.set(provider.id, provider);
    },

    tracksRest() {
        for (const provider of _providers.values()) {
            if (provider?.tracksRest === true) return true;
        }
        return false;
    },

    isFed(actor, { slot } = {}) {
        return CookingBuffs.isWellFed(actor, { slot });
    },

    unregisterProvider(id) {
        return _providers.delete(id);
    },

    registerDefaultProvider(provider) {
        if (typeof provider?.serve !== "function") {
            throw new Error("CookingFeed.registerDefaultProvider: provider.serve required.");
        }
        _defaultProvider = provider;
    },

    registerDish(matcher) {
        if (!matcher?.id || typeof matcher.isDish !== "function" || typeof matcher.buffsFor !== "function") {
            throw new Error("CookingFeed.registerDish: { id, isDish, buffsFor } required.");
        }
        _dishMatchers.set(matcher.id, matcher);
    },

    unregisterDish(id) {
        return _dishMatchers.delete(id);
    },

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

    async applyToActor(actor, effectData, { slot } = {}) {
        const route = CookingGMExec.route({ isOwner: Boolean(actor?.isOwner) });
        if (route === "local") {
            await this._writeSlotEffect(actor, effectData, slot);
        } else if (route === "relay") {
            CookingGMExec.request("applyCookingBuff", { actorUuid: actor?.uuid, effectData, slot });
        }
        return route;
    },

    async clearSlot(actor, { slot } = {}) {
        const route = CookingGMExec.route({ isOwner: Boolean(actor?.isOwner) });
        if (route === "local") {
            await this._clearSlotEffects(actor, slot);
        } else if (route === "relay") {
            CookingGMExec.request("clearCookingBuff", { actorUuid: actor?.uuid, slot });
        }
        return route;
    },

    // Clear then write so the single slot never doubles.
    async _writeSlotEffect(actor, effectData, slot) {
        if (!actor?.createEmbeddedDocuments) return;
        await BuffApplicator.clearCookingSlot(actor, { slot });
        if (effectData?.changes?.length) {
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        }
    },

    // No slot key: clear every cooking-flagged effect.
    async _clearSlotEffects(actor, slot) {
        await BuffApplicator.clearCookingSlot(actor, { slot });
    },

    async _consumeDish(item) {
        if (!item || typeof item.update !== "function") return;
        const qty = Number(item.system?.quantity ?? 1);
        if (qty > 1) await item.update({ "system.quantity": qty - 1 });
        else if (typeof item.delete === "function") await item.delete();
    },

    _resolveProvider(item) {
        for (const provider of _providers.values()) {
            try { if (provider.canHandle(item)) return provider; } catch { /* ignore */ }
        }
        return null;
    },

    _defaultRecipients() {
        const members = game?.ionrift?.library?.party?.getMembers?.();
        return Array.isArray(members) ? members.filter(Boolean) : [];
    },

    // tracksRest provider: block if already fed; else replace (nothing clears the marker).
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

    _reset() {
        _providers.clear();
        _dishMatchers.clear();
        _defaultProvider = null;
    }
};
