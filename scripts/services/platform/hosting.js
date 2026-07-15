/** Host platform flags. Do not branch on ForgeVTT elsewhere; use PlatformHelper. */

export function isForge() {
    return (typeof ForgeVTT !== "undefined" && ForgeVTT.usingTheForge === true);
}

// Sqyre browse does not list freshly written files; prefer browse-free paths there.
export function isSqyre() {
    const hostname = globalThis.window?.location?.hostname;
    if (!hostname) return false;
    return /\.sqyre\.app$/i.test(hostname);
}
