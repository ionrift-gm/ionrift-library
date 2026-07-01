/**
 * Applies resolved IonriftBuff descriptors to actors per system.
 *
 * dnd5e: one shared-slot Active Effect (existing CookingFeed shape).
 * pf2e: Effect items carrying rule elements, flagged on the cooking slot.
 */

import { Logger } from "../Logger.js";
import { CookingBuffs, COOKING_BUFF_FLAG_NAMESPACE as NS, COOKING_BUFF_FLAG as FLAG, COOKING_SLOT_FLAG as SLOT, DEFAULT_COOKING_SLOT, LONG_REST_FALLBACK_SECONDS, SHORT_REST_FALLBACK_SECONDS } from "./CookingBuffs.js";

function activeSystemId() {
    return game?.system?.id ?? "unknown";
}

function isDnd5e() {
    return activeSystemId() === "dnd5e";
}

function isPf2e() {
    return activeSystemId() === "pf2e";
}

/**
 * Roll limited-use charges onto a buff copy when a uses formula is present.
 * @param {object} buff
 * @returns {Promise<object>}
 */
async function prepareBuffCharges(buff) {
    if (!buff?.uses || !globalThis.Roll) return buff;
    if (!["save_bonus", "check_advantage", "resistance"].includes(buff.type)) return buff;
    try {
        const roll = await new Roll(String(buff.uses)).evaluate();
        const charges = Math.max(1, roll.total);
        return { ...buff, chargesRemaining: charges, chargesMax: charges };
    } catch {
        return buff;
    }
}

function mergeSlotFlags(payload, slot, extraFlags = {}) {
    const out = globalThis.foundry?.utils?.deepClone
        ? foundry.utils.deepClone(payload)
        : structuredClone(payload);
    out.flags = out.flags ?? {};
    out.flags[NS] = {
        ...(out.flags[NS] ?? {}),
        [FLAG]: true,
        [SLOT]: slot ?? DEFAULT_COOKING_SLOT,
        ...(extraFlags[NS] ?? {})
    };
    for (const [key, value] of Object.entries(extraFlags)) {
        if (key === NS) continue;
        out.flags[key] = { ...(out.flags[key] ?? {}), ...value };
    }
    return out;
}

export const BuffApplicator = {
    systemId: activeSystemId,

    /**
     * Whether any buff in the list can be applied with automation on this system.
     * @param {object[]} buffs
     * @returns {boolean}
     */
    hasAutomatableBuffs(buffs) {
        for (const buff of buffs ?? []) {
            if (!buff?.type) continue;
            const fidelity = CookingBuffs.fidelity(buff);
            if (fidelity === "manual") continue;
            const resolved = CookingBuffs.resolve(null, buff);
            if (resolved?.immediateFlag) continue;
            if (isDnd5e() && resolved?.changes?.length) return true;
            if (isPf2e() && resolved?.effectItems?.length) return true;
        }
        return false;
    },

    /**
     * Advisory lines for buffs that need manual tracking or approximation notes.
     * @param {object[]} buffs
     * @returns {string[]}
     */
    advisoryLines(buffs) {
        const lines = [];
        for (const buff of buffs ?? []) {
            const fidelity = CookingBuffs.fidelity(buff);
            const resolved = CookingBuffs.resolve(null, buff);
            if (fidelity === "approximate" && resolved?.manualNote) {
                lines.push(resolved.manualNote);
            } else if (fidelity === "manual") {
                const note = resolved?.manualNote ?? CookingBuffs.degradeNote(buff);
                if (note) lines.push(note);
            }
        }
        return [...new Set(lines)];
    },

    /**
     * Build a single-slot dnd5e Active Effect from buff descriptors.
     * @param {Actor} actor
     * @param {object[]} buffs
     * @param {{ item?: object, slot?: string, title?: string, extraFlags?: object }} [meta]
     * @returns {object|null}
     */
    buildDnd5eSlotEffect(actor, buffs, { item = null, slot, title, extraFlags = {} } = {}) {
        const changes = [];
        const descriptions = [];
        const daeSpecial = [];
        const list = buffs ?? [];
        const shortRestWindow = list.some(buff => buff?.duration === "untilShortRest");

        for (const buff of list) {
            const built = CookingBuffs.build(actor, buff);
            if (!built || built.immediate) continue;
            if (built.changes.length) changes.push(...built.changes);
            if (built.description) descriptions.push(built.description);
            if (built.daeSpecialDuration?.length) daeSpecial.push(...built.daeSpecialDuration);
        }

        if (!changes.length && !descriptions.length) return null;

        const slotFlags = {
            [FLAG]: true,
            [SLOT]: slot ?? DEFAULT_COOKING_SLOT
        };
        if (shortRestWindow) slotFlags.expiresOnShortRest = true;

        const flags = { [NS]: { ...slotFlags } };
        for (const [key, value] of Object.entries(extraFlags)) {
            flags[key] = { ...(flags[key] ?? {}), ...value };
        }
        if (daeSpecial.length) {
            flags.dae = { specialDuration: [...new Set(daeSpecial)] };
        }

        const seconds = shortRestWindow ? SHORT_REST_FALLBACK_SECONDS : LONG_REST_FALLBACK_SECONDS;

        return {
            name: title ?? (item?.name ? `Well Fed: ${item.name}` : "Well Fed"),
            img: item?.img ?? "icons/consumables/food/bowl-stew-brown.webp",
            origin: actor?.uuid,
            disabled: false,
            duration: { seconds },
            changes,
            description: descriptions.join(" "),
            flags
        };
    },

    /**
     * Build pf2e Effect item payloads from buff descriptors.
     * @param {Actor} actor
     * @param {object[]} buffs
     * @param {{ slot?: string, extraFlags?: object }} [meta]
     * @returns {object[]}
     */
    buildPf2eEffectItems(actor, buffs, { slot, extraFlags = {} } = {}) {
        const items = [];
        for (const buff of buffs ?? []) {
            const built = CookingBuffs.build(actor, buff);
            if (!built || built.immediate) continue;
            for (const payload of built.effectItems ?? []) {
                items.push(mergeSlotFlags(payload, slot, extraFlags));
            }
        }
        return items;
    },

    /**
     * Remove prior cooking-slot effects (AE on dnd5e, Effect items on pf2e).
     * @param {Actor} actor
     * @param {{ slot?: string }} [opts]
     */
    async clearCookingSlot(actor, { slot } = {}) {
        if (!actor) return;

        const aeIds = (actor.effects ?? []).filter(effect => {
            const f = effect.flags?.[NS];
            if (f?.[FLAG] !== true) return false;
            if (slot && f?.[SLOT] && f[SLOT] !== slot) return false;
            return true;
        }).map(effect => effect.id);

        if (aeIds.length && actor.deleteEmbeddedDocuments) {
            await actor.deleteEmbeddedDocuments("ActiveEffect", aeIds);
        }

        const itemIds = (actor.items ?? []).filter(item => {
            const f = item.flags?.[NS];
            if (f?.[FLAG] !== true && f?.cookingBuffEffect !== true) return false;
            if (slot && f?.[SLOT] && f[SLOT] !== slot) return false;
            return true;
        }).map(item => item.id);

        if (itemIds.length && actor.deleteEmbeddedDocuments) {
            await actor.deleteEmbeddedDocuments("Item", itemIds);
        }
    },

    /**
     * Apply buff descriptors to an actor on the active system.
     * @param {Actor} actor
     * @param {object[]} buffs
     * @param {{ item?: object, slot?: string, title?: string, extraFlags?: object, clearSlot?: boolean }} [opts]
     * @returns {Promise<{ applied: boolean, lines: string[], approximateNotes: string[], effectData?: object, effectItems?: object[] }>}
     */
    async applyBuffs(actor, buffs, { item = null, slot, title, extraFlags = {}, clearSlot = true } = {}) {
        const prepared = [];
        for (const buff of buffs ?? []) {
            if (!buff?.type) continue;
            prepared.push(await prepareBuffCharges(buff));
        }

        const lines = [];
        const approximateNotes = this.advisoryLines(prepared);

        if (!actor?.createEmbeddedDocuments) {
            return { applied: false, lines, approximateNotes };
        }

        if (clearSlot) await this.clearCookingSlot(actor, { slot });

        if (isDnd5e()) {
            const effectData = this.buildDnd5eSlotEffect(actor, prepared, { item, slot, title, extraFlags });
            if (!effectData?.changes?.length) {
                return { applied: false, lines, approximateNotes };
            }
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
            for (const buff of prepared) {
                const built = CookingBuffs.build(actor, buff);
                if (built?.summaryLine) lines.push(`${actor.name}: ${built.summaryLine}`);
            }
            return { applied: true, lines, approximateNotes, effectData };
        }

        if (isPf2e()) {
            const effectItems = this.buildPf2eEffectItems(actor, prepared, { slot, extraFlags });
            if (!effectItems.length) {
                return { applied: false, lines, approximateNotes };
            }
            await actor.createEmbeddedDocuments("Item", effectItems);
            for (const buff of prepared) {
                const built = CookingBuffs.build(actor, buff);
                if (built?.summaryLine) lines.push(`${actor.name}: ${built.summaryLine}`);
            }
            return { applied: true, lines, approximateNotes, effectItems };
        }

        Logger.warn("Library", `BuffApplicator: no apply path for system "${activeSystemId()}".`);
        return { applied: false, lines, approximateNotes };
    }
};
