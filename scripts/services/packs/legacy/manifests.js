export const FORCE_MODE_OPTIONS = ["auto", "v13-button", "v14-advisory", "forge-readonly", "hide"];

export const LEGACY_MANIFESTS = {
    "ionrift-resonance": [
        {
            id: "resonance-prepack-sounds",
            removedInVersion: "2.7.0",
            kind: "media",
            label: "Duplicate copy in module folder",
            description: "An older Resonance install left sound files inside the module folder. They are unused duplicates and can be removed to free about 78 MB.",
            paths: ["modules/ionrift-resonance/sounds/pack"],
            preserve: [],
            estimatedBytes: 78 * 1024 * 1024
        }
    ]
};
