import { ClassifierValidatorApp } from "./ClassifierValidatorApp.js";
import { Logger } from "../../services/platform/Logger.js";

/**
 * @deprecated Attunement Protocol has been retired and consolidated into the Entity Manifest.
 * Use ClassifierValidatorApp directly.
 */
export class CreatureIndexSetupApp extends ClassifierValidatorApp {
    constructor(options = {}) {
        super(options);
        Logger.warn("Library", "CreatureIndexSetupApp is deprecated. Opening Entity Manifest (ClassifierValidatorApp).");
    }
}
