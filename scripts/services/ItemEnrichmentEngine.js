/**
 * ItemEnrichmentEngine
 *
 * Kernel-level service that manages a registry of item enrichments and
 * injects styled mechanical-notes blocks into Foundry VTT item sheets.
 *
 * Any Ionrift module (Respite, Quartermaster, future modules) can register
 * enrichment data via `register()` or `registerBatch()`. The engine
 * handles all hook wiring, DOM targeting, and rendering.
 *
 * Registry keys are normalised (curly apostrophes collapsed, lowercased)
 * so lookups work for SRD items regardless of smart-quote variants.
 * Example: "Cook\u2019s Utensils" and "Cook's Utensils" resolve identically.
 *
 * Hook support:
 *   - renderItemSheet       (legacy dnd5e v2 / AppV1)
 *   - renderItemSheet5e     (dnd5e v3 ApplicationV2, 4-arg signature)
 *   - renderItemSheet5e2    (dnd5e v3 alternate class name)
 */
export class ItemEnrichmentEngine {

    /**
     * Internal registry map.
     * Keys are lowercase item names; values are { html, tags }.
     * @type {Map<string, {html: string, tags: string[]}>}
     */
    static _registry = new Map();

    // ──────────────────────────────────────────────────────────────────
    // Internal helpers
    // ──────────────────────────────────────────────────────────────────

    /**
     * Normalise an item name for use as a registry key.
     * Collapses Unicode apostrophe variants (\u2018 \u2019 \u201A \u2032)
     * and typographic single-quotes to a plain ASCII apostrophe, then
     * lowercases. This ensures SRD items like \u201cCook\u2019s Utensils\u201d
     * match a registration that used a straight apostrophe, and vice versa.
     * @param {string} name
     * @returns {string}
     */
    static _normalize(name) {
        return name
            .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
            .toLowerCase();
    }

    // ──────────────────────────────────────────────────────────────────
    // Registration API
    // ──────────────────────────────────────────────────────────────────

    /**
     * Register a single enrichment entry.
     * @param {string} itemName - Item display name (case-insensitive key)
     * @param {{ html: string, tags?: string[] }} data
     */
    static register(itemName, data) {
        if (!itemName || !data?.html) {
            console.warn("ItemEnrichmentEngine | register() called with invalid data:", itemName, data);
            return;
        }
        this._registry.set(this._normalize(itemName), data);
    }

    /**
     * Register multiple entries at once.
     * @param {Object<string, {html: string, tags?: string[]}>} map - Plain object keyed by item name
     */
    static registerBatch(map) {
        if (!map || typeof map !== "object") return;
        for (const [name, data] of Object.entries(map)) {
            this.register(name, data);
        }
    }

    // ──────────────────────────────────────────────────────────────────
    // Lookup API
    // ──────────────────────────────────────────────────────────────────

    /**
     * Look up enrichment data by item name.
     * @param {string} itemName
     * @returns {{ html: string, tags: string[] } | null}
     */
    static get(itemName) {
        if (!itemName) return null;
        return this._registry.get(this._normalize(itemName)) ?? null;
    }

    /**
     * Returns all registered item names (for debugging / inspection).
     * @returns {string[]}
     */
    static getRegisteredNames() {
        return [...this._registry.keys()];
    }

    // ──────────────────────────────────────────────────────────────────
    // Hook Handler
    // ──────────────────────────────────────────────────────────────────

    /**
     * Hook handler for renderItemSheet / renderItemSheet5e (ApplicationV2).
     * Injects a styled Ionrift enrichment block into the item description pane.
     *
     * AppV1 signature: (app, jQueryHtml, data)
     * AppV2 signature: (app, htmlElement, context, options)
     *
     * @param {Application} app
     * @param {jQuery|HTMLElement} html
     */
    static onRenderItemSheet(app, html, ...rest) {
        const item = app.document ?? app.object ?? app.item;
        if (!item?.name) return;
        // Only process Item documents
        if (item.documentName && item.documentName !== "Item") return;

        const enrichment = ItemEnrichmentEngine.get(item.name);
        if (!enrichment) return;

        // Resolve the root HTMLElement.
        // AppV2:  html IS the HTMLElement directly
        // AppV1:  html is a jQuery object — unwrap with [0]
        // Fallback: try app.element (AppV2 stores rendered DOM here)
        let root;
        if (html instanceof HTMLElement) {
            root = html;
        } else if (typeof jQuery !== "undefined" && html instanceof jQuery) {
            root = html[0];
        } else if (app.element instanceof HTMLElement) {
            root = app.element;
        } else if (app.element?.[0] instanceof HTMLElement) {
            root = app.element[0];
        } else {
            root = html;
        }

        if (!root?.querySelector) {
            console.warn("ItemEnrichmentEngine | Cannot resolve root element for:", item.name);
            return;
        }

        // Guard: don't inject twice on re-renders
        if (root.querySelector(".ionrift-enrichment")) return;

        // Selector chain: most specific (dnd5e v3) → legacy → broad fallback.
        // dnd5e v3 confirmed: section.description.tab > .card.description.collapsible
        //                       > .details.collapsible-content
        const selectors = [
            ".card.description .collapsible-content",
            ".card.description .details",
            "section.description.tab",
            "section.tab[data-tab='description']",
            ".tab.description",
            ".tab[data-tab='description']",
            "[data-tab='description']",
            ".editor-content",
            ".editor",
            "form"
        ];

        let target = null;
        for (const sel of selectors) {
            const el = root.querySelector(sel);
            if (el) {
                target = el;
                break;
            }
        }

        if (!target) {
            console.warn("ItemEnrichmentEngine | No injection target for:", item.name);
            return;
        }

        const enrichDiv = document.createElement("div");
        enrichDiv.className = "ionrift-enrichment";

        // Prepend the campground icon before <strong>Respite:</strong> (or any
        // module's prefix) — callers should include their own prefix text.
        enrichDiv.innerHTML = enrichment.html.replace(
            /<strong>([^<]+):<\/strong>/,
            `<i class="fas fa-campground"></i> <strong>$1:</strong>`
        );

        target.insertBefore(enrichDiv, target.firstChild);
    }
}
