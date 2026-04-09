# Ionrift Library (Kernel) -- Backlog

Canonical backlog for the shared library module. Tracks kernel-level services, adapters, and cross-module infrastructure.

---

## Planned

### SystemAdapter Service
- [ ] **Abstract system-specific actor data queries into a shared adapter interface**
- [ ] Extract Arbiter's inline HP/resource/condition detection into formal adapter methods
- [ ] Add spell-related methods for Workshop's Spell Progression Seeder
- [ ] Auto-detect `game.system.id` on init and instantiate the correct adapter
- [ ] Expose via `game.modules.get('ionrift-library').api.system`

#### Proposed Interface

| Method | Role | Consumers |
|:---|:---|:---|
| `getHP(actor)` | Unified HP extraction | Arbiter |
| `getAbilityScores(actor)` | Ability score extraction | Arbiter |
| `getResourceScore(actor)` | Normalizes spell slots / Hope / Stress to -1..1 | Arbiter |
| `hasCondition(token, id)` | Standardized condition checks | Arbiter |
| `getSpellList(actor)` | Known/prepared spells for an actor | Workshop |
| `getClassSpellPool(className, level)` | Full spell list available to a class at a level | Workshop |
| `getCasterType(actor)` | "known" (Wizard/Sorc/Bard/Warlock) or "prepared" (Cleric/Druid/Paladin/Ranger) | Workshop |
| `getPartyTier(actors)` | Infer tier (1-4) from average party level | Workshop, Respite |

#### System Implementations Needed

| System | Adapter | Notes |
|:---|:---|:---|
| DnD5e | `Dnd5eAdapter` | Must handle v3/v4/v5.2.5 schema differences |
| Daggerheart | `DaggerheartAdapter` | Hope/Stress/Armor model, no spell slots |

#### Cross-Filed From
- Workshop BACKLOG.md (Spell Progression Seeder dependency)
- Arbiter KI (system_adapters.md, Phase 3 planned)

### Session Tracker Service
> **Consumer modules:** Workshop (Signature Ledger cadence gate), Respite (rest frequency analytics), future modules.
> **Cross-filed from:** Workshop BACKLOG.md (Phase 4/6 dependency)

- [ ] **Session detection heuristic**: 2+ players join the world AND 24+ hours since last recorded session
- [ ] **GM confirmation prompt**: Non-blocking dialog asking GM to confirm new session (avoids false positives from mid-week prep/testing)
- [ ] **Storage**: `sessionLog` world setting: `[{ id, date, number, players }]`
- [ ] **API**: Expose via `game.modules.get('ionrift-library').api.sessions`
  - `getSessionCount()` -- total sessions recorded
  - `getLastSession()` -- most recent session entry
  - `getSessionsSince(date)` -- sessions after a given date
  - `recordSession(playerIds)` -- manually log a session (GM utility)
- [ ] **Protection**: Setting is GM-only. Players cannot read or modify session history.

## Technical Debt

- [ ] **creatureClassifier.js (15KB)** -- Large file, may benefit from decomposition if additional classification categories are added
- [ ] **dnd5eData.js** -- Static data file with creature tags/sounds. Should be validated against current SRD

---

## Stable Services

- [x] Logger
- [x] DialogHelper
- [x] RuntimeValidator
- [x] SettingsLayout / SettingsStatusHelper
- [x] SidebarHelper
- [x] creatureClassifier
- [x] dnd5eData (static reference data)
