import { emptyResolvedEffect } from "../buffs/ResolvedEffect.js";
import { TYPES } from "../buffs/BuffTypeRegistry.js";

/** @param {import("../buffs/CookingBuffs.js").IonriftBuff} buff @param {string} [summaryLine] */
export function manualAdvisory(buff, summaryLine = "") {
    const summary = summaryLine || TYPES.get(buff?.type)?.label || buff?.type || "";
    const duration = buff?.duration === "untilShortRest"
        ? "until the next short rest or 4 hours, whichever comes first"
        : "until the next long rest";
    return summary
        ? `Gains ${summary} ${duration} (track manually).`
        : "Gains a meal buff (track manually).";
}

// Unimplemented: manual + advisory; never empty silence.
export class IonriftBuffAdapter {
    get systemId() {
        throw new Error("IonriftBuffAdapter: systemId not implemented");
    }

    fidelity(buff) {
        return "manual";
    }

    resolve(actor, buff, ctx = {}) {
        const summary = buff?.type ? TYPES.get(buff.type)?.label ?? buff.type : "";
        return emptyResolvedEffect({
            summaryLine: summary,
            manualNote: manualAdvisory(buff, summary)
        });
    }

    degradeNote(buff) {
        return manualAdvisory(buff, this.resolve(null, buff).summaryLine);
    }
}
