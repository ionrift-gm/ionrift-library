import { IonriftBuffAdapter } from "../IonriftBuffAdapter.js";
import { emptyResolvedEffect } from "../ResolvedEffect.js";
import { TYPES, activeAdapter } from "../BuffTypeRegistry.js";

/** Buff types with native dnd5e Active Effect mapping. */
const NATIVE_TYPES = new Set([
    "temp_hp", "heal", "exhaustion_save", "hit_die", "advantage", "resistance",
    "sense_darkvision", "check_advantage", "skill_advantage", "passive_perception",
    "ability_bonus", "save_bonus"
]);

export class Dnd5eBuffAdapter extends IonriftBuffAdapter {
    get systemId() { return "dnd5e"; }

    fidelity(buff) {
        if (!buff?.type || !TYPES.has(buff.type)) return "manual";
        if (TYPES.get(buff.type)?.immediate) return "native";
        return NATIVE_TYPES.has(buff.type) ? "native" : "manual";
    }

    resolve(actor, buff, ctx = {}) {
        if (!buff?.type) return emptyResolvedEffect();
        const meta = TYPES.get(buff.type);
        if (!meta) {
            return emptyResolvedEffect({
                manualNote: "Gains a meal buff (track manually)."
            });
        }

        const built = meta.render(actor, buff, activeAdapter()) ?? {};
        const changes = Array.isArray(built.changes) ? built.changes : [];
        const immediateFlag = Boolean(meta.immediate);

        return emptyResolvedEffect({
            changes: immediateFlag ? [] : changes,
            daeSpecial: built.daeSpecialDuration ?? [],
            description: built.description ?? "",
            summaryLine: built.summaryLine ?? "",
            fidelity: this.fidelity(buff),
            manualNote: null,
            roll: built.roll ?? null,
            chargesRemaining: built.chargesRemaining ?? null,
            chargesMax: built.chargesMax ?? null,
            immediateFlag
        });
    }
}
