import { emptyResolvedEffect } from "./ResolvedEffect.js";
import { TYPES } from "./BuffTypeRegistry.js";

/** @param {import("./CookingBuffs.js").IonriftBuff} buff @param {string} [summaryLine] */
export function manualAdvisory(buff, summaryLine = "") {
    const summary = summaryLine || TYPES.get(buff?.type)?.label || buff?.type || "";
    const duration = buff?.duration === "untilShortRest"
        ? "until the next short rest or 4 hours, whichever comes first"
        : "until the next long rest";
    return summary
        ? `Gains ${summary} ${duration} (track manually).`
        : "Gains a meal buff (track manually).";
}

/**
 * Base class for per-system IonriftBuff resolution.
 * Subclasses implement fidelity() and resolve(); unimplemented paths degrade
 * to manual with an advisory note, never silent emptiness.
 */
export class IonriftBuffAdapter {
    /** @returns {string} */
    get systemId() {
        throw new Error("IonriftBuffAdapter: systemId not implemented");
    }

    /**
     * @param {import("./CookingBuffs.js").IonriftBuff} buff
     * @returns {"native"|"approximate"|"manual"}
     */
    fidelity(buff) {
        return "manual";
    }

    /**
     * @param {Actor|null} actor
     * @param {import("./CookingBuffs.js").IonriftBuff} buff
     * @param {object} [ctx]
     * @returns {import("./ResolvedEffect.js").ResolvedEffect}
     */
    resolve(actor, buff, ctx = {}) {
        const summary = buff?.type ? TYPES.get(buff.type)?.label ?? buff.type : "";
        return emptyResolvedEffect({
            summaryLine: summary,
            manualNote: manualAdvisory(buff, summary)
        });
    }

    /**
     * @param {import("./CookingBuffs.js").IonriftBuff} buff
     * @returns {string}
     */
    degradeNote(buff) {
        return manualAdvisory(buff, this.resolve(null, buff).summaryLine);
    }
}
