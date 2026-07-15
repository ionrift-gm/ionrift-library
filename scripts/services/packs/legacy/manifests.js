export const FORCE_MODE_OPTIONS = ["auto", "v13-button", "v14-advisory", "forge-readonly", "hide"];

export const LEGACY_MANIFESTS = {
    "ionrift-resonance": [
        {
            id: "resonance-prepack-sounds",
            removedInVersion: "2.7.0",
            kind: "media",
            label: "Duplicate copy in module folder",
            description: "An older Resonance install left a copy of the sound files inside the module folder. Your active sounds are already loading from ionrift-data/resonance/. The duplicate under modules/ionrift-resonance/sounds/pack/ is unused and can be removed to free about 78 MB.",
            paths: ["modules/ionrift-resonance/sounds/pack"],
            preserve: [],
            estimatedBytes: 78 * 1024 * 1024
        }
    ]
};
