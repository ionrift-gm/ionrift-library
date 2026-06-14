import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

/**
 * Universal Tabletop System (MetaMorphic Digital).
 * Player characters are "token" actors, not the conventional "character" type.
 */
export class UniversalTabletopAdapter extends IonriftSystemAdapter {
    get systemId() { return "universal-tabletop-system"; }

    isPlayerCharacter(actor) {
        if (!actor?.hasPlayerOwner) return false;
        return actor.type === "token";
    }
}
