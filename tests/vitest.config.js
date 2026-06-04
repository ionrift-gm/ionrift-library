import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        root: resolve(import.meta.dirname, ".."),
        include: ["tests/**/*.test.js"],
        globals: false
    }
});
