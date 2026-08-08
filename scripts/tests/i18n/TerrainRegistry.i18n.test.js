import { describe, it, expect, beforeEach } from "vitest";
import { TerrainRegistry } from "../../services/terrain/TerrainRegistry.js";
import { resetTranslations } from "../setup/foundryI18nMock.js";

describe("TerrainRegistry i18n", () => {
    beforeEach(() => {
        resetTranslations({
            "IONRIFT.LIBRARY.TERRAIN.Forest": "Лес",
            "IONRIFT.LIBRARY.TERRAIN.Swamp": "Болото",
            "IONRIFT.LIBRARY.TERRAIN.Desert": "Пустыня",
            "IONRIFT.LIBRARY.TERRAIN.Urban": "Город",
            "IONRIFT.LIBRARY.TERRAIN.Dungeon": "Подземелье"
        });
    });

    it("resolves base terrain labels through i18n", () => {
        const reg = new TerrainRegistry();
        const forest = reg.getBase().find((t) => t.id === "forest");
        expect(forest.label).toBe("Лес");
    });

    it("getBase stays canonical when register overrides a base id", () => {
        const reg = new TerrainRegistry();
        reg.register({ id: "forest", label: "Override" });

        const baseForest = reg.getBase().find((t) => t.id === "forest");
        expect(baseForest.label).toBe("Лес");
        expect(reg.get("forest").label).toBe("Override");
    });
});
