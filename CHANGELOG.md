# Changelog

## [1.7.1] - 2026-04-16

### Added
- **Patreon Connection panel.** The settings menu button now opens a full panel showing your tier and any available early-access modules. Modules you qualify for show an Install Now button; modules that need a higher tier are visible but locked, so you can see what's coming with an upgrade.
- **Early-access badge** on the Patreon Connection settings button. Appears when an early-access offer was snoozed and is still waiting. Clicking it opens the panel directly.
- `PackRegistryService.clearSnooze()` — internal utility for resetting a snoozed offer when the GM acts on it.

### Changed
- Disconnect now styled in amber across the Patreon Connection panel for clarity.

## [1.6.1] - 2026-04-15

### Fixed
- JSON pack importer now accepts packs that predate the manifest schema. Previously any pack without a `_manifest` block was rejected with a schema error. Legacy packs now import in a compatibility mode - the `onImport` callback still runs, no version metadata is stored.

## [1.6.0] - 2026-04-15

### Added
*   **Content Pack Versioning.** Packs now embed version manifests. Installed pack versions are tracked and checked against a public registry on startup (GM only, once per day max).
*   **Pack Update Notifications.** When a newer version is available, GMs see a notification with a Patreon download link. If Ionrift Cloud is connected, a one-click update button appears instead.
*   **Cloud Pack Downloads.** Authenticated downloads via presigned URLs with streaming progress bar and cancel support.
*   **JSON Pack Importer.** Content packs can ship as standalone JSON files. Consumer modules call `game.ionrift.library.importJsonPack()` with a schema validator callback.
*   **Module Installer.** Early-access module previews can be installed from cloud with automatic backup of the existing version.
*   **Settings Layout.** Standardised settings panel with visual dividers and support section, shared across all Ionrift modules.

### Changed
*   Zip Importer reads pack manifests automatically when present. Falls back to manual options if no manifest.
*   Pack registry checks cached to prevent redundant network calls.

### Fixed
*   FilePicker guard for headless test environments.

## [1.5.5] - 2026-04-11

*   **Fix**: Item Enrichment Engine registry key normalisation. Unicode apostrophe variants (curly quotes, prime) are now collapsed to a plain ASCII apostrophe before lookup, so SRD items like "Cook's Utensils" match enrichments registered with a straight apostrophe and vice versa. Resolves silent enrichment misses on items sourced from the 2024 SRD compendium.
*   **Feature**: System Adapter exposed on the public API as `game.ionrift.library.system`. Provides system-agnostic actor queries (character level, spell slots, class list) used by Workshop and future consumer modules.
*   **Infra**: Discord patch notes workflow. A `notify-discord` job fires on every stable release, parsing the top CHANGELOG entry and posting a formatted embed to `#patch-notes` (Library purple `#7C5CBF`).

## [1.5.0] - Item Enrichment Engine, Session Tracker, Zip Pack Importer

*   **Feature**: Item Enrichment Engine (`ItemEnrichmentEngine`). Kernel-level service that injects styled mechanical-notes blocks into Foundry item sheets. Any Ionrift module can register enrichment data via `game.ionrift.library.enrichment.register()` or `registerBatch()`. Registry is name-keyed and normalises Unicode apostrophe variants so SRD items match regardless of smart-quote encoding. Hook wiring covers AppV1 (`renderItemSheet`) and AppV2 (`renderItemSheet5e`, `renderItemSheet5e2`). Respite is the first consumer; Workshop will follow.
*   **Feature**: Session Tracker (`SessionTracker`). Records session metadata (date, session number, player list) to world settings across restarts. Exposed as `game.ionrift.library.sessions`. Required dependency for Workshop Phase 4.
*   **Style**: `.ionrift-enrichment` CSS block moved to library `ionrift.css`. Consumer modules no longer need to carry their own copy.
*   **Feature**: Zip Pack Importer. Shared utility for importing ZIP archives (art, SFX) through the Foundry UI. Consumer modules call `game.ionrift.library.importZipPack()` with module ID, asset type, and optional validators.
*   **Feature**: Ionrift Glass styled progress modal with cancel support and auto-close on completion.
*   **Convention**: Imported assets land in `ionrift-data/{module}/{type}/` at the Data root. Survives module updates.
*   **Dependency**: Vendored JSZip v3.10.1 (MIT, ~100KB minified). No external CDN calls.
*   **Safety**: 50 MB zip size cap enforced before parsing. Extension filtering and OS metadata stripping built in.

## [1.4.6] - Settings Layout and Wiki Links
*   **Feature**: Standardised settings layout with header/body/footer structure. Attunement at the top, module settings in the middle, support and diagnostics at the bottom with a visual divider.
*   **Feature**: Wiki / Guides button in module settings footer. Opens the Ionrift wiki directly from Foundry.
*   **Fix**: Wiki links in README updated to numbered URLs.
*   **Docs**: Standardised README footer with wiki, Discord, and Patreon links.

## [1.4.5] - Resonance v2.2.2 Advisory
*   **Advisory**: One-time GM notification alerting Linux-hosted users about the Resonance v2.2.2 case-sensitivity fix. Users who had a broken Resonance module are prompted to update.

## [1.4.4] - Hotfix (supersedes 1.4.3)
*   **Fix**: Removed unreleased `TokenArtResolver` import that caused module crash on load.

## [1.4.3] - Discord Support Link
*   **Feature**: Added "Get Support" button to module settings. Opens the Ionrift Discord server.
*   **Feature**: New `SupportHelper` utility class for ecosystem-wide support link registration.
*   **Improvement**: Added `bugs` field to `module.json` pointing to Discord.
## [1.4.0] - Public Launch
*   **Release**: First public release alongside Ionrift Resonance v2.0.0.
*   **Improvement**: Updated copyright to 2026.
*   **Improvement**: Added `license` field to `module.json`.
*   **Improvement**: Hardened release workflow exclusions.

## [1.3.2]
*   Fix: Diagnostic refresh and status indicator improvements.

## [1.2.0]
*   Feature: Creature Classifier with DnD5e and Daggerheart data sets.
*   Feature: Integration Status service for cross-module health monitoring.
*   Feature: Runtime Validator for system schema checks.

## [1.1.1]
*   Docs: Add README with API documentation.