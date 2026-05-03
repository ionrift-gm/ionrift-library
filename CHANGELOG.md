# Changelog

## [2.0.0] - 2026-05-03

### Added
- **Party Roster service.** Shared party membership tracking exposed at `game.ionrift.library.partyRoster`. Consumer modules (Respite, Quartermaster) use a single roster instead of maintaining independent party lists.
- **PartyRosterApp** configuration UI for managing party membership from the library settings panel.

### Changed
- Em-dashes replaced with plain punctuation in all user-facing strings for consistency across platforms.

## [1.9.2] - 2026-04-23

### Fixed
- **Module installs on newer V13 builds.** The server-side install path added in v1.9.1 was gated to V14 only, but recent V13 builds (351+) enforce the same upload restrictions. Installs via the Patreon panel now use the server-side route on V13 as well, fixing the silent failure where directories were created but no files were written.

## [1.9.1] - 2026-04-21

### Fixed
- **Module installs on Foundry v14.** One-click installs from the Patreon Connection panel were silently failing on v14 — the module appeared to install but all functional files were missing. Installs now use a server-side route that works with v14's stricter upload rules. If the server route isn't available (some hosting environments), a download dialog with manual extraction steps appears instead of a silent failure.
- Module backup before upgrade is skipped on v14 where the backup would also be blocked. The existing version stays in place until the new one extracts successfully.

## [1.9.0] - 2026-04-20

### Added
- **Platform API** exposed at `game.ionrift.library.platform`. Modules that need to browse directories, create folders, or detect The Forge now call one shared service instead of carrying their own copy of that logic. This won't change anything you see in-game, but it means fewer things can break when the next hosting quirk surfaces.
- **Logger factory** at `game.ionrift.library.createLogger("YourModule")`. Gives any consumer module a ready-made log/info/warn/error proxy with the correct Ionrift prefix and debug gating, without hand-rolling a wrapper file.

### Changed
- Respite, Resonance, Quartermaster, and Cloud all delegate their platform logic to the library now. This removes roughly 200 lines of copy-pasted Forge detection, FilePicker resolution, and directory-creation helpers that had drifted out of sync across modules. The next Forge compatibility fix only needs to land in one place.

### Internal
- Added `DuplicationAudit.test.js` as a permanent static analysis guard. If a consumer module re-introduces a private copy of Forge detection or file-source branching, the library test suite will fail.

## [1.8.3] - 2026-04-20

### Fixed
- File operations on The Forge now work correctly with Foundry v13. The Forge module patches the global FilePicker class to handle its S3-backed storage, but v13 introduced a second (namespaced) copy that the Forge doesn't patch. All browse, upload, and directory-creation calls now use the correct class on each platform.

## [1.8.2] - 2026-04-19

### Fixed
- Diagnostics panel, Patreon Connection menu, and Test Report app no longer crash on Foundry v14. All three were using a removed global that was dropped in v14.
- Forge install dialog now links to the correct wiki page instead of a 404.
- ZIP extraction no longer floods the notification bar with per-file "saved to" toasts during module installs and pack imports.

## [1.8.1] - 2026-04-17

### Added
- Forge install dialog now links to the [setup guide](https://github.com/ionrift-gm/ionrift-library/wiki/Installing-on-The-Forge).

### Fixed
- Content pack downloads now return specific errors for auth failures, tier restrictions, and missing packs.
- ZIP extraction on The Forge now writes to the correct storage location.

## [1.8.0] - 2026-04-17

### Added
- **Pathfinder 2e support.** The creature classifier now reads PF2e trait data (`system.traits.value`) — so when Resonance's Adaptive Sounds activates on a PF2e creature, it has real trait signal to work with rather than falling back to name-only guessing. A zombie tagged `["undead", "mindless"]` will now be identified as undead even if the name alone wouldn't tip it off.

### Changed
- The Creature Index setup wizard no longer pops automatically on first install. It's still a click away in the Ionrift Library settings, but it won't interrupt you the moment you enable the library. Modules that need the index (like Resonance's Adaptive Sounds) will let you know when it matters.
- PF2e worlds no longer see all 25+ bundled Pathfinder compendiums in the Creature Index scan list. The system's own adventure paths and bestiaries are filtered out — only world-specific and third-party packs appear.

### Fixed
- The **Calibration Warning** shown at the end of Creature Index setup was firing incorrectly on PF2e worlds. The self-test suite had no PF2e entries and was falling through to a DnD5e-specific test that was never going to pass. PF2e installs now correctly show all-clear after the integrity check.

## [1.7.6] - 2026-04-16


### Fixed
- Forge installation dialog now shows the correct steps: **Summon Import Wizard** instead of the old "Manage Modules" path, and step 3 clarifies the ZIP File tab and Analyze button. If you followed the v1.7.5 dialog, you probably figured it out, but the instructions are accurate now.

## [1.7.5] - 2026-04-16

### Added
- **Managed hosting support.** Installing early-access modules on The Forge (and other managed platforms) now shows a guided download dialog instead of attempting file extraction that fails silently. Download the ZIP, import it through The Forge's Import Wizard, restart your server. Full walkthrough on the [wiki](https://github.com/ionrift-gm/ionrift-library/wiki/Early-Access-on-The-Forge).
- **Check for Updates** button in the Patreon Connection panel. Forces a fresh registry fetch without waiting for the 24-hour cache.

### Fixed
- File upload throttle during module extraction. Self-hosted installs no longer flood the server with parallel FilePicker calls; uploads are batched to prevent timeouts on slower connections.

## [1.7.4] - 2026-04-16

### Fixed
- Patreon Connection panel now fetches a live copy of the registry when opened, instead of relying on the 24-hour startup cache. Previously a stale cache could show outdated version numbers or missing early-access entries; this was the cause of "pack not found" errors for patrons whose cache predated the current release.

## [1.7.3] - 2026-04-16

### Fixed
- Patreon tier checks now work correctly even when the tier name in the token has a trailing space. Some Patreon tier names were being stored with extra whitespace, which caused the access check to fail silently and show a lock to patrons who fully qualified.

## [1.7.2] - 2026-04-16

### Fixed
- Opening the Patreon Connection panel now fetches a fresh copy of the registry rather than relying on the 24-hour cache. Patrons who connected shortly after an early-access release went live will now see their correct install button straight away, without needing to wait for the cache to expire or manually clear settings.

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