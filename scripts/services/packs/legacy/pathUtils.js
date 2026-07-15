import { PlatformHelper } from "../../platform/PlatformHelper.js";

export function browseTargetMatches(browseTarget, requestedPath) {
    if (!browseTarget) return true;
    const norm = (p) => (p ?? "").replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
    return norm(browseTarget) === norm(requestedPath);
}

export function compareVersions(a, b) {
    const parse = (v) => String(v ?? "0")
        .split("-")[0]
        .split(".")
        .map(n => parseInt(n, 10) || 0);
    const aa = parse(a);
    const bb = parse(b);
    const len = Math.max(aa.length, bb.length);
    for (let i = 0; i < len; i++) {
        const x = aa[i] ?? 0;
        const y = bb[i] ?? 0;
        if (x !== y) return x - y;
    }
    return 0;
}

export async function pathHasContent(path) {
    const FP = PlatformHelper.FP;
    if (!FP) return false;
    const src = PlatformHelper.fileSource;
    try {
        const browse = await FP.browse(src, path);
        const target = browse?.target ?? "";
        if (!browseTargetMatches(target, path)) return false;
        const fileCount = browse?.files?.length ?? 0;
        const dirCount = browse?.dirs?.length ?? 0;
        return fileCount > 0 || dirCount > 0;
    } catch {
        return false;
    }
}

/** True when ionrift-data carries a Resonance pack with manifest.json. */
export async function resonanceHasLivePack() {
    const FP = PlatformHelper.FP;
    if (!FP) return false;
    const src = PlatformHelper.fileSource;
    const roots = [
        "ionrift-data/resonance/packs",
        "ionrift-data/overlays/ionrift-resonance"
    ];

    for (const root of roots) {
        let rootBrowse;
        try {
            rootBrowse = await FP.browse(src, root);
        } catch {
            continue;
        }

        const rootTarget = rootBrowse?.target ?? "";
        if (!browseTargetMatches(rootTarget, root)) continue;

        for (const dirUrl of rootBrowse?.dirs ?? []) {
            const dirName = dirUrl.split("/").filter(Boolean).pop();
            if (!dirName) continue;
            try {
                const subBrowse = await FP.browse(src, `${root}/${dirName}`);
                const files = subBrowse?.files ?? [];
                if (files.some(f => f.split("/").pop() === "manifest.json")) {
                    return true;
                }
            } catch {
                /* next */
            }
        }
    }
    return false;
}
