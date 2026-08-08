import { describe, it, expect, beforeEach } from "vitest";
import { localize, format } from "../../utils/I18n.js";
import { resetTranslations } from "../setup/foundryI18nMock.js";

describe("I18n", () => {
    beforeEach(() => {
        resetTranslations({
            "IONRIFT.LIBRARY.TEST.Hello": "Hello",
            "IONRIFT.LIBRARY.TEST.HelloName": "Hello, {name}"
        });
    });

    it("localizes known keys", () => {
        expect(localize("IONRIFT.LIBRARY.TEST.Hello")).toBe("Hello");
    });

    it("returns key when missing", () => {
        expect(localize("IONRIFT.LIBRARY.TEST.Missing")).toBe("IONRIFT.LIBRARY.TEST.Missing");
    });

    it("formats interpolations", () => {
        expect(format("IONRIFT.LIBRARY.TEST.HelloName", { name: "GM" })).toBe("Hello, GM");
    });
});
