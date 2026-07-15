import { IonriftSystemAdapter } from "../IonriftSystemAdapter.js";

export class DaggerheartAdapter extends IonriftSystemAdapter {
    get systemId() { return "daggerheart"; }

    getLevel(actor) {
        if (!actor) return 1;
        return actor.system?.level?.value ?? 1;
    }

    getClassNames(actor) {
        if (!actor) return [];
        const cls = actor.system?.class;
        return cls ? [cls] : [];
    }

    isPlayerCharacter(actor) {
        if (!actor) return false;
        return actor.hasPlayerOwner && actor.type === "character";
    }
}
