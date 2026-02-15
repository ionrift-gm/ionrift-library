const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(__dirname, '../dist');

// Configuration
const PUBLIC_REPO_URL = "https://github.com/ionrift-gm/ionrift-library";
const PUBLIC_DOWNLOAD_URL = "https://github.com/ionrift-gm/ionrift-library/releases/latest/download/module.zip";
const PUBLIC_MANIFEST_URL = "https://github.com/ionrift-gm/ionrift-library/releases/latest/download/module.json";

// Files/Dirs to Copy
const INCLUDE = [
    'styles',
    'templates',
    'scripts',
    'CHANGELOG.md',
    'LICENSE',
    'module.json',
    'README.md'
];

// Files to Exclude within directories
const EXCLUDE_FILES = [
    'build-public.js',
    '.git',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'node_modules'
];

/**
 * Main Build Function
 */
async function build() {
    console.log("Starting Build: Ionrift Library -> dist/");

    // 1. Clean Dist
    if (fs.existsSync(DIST_DIR)) {
        console.log("Cleaning dist/...");
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(DIST_DIR);

    // 2. Copy Files
    for (const item of INCLUDE) {
        const srcPath = path.join(SOURCE_DIR, item);
        const destPath = path.join(DIST_DIR, item);

        if (fs.existsSync(srcPath)) {
            copyRecursive(srcPath, destPath);
        } else {
            console.warn(`Warning: ${item} not found.`);
        }
    }

    // 3. Transform README.md (Strip Cloud/Privacy Section)
    transformReadme();

    // 4. Transform module.json (Update URLs)
    transformModuleJson();



    console.log("Build Complete! Contents ready in dist/");
}

// ... (copyRecursive, transformReadme, transformModuleJson remain same) ...



/**
 * Recursive Copy Helper
 */
function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest);
        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            if (EXCLUDE_FILES.includes(entry)) continue;
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
    } else {
        if (EXCLUDE_FILES.includes(path.basename(src))) return;
        fs.copyFileSync(src, dest);
    }
}

/**
 * Strips "Privacy & Cloud" section from README
 */
// 3. (Skipped) Transform README
// transformReadme();

/**
 * Updates module.json URLs
 */
function transformModuleJson() {
    const modulePath = path.join(DIST_DIR, 'module.json');
    if (!fs.existsSync(modulePath)) return;

    const moduleData = JSON.parse(fs.readFileSync(modulePath, 'utf8'));

    // Update URLs
    moduleData.url = PUBLIC_REPO_URL;
    moduleData.manifest = PUBLIC_MANIFEST_URL;
    moduleData.download = PUBLIC_DOWNLOAD_URL;

    // Optional: Remove any "cloud" specific flags if we added any
    // moduleData.flags = ...

    console.log("Updating module.json URLs to public repo.");
    fs.writeFileSync(modulePath, JSON.stringify(moduleData, null, 4), 'utf8');
}

build().catch(err => console.error(err));
