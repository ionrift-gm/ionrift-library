/**
 * PartyRoster
 * Authoritative party membership service. Stores a GM-curated actor ID list
 * in world settings. Consumer modules call the static API instead of
 * maintaining their own roster logic.
 *
 * From Foundry v14 onward, systems ship a native party feature (e.g. the dnd5e
 * primary-party Group actor). When one is configured, this service defers
 * membership to that native source and stops consulting the curated setting.
 * On v13, or on v14 with no native party set, the GM-curated roster remains
 * authoritative. The active system adapter owns the native-source binding.
 *
 * API:
 *   game.ionrift.library.party.getMembers()    → Actor[]
 *   game.ionrift.library.party.getRosterIds()   → string[]
 *   game.ionrift.library.party.isRostered(id)   → boolean
 *
 * Fires `ionrift.partyChanged` hook when the roster is saved.
 */

const LIB_ID = "ionrift-library";

export class PartyRoster {

    /**
     * Native party members resolved via the active system adapter, gated on
     * Foundry v14+. Returns null when not on v14, when the adapter has no
     * native source, or when no native party is configured (caller falls back
     * to the curated roster). A non-null array means the native party is
     * authoritative and should be deferred to.
     * @returns {Actor[]|null}
     */
    /**
     * True on Foundry v14 or later, where systems own party management.
     * @returns {boolean}
     */
    static isV14() {
        return (game.release?.generation ?? 0) >= 14;
    }

    static nativeMembers() {
        if (!this.isV14()) return null;
        const adapter = game.ionrift?.library?.system?.current;
        if (!adapter?.getNativePartyMembers) return null;
        try {
            return adapter.getNativePartyMembers();
        } catch {
            return null;
        }
    }

    /**
     * True when a system-native party is active and authoritative (v14+ with
     * a configured native source). In this mode the curated roster setting and
     * its editor UI are bypassed in favour of the native feature.
     * @returns {boolean}
     */
    static nativePartyActive() {
        return Array.isArray(this.nativeMembers());
    }

    /**
     * Open the system's native party management UI. Delegates to the active
     * adapter. Returns true if the adapter handled it.
     * @returns {boolean}
     */
    static openNativeManagement() {
        const adapter = game.ionrift?.library?.system?.current;
        return adapter?.openNativePartyManagement?.() ?? false;
    }

    /**
     * Bridge native party changes to the `ionrift.partyChanged` hook so
     * downstream UIs refresh when the GM edits the system's native party. Only
     * relevant on v14+; idempotent. On v13 the curated editor already fires the
     * hook via setRoster(), so this is a no-op there.
     */
    static installNativePartyBridge() {
        if (this._bridgeInstalled) return;
        if (!this.isV14()) return;
        const adapter = game.ionrift?.library?.system?.current;
        if (!adapter?.watchNativeParty) return;
        this._bridgeInstalled = true;
        adapter.watchNativeParty(() => {
            Hooks.callAll("ionrift.partyChanged", this.getMembers());
        });
    }

    /**
     * Returns the current party as resolved Actor documents.
     * When a system-native party is active (v14+ dnd5e with a primary party
     * configured), returns the native members when present. When the native
     * party is configured but empty, falls back to the curated roster, then
     * player-owned characters. Systems without native party support (PF2e,
     * Daggerheart) always use the curated roster regardless of Foundry version.
     * @returns {Actor[]}
     */
    static getMembers() {
        const native = this.nativeMembers();

        // v14 with a configured native party (including empty): trust native first, then curated.
        // Player-owned fallback is reserved for v13 and v14 worlds without a primary party set.
        if (this.isV14() && Array.isArray(native)) {
            if (native.length) return native;
            const ids = this._settingIds();
            if (ids.length) return ids.map(id => game.actors.get(id)).filter(Boolean);
            return [];
        }

        if (native?.length) return native;

        const ids = this._settingIds();
        if (ids.length) return ids.map(id => game.actors.get(id)).filter(Boolean);

        return game.actors.filter(a => {
            if (!a.hasPlayerOwner) return false;
            return a.type === "character" || a.system?.isCharacter;
        });
    }

    /**
     * True when this world uses the dnd5e v14 primary-party Group on Foundry v14+.
     * @returns {boolean}
     */
    static usesDnd5eNativeParty() {
        return this.isV14()
            && game.system?.id === "dnd5e"
            && game.actors?.party !== undefined;
    }

    /**
     * Setup diagnostics for empty-party UI and non-blocking GM warnings.
     * v14 dnd5e surfaces primary-party states; v13 and below use curated roster copy.
     * @returns {{
     *   isV14: boolean,
     *   usesNativeParty: boolean,
     *   emptyParty: boolean,
     *   reason: string|null,
     *   warning: string|null
     * }}
     */
    static getSetupState() {
        const members = this.getMembers();
        const emptyParty = members.length === 0;

        if (!this.usesDnd5eNativeParty()) {
            return {
                isV14: this.isV14(),
                usesNativeParty: false,
                emptyParty,
                reason: emptyParty ? "no_characters" : null,
                warning: null
            };
        }

        const primary = game.actors.party;
        const groups = game.actors.filter(a => a.type === "group");
        const primaryPcCount = primary?.system?.playerCharacters?.length ?? 0;
        const alternateGroup = groups.find(
            g => g.id !== primary?.id && (g.system?.playerCharacters?.length ?? 0) > 0
        );

        if (emptyParty) {
            if (!primary && groups.length) {
                return {
                    isV14: true,
                    usesNativeParty: true,
                    emptyParty: true,
                    reason: "no_primary_party",
                    warning: null
                };
            }
            if (!primary) {
                return {
                    isV14: true,
                    usesNativeParty: true,
                    emptyParty: true,
                    reason: "no_party_group",
                    warning: null
                };
            }
            if (primaryPcCount === 0) {
                return {
                    isV14: true,
                    usesNativeParty: true,
                    emptyParty: true,
                    reason: "primary_party_empty",
                    warning: null
                };
            }
            return {
                isV14: true,
                usesNativeParty: true,
                emptyParty: true,
                reason: "no_characters",
                warning: null
            };
        }

        let warning = null;
        if (!primary && members.length) {
            warning = "no_primary_party";
        } else if (alternateGroup && primaryPcCount === 0) {
            warning = "no_primary_party";
        }

        return {
            isV14: true,
            usesNativeParty: true,
            emptyParty: false,
            reason: null,
            warning
        };
    }

    /**
     * Returns the active party's actor IDs. When a system-native party is
     * active, returns the native member IDs. Otherwise returns the curated
     * setting IDs; an empty array means "no explicit roster" (fallback mode).
     * @returns {string[]}
     */
    static getRosterIds() {
        const native = this.nativeMembers();
        if (native) return native.map(a => a.id);
        return this._settingIds();
    }

    /**
     * Raw curated-roster IDs straight from the world setting, ignoring any
     * native party. Internal use only; consumers should call getRosterIds().
     * @returns {string[]}
     */
    static _settingIds() {
        try {
            return game.settings.get(LIB_ID, "partyRoster") ?? [];
        } catch {
            return [];
        }
    }

    /**
     * Quick membership check.
     * When a system-native party is active, checks native membership directly.
     * Otherwise checks the stored roster; in fallback mode (empty roster),
     * checks hasPlayerOwner instead.
     * @param {string} actorId
     * @returns {boolean}
     */
    static isRostered(actorId) {
        const native = this.nativeMembers();
        if (native) return native.some(a => a.id === actorId);

        const ids = this._settingIds();
        if (ids.length) return ids.includes(actorId);
        const actor = game.actors.get(actorId);
        return !!(actor?.hasPlayerOwner && actor?.type === "character");
    }

    /**
     * Persist a new roster and fire the change hook.
     * GM-only; silently no-ops for players. When a system-native party is
     * active, no-ops and points the GM at the native UI rather than writing
     * the (now vestigial) curated setting.
     * @param {string[]} actorIds
     */
    static async setRoster(actorIds) {
        if (!game.user.isGM) return;
        if (this.nativePartyActive()) {
            ui.notifications?.info("Party membership is managed by the system's native party. Use the party sheet to change members.");
            return;
        }
        await game.settings.set(LIB_ID, "partyRoster", actorIds);
        Hooks.callAll("ionrift.partyChanged", this.getMembers());
    }

    /**
     * One-time migration: seeds the library roster from Respite's setting
     * if the library roster is empty and Respite has one.
     * Called during ready hook, GM only.
     */
    static async migrateFromRespite() {
        if (!game.user.isGM) return;

        const libRoster = this._settingIds();
        if (libRoster.length) return;

        const migrated = game.settings.get(LIB_ID, "partyRosterMigrated");
        if (migrated) return;

        try {
            const respiteRoster = game.settings.get("ionrift-respite", "partyRoster");
            if (respiteRoster?.length) {
                await game.settings.set(LIB_ID, "partyRoster", respiteRoster);
                console.log(`Ionrift | PartyRoster: migrated ${respiteRoster.length} actors from Respite`);
            }
        } catch {
            // Respite not active or setting not registered; skip silently
        }

        await game.settings.set(LIB_ID, "partyRosterMigrated", true);
    }
}
