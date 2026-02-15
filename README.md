# Ionrift Library

**The Core Library.**

Shared utilities for the Ionrift ecosystem. It centralizes logic between modules to prevent code drift and fragmentation. **Ionrift Resonance** uses the library to classify a "Skeleton", ensuring consistent behavior across the suite.

## Features

### Creature Classifier
Standardizes actor data into concept IDs (`undead`, `construct`) and prompts.

**Usage:**
```javascript
// Check if library is active
if (game.ionrift?.library?.classifyCreature) {
    const result = game.ionrift.library.classifyCreature(actor.name);
    
    if (result.match) {
        console.log(result.id);       // e.g. "skeleton"
        console.log(result.visual);   // e.g. "undead skeleton, rotting bones..."
        console.log(result.sound);    // e.g. "MONSTER_SKELETON"
    }
}
```

### System Check
On `ready`, the library runs a self-diagnostic unit test to ensure the classification logic is performing as expected. Check the Console (F12) for the `[PASS]` report.

## Integration
To use this in your module, add it to your `module.json` dependencies:

```json
"relationships": {
    "requires": [
        { "id": "ionrift-library", "type": "module" }
    ]
}
```

---

## License
MIT License. See [LICENSE](./LICENSE) for details.


