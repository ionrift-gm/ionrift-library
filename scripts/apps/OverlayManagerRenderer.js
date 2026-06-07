import { LegacyAssetSweeper } from "../services/LegacyAssetSweeper.js";
import { PackRegistryService } from "../services/PackRegistryService.js";

/** Status priority for rolling up a module's tiers to a single tile state. */
const STATUS_PRIORITY = [
    "not-installed",
    "update-available",
    "module-outdated",
    "installed-outdated",
    "installed-locked",
    "installed-inactive",
    "up-to-date",
    "no-content",
    "module-inactive",
    "locked"
];

// ── Pure display helpers ─────────────────────────────────────────────

export function shortModuleName(name) {
    return name.replace(/^Ionrift\s+/i, "");
}

/**
 * Audience-tier label for the pill. Maps registry tier names to
 * reader-friendly labels matching the Patreon tier names.
 * @param {string} tier
 * @returns {string}
 */
export function tierDisplayLabel(tier) {
    switch (tier) {
        case "Free":      return "Follower";
        case "Initiate":  return "Initiate";
        case "Acolyte":   return "Acolyte";
        case "Weaver":    return "Weaver";
        case "Artificer": return "Artificer";
        default:          return tier || "Follower";
    }
}

/**
 * Classification noun for an overlay, derived from its sublayer.
 * @param {string} sublayer
 * @param {string} [overlayId=""]
 * @returns {string}
 */
export function packClassLabel(sublayer, overlayId = "") {
    if (overlayId.includes("frost-stone") || sublayer === "frost-stone") {
        return "Frost & Stone pack";
    }
    switch (sublayer) {
        case "core":      return "Core pack";
        case "free":      return "Core pack";
        case "initiate":  return "Standard pack";
        case "acolyte":
        case "premium":   return "Premium pack";
        case "weaver":    return "Weaver pack";
        case "artificer": return "Artificer pack";
        default:          return "Content pack";
    }
}

export function hasError(status, lastError) {
    if (!lastError) return false;
    if (status === "locked" || status === "module-inactive") return false;
    return true;
}

export function tileStatusDisplay(target) {
    const isError = !!target.hasError;
    switch (target.status) {
        case "installed-inactive":
            return { icon: "fa-moon", className: "is-off", label: "Off" };
        case "up-to-date":
            return { icon: "fa-check", className: "is-ok", label: "Active" };
        case "not-installed":
            return isError
                ? { icon: "fa-rotate-right", className: "is-action", label: "Install failed last time. Try again." }
                : { icon: "fa-download", className: "is-action", label: "Ready to install" };
        case "update-available":
            return isError
                ? { icon: "fa-rotate-right", className: "is-action", label: "Update failed last time. Try again." }
                : { icon: "fa-download", className: "is-action", label: "Update available" };
        case "installed-outdated":
            return { icon: "fa-circle-info", className: "is-muted", label: "Module update available" };
        case "installed-locked":
            return { icon: "fa-lock", className: "is-locked", label: "Installed, no longer entitled" };
        case "module-outdated":
            return { icon: "fa-arrow-up", className: "is-muted", label: "Module update required" };
        case "no-content":
            return { icon: "fa-circle-minus", className: "is-muted", label: "No content registered yet" };
        case "module-inactive":
            return { icon: "fa-power-off", className: "is-muted", label: "Module off" };
        case "locked":
        default:
            return { icon: "fa-lock", className: "is-locked", label: "Locked" };
    }
}

/**
 * Module tile corner icon: reflects install + active mix across all packs.
 * @param {Object} group
 * @returns {{ icon: string, className: string, label: string }}
 */
export function tileRollupDisplay(group) {
    if (group.status === "locked" || group.status === "module-inactive"
        || group.status === "module-outdated" || group.status === "no-content"
        || group.status === "installed-outdated" || group.status === "installed-locked") {
        return tileStatusDisplay(group);
    }

    const activeCount = group.activeCount ?? 0;
    const offCount = group.inactiveCount ?? 0;
    const installedCount = group.installedCount ?? 0;

    if (activeCount > 0 && offCount > 0) {
        return {
            icon: "fa-circle-half-stroke",
            className: "is-partial",
            label: `${activeCount} active, ${offCount} off`
        };
    }
    if (installedCount > 0 && offCount > 0 && activeCount === 0) {
        return { icon: "fa-moon", className: "is-off", label: "Installed, off" };
    }
    if (activeCount > 0) {
        return { icon: "fa-check", className: "is-ok", label: "Active" };
    }

    return tileStatusDisplay(group);
}

/**
 * Which pack panel should start expanded in detail view.
 * @param {Object[]} overlays
 * @returns {string|null}
 */
export function pickDefaultExpandedOverlay(overlays) {
    if (!overlays?.length) return null;
    const actionable = overlays.find(o =>
        o.status === "update-available" || o.status === "not-installed"
    );
    return actionable?.overlayId ?? overlays[0].overlayId;
}

export function formatDetailError(lastError, status, overlayId) {
    if (!lastError || (status !== "not-installed" && status !== "update-available")) return "";
    const name = overlayId ? `<strong>${overlayId}</strong>` : "This pack";

    if (lastError.stage === "requestDownload") {
        if (lastError.status === 404) {
            return `${name} is not on the server yet. The registry may list an id that has not been published. Use <strong>Check for updates</strong> after publish.`;
        }
        return `${name} could not be downloaded. Try <strong>Install</strong> again, or use <strong>Check for updates</strong>.`;
    }
    if (lastError.stage === "fetch") {
        return `${name} could not be fetched from storage. The download link may have expired. Use <strong>Check for updates</strong>, then install again.`;
    }
    return `Install did not complete for ${name}. Try again.`;
}

// ── HTML markup builders ─────────────────────────────────────────────

/**
 * @param {Object} group
 * @param {{ selectedModuleId: string|null, compact?: boolean }} state
 * @returns {string}
 */
export function renderModuleTile(group, state) {
    const { selectedModuleId, compact = false } = state;
    const status = tileRollupDisplay(group);
    const isPartial = status.className === "is-partial";
    const classes = [
        "overlay-tile",
        `overlay-tile--${group.status}`,
        isPartial ? "overlay-tile--partial" : "",
        group.hasError ? "overlay-tile--error" : "",
        group.status === "locked" ? "overlay-tile--locked" : "",
        group.status === "module-inactive" ? "overlay-tile--inactive" : "",
        selectedModuleId === group.moduleId ? "overlay-tile--selected" : "",
        compact ? "overlay-tile--compact" : "",
        group.updateCount > 0 ? "overlay-tile--stale" : ""
    ].filter(Boolean).join(" ");

    const sName = shortModuleName(group.moduleName);
    const showProgress = group.entitledCount > 0;
    const isComplete = showProgress && group.installedCount === group.entitledCount;
    const packWord = group.entitledCount === 1 ? "pack" : "packs";
    let metaText = showProgress ? `${group.installedCount}/${group.entitledCount} ${packWord}` : "";
    if (isPartial && group.activeCount > 0) {
        metaText += ` · ${group.activeCount} on`;
    }
    const packMeta = metaText
        ? `<span class="overlay-tile-meta ${isComplete && !isPartial ? "is-complete" : ""}">${metaText}</span>`
        : "";
    const updateWord = group.updateCount === 1 ? "update available" : "updates available";
    const updateBadge = group.updateCount > 0
        ? `<span class="overlay-tile-update-badge"><i class="fas fa-sync"></i> ${group.updateCount} ${updateWord}</span>`
        : "";

    return `
    <button type="button" class="${classes}"
        data-action="select-tile" data-module-id="${group.moduleId}"
        data-status="${group.status}" title="${status.label}"
        aria-label="${sName}. ${status.label}">
        <span class="overlay-tile-status ${status.className}" aria-hidden="true"><i class="fas ${status.icon}"></i></span>
        <span class="overlay-tile-icon"><i class="fas ${group.moduleIcon}"></i></span>
        <span class="overlay-tile-label">
            <span class="overlay-tile-name">${sName}</span>
            ${packMeta}
            ${updateBadge}
        </span>
    </button>`;
}

/** Subscription status strip at the top of the panel. */
export function buildSubscriptionStrip(context) {
    if (!context.isConnected) {
        return `
        <div class="overlay-mgr-strip overlay-mgr-strip--disconnected">
            <div class="overlay-mgr-strip-main">
                <i class="fab fa-patreon overlay-mgr-strip-icon"></i>
                <span class="overlay-mgr-strip-label">
                    Connect your Patreon account to automatically download content packs for your tier.
                </span>
            </div>
            <button type="button" class="overlay-mgr-strip-connect" data-action="connect-patreon"
                    title="Link your Patreon account">
                <i class="fab fa-patreon"></i> Connect Patreon
            </button>
        </div>`;
    }

    const tier = context.userTier || "Free";
    const manageTray = context.manageOpen
        ? `
        <div class="overlay-mgr-manage-tray">
            <span class="overlay-mgr-manage-tray-label">Account</span>
            <button type="button" class="overlay-mgr-manage-btn overlay-mgr-manage-btn--danger" data-action="disconnect">
                <i class="fas fa-unlink"></i> Disconnect Patreon
            </button>
        </div>`
        : "";

    const expiry = context.expiryStatus;
    const expiryMod = expiry ? ` overlay-mgr-strip--${expiry.state}` : "";
    const expiryAdvisory = expiry
        ? `
        <div class="overlay-mgr-strip-advisory overlay-mgr-strip-advisory--${expiry.state}">
            <span class="overlay-mgr-strip-advisory-icon">
                <i class="fas ${expiry.state === "expired" ? "fa-exclamation-triangle" : "fa-clock"}"></i>
            </span>
            <span class="overlay-mgr-strip-advisory-text">
                <strong>${expiry.label}.</strong>
                <span class="overlay-mgr-strip-advisory-hint">${expiry.hint}</span>
            </span>
            <button type="button" class="overlay-mgr-strip-reconnect" data-action="reconnect-patreon"
                    title="Disconnect and reconnect your Patreon account">
                <i class="fas fa-sync-alt"></i> Reconnect
            </button>
        </div>`
        : "";

    return `
    <div class="overlay-mgr-strip ${context.manageOpen ? "is-open" : ""}${expiryMod}">
        <div class="overlay-mgr-strip-main">
            <i class="fab fa-patreon overlay-mgr-strip-icon"></i>
            <span class="overlay-mgr-strip-label">Connected</span>
            <span class="overlay-tier-pill overlay-tier-pill--user">${tier}</span>
        </div>
        <button type="button" class="overlay-mgr-strip-manage ${context.manageOpen ? "is-open" : ""}"
                data-action="toggle-manage" aria-expanded="${context.manageOpen}"
                title="Manage connection">
            <i class="fas fa-cog"></i> Manage
        </button>
        ${manageTray}
        ${expiryAdvisory}
    </div>`;
}

/** Early Access modules section: one thin row per offer. */
export function buildEarlyAccessSection(context) {
    if (!context.earlyAccess?.length) return "";

    const rows = context.earlyAccess.map(ea => {
        const sName = shortModuleName(ea.title);
        let action;
        if (!ea.isQualified) {
            action = `<span class="overlay-ea-row-locked"><i class="fas fa-lock"></i> ${ea.requiredTier}+ required</span>`;
        } else if (ea.isInstalled) {
            action = `<span class="overlay-ea-row-installed"><i class="fas fa-check"></i> Installed</span>`;
        } else {
            action = `<button type="button" class="overlay-ea-row-btn" data-action="install-ea"
                        data-module-id="${ea.moduleId}" data-version="${ea.version}">
                        <i class="fas fa-download"></i> Install
                    </button>`;
        }

        return `
        <div class="overlay-ea-row ${ea.isQualified ? "" : "overlay-ea-row--locked"}">
            <span class="overlay-ea-row-icon"><i class="fas ${ea.icon}"></i></span>
            <span class="overlay-ea-row-name">${sName}</span>
            <span class="overlay-tier-pill">${ea.requiredTier}+</span>
            <span class="overlay-ea-row-version">v${ea.version}</span>
            <span class="overlay-ea-row-action">${action}</span>
        </div>`;
    }).join("");

    return `
    <section class="overlay-mgr-section overlay-mgr-section--ea">
        <header class="overlay-mgr-section-head">
            <i class="fas fa-bolt"></i>
            <span class="overlay-mgr-section-title">Early Access Modules</span>
        </header>
        <div class="overlay-ea-list">${rows}</div>
    </section>`;
}

/** Content packs section header (count + Install All + Check for updates). */
export function buildPacksSectionHead(context) {
    const modWord = context.overlayCount === 1 ? "module" : "modules";
    let summary = `${context.overlayCount} ${modWord}`;
    if (context.installedCount > 0) {
        summary += ` &middot; ${context.installedCount} installed`;
    }
    if (context.inactiveCount > 0) {
        summary += ` &middot; ${context.inactiveCount} off`;
    }
    if (context.actionableCount > 0) {
        summary += ` &middot; <span class="overlay-mgr-section-updates">${context.actionableCount} ready to install</span>`;
    }

    const installAllBtn = context.actionableCount > 0
        ? `<button type="button" class="overlay-mgr-install-all-btn" data-action="install-all"
              title="Install ${context.actionableCount} ready pack${context.actionableCount === 1 ? "" : "s"}">
            <i class="fas fa-download"></i> Install All
        </button>`
        : "";

    const checkBtn = context.isConnected
        ? `<button type="button" class="overlay-mgr-check-btn" data-action="check-now">
            <i class="fas fa-sync"></i> Check for updates
        </button>`
        : "";

    const title = context.isConnected ? "Content Packs" : "Your Library";

    return `
    <header class="overlay-mgr-section-head overlay-mgr-section-head--packs">
        <i class="fas fa-layer-group"></i>
        <span class="overlay-mgr-section-title">${title}</span>
        <span class="overlay-mgr-section-summary">${summary}</span>
        ${installAllBtn}
        ${checkBtn}
    </header>`;
}

/**
 * Window-level footer: last-checked stamp plus the universal Install .zip
 * control.
 * @param {Object} context
 * @param {{ hasAnyZipImport: boolean }} opts
 * @returns {string}
 */
export function buildLibraryFooter(context, { hasAnyZipImport }) {
    const zipBtn = hasAnyZipImport
        ? `<button type="button" class="overlay-mgr-footer-zip" data-action="zip-import"
                title="Install a content pack from a .zip file">
                <i class="fas fa-file-import"></i> Install .zip
            </button>`
        : "";
    const zipHint = hasAnyZipImport
        ? `<span class="overlay-mgr-footer-hint">Have a .zip from Patreon? Install any content pack here.</span>`
        : "";
    const lastCheck = context.isConnected
        ? `<span class="overlay-mgr-footer-time">Last checked: ${context.lastCheck}</span>`
        : "";

    return `
    <div class="overlay-mgr-footer">
        <div class="overlay-mgr-footer-meta">
            ${zipHint}
            ${lastCheck}
        </div>
        ${zipBtn}
    </div>`;
}

/**
 * @param {Object} context
 * @param {{ selectedModuleId: string|null, hasAnyZipImport: boolean }} state
 * @returns {string}
 */
export function buildGridMarkup(context, state) {
    let html = buildSubscriptionStrip(context);

    if (context.isConnected) {
        html += buildEarlyAccessSection(context);
    }

    if (context.groups.length) {
        html += `<section class="overlay-mgr-section overlay-mgr-section--packs">`;
        html += buildPacksSectionHead(context);
        html += `<div class="overlay-tile-grid">`;
        for (const group of context.groups) {
            html += renderModuleTile(group, state);
        }
        html += `</div>`;
        html += `</section>`;
    }

    html += buildLibraryFooter(context, state);

    return html;
}

/**
 * @param {Object} context
 * @param {{ selectedModuleId: string|null, expandedOverlayId: string|null|undefined, hasAnyZipImport: boolean, cleanupPanelId: string }} state
 * @returns {string}
 */
export function buildDetailMarkup(context, state) {
    const group = context.selected;
    if (!group) return buildGridMarkup(context, state);

    let html = buildSubscriptionStrip(context);
    html += `<div class="overlay-split">`;
    html += `<div class="overlay-split-nav">`;
    html += `<button type="button" class="overlay-back-btn" data-action="back-grid"><i class="fas fa-arrow-left"></i> All modules</button>`;
    html += `<div class="overlay-mini-grid">`;
    for (const g of context.groups) {
        html += renderModuleTile(g, { ...state, compact: true });
    }
    html += `</div></div>`;
    html += buildDetailPanel(group, state);
    html += `</div>`;
    html += buildLibraryFooter(context, state);
    return html;
}

/**
 * @param {Object} group
 * @param {{ expandedOverlayId: string|null|undefined, isConnected?: boolean, cleanupPanelId: string }} state
 * @returns {string}
 */
export function buildDetailPanel(group, state) {
    const { isConnected = true, cleanupPanelId } = state;
    let { expandedOverlayId } = state;
    const sName = shortModuleName(group.moduleName);
    const hasCleanup = !!(group.cleanup?.entries?.length
        && LegacyAssetSweeper.getPlatformMode() !== "hide");
    const useAccordion = group.overlays.length > 1 || hasCleanup;
    if (useAccordion && expandedOverlayId === undefined) {
        expandedOverlayId = pickDefaultExpandedOverlay(group.overlays);
    }
    if (!useAccordion && group.overlays.length === 1) {
        expandedOverlayId = group.overlays[0].overlayId;
    }

    let html = `<div class="overlay-split-detail">`;

    html += `
    <div class="overlay-detail-head">
        <div class="overlay-detail-title">
            <span class="overlay-detail-icon"><i class="fas ${group.moduleIcon}"></i></span>
            <h3>${group.moduleName}</h3>
        </div>
    </div>
    <div class="overlay-detail-accent" style="background:${group.moduleAccent}"></div>`;

    if (!group.isModuleActive) {
        html += `<p class="overlay-detail-muted">Enable ${sName} in Manage Modules before installing.</p>`;
    }

    if (group.status === "no-content") {
        const emptyMsg = isConnected
            ? `${sName} is installed and active. No content packs are registered for it yet.
            When new content ships, it will appear here automatically.`
            : `${sName} is installed and active. Connect Patreon to browse and download content packs for this module, or use Install .zip below for a pack you already have.`;
        html += `<p class="overlay-detail-muted">${emptyMsg}</p>`;
    }

    html += `<div class="overlay-detail-tiers ${useAccordion ? "overlay-detail-tiers--accordion" : ""}">`;
    for (const overlay of group.overlays) {
        const isExpanded = !useAccordion || overlay.overlayId === expandedOverlayId;
        html += renderTierBlock(overlay, { isExpanded, useAccordion, isConnected });
    }
    if (hasCleanup) {
        const cleanupExpanded = !useAccordion
            || expandedOverlayId === cleanupPanelId;
        html += renderCleanupAccordionPanel(group, {
            isExpanded: cleanupExpanded,
            useAccordion,
            cleanupPanelId
        });
    }
    html += `</div>`;

    html += `</div>`;
    return html;
}

/**
 * Legacy cleanup as the first accordion row in the detail harmonica.
 * @param {Object} group
 * @param {{ isExpanded?: boolean, useAccordion?: boolean, cleanupPanelId: string }} opts
 * @returns {string}
 */
export function renderCleanupAccordionPanel(group, { isExpanded = false, useAccordion = true, cleanupPanelId } = {}) {
    const cleanup = group?.cleanup;
    if (!cleanup?.entries?.length) return "";

    const mode = LegacyAssetSweeper.getPlatformMode();
    const totalBytes = cleanup.estimatedBytes ?? 0;
    const headline = LegacyAssetSweeper.formatBytes(totalBytes);

    let body = "";
    for (const entry of cleanup.entries) {
        body += renderCleanupEntry(group, entry, mode);
    }

    const previewPill = cleanup.synthetic
        ? `<span class="overlay-tier-pill overlay-tier-pill--preview" title="Preview render. No legacy files were detected on disk; force-mode is set.">Preview</span>`
        : "";

    const panelClasses = [
        "overlay-pack-panel",
        "overlay-pack-panel--cleanup",
        "overlay-pack-panel--up-to-date",
        isExpanded ? "is-expanded" : "",
        useAccordion ? "overlay-pack-panel--accordion" : ""
    ].filter(Boolean).join(" ");

    const chevronHtml = useAccordion
        ? `<i class="fas fa-chevron-right overlay-pack-panel-chevron" aria-hidden="true"></i>`
        : "";

    const headBadges = `${previewPill}
        <span class="overlay-tier-pill overlay-tier-pill--cleanup"><i class="fas fa-broom"></i> Cleanup available</span>
        <span class="overlay-pack-class overlay-pack-class--cleanup">Save ${headline}</span>`;

    const toggleBtn = useAccordion
        ? `<button type="button" class="overlay-pack-panel-toggle"
                data-action="toggle-pack-panel"
                data-overlay-id="${cleanupPanelId}"
                aria-expanded="${isExpanded}">
            ${chevronHtml}
            ${headBadges}
        </button>`
        : `<div class="overlay-pack-panel-label">${headBadges}</div>`;

    const bodyHtml = isExpanded
        ? `
        <div class="overlay-pack-panel-body overlay-pack-panel-body--cleanup">
            ${body}
        </div>`
        : "";

    return `
    <section class="${panelClasses}" data-overlay-id="${cleanupPanelId}">
        <div class="overlay-pack-panel-head">
            ${toggleBtn}
        </div>
        ${bodyHtml}
    </section>`;
}

/**
 * Render one legacy manifest entry as a card inside the cleanup section.
 */
export function renderCleanupEntry(group, entry, mode) {
    const savings = LegacyAssetSweeper.describeSavings(entry.kind, entry.estimatedBytes ?? 0);

    const pathsList = entry.paths
        .map(p => `<li><code>${p}</code></li>`)
        .join("");

    const metaParts = [`Disk ${savings.disk}`];
    if (savings.quota !== "0 MB") metaParts.push(`Forge quota ${savings.quota}`);
    const savingsLine = `<span class="overlay-cleanup-meta">${metaParts.join(" · ")}</span>`;
    const quotaNote = savings.quotaNote
        ? `<p class="overlay-cleanup-note">${savings.quotaNote}</p>`
        : "";

    return `
    <article class="overlay-cleanup-entry">
        <p class="overlay-cleanup-desc">${entry.description}</p>
        ${savingsLine}
        ${quotaNote}
        <details class="overlay-cleanup-paths">
            <summary>Show paths (${entry.paths.length})</summary>
            <ul>${pathsList}</ul>
        </details>
        ${renderCleanupAction(group, entry, mode)}
    </article>`;
}

/**
 * Mode-specific action area. v13 ships an actual delete button.
 * v14 and Forge ship a short note plus a copy-paths affordance.
 */
export function renderCleanupAction(group, entry, mode) {
    const moduleId = group.moduleId;
    const entryId = entry.id;

    if (mode === "v13-button") {
        return `
        <div class="overlay-cleanup-action">
            <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                    data-action="legacy-cleanup-sweep"
                    data-module-id="${moduleId}" data-entry-id="${entryId}">
                <i class="fas fa-broom"></i> Reclaim space
            </button>
            <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--ghost"
                    data-action="legacy-cleanup-copy-paths"
                    data-module-id="${moduleId}" data-entry-id="${entryId}"
                    title="Copy the paths to the clipboard">
                <i class="fas fa-copy"></i> Copy paths
            </button>
        </div>`;
    }

    if (mode === "v14-advisory") {
        return `
        <div class="overlay-cleanup-action overlay-cleanup-action--advisory">
            <p>Foundry v14 restricts in-app file deletion. Close Foundry, remove the path above, then reopen.</p>
            <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                    data-action="legacy-cleanup-copy-paths"
                    data-module-id="${moduleId}" data-entry-id="${entryId}">
                <i class="fas fa-copy"></i> Copy paths
            </button>
        </div>`;
    }

    if (mode === "forge-readonly") {
        return `
        <div class="overlay-cleanup-action overlay-cleanup-action--advisory">
            <p>Reinstall ${shortModuleName(group.moduleName)} from your Forge dashboard to clear the older files.</p>
            <div class="overlay-cleanup-action-row">
                <a class="overlay-cleanup-btn overlay-cleanup-btn--primary"
                   href="https://forge-vtt.com/setup" target="_blank" rel="noopener">
                    <i class="fas fa-external-link-alt"></i> Open Forge dashboard
                </a>
                <button type="button" class="overlay-cleanup-btn overlay-cleanup-btn--ghost"
                        data-action="legacy-cleanup-copy-paths"
                        data-module-id="${moduleId}" data-entry-id="${entryId}">
                    <i class="fas fa-copy"></i> Copy paths
                </button>
            </div>
        </div>`;
    }

    return "";
}

/**
 * Render a single tier/pack block in the detail panel.
 * @param {Object} overlay
 * @param {{ isExpanded?: boolean, useAccordion?: boolean, isConnected?: boolean }} opts
 * @returns {string}
 */
export function renderTierBlock(overlay, { isExpanded = true, useAccordion = false, isConnected = true } = {}) {
    const contents = overlay.contents;
    const summary = contents?.summary ?? overlay.description ?? "";
    const actionHtml = renderDetailAction(overlay, isConnected);
    const errorHtml = formatDetailError(overlay.lastError, overlay.status, overlay.overlayId);
    const showBody = (overlay.hasAccess && overlay.status !== "locked")
        || overlay.status === "installed-locked";

    let outdatedNote = "";
    if (overlay.status === "module-outdated") {
        const moduleName = shortModuleName(overlay.moduleName ?? overlay.moduleId);
        const installed = overlay.installedModuleVersion
            ? ` (you have v${overlay.installedModuleVersion})`
            : "";
        outdatedNote = `
        <p class="overlay-detail-muted">
            Needs ${moduleName} v${overlay.minModuleVersion} or newer${installed}.
        </p>`;
    } else if (overlay.status === "installed-outdated") {
        const moduleName = shortModuleName(overlay.moduleName ?? overlay.moduleId);
        const installed = overlay.installedModuleVersion
            ? ` (you have v${overlay.installedModuleVersion})`
            : "";
        const newer = overlay.installedVersion
            && PackRegistryService._compareVersions(overlay.installedVersion, overlay.latestVersion) < 0;

        if (newer) {
            outdatedNote = `
            <p class="overlay-detail-muted">
                Pack v${overlay.latestVersion} needs ${moduleName} v${overlay.minModuleVersion}+ ${installed}.
                Your installed v${overlay.installedVersion} still works.
            </p>`;
        } else {
            outdatedNote = `
            <p class="overlay-detail-muted">
                ${moduleName} v${overlay.minModuleVersion}+ recommended${installed}. The pack still works.
            </p>`;
        }
    } else if (overlay.status === "installed-locked") {
        outdatedNote = `
        <p class="overlay-detail-muted">
            Your current Patreon tier no longer entitles you to this pack. The installed copy keeps working.
        </p>`;
    }

    let categoriesHtml = "";
    if (showBody) {
        for (const cat of (contents?.categories ?? [])) {
            const items = cat.items ?? [];
            if (!items.length) continue;
            categoriesHtml += `
            <div class="overlay-detail-category">
                <div class="overlay-detail-cat-head"><i class="fas ${cat.icon ?? "fa-box"}"></i><span>${cat.label}</span></div>
                <ul>${items.map(i => `<li>${i}</li>`).join("")}</ul>
            </div>`;
        }
        if (categoriesHtml) categoriesHtml = `<div class="overlay-detail-categories">${categoriesHtml}</div>`;
    }

    let lockedNote = "";
    if (overlay.status === "locked") {
        lockedNote = `<p class="overlay-detail-muted">Available at ${tierDisplayLabel(overlay.tier)} or higher.</p>`;
    }

    const versionMeta = overlay.installedVersion
        ? `Installed v${overlay.installedVersion}`
        : `Latest v${overlay.latestVersion}`;

    const classLabel = overlay.packLabel
        ?? packClassLabel(overlay.sublayer, overlay.overlayId);
    const isFollowerTier = overlay.tier === "Free";
    const previewPill = overlay.preview
        ? `<span class="overlay-tier-pill overlay-tier-pill--preview" title="Preview, hidden from public registry">Preview</span>`
        : "";
    const headBadges = isFollowerTier
        ? `${previewPill}<span class="overlay-tier-pill overlay-tier-pill--pack-name">${classLabel}</span>`
        : `${previewPill}<span class="overlay-tier-pill">${tierDisplayLabel(overlay.tier)}</span>
            <span class="overlay-pack-class">${classLabel}</span>`;

    const panelClasses = [
        "overlay-pack-panel",
        `overlay-pack-panel--${overlay.status}`,
        overlay.isActive ? "overlay-pack-panel--on" : "overlay-pack-panel--off",
        isExpanded ? "is-expanded" : "",
        useAccordion ? "overlay-pack-panel--accordion" : ""
    ].filter(Boolean).join(" ");

    const chevronHtml = useAccordion
        ? `<i class="fas fa-chevron-right overlay-pack-panel-chevron" aria-hidden="true"></i>`
        : "";

    const toggleBtn = useAccordion
        ? `<button type="button" class="overlay-pack-panel-toggle"
                data-action="toggle-pack-panel" data-overlay-id="${overlay.overlayId}"
                aria-expanded="${isExpanded}">
            ${chevronHtml}
            ${headBadges}
        </button>`
        : `<div class="overlay-pack-panel-label">${headBadges}</div>`;

    const bodyHtml = isExpanded
        ? `
        <div class="overlay-pack-panel-body">
            ${lockedNote}
            ${outdatedNote}
            ${showBody && summary ? `<p class="overlay-detail-summary">${summary}</p>` : ""}
            ${categoriesHtml}
            ${errorHtml ? `<p class="overlay-detail-error">${errorHtml}</p>` : ""}
            <div class="overlay-detail-meta">${versionMeta}</div>
        </div>`
        : "";

    return `
    <section class="${panelClasses}" data-overlay-id="${overlay.overlayId}">
        <div class="overlay-pack-panel-head">
            ${toggleBtn}
            <div class="overlay-tier-block-action">${actionHtml}</div>
        </div>
        ${bodyHtml}
    </section>`;
}

export function renderDetailAction(overlay, isConnected = true) {
    switch (overlay.status) {
        case "not-installed":
            return `<button type="button" class="overlay-detail-btn" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Install"><i class="fas fa-download"></i> Install</button>`;
        case "update-available":
            return `${renderOverlayLifecycleControls(overlay, isConnected)}
                <button type="button" class="overlay-detail-btn overlay-detail-btn--update" data-action="install" data-overlay-id="${overlay.overlayId}" data-install-label="Update"><i class="fas fa-sync"></i> Update</button>`;
        case "up-to-date":
        case "installed-inactive":
        case "installed-outdated":
        case "installed-locked":
            return renderOverlayLifecycleControls(overlay, isConnected);
        case "module-outdated":
            return `<span class="overlay-detail-status-blocked"><i class="fas fa-arrow-up"></i> Update module first</span>`;
        default:
            return "";
    }
}

export function renderOverlayLifecycleControls(overlay, isConnected = true) {
    const checked = overlay.isActive ? "checked" : "";
    const reinstallBtn = isConnected
        ? `<button type="button" class="overlay-detail-btn overlay-detail-btn--icon"
            data-action="reinstall-overlay"
            data-overlay-id="${overlay.overlayId}"
            title="Reinstall fresh assets"
            aria-label="Reinstall fresh assets">
            <i class="fas fa-wrench"></i>
        </button>`
        : "";
    return `
    <div class="overlay-pack-toolbar">
        <label class="pack-toggle-label overlay-pack-active-toggle"
            title="${overlay.isActive ? "On in this world" : "Off in this world"}"
            aria-label="${overlay.isActive ? "On in this world" : "Off in this world"}">
            <input type="checkbox" class="pack-toggle-input" data-action="toggle-overlay-active"
                data-overlay-id="${overlay.overlayId}"
                data-module-id="${overlay.moduleId}"
                data-sublayer="${overlay.sublayer}"
                ${checked} />
            <span class="pack-toggle-switch"></span>
        </label>
        ${reinstallBtn}
    </div>`;
}
