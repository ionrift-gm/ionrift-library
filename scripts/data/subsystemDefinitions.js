import { MODULE_ID } from "./moduleId.js";

export const SUBSYSTEM_DEFINITIONS = {
    entityManifest: {
        key: "validatorMenu",
        name: "Entity Manifest",
        consumers: ["ionrift-resonance", "ionrift-monstrous-feast", "ionrift-qol"],
        consumerLabels: {
            "ionrift-resonance": "Resonance",
            "ionrift-monstrous-feast": "Monstrous Feast",
            "ionrift-qol": "Quality of Life"
        },
        consumerIcons: {
            "ionrift-resonance": "fas fa-volume-high",
            "ionrift-monstrous-feast": "fas fa-drumstick-bite",
            "ionrift-qol": "fas fa-wand-magic-sparkles"
        }
    },
    tokenManifest: {
        key: "avatarManifest",
        name: "Token Manifest",
        consumers: ["ionrift-civics", "ionrift-cloud"],
        consumerLabels: {
            "ionrift-civics": "Civics",
            "ionrift-cloud": "Cloud"
        },
        consumerIcons: {
            "ionrift-civics": "fas fa-landmark",
            "ionrift-cloud": "fas fa-cloud"
        }
    },
    customTerrains: {
        key: "terrainManager",
        name: "Custom Terrains",
        consumers: ["ionrift-respite", "ionrift-quartermaster"],
        consumerLabels: {
            "ionrift-respite": "Respite",
            "ionrift-quartermaster": "Quartermaster"
        },
        consumerIcons: {
            "ionrift-respite": "fas fa-campground",
            "ionrift-quartermaster": "fas fa-coins"
        }
    },
    partyRoster: {
        key: "partyRosterMenu",
        name: "Party Roster",
        consumers: ["ionrift-respite", "ionrift-quartermaster", "ionrift-qol"],
        consumerLabels: {
            "ionrift-respite": "Respite",
            "ionrift-quartermaster": "Quartermaster",
            "ionrift-qol": "Quality of Life"
        },
        consumerIcons: {
            "ionrift-respite": "fas fa-campground",
            "ionrift-quartermaster": "fas fa-coins",
            "ionrift-qol": "fas fa-wand-magic-sparkles"
        }
    }
};

// Backward compatibility alias for legacy callers without polluting Object.entries
Object.defineProperty(SUBSYSTEM_DEFINITIONS, "creatureIndex", {
    get() { return SUBSYSTEM_DEFINITIONS.entityManifest; },
    enumerable: false,
    configurable: true
});

/**
 * Returns visibility, active consumer names, and dormancy state for a subsystem.
 * @param {string} subsystemKey
 * @returns {{ visible: boolean, isActive: boolean, activeConsumers: string[], dormantConsumers: string[], activeConsumerDetails: { id: string, name: string, icon: string }[], dormantConsumerDetails: { id: string, name: string, icon: string }[] }}
 */
export function getSubsystemStatus(subsystemKey) {
    const key = subsystemKey === "creatureIndex" ? "entityManifest" : subsystemKey;
    const def = SUBSYSTEM_DEFINITIONS[key];
    if (!def) {
        return {
            visible: true,
            isActive: true,
            activeConsumers: [],
            dormantConsumers: [],
            activeConsumerDetails: [],
            dormantConsumerDetails: []
        };
    }

    const activeIds = def.consumers.filter(id => Boolean(game.modules?.get?.(id)?.active));
    const dormantIds = def.consumers.filter(id => !game.modules?.get?.(id)?.active);

    return {
        visible: activeIds.length > 0,
        isActive: activeIds.length > 0,
        activeConsumers: activeIds.map(id => def.consumerLabels[id] || id),
        dormantConsumers: dormantIds.map(id => def.consumerLabels[id] || id),
        activeConsumerDetails: activeIds.map(id => ({
            id,
            name: def.consumerLabels[id] || id,
            icon: def.consumerIcons?.[id] || "fas fa-cube"
        })),
        dormantConsumerDetails: dormantIds.map(id => ({
            id,
            name: def.consumerLabels[id] || id,
            icon: def.consumerIcons?.[id] || "fas fa-cube"
        }))
    };
}
