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

export const CHIP_TONES = Object.freeze(["neutral", "die", "success", "danger", "warning", "info", "arcane"]);
export const CARD_TONES = Object.freeze(["arcane", "gold", "danger", "success", "info", "neutral"]);

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
