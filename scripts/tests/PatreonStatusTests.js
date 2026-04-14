/**
 * PatreonStatusTests
 *
 * DOM-based self-tests for SettingsLayout.injectPatreonStatus().
 * Tests run against a temporary fixture element — no settings panel needed.
 *
 * Run from Foundry console:
 *   game.ionrift.library._tests.patreonStatus()
 */
import { SettingsLayout } from "../SettingsLayout.js";

// ── Fixture ─────────────────────────────────────────────────

/**
 * Build a minimal DOM fixture matching Foundry v13 settings panel structure:
 *   <div class="form-group">
 *     <label>Patreon Connection</label>
 *     <div class="form-fields">
 *       <button data-key="ionrift-library.patreonMenu">
 *         <i class="fas fa-link" inert></i>
 *         <span>Connect Patreon</span>
 *       </button>
 *     </div>
 *     <p class="notes">Link your Patreon account for content updates and early access.</p>
 *   </div>
 */
function createFixture() {
    const root = document.createElement("div");
    root.id = "ionrift-patreon-test-fixture";
    root.style.display = "none";
    root.innerHTML = `
        <div class="form-group">
            <label>Patreon Connection</label>
            <div class="form-fields">
                <button data-key="ionrift-library.patreonMenu">
                    <i class="fas fa-link" inert></i>
                    <span>Connect Patreon</span>
                </button>
            </div>
            <p class="notes">Link your Patreon account for content updates and early access.</p>
        </div>`;
    document.body.appendChild(root);
    return root;
}

function destroyFixture(root) {
    root.remove();
}

// ── Assertions ──────────────────────────────────────────────

function assert(condition, msg) {
    if (!condition) throw new Error(`FAIL: ${msg}`);
}

function getState(root) {
    const btn = root.querySelector(`button[data-key="ionrift-library.patreonMenu"]`);
    const label = root.querySelector("label");
    const hint = root.querySelector(".notes");
    const statusIcon = label?.querySelector(".ionrift-patreon-status");
    const btnIcon = btn?.querySelector("i");
    const btnSpan = btn?.querySelector("span");

    return {
        statusIconClass: statusIcon?.className ?? null,
        statusIconColor: statusIcon?.style.color ?? null,
        btnIconClass: btnIcon?.className ?? null,
        btnLabel: btnSpan?.textContent ?? null,
        hintText: hint?.textContent ?? null,
        hintHTML: hint?.innerHTML ?? null
    };
}

// ── Test Cases ──────────────────────────────────────────────

function testDisconnectedState() {
    const root = createFixture();
    try {
        SettingsLayout.injectPatreonStatus({ root, isConnected: false });
        const s = getState(root);

        assert(s.statusIconClass?.includes("fa-exclamation-circle"), "Disconnected should show warning icon");
        assert(s.statusIconColor === "rgb(239, 68, 68)" || s.statusIconColor === "#ef4444", `Disconnected icon should be red, got: ${s.statusIconColor}`);
        assert(s.btnIconClass?.includes("fa-link"), "Disconnected button should show link icon");
        assert(s.btnLabel === "Connect Patreon", `Button should say 'Connect Patreon', got: '${s.btnLabel}'`);
        assert(s.hintText === "Link your Patreon account for content updates and early access.",
            `Hint text should be default, got: '${s.hintText}'`);

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testConnectedFreeState() {
    const root = createFixture();
    try {
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: null });
        const s = getState(root);

        assert(s.statusIconClass?.includes("fa-check-circle"), "Connected should show checkmark icon");
        assert(s.statusIconColor === "rgb(68, 255, 255)" || s.statusIconColor === "#4ff", `Connected icon should be cyan, got: ${s.statusIconColor}`);
        assert(s.btnIconClass?.includes("fa-unlink"), "Connected button should show unlink icon");
        assert(s.btnLabel === "Manage Connection", `Button should say 'Manage Connection', got: '${s.btnLabel}'`);
        assert(s.hintHTML?.includes("Free"), "Hint should mention 'Free' tier");
        assert(s.hintHTML?.includes("Click to manage"), "Hint should say 'Click to manage'");

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testConnectedWithTier() {
    const root = createFixture();
    try {
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: "Acolyte" });
        const s = getState(root);

        assert(s.statusIconClass?.includes("fa-check-circle"), "Acolyte should show checkmark icon");
        assert(s.btnLabel === "Manage Connection", "Acolyte button should say 'Manage Connection'");
        assert(s.hintHTML?.includes("Acolyte"), `Hint should mention 'Acolyte', got: '${s.hintHTML}'`);

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testToggleConnectedToDisconnected() {
    const root = createFixture();
    try {
        // First: connected
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: "Weaver" });
        let s = getState(root);
        assert(s.btnLabel === "Manage Connection", "Should start as Manage Connection");
        assert(s.statusIconClass?.includes("fa-check-circle"), "Should start with checkmark");

        // Then: disconnect
        SettingsLayout.injectPatreonStatus({ root, isConnected: false });
        s = getState(root);
        assert(s.btnLabel === "Connect Patreon", `After disconnect should say 'Connect Patreon', got: '${s.btnLabel}'`);
        assert(s.statusIconClass?.includes("fa-exclamation-circle"), "After disconnect should show warning icon");
        assert(s.hintText === "Link your Patreon account for content updates and early access.",
            `After disconnect hint should reset, got: '${s.hintText}'`);

        // Verify only one status icon exists (old one was removed)
        const icons = root.querySelectorAll(".ionrift-patreon-status");
        assert(icons.length === 1, `Should have exactly 1 status icon, got: ${icons.length}`);

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testToggleDisconnectedToConnected() {
    const root = createFixture();
    try {
        // First: disconnected
        SettingsLayout.injectPatreonStatus({ root, isConnected: false });
        let s = getState(root);
        assert(s.btnLabel === "Connect Patreon", "Should start as Connect Patreon");

        // Then: connect
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: "Acolyte" });
        s = getState(root);
        assert(s.btnLabel === "Manage Connection", `After connect should say 'Manage Connection', got: '${s.btnLabel}'`);
        assert(s.statusIconClass?.includes("fa-check-circle"), "After connect should show checkmark");
        assert(s.hintHTML?.includes("Acolyte"), "After connect hint should mention Acolyte");

        const icons = root.querySelectorAll(".ionrift-patreon-status");
        assert(icons.length === 1, `Should have exactly 1 status icon after toggle, got: ${icons.length}`);

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testIdempotentDoubleCall() {
    const root = createFixture();
    try {
        // Call twice in the same state — should not duplicate icons
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: "Weaver" });
        SettingsLayout.injectPatreonStatus({ root, isConnected: true, tier: "Weaver" });

        const icons = root.querySelectorAll(".ionrift-patreon-status");
        assert(icons.length === 1, `Double call should still produce 1 icon, got: ${icons.length}`);

        return "PASS";
    } finally {
        destroyFixture(root);
    }
}

function testNoButtonGracefulExit() {
    const root = document.createElement("div");
    root.innerHTML = `<div>No button here</div>`;
    document.body.appendChild(root);
    try {
        // Should not throw
        SettingsLayout.injectPatreonStatus({ root, isConnected: true });
        return "PASS";
    } finally {
        root.remove();
    }
}

// ── Runner ──────────────────────────────────────────────────

const TESTS = [
    ["Disconnected state renders correctly", testDisconnectedState],
    ["Connected (Free) state renders correctly", testConnectedFreeState],
    ["Connected (Acolyte) shows tier in hint", testConnectedWithTier],
    ["Toggle connected → disconnected", testToggleConnectedToDisconnected],
    ["Toggle disconnected → connected", testToggleDisconnectedToConnected],
    ["Idempotent double-call", testIdempotentDoubleCall],
    ["No button — graceful exit", testNoButtonGracefulExit]
];

export function runPatreonStatusTests() {
    console.log("%c── Patreon Status Tests ──", "font-weight:bold; color:#4ff");
    let passed = 0;
    let failed = 0;

    for (const [name, fn] of TESTS) {
        try {
            const result = fn();
            console.log(`  ✅ ${name}: ${result}`);
            passed++;
        } catch (e) {
            console.error(`  ❌ ${name}: ${e.message}`);
            failed++;
        }
    }

    const summary = `${passed}/${TESTS.length} passed${failed ? `, ${failed} FAILED` : ""}`;
    console.log(`%c── ${summary} ──`, `font-weight:bold; color:${failed ? "#ef4444" : "#4ff"}`);

    return { passed, failed, total: TESTS.length };
}
