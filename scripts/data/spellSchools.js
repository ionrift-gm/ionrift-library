/**
 * Canonical spell school normalization.
 * Maps known system abbreviations and variants to full lowercase names.
 */
export const SPELL_SCHOOL_MAP = {
    abj: "abjuration",
    con: "conjuration",
    div: "divination",
    enc: "enchantment",
    evo: "evocation",
    ill: "illusion",
    nec: "necromancy",
    trs: "transmutation",
    // Common variants and alternates
    tra: "transmutation",
    evoc: "evocation"
};

/**
 * Normalizes a spell school abbreviation or string.
 * @param {string|null} code  e.g. "evo", "nec", "evocation"
 * @returns {string|null}     e.g. "evocation", "necromancy", or null
 */
export function normalizeSpellSchool(code) {
    if (!code) return null;
    const lower = String(code).trim().toLowerCase();
    return SPELL_SCHOOL_MAP[lower] ?? lower;
}
