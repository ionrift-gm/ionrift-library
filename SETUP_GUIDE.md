# Ionrift Setup Guide

Getting started with the Ionrift module suite. Covers installation, first-time setup, and common issues.

## Installation

Install from the Foundry VTT package manager in this order:

1. **Ionrift Library** (required by all other Ionrift modules)
2. **Ionrift Resonance** (combat sounds) or any other Ionrift module

Library must be installed and active before any other Ionrift module will work. If Library is missing or disabled, dependent modules will fail silently during startup.

## First-Time Setup

After installing, two separate setup wizards are available. They do different things.

| Module | Settings Section | Button Label | What it does |
|--------|-----------------|--------------|--------------|
| Ionrift Library | Ionrift Library | **Begin Attunement** | Indexes creature data for classification (skeleton, dragon, etc). No sound configuration here. |
| Ionrift Resonance | Ionrift Resonance | **Open Attunement Protocol** | Sound preset selection and optional Syrinscape connection. This is where you pick the SFX Pack. |

These are under **Game Settings > Module Settings**, listed separately. Make sure you scroll to the correct module section.

### Library Setup (Creature Index)

1. Open **Game Settings > Module Settings > Ionrift Library**
2. Click **Begin Attunement**
3. Walk through the three steps: Ingest Core Data, Scan Expansion Modules, Integrity Verification
4. Done. The creature classifier is now active.

### Resonance Setup (Sound Configuration)

1. Open **Game Settings > Module Settings > Ionrift Resonance**
2. Click **Open Attunement Protocol**
3. **Step 1 - Sound Provider**: Connect Syrinscape (optional). If you only want local sounds, leave the token blank and click "Skip" or "Verify" to proceed in Local-Only mode.
4. **Step 2 - Apply Sound Preset**: Select **"Ionrift SFX Pack"** to activate ~400 built-in sounds. This is the step most users are looking for.
5. **Step 3 - Final Verification**: Confirm and finish.

If you don't see an "Ionrift Resonance" section in Module Settings at all, see Troubleshooting below.

## Checking Versions

Open **Game Settings > Manage Modules**. Each module shows its version number on the right side of the entry. When reporting bugs, include:

- Foundry version and build number (shown on the login screen and in Settings)
- Game system and version (e.g. DnD5e 5.2.5)
- Ionrift Library version
- Ionrift Resonance version (or whichever module is affected)

## Troubleshooting

### "I don't see the SFX Pack option"

You're probably in the Library wizard, not the Resonance wizard. The Library's "Begin Attunement" shows creature indexing steps (Ingest Core Data, Scan Expansion Modules, Integrity Verification). The SFX Pack is in Resonance's "Open Attunement Protocol" under a different settings section. Scroll down in Module Settings to find the **Ionrift Resonance** section.

### "Ionrift Resonance doesn't appear in Module Settings"

The module is crashing during startup before it can register its settings. This usually means a JavaScript error in the init sequence.

To diagnose:
1. Press **F12** to open the browser Developer Console
2. Click the **Console** tab
3. Press **F5** to reload the page
4. Look for red error lines mentioning `ionrift` or `resonance`
5. Screenshot those errors or copy the text

Common causes:
- Missing dependency (Library not installed or disabled)
- Module conflict with another installed module
- Corrupted download (try reinstalling from the package manager)

### "Sounds aren't playing during combat"

Check these in order:
1. **Preset active?** Open Module Settings > Ionrift Resonance. Is the Sound Preset set to "Ionrift SFX Pack" or "Fantasy"? If it says "None", run the Attunement Protocol again.
2. **DnD5e users: Midi-QOL installed?** Resonance needs Midi-QOL for DnD5e automation. Without it, only basic attack roll sounds work.
3. **Midi-QOL workflow settings**: Open Midi-QOL settings > Workflow. Enable "Auto Apply Damage to Target" so HP changes trigger pain/death sounds.
4. **Volume**: Check Foundry's audio settings (Interface volume slider).

### "I see errors in the console"

When reporting errors, include:
1. The full error text (red lines in the Console tab)
2. What you were doing when it happened
3. Your module versions (see Checking Versions above)

Post to the [Ionrift Discord](https://discord.gg/vFGXf7Fncj) or open a [GitHub Issue](https://github.com/ionrift-gm/ionrift-resonance/issues).

## Getting Help

- **Discord**: [discord.gg/vFGXf7Fncj](https://discord.gg/vFGXf7Fncj) - bug reports, questions, feature requests
- **Patreon**: [patreon.com/ionrift](https://patreon.com/ionrift) - dev updates, early access

---
*Part of the [Ionrift Module Suite](https://github.com/ionrift-gm).*
