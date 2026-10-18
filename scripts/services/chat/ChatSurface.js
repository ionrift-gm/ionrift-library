/**
 * ChatSurface: markup builders for anything Ionrift puts in the chat log.
 * Paint lives in styles/chat-surface.css. Callers still post with
 * ChatMessage.create; this only shapes the HTML.
 *
 *   const { chat } = game.ionrift.library;
 *   chat.chip("HIT", { tone: "success", icon: "fa-bullseye", upper: true });
 *   chat.card({ title: "Spike Trap", icon: "fa-burst", body: "<p>...</p>" });
 */

/** @typedef {"neutral"|"die"|"success"|"danger"|"warning"|"info"|"arcane"} ChipTone */
/** @typedef {"arcane"|"gold"|"danger"|"success"|"info"|"neutral"} CardTone */
/** @typedef {"default"|"primary"|"secondary"|"danger"|"gold"} ButtonTone */

export const CHIP_TONES = Object.freeze(["neutral", "die", "success", "danger", "warning", "info", "arcane"]);
export const CARD_TONES = Object.freeze(["arcane", "gold", "danger", "success", "info", "neutral"]);
export const BUTTON_TONES = Object.freeze(["default", "primary", "secondary", "danger", "gold"]);
export const CARD_ROOT_CLASSES = Object.freeze([
    "ionrift-chat-card",
    "ionrift-pacing-card",
    "ionrift-qol-chat",
    "tripwire-chat-card",
    "cw-removal-card",
    "ionrift-quiz-chat",
    "ionrift-nemesis-chat-card",
    "ionrift-cache-card",
    "mf-butcher-card",
    "mf-share-card"
]);

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

/** @param {unknown} value */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/** @param {string|undefined} icon */
function iconHtml(icon) {
    if (!icon) return "";
    const cls = /(^|\s)(fa[srlbd]?|fa-(solid|regular|light|thin|brands|duotone))(\s|$)/.test(icon) ? icon : `fas ${icon}`;
    return `<i class="${escapeHtml(cls)}"></i>`;
}

export const ChatSurface = {
    CHIP_TONES,
    CARD_TONES,
    BUTTON_TONES,
    CARD_ROOT_CLASSES,

    /**
     * Opaque pill. Safe inside any card, light or dark.
     * @param {string|number} text  Plain text, escaped.
     * @param {{ tone?: ChipTone, icon?: string, title?: string, upper?: boolean, className?: string }} [opts]
     */
    chip(text, { tone = "neutral", icon, title, upper = false, className = "" } = {}) {
        const t = CHIP_TONES.includes(tone) ? tone : "neutral";
        const classes = ["ionrift-chat-chip", `ionrift-chat-chip--${t}`];
        if (upper) classes.push("ionrift-chat-chip--upper");
        if (className) classes.push(className);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<span class="${classes.join(" ")}"${titleAttr}>${iconHtml(icon)}${icon ? " " : ""}${escapeHtml(text)}</span>`;
    },

    /**
     * Number or short value dropped into someone else's card. Inherits the
     * card's own text colour.
     * @param {string|number} text
     * @param {{ className?: string }} [opts]
     */
    value(text, { className = "" } = {}) {
        const cls = className ? `ionrift-chat-value ${className}` : "ionrift-chat-value";
        return `<span class="${cls}">${escapeHtml(text)}</span>`;
    },

    /**
     * Centered row for a value plus chips.
     * @param {...string} parts  Trusted HTML from chip() / value().
     */
    row(...parts) {
        return `<div class="ionrift-chat-row">${parts.filter(Boolean).join("")}</div>`;
    },

    /**
     * Action button inside an Ionrift chat card, protected against unlayered
     * foreign class overrides (.primary / .secondary).
     * @param {string} text  Plain text label, escaped.
     * @param {{ tone?: ButtonTone, icon?: string, action?: string, className?: string }} [opts]
     */
    button(text, { tone = "default", icon, action, className = "" } = {}) {
        const t = BUTTON_TONES.includes(tone) ? tone : "default";
        const classes = ["ionrift-chat-btn"];
        if (t !== "default") classes.push(`ionrift-chat-btn--${t}`);
        if (className) classes.push(className);
        const toneAttr = t !== "default" ? ` data-tone="${t}"` : "";
        const actionAttr = action ? ` data-action="${escapeHtml(action)}"` : "";
        return `<button type="button" class="${classes.join(" ")}"${toneAttr}${actionAttr}>${iconHtml(icon)}${icon ? " " : ""}${escapeHtml(text)}</button>`;
    },

    /**
     * A card we own, on the shared dark card palette.
     * @param {{ title?: string, icon?: string, tone?: CardTone, body?: string, footer?: string, className?: string }} opts
     *   title is plain text (escaped). body and footer are trusted HTML.
     */
    card({ title, icon, tone = "arcane", body = "", footer = "", className = "" } = {}) {
        const t = CARD_TONES.includes(tone) ? tone : "arcane";
        const cls = className ? `ionrift-chat-card ${className}` : "ionrift-chat-card";
        const header = title
            ? `<header class="ionrift-chat-card__header">${iconHtml(icon)}<span>${escapeHtml(title)}</span></header>`
            : "";
        const foot = footer ? `<footer class="ionrift-chat-card__footer">${footer}</footer>` : "";
        return `<div class="${cls}" data-tone="${t}">${header}${body}${foot}</div>`;
    },

    escape: escapeHtml
};
