/**
 * RollModeResolver
 * Resolves the active client roll/message mode across Foundry v13 (rollMode) and v14 (messageMode),
 * including Ionrift QOL's Half-Blind mode ("halfblind").
 */

const V14_TO_V13 = {
    public: "publicroll",
    gm: "gmroll",
    blind: "blindroll",
    self: "selfroll",
    halfblind: "halfblind"
};

const V13_TO_V14 = {
    publicroll: "public",
    gmroll: "gm",
    blindroll: "blind",
    selfroll: "self",
    halfblind: "halfblind"
};

/**
 * Reads the current client's active roll mode setting from Foundry core settings.
 * @returns {string} Raw setting value (e.g. "public", "publicroll", "blind", "blindroll", "halfblind")
 */
export function getClientRollMode() {
    const settings = globalThis.game?.settings;
    if (!settings || typeof settings.get !== "function") return "public";

    try {
        if (settings.settings?.has?.("core.messageMode")) {
            const msgMode = settings.get("core", "messageMode");
            if (msgMode) return String(msgMode);
        }
    } catch {
        /* ignore */
    }

    try {
        const rollMode = settings.get("core", "rollMode");
        if (rollMode) return String(rollMode);
    } catch {
        /* ignore */
    }

    return "public";
}

/**
 * Resolves a requested roll mode (where "client" or null/undefined reads the active client's setting)
 * into normalized v13 (`rollMode`) and v14 (`messageMode`) strings plus visibility flags.
 *
 * @param {string|null|undefined} [requestedMode="client"]
 * @param {{ treatHalfBlindAsBlind?: boolean }} [options]
 * @returns {{ mode: string, rollMode: string, messageMode: string, isBlind: boolean, isGmWhisper: boolean, isSelf: boolean }}
 */
export function resolveRollMode(requestedMode = "client", { treatHalfBlindAsBlind = false } = {}) {
    let raw = (!requestedMode || requestedMode === "client")
        ? getClientRollMode()
        : String(requestedMode);

    raw = raw.toLowerCase().trim();

    let canonical = V13_TO_V14[raw] ?? (V14_TO_V13[raw] ? raw : "public");

    if (treatHalfBlindAsBlind && canonical === "halfblind") {
        canonical = "blind";
    }

    const rollMode = V14_TO_V13[canonical] ?? "publicroll";
    const messageMode = canonical;

    return {
        mode: canonical,
        rollMode,
        messageMode,
        isBlind: canonical === "blind",
        isGmWhisper: canonical === "gm" || canonical === "blind",
        isSelf: canonical === "self"
    };
}

/**
 * Builds the `roll.toMessage(messageData, createOptions)` second argument (`createOptions`)
 * compatible with Foundry v13 (`rollMode`) and v14 (`messageMode`).
 *
 * @param {string|null|undefined} [requestedMode="client"]
 * @param {{ treatHalfBlindAsBlind?: boolean }} [options]
 * @returns {{ rollMode?: string, messageMode?: string }}
 */
export function messageOptionsForMode(requestedMode = "client", options = {}) {
    const resolved = resolveRollMode(requestedMode, options);
    const generation = Number(globalThis.game?.release?.generation ?? 13);
    if (generation >= 14) {
        return { messageMode: resolved.messageMode };
    }
    return { rollMode: resolved.rollMode };
}

/**
 * Applies resolved roll mode (`whisper`, `blind`, `rollMode`) onto a `ChatMessage.create` data payload.
 * Used when posting custom HTML cards (`ChatMessage.create({ content, rolls })`) so that visibility
 * and Dice So Nice animations honor the rolling client's roll mode.
 *
 * @param {object} chatData
 * @param {string|null|undefined} [requestedMode="client"]
 * @param {{ treatHalfBlindAsBlind?: boolean }} [options]
 * @returns {object} New chatData object with visibility fields populated
 */
export function applyRollModeToChatData(chatData = {}, requestedMode = "client", options = {}) {
    const resolved = resolveRollMode(requestedMode, options);
    const out = { ...chatData };

    const gmIds = () => {
        const users = globalThis.game?.users;
        if (!users) return [];
        const gms = typeof users.filter === "function"
            ? users.filter((u) => u.isGM).map((u) => u.id)
            : [];
        if (gms.length === 0 && globalThis.game?.user?.isGM && globalThis.game?.user?.id) {
            return [globalThis.game.user.id];
        }
        return gms;
    };

    if (resolved.isBlind) {
        out.whisper = out.whisper ?? gmIds();
        out.blind = true;
    } else if (resolved.mode === "gm") {
        out.whisper = out.whisper ?? gmIds();
        if (out.blind === undefined) out.blind = false;
    } else if (resolved.isSelf) {
        const selfId = globalThis.game?.user?.id;
        out.whisper = out.whisper ?? (selfId ? [selfId] : []);
        if (out.blind === undefined) out.blind = false;
    }

    if (out.rollMode === undefined) {
        out.rollMode = resolved.rollMode;
    }

    if (typeof globalThis.ChatMessage?.applyRollMode === "function" && !out.whisper && !out.blind) {
        try {
            globalThis.ChatMessage.applyRollMode(out, resolved.rollMode);
        } catch {
            /* ignore if custom mode like halfblind is not recognized by applyRollMode */
        }
    }

    return out;
}
