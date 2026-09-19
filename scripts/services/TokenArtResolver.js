/**
 * TokenArtResolver - Shared token art convention for the Ionrift Suite.
 * 
 * Defines a standard folder convention for token art and provides a
 * non-blocking, multi-tier fallback path lookup API consumed across the suite.
 * 
 * Convention:  tokens/ionrift/{species}/{role}/
 * Example:     tokens/ionrift/dwarf/merchant/token_01.webp
 * 
 * Fallback Chain:
 * 1. Exact Title Match:    tokens/ionrift/{species}/{role}/
 * 2. Canonical Archetype:  tokens/ionrift/{species}/{archetype}/
 * 3. Species Loose Art:    tokens/ionrift/{species}/
 * 4. Generic Role:         tokens/ionrift/generic/{role}/
 * 5. Generic Archetype:    tokens/ionrift/generic/{archetype}/
 * 6. Generic Loose Art:    tokens/ionrift/generic/
 * 7. Overlay Pack Art:     ionrift-data/overlays/... (via OverlayService)
 * 8. Neutral Vector Glyph: modules/ionrift-library/assets/glyphs/{archetype}.svg
 * 9. Absolute Failsafe:    icons/svg/mystery-man.svg
 */
import { PlatformHelper } from "./platform/PlatformHelper.js";
import { OverlayService } from "./packs/OverlayService.js";
import { AvatarRegistryService } from "./AvatarRegistryService.js";
import { MODULE_ID } from "../data/moduleId.js";

export class TokenArtResolver {

    /** Default root folder for all Ionrift-managed token art */
    static DEFAULT_ROOT = "tokens/ionrift";

    /** Bundled neutral vector glyphs root */
    static GLYPHS_ROOT = "modules/ionrift-library/assets/glyphs";

    /** Default fallback image */
    static FALLBACK = "icons/svg/mystery-man.svg";

    /** Standard species folders */
    static SPECIES = [
        "human", "elf", "dwarf", "halfling", "gnome", "orc",
        "half-elf", "half-orc", "tiefling", "dragonborn", "goblin", "drow"
    ];

    /** Standard archetype folders */
    static ARCHETYPES = [
        "guard", "soldier", "merchant", "noble", "thief",
        "priest", "scholar", "performer", "laborer", "beggar", "artisan", "commoner"
    ];

    /** Internal cache map: folderPath -> string[] */
    static _cache = new Map();

    /** Overlay cache map: key -> string[] */
    static _overlayCache = new Map();

    /** Cache state */
    static _cacheReady = false;
    static _warmingPromise = null;

    /**
     * Resolves the active root directory from world settings.
     * @returns {string} Root folder path (e.g. "tokens/ionrift")
     */
    static get ROOT() {
        return this.getRootPath();
    }

    static getRootPath() {
        try {
            if (typeof game !== "undefined" && game.settings?.get) {
                const configured = game.settings.get(MODULE_ID, "tokenArtRoot");
                if (configured && typeof configured === "string") {
                    return configured.replace(/^\/+|\/+$/g, "");
                }
            }
        } catch {
            // Settings not yet initialized; use default
        }
        return this.DEFAULT_ROOT;
    }

    /**
     * Maps an arbitrary occupation/role string to a canonical token archetype.
     * @param {string} role 
     * @returns {string} Canonical archetype (e.g. "guard", "merchant", "noble")
     */
    static getCanonicalArchetype(role) {
        if (!role) return "commoner";
        const r = role.toLowerCase().trim().replace(/[-_]/g, " ");

        // 1. Martial Archetypes
        if (/(guard|watchman|militia|sentry|patrol|gatekeeper|sentinel)/.test(r)) return "guard";
        if (/(soldier|warrior|grunt|raider|skirmisher|infantry|spearman|shieldbearer|vanguard|ironclad|berserker)/.test(r)) return "soldier";
        if (/(sergeant|veteran|scout|hunter|tracker|outrider|spellsword|spellblade|bladesinger|wayfarer)/.test(r)) return "soldier";
        if (/(knight|champion|captain|paladin|warmaster)/.test(r)) return "soldier";

        // 2. Civic Commerce & Trade
        if (/(merchant|trader|peddler|grocer|vendor|innkeeper|tavernkeeper|barkeeper|shopkeeper|tribute)/.test(r)) return "merchant";
        if (/(artisan|blacksmith|smith|baker|brewer|mason|carpenter|weaver|tanner|cobbler|gemcutter|runesmith)/.test(r)) return "artisan";

        // 3. Civic Leadership & Elite
        if (/(noble|aristocrat|official|mayor|magistrate|lord|lady|archon|elder|headman|councillor|guildmaster|thane|chieftain|warboss|warlord)/.test(r)) return "noble";

        // 4. Sacred & Mystical
        if (/(priest|cleric|acolyte|monk|cultist|shaman|witch doctor|healer|druid|oracle|divine)/.test(r)) return "priest";
        if (/(scholar|scribe|alchemist|wizard|mage|sage|librarian|tutor|astrologer|herbalist)/.test(r)) return "scholar";

        // 5. Shadow & Outlaw
        if (/(thief|pickpocket|cutpurse|smuggler|thug|bandit|marauder|outlaw|rogue|infiltrator)/.test(r)) return "thief";
        if (/(assassin|spy|poisoner|shadowblade|shadow-stalker|bounty hunter)/.test(r)) return "thief";
        if (/(beggar|urchin|drunkard|outcast|scavenger|vagrant|casteless)/.test(r)) return "beggar";

        // 6. Entertainment
        if (/(performer|bard|jester|actor|dancer|minstrel|circus|troubadour|chanter)/.test(r)) return "performer";

        // 7. Base Labor & Commoner
        if (/(laborer|worker|miner|delver|quarryman|farmer|peasant|villager|youth|child|clansman|thrall)/.test(r)) return "laborer";

        return "commoner";
    }

    /**
     * Returns the built-in neutral vector SVG glyph path for an archetype.
     * @param {string} archetype 
     * @returns {string} Path to SVG glyph
     */
    static getNeutralGlyph(archetype) {
        const arch = (archetype || "citizen").toLowerCase().trim();
        const validGlyphs = [
            "citizen", "guard", "soldier", "merchant", "noble",
            "priest", "scholar", "thief", "artisan", "performer",
            "beggar", "commoner"
        ];
        const selected = validGlyphs.includes(arch) ? arch : "citizen";
        return `${this.GLYPHS_ROOT}/${selected}.svg`;
    }

    /**
     * Adaptive, non-blocking asynchronous cache warming.
     * Starts at ROOT: if missing, exits immediately in 1 browse call (~15ms).
     * Only crawls existing directories and yields microtasks to prevent Electron lockups.
     * 
     * @param {Object} [options]
     * @param {boolean} [options.force=false] Force full re-crawl
     * @returns {Promise<void>}
     */
    static async warmCache({ force = false } = {}) {
        if (this._cacheReady && !force) return;
        if (this._warmingPromise) return this._warmingPromise;

        this._warmingPromise = (async () => {
            const FP = PlatformHelper.FP;
            if (!FP) {
                this._cacheReady = true;
                return;
            }

            const root = this.getRootPath();
            const source = PlatformHelper.fileSource;

            if (force || !this._cache) {
                this._cache = new Map();
                this._overlayCache = new Map();
            }

            console.log(`Ionrift Library | Scanning token art at: ${root}...`);

            try {
                // Step 1: Probe root directory. If missing, complete immediately.
                let rootResult;
                try {
                    rootResult = await FP.browse(source, root);
                } catch {
                    // Root doesn't exist; world is fresh or unpopulated.
                    this._cacheReady = true;
                    console.log(`Ionrift Library | Token root '${root}' not found. Defaulting to neutral glyphs.`);
                    return;
                }

                // Step 2: Record root loose files
                const rootImages = (rootResult.files || []).filter(f => this._isImage(f));
                this._cache.set(root, rootImages);

                // Step 3: Top-down adaptive crawl of existing subdirectories
                const dirQueue = [...(rootResult.dirs || [])];

                while (dirQueue.length > 0) {
                    const currentDir = dirQueue.shift();

                    // Yield event loop between folder reads to prevent UI hitching
                    await new Promise(resolve => setTimeout(resolve, 0));

                    try {
                        const dirResult = await FP.browse(source, currentDir);
                        const images = (dirResult.files || []).filter(f => this._isImage(f));
                        this._cache.set(currentDir, images);

                        // Enqueue subdirectories (e.g. role folders inside species)
                        if (dirResult.dirs && dirResult.dirs.length > 0) {
                            dirQueue.push(...dirResult.dirs);
                        }
                    } catch {
                        this._cache.set(currentDir, []);
                    }
                }

                // Step 4: Index active content overlays via OverlayService if present
                await this._warmOverlayPacks();

                this._cacheReady = true;
                console.log(`Ionrift Library | Token art cache ready (${this._cache.size} folders indexed).`);
            } catch (err) {
                console.warn("Ionrift Library | Error during token art cache crawl:", err);
                this._cacheReady = true;
            } finally {
                this._warmingPromise = null;
            }
        })();

        return this._warmingPromise;
    }

    /**
     * Checks installed content overlays via OverlayService and indexes any art files.
     * @private
     */
    static async _warmOverlayPacks() {
        try {
            const FP = PlatformHelper.FP;
            if (!FP) return;
            const source = PlatformHelper.fileSource;

            // Check standard overlay directories for ionrift-civics and ionrift-library
            const overlayCandidates = [
                `${OverlayService.OVERLAY_ROOT}/ionrift-civics/core/tokens`,
                `${OverlayService.OVERLAY_ROOT}/ionrift-civics/tokens`,
                `${OverlayService.OVERLAY_ROOT}/ionrift-library/tokens`
            ];

            for (const cand of overlayCandidates) {
                try {
                    const res = await FP.browse(source, cand);
                    if (res?.files?.length > 0) {
                        const images = res.files.filter(f => this._isImage(f));
                        this._overlayCache.set(cand, images);
                    }
                } catch {
                    // Candidate overlay not installed; normal condition.
                }
            }
        } catch {
            // Ignore overlay scan issues
        }
    }

    /**
     * Multi-tier resolution ladder for resident/citizen token art.
     * 
     * @param {string} species - Species name (e.g. "orc", "dwarf", "human")
     * @param {string} role - Occupation/title (e.g. "Blood-Guard", "Watchman")
     * @param {Object} [options] - Additional contextual query options
     * @param {string} [options.archetype] - Normalized canonical archetype (e.g. "guard")
     * @param {string} [options.identity] - Presentation/Identity tag (e.g. "masculine", "feminine")
     * @returns {Promise<string>} Image file path or fallback
     */
    static async getTokenPath(species, role, options = {}) {
        const root = this.getRootPath();
        const speciesKey = (species || "generic").toLowerCase().trim();
        const roleKey = role ? role.toLowerCase().trim().replace(/[-_]/g, " ") : "";
        const roleFolderKey = roleKey.replace(/\s+/g, "-");
        const archetypeKey = options.archetype
            ? options.archetype.toLowerCase().trim()
            : this.getCanonicalArchetype(roleKey);

        // 0. Curated Avatar Registry Query (Highest priority: GMs hand-picked or auto-cataloged tokens)
        try {
            const registryTokens = AvatarRegistryService.getTokensFor(speciesKey, archetypeKey || roleKey);
            if (registryTokens.length > 0) {
                return this._pickRandom(registryTokens);
            }
        } catch {
            // Registry query optional
        }

        // If cache isn't warm yet, return neutral glyph instantly (never freeze mid-roll)
        if (!this._cacheReady && this._cache.size === 0) {
            return this.getNeutralGlyph(archetypeKey);
        }

        // 1. Exact Species + Exact Role Title: tokens/ionrift/{species}/{role}/
        if (roleKey) {
            const exact = this._getFilesFromCache(`${root}/${speciesKey}/${roleFolderKey}`)
                || this._getFilesFromCache(`${root}/${speciesKey}/${roleKey}`);
            if (exact.length > 0) return this._pickRandom(exact);
        }

        // 2. Exact Species + Canonical Archetype: tokens/ionrift/{species}/{archetype}/
        if (archetypeKey) {
            const canonSpecies = this._getFilesFromCache(`${root}/${speciesKey}/${archetypeKey}`);
            if (canonSpecies.length > 0) return this._pickRandom(canonSpecies);
        }

        // 3. Species Root Loose Files: tokens/ionrift/{species}/
        const speciesLoose = this._getFilesFromCache(`${root}/${speciesKey}`);
        if (speciesLoose.length > 0) return this._pickRandom(speciesLoose);

        // 4. Generic Species + Exact Role Title: tokens/ionrift/generic/{role}/
        if (roleKey) {
            const genericRole = this._getFilesFromCache(`${root}/generic/${roleFolderKey}`)
                || this._getFilesFromCache(`${root}/generic/${roleKey}`);
            if (genericRole.length > 0) return this._pickRandom(genericRole);
        }

        // 5. Generic Species + Canonical Archetype: tokens/ionrift/generic/{archetype}/
        if (archetypeKey) {
            const genericCanon = this._getFilesFromCache(`${root}/generic/${archetypeKey}`);
            if (genericCanon.length > 0) return this._pickRandom(genericCanon);
        }

        // 6. Generic Root Loose Files: tokens/ionrift/generic/
        const genericLoose = this._getFilesFromCache(`${root}/generic`);
        if (genericLoose.length > 0) return this._pickRandom(genericLoose);

        // 7. Overlay Pack Art (Installed Content Overlays)
        const overlayArt = this._resolveOverlayArt(speciesKey, archetypeKey);
        if (overlayArt) return overlayArt;

        // 8. Built-in Handcrafted Neutral Vector SVG Glyph
        return this.getNeutralGlyph(archetypeKey);
    }

    /**
     * Check if any custom art exists for a species/role combination.
     * @param {string} species 
     * @param {string} role 
     * @returns {Promise<boolean>}
     */
    static async hasCustomArt(species, role) {
        const path = await this.getTokenPath(species, role);
        return !path.startsWith(this.GLYPHS_ROOT) && path !== this.FALLBACK;
    }

    /**
     * Scaffold the standard directory skeleton on GM startup or on demand.
     * Idempotently creates root, standard species folders, generic/ with core archetypes,
     * and a helpful README.txt explaining conventions.
     */
    static async scaffoldFolders() {
        const FP = PlatformHelper.FP;
        if (!FP) return;
        const source = PlatformHelper.fileSource;
        const root = this.getRootPath();

        console.log(`Ionrift Library | Scaffolding token art directories at '${root}'...`);

        // Create root
        await PlatformHelper.ensureDirectory(root, source);

        // Create species directories
        for (const sp of this.SPECIES) {
            await PlatformHelper.ensureDirectory(`${root}/${sp}`, source);
        }

        // Create generic directory and core archetypes
        const genericArchetypes = ["guard", "soldier", "merchant", "noble", "thief", "commoner"];
        for (const arch of genericArchetypes) {
            await PlatformHelper.ensureDirectory(`${root}/generic/${arch}`, source);
        }

        // Create README.txt explaining conventions
        const readmeContent = [
            "Ionrift Token Art Directory",
            "===========================",
            "",
            "Drop your portrait and token art into this directory structure.",
            "Ionrift modules automatically scan and resolve matching tokens using this fallback order:",
            "",
            "1. Specific Species & Role:   tokens/ionrift/{species}/{role}/      (e.g. dwarf/merchant/token1.webp)",
            "2. Species & Archetype:       tokens/ionrift/{species}/{archetype}/ (e.g. dwarf/guard/token1.webp)",
            "3. Species Loose Art:         tokens/ionrift/{species}/             (e.g. dwarf/dwarf_portrait.webp)",
            "4. Generic Role:              tokens/ionrift/generic/{role}/        (e.g. generic/merchant/token1.webp)",
            "5. Generic Archetype:         tokens/ionrift/generic/{archetype}/   (e.g. generic/guard/token1.webp)",
            "6. Generic Loose Art:         tokens/ionrift/generic/               (e.g. generic/commoner.webp)",
            "",
            "Supported formats: .webp, .png, .jpg, .svg",
            "Standard species: human, elf, dwarf, halfling, gnome, orc, half-elf, half-orc, tiefling, dragonborn, goblin, drow",
            "Standard archetypes: guard, soldier, merchant, noble, thief, priest, scholar, performer, laborer, beggar, artisan, commoner"
        ].join("\n");

        try {
            const readmeFile = new File([readmeContent], "README.txt", { type: "text/plain" });
            await FP.upload(source, root, readmeFile, {});
        } catch {
            // README write optional
        }

        console.log("Ionrift Library | Token art folder structure ready.");
        await this.warmCache({ force: true });
    }

    /**
     * Invalidate and reload the art cache.
     */
    static async refreshCache() {
        this._cacheReady = false;
        await this.warmCache({ force: true });
    }

    // ---- Internal Helpers ----

    static _getFilesFromCache(path) {
        if (!this._cache) return [];
        // Support paths with and without trailing slash or slight normalization variations
        const normalized = path.replace(/\/+$/, "");
        return this._cache.get(normalized) || this._cache.get(`${normalized}/`) || [];
    }

    static _resolveOverlayArt(speciesKey, archetypeKey) {
        if (!this._overlayCache || this._overlayCache.size === 0) return null;
        for (const [folder, files] of this._overlayCache.entries()) {
            const matching = files.filter(f => {
                const lower = f.toLowerCase();
                return lower.includes(speciesKey) || lower.includes(archetypeKey);
            });
            if (matching.length > 0) {
                return this._pickRandom(matching);
            }
        }
        return null;
    }

    static _isImage(path) {
        return /\.(png|jpe?g|webp|gif|svg)$/i.test(path);
    }

    static _pickRandom(arr) {
        if (!arr || arr.length === 0) return this.FALLBACK;
        return arr[Math.floor(Math.random() * arr.length)];
    }
}
