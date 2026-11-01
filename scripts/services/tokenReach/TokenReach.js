/**
 * Shared token-to-token reach checks for Ionrift modules.
 *
 * Delegates to the Arms Reach module API when present; otherwise measures on the
 * active scene grid with a configurable square limit and large-token allowance.
 */

const LIBRARY_ID = "ionrift-library";
const ARMS_REACH_ID = "arms-reach";

const SETTING_DEFAULT_SQUARES = "tokenReachDefaultSquares";
const SETTING_BYPASS_GM = "tokenReachBypassGM";
const SETTING_USE_GRID = "tokenReachUseGrid";

/**
 * @typedef {object} TokenReachResult
 * @property {boolean} ok
 * @property {string} provider "arms-reach" | "ionrift-library" | "skipped"
 * @property {number|null} [distance] Measured scene distance when available.
 * @property {number|null} [spaces] Measured grid spaces when available.
 * @property {number|null} [maxDistance] Applied distance cap in scene units.
 * @property {number|null} [maxSquares] Applied grid-space cap.
 * @property {string|null} [reason] Short failure reason for UI copy.
 */

function getSetting(key, fallback) {
    try {
        if (!game.settings?.settings?.has?.(`${LIBRARY_ID}.${key}`)) return fallback;
        return game.settings.get(LIBRARY_ID, key);
    } catch {
        return fallback;
    }
}

/**
 * @param {Token|object|null|undefined} token
 * @returns {{ x: number, y: number }|null}
 */
function tokenCenterPoint(token) {
    if (!token) return null;
    if (token.center && typeof token.center.x === "number" && typeof token.center.y === "number") {
        return { x: token.center.x, y: token.center.y };
    }
    if (typeof token.getCenterPoint === "function") {
        try {
            return token.getCenterPoint({ elevation: false });
        } catch {
            /* fall through */
        }
    }
    const doc = token.document ?? token;
    if (doc.documentName === "Wall" || Array.isArray(doc.c)) {
        const coords = doc.c ?? [];
        if (coords.length >= 4) {
            return {
                x: (Number(coords[0]) + Number(coords[2])) / 2,
                y: (Number(coords[1]) + Number(coords[3])) / 2
            };
        }
    }
    if (doc.documentName === "Region" || Array.isArray(doc.shapes)) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const grow = (x, y) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        };
        for (const shape of doc.shapes ?? []) {
            if (shape.hole) continue;
            if (shape.type === "rectangle") {
                grow(shape.x, shape.y);
                grow(shape.x + shape.width, shape.y + shape.height);
            } else if (shape.type === "circle") {
                grow(shape.x - shape.radius, shape.y - shape.radius);
                grow(shape.x + shape.radius, shape.y + shape.radius);
            } else if (shape.type === "ellipse") {
                grow(shape.x - shape.radiusX, shape.y - shape.radiusY);
                grow(shape.x + shape.radiusX, shape.y + shape.radiusY);
            } else if (Array.isArray(shape.points)) {
                for (let i = 0; i < shape.points.length; i += 2) {
                    grow(shape.points[i], shape.points[i + 1]);
                }
            }
        }
        if (Number.isFinite(minX)) {
            return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        }
        const bounds = doc.bounds ?? token.bounds;
        if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.width)) {
            return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
    }
    if (
        typeof doc.x === "number"
        && typeof doc.y === "number"
        && doc.width === undefined
        && doc.height === undefined
        && !doc.documentName
    ) {
        return { x: doc.x, y: doc.y };
    }
    const gridSize = canvas?.grid?.size ?? 100;
    const width = Number(doc.width ?? 1);
    const height = Number(doc.height ?? 1);
    return {
        x: Number(doc.x ?? 0) + (width * gridSize) / 2,
        y: Number(doc.y ?? 0) + (height * gridSize) / 2
    };
}

/**
 * Rough allowance so adjacent squares on large tokens or regions still count as in reach
 * when measuring center-to-center on the grid.
 * @param {Token|object} sourceToken
 * @param {Token|object} targetToken
 * @returns {number}
 */
function footprintAllowance(sourceToken, targetToken) {
    const sourceDoc = sourceToken?.document ?? sourceToken;
    const targetDoc = targetToken?.document ?? targetToken;
    const gridSize = Math.max(1, Number(canvas?.grid?.size ?? 100));
    const sourceSpan = Math.max(Number(sourceDoc?.width ?? 1), Number(sourceDoc?.height ?? 1));
    let targetSpan = Math.max(Number(targetDoc?.width ?? 1), Number(targetDoc?.height ?? 1));
    if (targetDoc?.documentName === "Region" || Array.isArray(targetDoc?.shapes)) {
        const b = targetDoc.bounds ?? targetToken?.bounds;
        if (b && Number.isFinite(b.width)) {
            targetSpan = Math.max(1, Math.max(b.width, b.height) / gridSize);
        }
    } else if (targetDoc?.widthPx && targetDoc?.heightPx) {
        targetSpan = Math.max(1, Math.max(Number(targetDoc.widthPx), Number(targetDoc.heightPx)) / gridSize);
    }
    return Math.max(0, (sourceSpan + targetSpan) / 2 - 0.5);
}

/**
 * @param {Token|object} sourceToken
 * @param {Token|object} targetToken
 * @param {number} [tolerance]
 * @returns {boolean}
 */
function elevationWithinTolerance(sourceToken, targetToken, tolerance = 5) {
    const sourceDoc = sourceToken?.document ?? sourceToken;
    const targetDoc = targetToken?.document ?? targetToken;
    const sourceLevel = sourceDoc?.level ?? sourceDoc?._source?.level ?? null;

    if (sourceLevel && targetDoc) {
        const targetIsRegion = targetDoc.documentName === "Region" || Array.isArray(targetDoc.shapes);
        if (targetIsRegion) {
            const targetLevels = targetDoc.levels instanceof Set
                ? targetDoc.levels
                : (Array.isArray(targetDoc._source?.levels) ? new Set(targetDoc._source.levels) : null);
            if (targetLevels && targetLevels.size > 0 && !targetLevels.has(sourceLevel)) {
                return false;
            }
        } else {
            const targetLevel = targetDoc.level ?? targetDoc._source?.level ?? null;
            if (targetLevel && targetLevel !== sourceLevel) {
                return false;
            }
        }
    }

    const sourceElevation = Number(sourceDoc?.elevation ?? 0);
    const rawTargetElev = targetDoc?.elevation ?? 0;
    if (typeof rawTargetElev === "object" && rawTargetElev !== null) {
        const bottom = Number.isFinite(rawTargetElev.bottom) ? rawTargetElev.bottom : -Infinity;
        const top = Number.isFinite(rawTargetElev.top) ? rawTargetElev.top : Infinity;
        return sourceElevation >= (bottom - tolerance) && sourceElevation <= (top + tolerance);
    }

    const targetElevation = Number(rawTargetElev);
    if (!Number.isFinite(targetElevation)) return true;
    return Math.abs(sourceElevation - targetElevation) <= tolerance;
}

/**
 * @param {object} [options]
 * @returns {number}
 */
function resolveMaxSquares(options = {}) {
    const fromOptions = Number(options.squares);
    if (Number.isFinite(fromOptions) && fromOptions > 0) return fromOptions;
    const fromSetting = Number(getSetting(SETTING_DEFAULT_SQUARES, 1));
    if (Number.isFinite(fromSetting) && fromSetting > 0) return fromSetting;
    return 1;
}

/**
 * @param {object} [options]
 * @returns {boolean}
 */
function resolveUseGrid(options = {}) {
    if (typeof options.useGrid === "boolean") return options.useGrid;
    return getSetting(SETTING_USE_GRID, true) !== false;
}

/**
 * @param {object} [options]
 * @returns {number}
 */
function resolveMaxDistance(options = {}, maxSquares = 1) {
    const fromOptions = Number(options.maxDistance);
    if (Number.isFinite(fromOptions) && fromOptions > 0) return fromOptions;
    const gridDistance = Number(canvas?.grid?.distance ?? 5);
    return maxSquares * gridDistance;
}

/**
 * @returns {object|null}
 */
function armsReachApi() {
    const mod = game.modules?.get?.(ARMS_REACH_ID);
    if (!mod?.active) return null;
    return mod.api ?? null;
}

/**
 * @param {Token|object|null|undefined} sourceToken
 * @param {Token|object|null|undefined} targetToken
 * @param {object} [options]
 * @returns {TokenReachResult}
 */
function measureFallbackReach(sourceToken, targetToken, options = {}) {
    const useGrid = resolveUseGrid(options);
    const maxSquares = resolveMaxSquares(options);
    const maxDistance = resolveMaxDistance(options, maxSquares);
    const allowance = footprintAllowance(sourceToken, targetToken);
    const allowedSpaces = maxSquares + allowance;

    if (!canvas?.grid || !canvas?.ready) {
        return {
            ok: false,
            provider: "ionrift-library",
            distance: null,
            spaces: null,
            maxDistance,
            maxSquares,
            reason: "no_scene"
        };
    }

    if (!elevationWithinTolerance(sourceToken, targetToken, options.elevationTolerance ?? 5)) {
        return {
            ok: false,
            provider: "ionrift-library",
            distance: null,
            spaces: null,
            maxDistance,
            maxSquares,
            reason: "elevation"
        };
    }

    const origin = tokenCenterPoint(sourceToken);
    const dest = tokenCenterPoint(targetToken);
    if (!origin || !dest) {
        return {
            ok: false,
            provider: "ionrift-library",
            distance: null,
            spaces: null,
            maxDistance,
            maxSquares,
            reason: "missing_token"
        };
    }

    let distance = null;
    let spaces = null;
    try {
        const measured = canvas.grid.measurePath([origin, dest], { gridSpaces: useGrid });
        distance = Number(measured?.distance ?? 0);
        spaces = Number(measured?.spaces ?? measured?.distance ?? 0);
    } catch {
        const dx = dest.x - origin.x;
        const dy = dest.y - origin.y;
        distance = Math.hypot(dx, dy);
        const gridSize = canvas.grid.size ?? 100;
        spaces = distance / gridSize;
    }

    const ok = useGrid
        ? spaces <= allowedSpaces
        : distance <= maxDistance;

    return {
        ok,
        provider: "ionrift-library",
        distance,
        spaces,
        maxDistance,
        maxSquares: allowedSpaces,
        reason: ok ? null : "distance"
    };
}

/**
 * @param {TokenReachResult} result
 * @param {object} [options]
 * @returns {string}
 */
export function reachFailureMessage(result, options = {}) {
    if (result?.ok) return "";
    if (options.message) return options.message;
    if (result?.reason === "elevation") {
        return "Too far above or below to reach.";
    }
    if (result?.reason === "missing_token") {
        return "Could not find both tokens on the scene.";
    }
    if (result?.reason === "no_scene") {
        return "The scene is not ready for reach checks.";
    }
    return "Move closer to reach that token.";
}

/**
 * Whether a user should bypass reach checks (GM by default).
 * @param {object} [options]
 * @returns {boolean}
 */
export function shouldBypassReach(options = {}) {
    if (typeof options.bypass === "boolean") return options.bypass;
    if (game.user?.isGM && getSetting(SETTING_BYPASS_GM, true) !== false) {
        return true;
    }
    return false;
}

/**
 * Check whether one token can reach another.
 * @param {Token|object|null|undefined} sourceToken
 * @param {Token|object|null|undefined} targetToken
 * @param {object} [options]
 * @param {number} [options.squares] Max grid squares before large-token allowance.
 * @param {number} [options.maxDistance] Scene-unit cap; overrides squares when set.
 * @param {boolean} [options.useGrid] Measure on the grid path.
 * @param {boolean} [options.bypass] Force pass/fail regardless of user role.
 * @param {string} [options.message] Custom failure message for callers.
 * @returns {TokenReachResult}
 */
export function canReachToken(sourceToken, targetToken, options = {}) {
    if (!sourceToken || !targetToken) {
        return {
            ok: false,
            provider: "skipped",
            distance: null,
            spaces: null,
            maxDistance: null,
            maxSquares: null,
            reason: "missing_token"
        };
    }

    if (sourceToken === targetToken || sourceToken.id === targetToken.id) {
        return {
            ok: true,
            provider: "skipped",
            distance: 0,
            spaces: 0,
            maxDistance: null,
            maxSquares: null,
            reason: null
        };
    }

    if (shouldBypassReach(options)) {
        return {
            ok: true,
            provider: "skipped",
            distance: null,
            spaces: null,
            maxDistance: null,
            maxSquares: null,
            reason: null
        };
    }

    const maxSquares = resolveMaxSquares(options);
    const maxDistance = resolveMaxDistance(options, maxSquares);
    const useGrid = resolveUseGrid(options);
    // Arms Reach has its own GM bypass, so it can't honour an explicit bypass:false.
    const api = options.bypass === false ? null : armsReachApi();

    if (typeof api?.isReachable === "function") {
        try {
            const ok = Boolean(api.isReachable(sourceToken, targetToken, maxDistance, useGrid));
            if (ok) {
                return {
                    ok: true,
                    provider: "arms-reach",
                    distance: null,
                    spaces: null,
                    maxDistance,
                    maxSquares,
                    reason: null
                };
            }
        } catch {
            /* fall through to measureFallbackReach */
        }
    }

    return measureFallbackReach(sourceToken, targetToken, { ...options, squares: maxSquares, useGrid, maxDistance });
}

/**
 * Check whether a token can reach any target (Token, Wall, Region, Tile, or `{ x, y }` world coordinate).
 * @param {Token|object|null|undefined} sourceToken
 * @param {Token|object|null|undefined} targetOrPoint
 * @param {object} [options]
 * @returns {TokenReachResult}
 */
export function canReachTarget(sourceToken, targetOrPoint, options = {}) {
    return canReachToken(sourceToken, targetOrPoint, options);
}

/**
 * Resolves the active user's primary avatar token on the current scene.
 * Prioritizes controlled character tokens, then the user's assigned character token,
 * then any character token owned by the user on the scene.
 *
 * @param {User} [user]
 * @param {Scene} [scene]
 * @returns {Token|TokenDocument|null}
 */
export function resolveUserToken(user = globalThis.game?.user, scene = globalThis.canvas?.scene) {
    if (!user || !scene) return null;
    const placeables = globalThis.canvas?.tokens?.placeables || [];
    const controlled = globalThis.canvas?.tokens?.controlled || [];

    if (controlled.length > 0) {
        const charControlled = controlled.find(t => t?.actor?.type === "character" && (t.actor?.isOwner || user.isGM));
        if (charControlled) return charControlled;
        if (!user.isGM && controlled[0]) return controlled[0];
    }

    const assignedActorId = user.character?.id || null;
    if (assignedActorId) {
        const assignedPlaceable = placeables.find(t => t?.actor?.id === assignedActorId);
        if (assignedPlaceable) return assignedPlaceable;
        const assignedDoc = scene.tokens?.find?.(t => t?.actorId === assignedActorId || t?.actor?.id === assignedActorId);
        if (assignedDoc) return assignedDoc.object || assignedDoc;
    }

    if (!user.isGM) {
        const ownedPlaceable = placeables.find(t => {
            const a = t?.actor;
            if (!a || a.type !== "character") return false;
            const perm = a.ownership?.[user.id] ?? t.document?.ownership?.[user.id] ?? 0;
            return perm >= 3 || Boolean(a.isOwner);
        });
        if (ownedPlaceable) return ownedPlaceable;
    }

    return null;
}

/**
 * Watches for token movement on the active scene and invokes `onOutOfReach(result, tokenDoc)`
 * whenever the watched source token moves beyond reach of the target.
 * Designed as a shared library offering so open interaction UIs (puzzles, locks, mechanisms)
 * automatically dismiss if a player's avatar wanders beyond reach.
 *
 * @param {object} config
 * @param {() => (Token|TokenDocument|null)} [config.getSourceToken]
 * @param {() => (Token|object|null)} config.getTarget
 * @param {object} [config.options] Reach options passed to `canReachTarget` (e.g. `{ squares: 2 }`).
 * @param {(result: TokenReachResult, tokenDoc: TokenDocument) => void} config.onOutOfReach
 * @returns {() => void} Cleanup function (`unwatch()`) to remove the hook listener.
 */
export function watchTokenReach({
    getSourceToken = () => resolveUserToken(),
    getTarget,
    options = {},
    onOutOfReach
} = {}) {
    if (typeof getTarget !== "function" || typeof onOutOfReach !== "function") {
        return () => {};
    }

    let fired = false;
    const onUpdateToken = (tokenDoc, change) => {
        if (fired) return;
        if (change?.x === undefined && change?.y === undefined && change?.elevation === undefined) {
            return;
        }
        if (shouldBypassReach(options)) return;

        const source = getSourceToken();
        if (!source) return;
        const sourceId = source.id ?? source.document?.id ?? null;
        const movedId = tokenDoc?.id ?? null;
        if (!sourceId || !movedId || sourceId !== movedId) return;

        const target = getTarget();
        if (!target) return;

        // Build a synthetic source snapshot with the newly committed coordinates so reach is evaluated
        // against the destination immediately even while the canvas placeable is still animating.
        const doc = tokenDoc;
        const updatedSource = {
            id: doc.id,
            document: doc,
            x: Number(change.x ?? doc.x ?? source.x ?? 0),
            y: Number(change.y ?? doc.y ?? source.y ?? 0),
            width: Number(doc.width ?? source.document?.width ?? source.width ?? 1),
            height: Number(doc.height ?? source.document?.height ?? source.height ?? 1),
            elevation: Number(change.elevation ?? doc.elevation ?? source.document?.elevation ?? 0)
        };

        const res = canReachTarget(updatedSource, target, options);
        if (!res.ok) {
            fired = true;
            onOutOfReach(res, tokenDoc);
        }
    };

    globalThis.Hooks?.on?.("updateToken", onUpdateToken);
    return () => {
        globalThis.Hooks?.off?.("updateToken", onUpdateToken);
    };
}

export const TokenReach = {
    ARMS_REACH_MODULE_ID: ARMS_REACH_ID,
    SETTING_DEFAULT_SQUARES,
    SETTING_BYPASS_GM,
    SETTING_USE_GRID,
    canReachToken,
    canReachTarget,
    resolveUserToken,
    watchTokenReach,
    shouldBypassReach,
    reachFailureMessage,
    _measureFallbackReach: measureFallbackReach
};
