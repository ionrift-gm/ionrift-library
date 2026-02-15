import { classifyCreature } from "../creatureClassifier.js";

export class ClassifierValidatorApp extends FormApplication {
    constructor(options = {}) {
        super(null, options);
        this._results = [];
        this.currentPage = 1;
        this.itemsPerPage = 50;
        this._filterQuery = "";
        this._filterMode = "all";
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "ionrift-classifier-validator",
            title: "Entity Manifest",
            template: "modules/ionrift-library/templates/classifier-validator.hbs",
            width: 800,
            height: 600,
            resizable: true,
            classes: ["ionrift-window", "glass-ui"]
        });
    }

    async _updateObject(event, formData) {
        // No settings to save
    }

    async getData() {
        // If results are empty (first load), scan
        if (this._results.length === 0) {
            await this._scanActors();
        }

        // 1. Filter
        const query = (this._filterQuery || "").toLowerCase();
        const mode = this._filterMode || "all";

        let filtered = this._results.filter(r => {
            // Text Search
            if (query && !r.name.toLowerCase().includes(query)) return false;
            // Confidence Mode
            // Low (Needs Review): < 0.6 (Critical/Degraded)
            if (mode === "low" && r.confidence >= 0.6) return false;

            // Med (Uncertain): 0.6 <= x < 0.8 (Good but not Excellent)
            if (mode === "med" && (r.confidence < 0.6 || r.confidence >= 0.8)) return false;

            return true;
        });

        // 2. Sort (Alphabetical A-Z by default)
        filtered.sort((a, b) => a.name.localeCompare(b.name));


        // 3. Paginate
        const totalItems = filtered.length;
        const totalPages = Math.ceil(totalItems / this.itemsPerPage);
        this.currentPage = Math.min(Math.max(1, this.currentPage), totalPages || 1);

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const paginated = filtered.slice(startIndex, endIndex);

        // Calculate Statistics (Global for Dashboard)
        let stats = { mean: 0, median: 0, total: this._results.length, identified: 0 };
        if (this._results.length > 0) {
            const sum = this._results.reduce((acc, r) => acc + r.confidence, 0);
            stats.mean = Math.round((sum / this._results.length) * 100);

            // Count "Identified" (Confidence >= 0.8)
            stats.identified = this._results.filter(r => r.confidence >= 0.8).length;
            stats.integrity = stats.mean; // Alias for template

            // Integrity Classification
            if (stats.mean >= 80) {
                stats.integrityLabel = "Excellent";
                stats.integrityClass = "success";
            } else if (stats.mean >= 60) {
                stats.integrityLabel = "Good";
                stats.integrityClass = "success"; // Still green-ish
            } else if (stats.mean >= 40) {
                stats.integrityLabel = "Degraded";
                stats.integrityClass = "warning";
            } else {
                stats.integrityLabel = "Critical"; // < 40%
                stats.integrityClass = "error";
            }
        }

        return {
            results: paginated,
            stats: stats,
            pagination: {
                current: this.currentPage,
                total: totalPages,
                hasPrev: this.currentPage > 1,
                hasNext: this.currentPage < totalPages,
                totalItems: totalItems,
                startItem: totalItems === 0 ? 0 : startIndex + 1,
                endItem: Math.min(endIndex, totalItems)
            },
            filters: {
                query: this._filterQuery,
                mode: this._filterMode
            }
        };
    }

    async _scanActors() {
        this._results = [];
        ui.notifications.info("Ionrift | Scanning Entity Manifest...");

        let actors = [];

        // 1. World Actors (Full Data)
        if (game.actors) {
            const worldActors = game.actors
                .filter(a => a.type !== 'character')
                .map(a => ({
                    ...this._classifyData(a),
                    source: "World"
                }));
            actors = actors.concat(worldActors);
        }

        // 2. Compendium Scan (Smart & Robust)
        const sysId = game.system.id;
        const targetPacks = game.packs.filter(p => {
            if (p.documentName !== "Actor") return false;
            const id = p.metadata.id;
            const label = p.metadata.label.toLowerCase();

            // DnD5e: Standard SRD
            if (sysId === "dnd5e" && id === "dnd5e.monsters") return true;

            // Daggerheart: Look for standard "adversaries" pack
            if (sysId === "daggerheart" && (id.includes("adversaries") || label.includes("adversaries"))) return true;

            return false;
        });

        for (const pack of targetPacks) {
            // Fetch necessary fields including system-specific details
            const index = await pack.getIndex({
                fields: [
                    "system.details.type",
                    "system.details.alignment",
                    "system.details.biography",
                    "system.ancestry",      // Daggerheart
                    "system.description"    // Common
                ]
            });
            const packActors = index.map(i => ({
                ...this._classifyData(i),
                source: pack.metadata.label,
                uuid: i.uuid
            }));
            actors = actors.concat(packActors);
        }

        // Exclude Players/Characters
        this._results = actors.filter(r => r.classId !== "player");
    }

    _classifyData(actorOrIndex) {
        const classification = classifyCreature(actorOrIndex);
        const score = classification.confidence;

        let scoreClass = "score-low";
        if (score >= 0.8) scoreClass = "score-high";
        else if (score >= 0.6) scoreClass = "score-med";

        return {
            actorId: actorOrIndex.id || actorOrIndex._id,
            name: actorOrIndex.name || "Unknown Entity",
            img: actorOrIndex.img || "icons/svg/mystery-man.svg",
            classId: this._formatClassId(classification.id),
            soundKey: this._formatSoundKey(classification.sound),
            confidence: score,
            confidencePct: Math.round(score * 100),
            scoreClass: scoreClass,
            tags: Array.from(classification.tags).join(", ")
        };
    }

    _formatClassId(id) {
        if (!id || id === "unknown") return "Unknown";
        // Convert "monstrosity_owlbear" -> "Monstrosity (Owlbear)"
        // or "beast_ursine" -> "Beast (Ursine)"
        // or just Title Case if simple
        const parts = id.split("_");
        if (parts.length > 1) {
            const main = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
            const sub = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
            return `${main} (${sub})`;
        }
        return id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");
    }

    _formatSoundKey(key) {
        if (!key) return "—";
        if (key === "MONSTER_GENERIC") return "Generic Monster";
        if (key === "NPC_GENERIC") return "Generic NPC";
        // "syrinscape:element:1234" -> "Syrinscape Element"
        if (key.startsWith("syrinscape:")) return "Syrinscape Element";
        return key.replace(/_/g, " ");
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Filter Logic
        const filterInput = html.find("#validator-search");
        const filterSelect = html.find("#confidence-filter");

        // Restore State
        filterInput.val(this._filterQuery);
        filterSelect.val(this._filterMode);

        const onFilterChange = () => {
            this._filterQuery = filterInput.val();
            this._filterMode = filterSelect.val();
            this.currentPage = 1; // Reset to page 1
            this.render();
        };

        filterInput.on("change", onFilterChange); // Only update on Enter/Blur to avoid focus loss
        filterSelect.on("change", onFilterChange);

        // Pagination Controls
        html.find(".page-prev").click(() => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.render();
            }
        });

        html.find(".page-next").click(() => {
            // Max page check is handled in getData, but good to check here too
            this.currentPage++;
            this.render();
        });

        // Open Sheet
        html.find(".actor-link").click(async (ev) => {
            const id = $(ev.currentTarget).data("id");
            const uuid = $(ev.currentTarget).data("uuid");

            let doc;
            if (uuid) doc = await fromUuid(uuid);
            else doc = game.actors.get(id);

            if (doc) doc.sheet.render(true);
        });

        // Re-Scan
        html.find("#refresh-validator").click(async () => {
            await this._scanActors();
            this.render();
        });

        // Export All (Low Confidence)
        const btn = html.find("#export-json");
        btn.html(`<i class="fas fa-file-export"></i> Export All`);

        btn.click(async (ev) => {
            const btn = $(ev.currentTarget);
            const icon = btn.html();
            btn.html('<i class="fas fa-spinner fa-spin"></i>');

            try {
                // Get current filter mode from the dropdown
                const filterMode = html.find("#confidence-filter").val();

                // Filter based on the selected mode
                // Filter based on the selected mode
                const filteredList = this._results.filter(r => {
                    if (filterMode === "low") return r.confidence < 0.8;
                    if (filterMode === "med") return r.confidence < 1.0;
                    return true; // "all"
                });

                const lowConf = [];
                for (const r of filteredList) {
                    // Attempt to fetch actor (sync for World, async for SRD/Compendium)
                    let actor = game.actors.get(r.actorId);
                    if (!actor && r.uuid) {
                        try {
                            actor = await fromUuid(r.uuid);
                        } catch (e) {
                            console.warn(`Ionrift | Could not fetch actor ${r.name}`, e);
                        }
                    }

                    let description = "";
                    let itemsData = "";

                    if (actor) {
                        // Handles standard D&D5e/System 'description' logic
                        // Some systems use system.details.biography.value, others just biography
                        const paths = [
                            "system.description.value",
                            "system.details.biography.value",
                            "system.biography.value",
                            "system.description",
                            "system.biography",
                            "system.notes.value",
                            "system.details.notes.value"
                        ];

                        let descHTML = "";
                        for (const path of paths) {
                            const val = foundry.utils.getProperty(actor, path);
                            if (val && typeof val === "string" && val.length > 5) {
                                descHTML = val;
                                break;
                            }
                        }

                        if (descHTML) {
                            // Strip HTML
                            const tmp = document.createElement("DIV");
                            tmp.innerHTML = descHTML;
                            description = tmp.textContent || tmp.innerText || "";
                            description = description.replace(/\s+/g, ' ').trim(); // Clean whitespace
                        }

                        // Extract Items (Attacks/Abilities) for Context
                        if (actor.items) {
                            const itemNames = actor.items.map(i => i.name).join(", ");
                            const itemDescs = actor.items.map(i => {
                                const val = i.system?.description?.value || "";
                                // Strip HTML
                                const tmp = document.createElement("DIV");
                                tmp.innerHTML = val;
                                return (tmp.textContent || tmp.innerText || "").substring(0, 100);
                            }).join(" ");
                            itemsData = (itemNames + " " + itemDescs).replace(/\s+/g, ' ').trim().substring(0, 500);
                        }
                    }

                    // Push processed record
                    lowConf.push({
                        name: r.name,
                        detectedId: r.classId,
                        confidence: r.confidence,
                        tags: r.tags,
                        source: r.source, // Include source for debugging
                        ...(description ? { description: description.substring(0, 300) } : {}),
                        ...(itemsData ? { items: itemsData } : {})
                    });
                }

                if (lowConf.length === 0) {
                    ui.notifications.info("No low confidence actors found to export!");
                    return;
                }

                const json = JSON.stringify(lowConf, null, 2);

                // Show Dialog to bypass async clipboard restriction
                new Dialog({
                    title: "Export Low Confidence Data",
                    content: `<p>Copy this JSON to share with the developers:</p><textarea style="width:100%; height:300px; font-family:monospace;">${json}</textarea>`,
                    buttons: {
                        copy: {
                            icon: '<i class="fas fa-copy"></i>',
                            label: "Copy to Clipboard",
                            callback: (html) => {
                                const text = html.find("textarea").val();
                                game.clipboard.copyPlainText(text);
                                ui.notifications.info("Copied to clipboard!");
                            }
                        },
                        close: {
                            icon: '<i class="fas fa-check"></i>',
                            label: "Close"
                        }
                    },
                    default: "close"
                }).render(true);

            } catch (err) {
                console.error(err);
                ui.notifications.error("Export generation failed. See Console.");
            } finally {
                btn.html(icon);
            }
        });
    }
}
