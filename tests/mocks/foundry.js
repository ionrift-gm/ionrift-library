/**
 * Minimal Foundry globals for Vitest. classifyCreature resolves data via
 * getClassifierData(), which reads game.system.id at call time.
 */
globalThis.game = {
    system: { id: "dnd5e" }
};
