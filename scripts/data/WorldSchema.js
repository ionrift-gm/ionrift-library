export const WorldSchema = [
    { key: "origin", label: "Origin", group: "Basics", default: "Trade Post", inputName: "origin" },
    { key: "environment", label: "Environment", group: "Basics", default: "", inputName: "environment" },
    { key: "atmosphere", label: "Atmosphere", group: "Basics", default: "Bustling", inputName: "atmosphere" },

    { key: "architecture", label: "Architecture", group: "Society", default: "", inputClass: "settlement-architecture-input" },
    { key: "culture", label: "Culture", group: "Society", default: "", inputClass: "settlement-culture-input" },

    { key: "governmentType", label: "Government Type", group: "Government", default: "Autocracy", inputClass: "government-type-input" },
    { key: "rulerStatus", label: "Ruler Status", group: "Government", default: "Respected, fair, and just", inputClass: "ruler-status-input" },
    { key: "seatOfPower", label: "Seat of Power", group: "Government", default: "", inputClass: "seat-of-power-input" },
    { key: "fortification", label: "Fortification", group: "Defense", default: "Unfortified", inputClass: "settlement-fortification-input" },

    { key: "magicLevel", label: "Magic Level", group: "Faith & Magic", default: "Standard (Common, utility)", inputClass: "settlement-magic-input" },
    { key: "religion", label: "Religion", group: "Faith & Magic", default: "Polytheistic (Pantheon)", inputClass: "settlement-religion-input" },

    { key: "quality", label: "Quality", group: "Economy", default: "Prosperous", inputClass: "settlement-quality-input" },
    { key: "feature", label: "Feature", group: "Economy", default: "", inputClass: "settlement-feature-input" },

    { key: "crimeLevel", label: "Crime Level", group: "Flaws", default: "Average", inputClass: "crime-level-input" },
    { key: "lawEnforcement", label: "Law Enforcement", group: "Flaws", default: "City Watch", inputClass: "law-enforcement-input" },
    { key: "justiceSeverity", label: "Justice Severity", group: "Flaws", default: "Fair / Standard", inputClass: "justice-severity-input" }
];
