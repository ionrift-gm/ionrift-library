import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["scripts/tests/**/*.test.js"],
        setupFiles: ["scripts/tests/setup/install.js"]
    }
});
