# Changelog

## [2.3.4] - 2026-06-09

### Added
- On startup, the library now inspects the modules folder for EA modules that Foundry cannot see. If it finds a structural problem (ZIP left unextracted, double-nested folder, empty directory, or a valid install that just needs a restart), it surfaces a console warning with the exact cause and fix. Saves a support round-trip for the most common install mistakes.

### Changed
- The manual install fallback dialog now shows OS-specific extraction steps and the exact target path for the module folder, so you're not guessing where files should land.
- When the server-side installer falls back to manual mode, it now pre-creates the target module folder so users do not have to create it themselves.

## [2.3.3] - 2026-06-07

### Fixed
- Fixed an issue where the party roster would fail to load if the primary D&D 5e party group was empty, now gracefully falling back to alternate groups.

## [2.3.2] - 2026-06-04

### Added
- **Module config profiles.** Shared Quick Setup card with preset profiles and grouped settings headers for module settings panels.

### Changed
- **Profile apply confirm.** The confirm dialog now highlights only the values that will actually change. Unchanged settings show in neutral text instead of green.

## [2.3.1] - 2026-06-03

### Fixed
- Foundry could not update the library past 2.2.1. The v2.3.0 release shipped with a download URL still pointing at the previous version, so every update attempt silently re-installed 2.2.1. Modules that require 2.3.0 or later - including Respite 3.0 - were blocked from activating.

## [2.3.0] - 2026-06-02

### Added
- Native party roster on Foundry v14. DnD5e v14 worlds now use the system's built-in party membership instead of the manual roster. Existing v13 worlds continue using the configured roster as before.
- Built terrain category. Terrains registered by content overlays are now tagged as built-in or overlay-provided, with a legacy normalizer for packs that predate the distinction.

### Fixed
- Compendium sidebar folders that lost their name no longer block a world from loading. The library repairs the stored folder layout on startup, renaming any nameless compendium folder and clearing references to folders that no longer exist.

## [2.2.1] - 2026-05-29

### Fixed
- Compatibility declared for Foundry v14. Worlds upgrading from v13 could have the library auto-disabled, which cascades to break all dependent Ionrift modules.

## [2.2.0] - 2026-05-27

### Changed
- Manual zip import now accepts current-format overlay packs only. Download an overlay zip from Patreon or install through the in-app Patreon Library. Legacy content-pack zips are no longer supported on the import surface.
- Patreon Library "Install .zip" routes overlay archives into the same on-disk path as one-click overlay installs.

### Added
- `OverlayService.installFromBlob()` for sideloading overlay zips without a cloud download step.

## [2.1.5] - 2026-05-26

### Changed
- Terrain registry exposes a stable kernel base of five terrains (forest, swamp, desert, urban, dungeon). Modules that need additional terrains now bring them with their own pack data instead of pushing into the shared list.

### Added
- Content overlays can register and unregister terrains at runtime. Installing or removing an overlay updates the terrain picker automatically.

### Fixed
- Minting validation no longer rejects Foundry deletion-syntax keys in update payloads.
- Flameskull and demilich now resolve to the floating-skull sound profile instead of the generic undead fallback.

## [2.1.4] - 2026-05-24

### Added
- **Graduated EA nudge.** Modules that have moved from Early Access to the public Foundry listing now prompt GMs still running the old EA copy to uninstall and reinstall from the module browser. The dialog is snoozable.

### Fixed
- Quieter console on The Forge. The platform helper now resolves the FilePicker class once per session instead of on every overlay manifest read, so the v13 deprecation warning logs once at boot rather than several times per Library render.

## [2.1.3] - 2026-05-22

### Added
- **Patreon expiry detection.** The library now detects when your Patreon connection is stale or expired and surfaces an advisory in both the settings row and the Library panel. A one-click Reconnect button handles the full disconnect-and-reauth flow.

## [2.1.2] - 2026-05-20

### Added
- Pre-install notice on hosted Foundry warns that large packs can take up to 15 minutes and that the browser tab needs to stay open.
- Estimated time remaining shown in the progress dialog once a stable rate is established.

### Changed
- Content pack installs now show a progress dialog with file count and current file - large packs no longer look like a hang on slow connections.
- Hosted installs upload in throttled batches to avoid tripping the Forge API rate monitor.

### Fixed
- The Forge's per-file upload toasts no longer flood the notification area during pack installs.
- Installing several packs in quick succession now queues them instead of running in parallel, preventing doubled API load.


## [2.1.1] - 2026-05-20

### Added
- Centralised pack-nudge banner served from the library. Consumer modules register once; the banner injects into Settings with shared dismiss and snooze state.
- The Library shows your full module inventory even when not connected. Modules display the packs you have installed locally and their on/off state. The on/off toggle and manual zip install stay reachable.

### Changed
- Library section header reads "Your Library" when disconnected, and hides the actions that require a registry round-trip.
- The connect prompt now reads "Connect your account to automatically download and install content packs." It sits at the top of the panel alongside the library management header.
- Footer "Install .zip" control matches the existing primary-action palette and shares the footer with a left-aligned hint and timestamp.

### Fixed
- Installed content packs can now be managed in the Library even when the host module is behind the version the latest pack requires, or when your tier no longer entitles you to the pack. The on/off toggle and the repair button stay reachable so the working installed copy is not stranded.
- Download failures now return structured error objects with status codes instead of null. Modules that check downloads silently no longer pop Foundry toasts; only user-initiated downloads show notifications.

## [2.1.0] - 2026-05-20

### Added

- **Patreon Library.** New unified panel in Ionrift Library settings for managing your Patreon connection, early-access modules, and content packs in one place. Replaces the per-module pack install menu.

- **Content overlay distribution.** Terrain packs, art packs, and sound packs can now be installed, updated, and removed directly from the Patreon Library panel. Each pack shows its install status, version, and contents. An "Install All" button handles everything pending in one click.

- **System adapter registry.** Adapters are now registered per game system instead of a single static class. Ships with DnD5e, PF2e, and Daggerheart adapters. Third-party system modules can register their own.

- **Terrain registry.** Shared terrain list at `game.ionrift.library.terrains` gives all modules a single canonical set of terrain IDs and labels. Content packs register additional terrains via the `ionrift.terrainsReady` hook. Respite and Quartermaster both read from this spine.


### Changed

- Content pack management in Respite and Quartermaster settings is replaced by the Patreon Library when overlay distribution is active. The legacy pack manager still appears if overlay distribution is off.

- Nested directory creation now walks each path segment instead of attempting the full path at once - fixes failures on platforms that do not create parent directories automatically.

- Batch file operations (zip extraction, module installs) suppress additional toast categories during extraction so the notification area stays clean.

### Fixed

- Download failures now return structured error objects with status codes instead of null. Modules that check downloads silently (overlay auto-checks) no longer pop Foundry toasts - only user-initiated downloads show notifications.

## [2.0.2] - 2026-05-07

### Fixed
- The Resonance v2.2.2 advisory notification has been removed. The notice was intended to appear once for users on an affected version, but was instead firing for any fresh install where the dismissal flag had never been set.

## [2.0.1] - 2026-05-03

### Added
- **Party Roster service.** Shared party membership tracking exposed at `game.ionrift.library.partyRoster`. Consumer modules (Respite, Quartermaster) use a single roster instead of maintaining independent party lists.
- **PartyRosterApp** configuration UI for managing party membership from the library settings panel.

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