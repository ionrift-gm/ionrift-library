import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig({
    root: repoRoot,
    test: {
        globals: true,
        setupFiles: ["./tests/mocks/foundry.js"],
        include: ["tests/**/*.test.js"]
    }
});
