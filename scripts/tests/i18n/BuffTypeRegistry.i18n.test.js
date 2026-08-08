import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetTranslations } from "../setup/foundryI18nMock.js";

describe("BuffTypeRegistry i18n", () => {
    beforeEach(() => {
        vi.resetModules();
        resetTranslations({
            "IONRIFT.LIBRARY.BUFF.TempHP": "Временные хиты",
            "IONRIFT.LIBRARY.BUFF.Healing": "Лечение",
            "IONRIFT.LIBRARY.BUFF.ExhaustionSave": "Спасбросок от истощения",
            "IONRIFT.LIBRARY.BUFF.HitDie": "Кость хитов",
            "IONRIFT.LIBRARY.BUFF.AdvantageOnSaves": "Преимущество на спасброски",
            "IONRIFT.LIBRARY.BUFF.DamageResistance": "Сопротивление урону",
            "IONRIFT.LIBRARY.BUFF.Darkvision": "Тёмное зрение",
            "IONRIFT.LIBRARY.BUFF.AdvantageOnAbilityChecks": "Преимущество на проверки характеристик",
            "IONRIFT.LIBRARY.BUFF.AdvantageOnSkillChecks": "Преимущество на проверки навыков",
            "IONRIFT.LIBRARY.BUFF.PassivePerceptionBonus": "Бонус к пассивному Восприятию",
            "IONRIFT.LIBRARY.BUFF.AbilityCheckBonus": "Бонус к проверке характеристики",
            "IONRIFT.LIBRARY.BUFF.SavingThrowBonusLimitedUses": "Бонус к спасброску (ограниченное число использований)"
        });
    });

    it("resolves temp_hp label through i18n", async () => {
        const { TYPES } = await import("../../services/cooking/buffs/BuffTypeRegistry.js");
        expect(TYPES.get("temp_hp").label).toBe("Временные хиты");
    });

    it("resolves all built-in buff type labels through i18n", async () => {
        const { TYPES } = await import("../../services/cooking/buffs/BuffTypeRegistry.js");
        expect(TYPES.get("heal").label).toBe("Лечение");
        expect(TYPES.get("exhaustion_save").label).toBe("Спасбросок от истощения");
        expect(TYPES.get("hit_die").label).toBe("Кость хитов");
        expect(TYPES.get("advantage").label).toBe("Преимущество на спасброски");
        expect(TYPES.get("resistance").label).toBe("Сопротивление урону");
        expect(TYPES.get("sense_darkvision").label).toBe("Тёмное зрение");
        expect(TYPES.get("check_advantage").label).toBe("Преимущество на проверки характеристик");
        expect(TYPES.get("skill_advantage").label).toBe("Преимущество на проверки навыков");
        expect(TYPES.get("passive_perception").label).toBe("Бонус к пассивному Восприятию");
        expect(TYPES.get("ability_bonus").label).toBe("Бонус к проверке характеристики");
        expect(TYPES.get("save_bonus").label).toBe("Бонус к спасброску (ограниченное число использований)");
    });

    it("registerBuffType resolves labelKey at registration time", async () => {
        const { TYPES, registerBuffType } = await import("../../services/cooking/buffs/BuffTypeRegistry.js");
        registerBuffType("custom_buff", {
            labelKey: "IONRIFT.LIBRARY.BUFF.TempHP",
            render() {
                return { changes: [], description: "", summaryLine: "", daeSpecialDuration: [] };
            }
        });
        expect(TYPES.get("custom_buff").label).toBe("Временные хиты");
    });
});
