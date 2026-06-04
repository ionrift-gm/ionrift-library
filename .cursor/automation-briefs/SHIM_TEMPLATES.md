# Automation Shim Templates

Paste one of these blocks as the Cursor automation prompt. Fill in the values marked `← CHANGE`.
The full brief is fetched from `ionrift-library` at runtime — only the config block below needs to be maintained.

Raw brief URLs (all private, accessible to Cursor authenticated as your GitHub account):
- Structural Health: `https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/structural-health.md`
- Bug Finder:        `https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/bug-finder.md`
- Test Coverage:     `https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/test-coverage.md`
- Adapter Audit:     `https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/adapter-audit.md`

---

## 1. Structural Health (Refactor) Shim

```
# ── Automation Config ──────────────────────────────────────────────────
MODULE_ID:       ionrift-respite          # ← CHANGE
MODULE_PATH:     modules/ionrift-respite  # ← CHANGE
SCRIPT_ROOT:     scripts/
ENTRY_POINT:     scripts/module.js
TEST_COMMAND:                             # ← CHANGE or leave blank
CADENCE:         nightly                  # ← CHANGE to 'weekly' when ready
EXCLUDE_DIRS:    [node_modules, packs, sounds, art]
FOCUS_CONCERNS:  []                       # ← Optional: specific files
OUTPUT_PATH:     ionrift-brand/Workspace/refactor_audit/
# ───────────────────────────────────────────────────────────────────────

Fetch the full brief from:
https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/structural-health.md

Follow it exactly, substituting the config values above wherever the brief uses {MODULE_ID}, {MODULE_PATH}, {SCRIPT_ROOT}, {TEST_COMMAND}, {CADENCE}, {EXCLUDE_DIRS}, {OUTPUT_PATH}.
```

---

## 2. Bug Finder Shim

```
# ── Automation Config ──────────────────────────────────────────────────
MODULE_ID:       ionrift-respite          # ← CHANGE
MODULE_PATH:     modules/ionrift-respite  # ← CHANGE
SCRIPT_ROOT:     scripts/
TEST_COMMAND:                             # ← CHANGE or leave blank
CADENCE:         nightly                  # ← CHANGE to 'weekly' when ready
LOOKBACK:        24h                      # ← CHANGE to '7d' when weekly
OUTPUT_PATH:     ionrift-brand/Workspace/bug_audit/
# ───────────────────────────────────────────────────────────────────────

Fetch the full brief from:
https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/bug-finder.md

Follow it exactly, substituting the config values above wherever the brief uses {MODULE_ID}, {MODULE_PATH}, {TEST_COMMAND}, {CADENCE}, {LOOKBACK}, {OUTPUT_PATH}.
```

---

## 3. Test Coverage Shim

```
# ── Automation Config ──────────────────────────────────────────────────
MODULE_ID:       ionrift-respite          # ← CHANGE
MODULE_PATH:     modules/ionrift-respite  # ← CHANGE
SCRIPT_ROOT:     scripts/
TEST_ROOT:       scripts/tests/
TEST_COMMAND:                             # ← CHANGE or leave blank
CADENCE:         nightly                  # ← CHANGE to 'weekly' when ready
OUTPUT_PATH:     ionrift-brand/Workspace/test_coverage/
# ───────────────────────────────────────────────────────────────────────

Fetch the full brief from:
https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/test-coverage.md

Follow it exactly, substituting the config values above wherever the brief uses {MODULE_ID}, {MODULE_PATH}, {SCRIPT_ROOT}, {TEST_ROOT}, {TEST_COMMAND}, {CADENCE}, {OUTPUT_PATH}.
```

---

## 4. Adapter Audit Shim

```
# ── Automation Config ──────────────────────────────────────────────────
MODULE_ID:           ionrift-respite            # ← CHANGE
MODULE_PATH:         modules/ionrift-respite    # ← CHANGE
LIBRARY_PATH:        modules/ionrift-library
ADAPTER_ROOT:        scripts/adapters/
TEST_COMMAND:        node scripts/tests/AdapterTests.js  # ← CHANGE or leave blank
CADENCE:             nightly                    # ← CHANGE to 'weekly' when ready
REFERENCE_SYSTEM:    dnd5e
REFERENCE_SYSTEM_CLASS: DnD5e
AUDIT_SYSTEM:        pf2e                       # ← CHANGE (e.g. 'daggerheart')
AUDIT_SYSTEM_CLASS:  PF2e                       # ← CHANGE (e.g. 'Daggerheart')
OUTPUT_PATH:         ionrift-brand/Workspace/adapter_audit/

# Module-specific known gaps (agent verifies and extends each run):
KNOWN_GAPS:
  -                                             # ← CHANGE: add module-specific gaps
FEATURE_OPPORTUNITIES:
  -                                             # ← CHANGE: list system-native features to evaluate
# ───────────────────────────────────────────────────────────────────────

Fetch the full brief from:
https://raw.githubusercontent.com/ionrift-gm/ionrift-library/main/.cursor/automation-briefs/adapter-audit.md

Follow it exactly, substituting the config values above wherever the brief uses substitution tokens.
```

---

## Switching to Weekly

When you're ready to drop a module from nightly to weekly, change **two fields only**:

```yaml
CADENCE:   weekly   # was: nightly
LOOKBACK:  7d       # was: 24h  (bug-finder only)
```

No brief edits needed.

---

## Adding a New Module

Copy the relevant shim(s), change `MODULE_ID` and `MODULE_PATH`. Done.
