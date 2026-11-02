/**
 * Stateless viewport transform compositor and peripheral screen vignette service.
 *
 * Coordinates `#board` CSS transforms across concurrent channels (`drift` and `shake`)
 * so ambient camera drift (`ionrift-qol`) and impact/hazard screen shake
 * (`ionrift-bloodshed`, `ionrift-puzzles`) compose cleanly without overwriting
 * each other's DOM transform.
 */
export class ViewportService {
    static _initialized = false;

    static _drift = {
        active: false,
        x: 0,
        y: 0,
        rotation: 0
    };

    static _sway = {
        active: false,
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1
    };

    static _shake = {
        active: false,
        startTime: 0,
        duration: 0,
        strength: 0,
        maxRotation: 0,
        seedX: 0,
        seedY: 0,
        seedR: 0,
        x: 0,
        y: 0,
        rotation: 0
    };

    static _shakeRafId = null;
    static _vignetteEl = null;
    static _vignetteDecayTimeout = null;
    static _vignetteResetTimeout = null;
    static _activeVignetteOpacity = 0;

    static _boundOnVisibilityChange = null;
    static _boundOnPageHide = null;

    static init() {
        if (this._initialized) return;
        this._initialized = true;

        this._ensureStyles();

        this._boundOnVisibilityChange = () => {
            if (document.hidden) {
                this.stopShake();
                this.resetVignette();
            }
        };
        this._boundOnPageHide = () => {
            this.stopShake();
            this.resetVignette();
        };

        if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
            document.addEventListener("visibilitychange", this._boundOnVisibilityChange);
        }
        if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("pagehide", this._boundOnPageHide);
        }
        if (typeof Hooks !== "undefined" && typeof Hooks.on === "function") {
            Hooks.on("canvasTearDown", () => {
                this.resetTransform();
                this.resetVignette();
            });
        }
    }

    static _ensureStyles() {
        if (typeof document === "undefined" || !document.head) return;
        if (document.getElementById("ionrift-viewport-styles")) return;

        const style = document.createElement("style");
        style.id = "ionrift-viewport-styles";
        style.textContent = `
#ionrift-damage-vignette {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 5;
    opacity: 0;
    background: radial-gradient(
        circle at center,
        transparent 45%,
        var(--ionrift-vignette-mid, rgba(130, 0, 0, 0.38)) 78%,
        var(--ionrift-vignette-edge, rgba(190, 0, 0, 0.82)) 100%
    );
    box-shadow: inset 0 0 90px var(--ionrift-vignette-glow, rgba(220, 20, 20, 0.45));
    mix-blend-mode: multiply;
    will-change: opacity, transform;
}
`;
        document.head.appendChild(style);
    }

    /**
     * Update the ambient drift channel offsets (in screen pixels / degrees)
     * and compose with any active impact shake.
     *
     * @param {object} [offsets]
     * @param {number} [offsets.x=0]
     * @param {number} [offsets.y=0]
     * @param {number} [offsets.rotation=0]
     */
    static setDrift({ x = 0, y = 0, rotation = 0 } = {}) {
        const nx = Number.isFinite(x) ? x : 0;
        const ny = Number.isFinite(y) ? y : 0;
        const nr = Number.isFinite(rotation) ? rotation : 0;
        this._drift.x = nx;
        this._drift.y = ny;
        this._drift.rotation = nr;
        this._drift.active = Math.abs(nx) >= 0.001 || Math.abs(ny) >= 0.001 || Math.abs(nr) >= 0.0001;
        this._applyComposedTransform();
    }

    /**
     * Clear the ambient drift channel while preserving any in-flight impact shake.
     */
    static resetDrift() {
        this._drift.active = false;
        this._drift.x = 0;
        this._drift.y = 0;
        this._drift.rotation = 0;
        this._applyComposedTransform();
    }

    /**
     * Update the disorientation sway channel offsets (used by Near-Death / Knockout sensory state)
     * and compose cleanly with ambient drift and impact shake.
     *
     * @param {object} [offsets]
     * @param {number} [offsets.x=0]
     * @param {number} [offsets.y=0]
     * @param {number} [offsets.rotation=0]
     * @param {number} [offsets.scale=1]
     */
    static setSway({ x = 0, y = 0, rotation = 0, scale = 1 } = {}) {
        const nx = Number.isFinite(x) ? x : 0;
        const ny = Number.isFinite(y) ? y : 0;
        const nr = Number.isFinite(rotation) ? rotation : 0;
        const ns = Number.isFinite(scale) && scale > 0.5 ? scale : 1;
        this._sway.x = nx;
        this._sway.y = ny;
        this._sway.rotation = nr;
        this._sway.scale = ns;
        this._sway.active = Math.abs(nx) >= 0.001
            || Math.abs(ny) >= 0.001
            || Math.abs(nr) >= 0.0001
            || Math.abs(ns - 1) >= 0.0005;
        this._applyComposedTransform();
    }

    /**
     * Clear the disorientation sway channel while preserving ambient drift and impact shake.
     */
    static resetSway() {
        this._sway.active = false;
        this._sway.x = 0;
        this._sway.y = 0;
        this._sway.rotation = 0;
        this._sway.scale = 1;
        this._applyComposedTransform();
    }

    /**
     * Stop any active screen shake immediately while preserving ambient drift.
     */
    static stopShake() {
        if (this._shakeRafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this._shakeRafId);
            this._shakeRafId = null;
        }
        this._shake.active = false;
        this._shake.x = 0;
        this._shake.y = 0;
        this._shake.rotation = 0;
        this._applyComposedTransform();
    }

    /**
     * Reset drift, sway, and shake channels and clear `#board` transform.
     */
    static resetTransform() {
        if (this._shakeRafId !== null && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(this._shakeRafId);
            this._shakeRafId = null;
        }
        this._drift.active = false;
        this._drift.x = 0;
        this._drift.y = 0;
        this._drift.rotation = 0;
        this._sway.active = false;
        this._sway.x = 0;
        this._sway.y = 0;
        this._sway.rotation = 0;
        this._sway.scale = 1;
        this._shake.active = false;
        this._shake.x = 0;
        this._shake.y = 0;
        this._shake.rotation = 0;

        if (typeof document !== "undefined") {
            const board = document.getElementById("board");
            if (board) {
                board.style.transform = "";
                board.style.willChange = "";
            }
        }
    }

    static _applyComposedTransform() {
        if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
        const board = document.getElementById("board");
        if (!board) return;

        const totalX = (this._drift.x || 0) + (this._sway.x || 0) + (this._shake.x || 0);
        const totalY = (this._drift.y || 0) + (this._sway.y || 0) + (this._shake.y || 0);
        const totalRot = (this._drift.rotation || 0) + (this._sway.rotation || 0) + (this._shake.rotation || 0);
        const scale = Number.isFinite(this._sway.scale) ? this._sway.scale : 1;
        const hasScale = Math.abs(scale - 1) >= 0.0005;

        if (Math.abs(totalX) < 0.001 && Math.abs(totalY) < 0.001 && Math.abs(totalRot) < 0.0001 && !hasScale) {
            board.style.transform = "";
            if (!this._drift.active && !this._sway.active && !this._shake.active) {
                board.style.willChange = "";
            }
            return;
        }

        board.style.willChange = "transform";
        const scaleSuffix = hasScale ? ` scale(${scale.toFixed(4)})` : "";
        board.style.transform = `translate3d(${totalX.toFixed(2)}px, ${totalY.toFixed(2)}px, 0) rotate(${totalRot.toFixed(3)}deg)${scaleSuffix}`;
    }

    /**
     * Check whether world coordinates `(x, y)` are within the current client's visible canvas bounds.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} [pad=150] Padding in screen pixels
     * @returns {boolean}
     */
    static isPointInView(x, y, pad = 150) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return true;
        if (typeof canvas === "undefined" || !canvas?.ready || !canvas?.stage) return true;

        const stage = canvas.stage;
        const scale = stage.scale?.x || 1;
        const screenW = typeof window !== "undefined" ? (window.innerWidth || 1920) : 1920;
        const screenH = typeof window !== "undefined" ? (window.innerHeight || 1080) : 1080;

        const viewW = screenW / scale;
        const viewH = screenH / scale;
        const center = stage.pivot || { x: 0, y: 0 };

        const padWorld = pad / scale;
        const left = center.x - (viewW / 2) - padWorld;
        const right = center.x + (viewW / 2) + padWorld;
        const top = center.y - (viewH / 2) - padWorld;
        const bottom = center.y + (viewH / 2) + padWorld;

        return x >= left && x <= right && y >= top && y <= bottom;
    }

    /**
     * Trigger a damped harmonic screen shake on `#board`.
     * Rapid successive calls compound smoothly without resetting phase.
     *
     * @param {object} [options]
     * @param {number} [options.strength=15] Max displacement in pixels
     * @param {number} [options.duration=400] Shake duration in ms
     * @param {number} [options.rotation=0.8] Max rotational displacement in degrees
     * @param {{x: number, y: number}|null} [options.origin=null] Optional world coordinate origin for viewport culling
     * @returns {boolean} True if shake was triggered
     */
    static shake({ strength = 15, duration = 400, rotation = 0.8, origin = null } = {}) {
        if (typeof document !== "undefined" && document.hidden) return false;
        this._ensureStyles();

        if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
            if (!this.isPointInView(origin.x, origin.y, 150)) return false;
        }

        const safeStrength = Math.max(0, Number(strength) || 0);
        const safeDuration = Math.max(50, Number(duration) || 400);
        const safeRotation = Math.max(0, Number(rotation) || 0);
        if (safeStrength <= 0 && safeRotation <= 0) return false;

        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const s = this._shake;

        if (s.active) {
            const elapsed = Math.max(0, now - s.startTime);
            const progress = Math.min(1, elapsed / Math.max(1, s.duration));
            const remainingRatio = Math.pow(1 - progress, 2);

            const currentStrength = s.strength * remainingRatio;
            const currentRot = s.maxRotation * remainingRatio;
            const remainingTime = Math.max(0, s.duration - elapsed);

            s.strength = Math.min(45, currentStrength + (safeStrength * 0.85));
            s.duration = Math.min(1400, Math.max(safeDuration, remainingTime, 300));
            s.maxRotation = Math.min(3.0, currentRot + (safeRotation * 0.85));
            s.startTime = now;
            return true;
        }

        s.active = true;
        s.startTime = now;
        s.duration = Math.min(1400, safeDuration);
        s.strength = Math.min(45, safeStrength);
        s.maxRotation = Math.min(3.0, safeRotation);
        s.seedX = Math.random() * 100;
        s.seedY = Math.random() * 100;
        s.seedR = Math.random() * 100;

        this._startShakeLoop();
        return true;
    }

    /**
     * Trigger an AoE blast wave shake with viewport culling and distant shockwave attenuation.
     *
     * @param {object} [options]
     * @param {number} [options.x] World X coordinate of the blast centroid
     * @param {number} [options.y] World Y coordinate of the blast centroid
     * @param {number} [options.strength=22]
     * @param {number} [options.duration=650]
     * @param {number} [options.rotation=1.4]
     * @param {number} [options.severity=0.55]
     * @param {boolean} [options.flashVignette=false]
     * @param {number} [options.vignetteDuration=700]
     * @param {string|null} [options.color=null]
     * @returns {{ triggered: boolean, attenuated: boolean, attenuation?: number }}
     */
    static shakeForAoe({
        x,
        y,
        strength = 22,
        duration = 650,
        rotation = 1.4,
        severity = 0.55,
        flashVignette = false,
        vignetteDuration = 700,
        color = null
    } = {}) {
        if (typeof document !== "undefined" && document.hidden) {
            return { triggered: false, attenuated: false };
        }

        const hasCoords = Number.isFinite(x) && Number.isFinite(y);
        const inView = !hasCoords || this.isPointInView(x, y, 250);

        if (inView) {
            const shook = this.shake({ strength, duration, rotation });
            if (flashVignette) {
                this.flashVignette({ severity, duration: vignetteDuration, color });
            }
            return { triggered: shook, attenuated: false };
        }

        if (typeof canvas !== "undefined" && canvas?.ready && canvas?.stage) {
            const center = canvas.stage.pivot || { x: 0, y: 0 };
            const dx = x - center.x;
            const dy = y - center.y;
            const dist = Math.hypot(dx, dy);

            const scale = canvas.stage.scale?.x || 1;
            const screenW = typeof window !== "undefined" ? (window.innerWidth || 1920) : 1920;
            const screenH = typeof window !== "undefined" ? (window.innerHeight || 1080) : 1080;
            const viewW = screenW / scale;
            const viewH = screenH / scale;
            const maxShockwaveDist = Math.max(viewW, viewH) * 1.3;

            if (dist <= maxShockwaveDist && maxShockwaveDist > 0) {
                const attenuation = Math.pow(1 - (dist / maxShockwaveDist), 1.5);
                if (attenuation >= 0.15) {
                    const shook = this.shake({
                        strength: strength * attenuation * 0.65,
                        duration: duration * 0.85,
                        rotation: rotation * attenuation * 0.5
                    });
                    return { triggered: shook, attenuated: true, attenuation };
                }
            }
        }

        return { triggered: false, attenuated: false };
    }

    static _startShakeLoop() {
        if (this._shakeRafId !== null) return;

        const step = (now) => {
            const s = this._shake;
            if (!s.active) {
                this._shakeRafId = null;
                this._applyComposedTransform();
                return;
            }

            if (typeof document !== "undefined" && document.hidden) {
                this.stopShake();
                return;
            }

            const ts = Number.isFinite(now)
                ? now
                : (typeof performance !== "undefined" ? performance.now() : Date.now());
            const elapsed = Math.max(0, ts - s.startTime);

            if (elapsed >= s.duration) {
                s.active = false;
                s.x = 0;
                s.y = 0;
                s.rotation = 0;
                this._shakeRafId = null;
                this._applyComposedTransform();
                return;
            }

            const progress = elapsed / Math.max(1, s.duration);
            const decay = Math.pow(1 - progress, 2.2);
            const freq = 0.045;

            s.x = (
                Math.sin(elapsed * freq + s.seedX) * 0.7 +
                Math.cos(elapsed * (freq * 2.3) + s.seedY) * 0.3
            ) * s.strength * decay;

            s.y = (
                Math.cos(elapsed * (freq * 1.1) + s.seedY) * 0.7 +
                Math.sin(elapsed * (freq * 1.9) + s.seedX) * 0.3
            ) * s.strength * decay;

            s.rotation = (
                Math.sin(elapsed * (freq * 0.85) + s.seedR)
            ) * s.maxRotation * decay;

            this._applyComposedTransform();

            if (typeof requestAnimationFrame === "function") {
                this._shakeRafId = requestAnimationFrame(step);
            } else {
                s.active = false;
                s.x = 0;
                s.y = 0;
                s.rotation = 0;
                this._shakeRafId = null;
                this._applyComposedTransform();
            }
        };

        if (typeof requestAnimationFrame === "function") {
            this._shakeRafId = requestAnimationFrame(step);
        } else {
            // Immediate synchronous tick fallback for non-RAF test environments
            const s = this._shake;
            s.x = s.strength * 0.5;
            s.y = s.strength * 0.35;
            s.rotation = s.maxRotation * 0.5;
            this._applyComposedTransform();
        }
    }

    static _ensureVignetteElement() {
        if (typeof document === "undefined" || !document.body) return null;
        this._ensureStyles();

        let el = document.getElementById("ionrift-damage-vignette");
        if (!el) {
            el = document.createElement("div");
            el.id = "ionrift-damage-vignette";
            document.body.appendChild(el);
        }
        this._vignetteEl = el;
        return el;
    }

    /**
     * Trigger a peripheral damage/trauma vignette flash.
     *
     * @param {object} [options]
     * @param {number} [options.severity=0.5] Normalized trauma severity (0.0 to 1.0)
     * @param {number} [options.duration=600] Total decay duration in ms
     * @param {string|null} [options.color=null] Optional CSS color override for non-crimson flashes
     * @returns {boolean} True if vignette flash was triggered
     */
    static flashVignette({ severity = 0.5, duration = 600, color = null } = {}) {
        if (typeof document !== "undefined" && document.hidden) return false;

        const safeSeverity = Math.max(0.05, Math.min(1.5, Number(severity) || 0.5));
        const safeDuration = Math.max(150, Math.min(3000, Number(duration) || 600));

        let targetOpacity;
        if (this._activeVignetteOpacity > 0.05) {
            targetOpacity = Math.min(0.95, Math.max(0.25, this._activeVignetteOpacity + (safeSeverity * 0.65)));
        } else {
            targetOpacity = Math.min(0.95, Math.max(0.25, safeSeverity * 0.85));
        }

        const scaleSpread = Math.max(1.0, 1.08 - (safeSeverity * 0.08));
        this._activeVignetteOpacity = targetOpacity;

        const el = this._ensureVignetteElement();
        if (!el) return true;

        if (color && typeof color === "string") {
            el.style.setProperty("--ionrift-vignette-mid", color);
            el.style.setProperty("--ionrift-vignette-edge", color);
            el.style.setProperty("--ionrift-vignette-glow", color);
        } else {
            el.style.removeProperty("--ionrift-vignette-mid");
            el.style.removeProperty("--ionrift-vignette-edge");
            el.style.removeProperty("--ionrift-vignette-glow");
        }

        if (this._vignetteDecayTimeout) clearTimeout(this._vignetteDecayTimeout);
        if (this._vignetteResetTimeout) clearTimeout(this._vignetteResetTimeout);

        const attackMs = 60;
        const decayMs = Math.max(150, safeDuration - attackMs);

        el.style.transition = `opacity ${attackMs}ms cubic-bezier(0.1, 0.9, 0.2, 1), transform ${attackMs}ms ease-out`;
        el.style.opacity = `${targetOpacity}`;
        el.style.transform = `scale(${scaleSpread})`;

        this._vignetteDecayTimeout = setTimeout(() => {
            if (!this._vignetteEl) return;
            this._vignetteEl.style.transition = `opacity ${decayMs}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform ${decayMs}ms ease-in-out`;
            this._vignetteEl.style.opacity = "0";
            this._vignetteEl.style.transform = "scale(1.05)";
            this._activeVignetteOpacity = 0;

            this._vignetteResetTimeout = setTimeout(() => {
                if (!this._vignetteEl) return;
                this._vignetteEl.style.transition = "none";
                this._vignetteEl.style.transform = "scale(1)";
            }, decayMs + 50);
        }, attackMs);

        return true;
    }

    /**
     * Immediately clear any active vignette flash.
     */
    static resetVignette() {
        if (this._vignetteDecayTimeout) {
            clearTimeout(this._vignetteDecayTimeout);
            this._vignetteDecayTimeout = null;
        }
        if (this._vignetteResetTimeout) {
            clearTimeout(this._vignetteResetTimeout);
            this._vignetteResetTimeout = null;
        }
        this._activeVignetteOpacity = 0;
        if (typeof document !== "undefined") {
            const el = this._vignetteEl || document.getElementById("ionrift-damage-vignette");
            if (el) {
                el.style.transition = "none";
                el.style.opacity = "0";
                el.style.transform = "scale(1)";
            }
        }
    }
}
