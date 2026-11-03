import { describe, it, expect } from "vitest";
import {
  normalizeUserLocalSettings,
  mergeUserLocalSettings,
  normalizeUiLanguage,
  resolveUiFontSizeZoomFactor,
  DEFAULT_USER_LOCAL_SETTINGS,
} from "../localSettings";

describe("localSettings", () => {
  describe("normalizeUiLanguage", () => {
    it("normalizes en variants to en-US", () => {
      expect(normalizeUiLanguage("en")).toBe("en-US");
      expect(normalizeUiLanguage("en-US")).toBe("en-US");
      expect(normalizeUiLanguage("en-us")).toBe("en-US");
      expect(normalizeUiLanguage("EN")).toBe("en-US");
    });

    it("normalizes zh variants to zh-CN", () => {
      expect(normalizeUiLanguage("zh")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-CN")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-cn")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-Hans")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh_cn")).toBe("zh-CN");
      expect(normalizeUiLanguage("zh-Hans-CN")).toBe("zh-CN");
    });

    it("falls back to default for unknown locales", () => {
      expect(normalizeUiLanguage("fr")).toBe("zh-CN");
      expect(normalizeUiLanguage("")).toBe("zh-CN");
      expect(normalizeUiLanguage(null)).toBe("zh-CN");
      expect(normalizeUiLanguage(undefined)).toBe("zh-CN");
    });
  });

  describe("resolveUiFontSizeZoomFactor", () => {
    it("returns a positive number for valid presets", () => {
      expect(resolveUiFontSizeZoomFactor("small")).toBeGreaterThan(0);
      expect(resolveUiFontSizeZoomFactor("medium")).toBeGreaterThan(0);
      expect(resolveUiFontSizeZoomFactor("large")).toBeGreaterThan(0);
    });

    it("medium is between small and large", () => {
      const small = resolveUiFontSizeZoomFactor("small");
      const medium = resolveUiFontSizeZoomFactor("medium");
      const large = resolveUiFontSizeZoomFactor("large");
      expect(medium).toBeGreaterThan(small);
      expect(large).toBeGreaterThan(medium);
    });
  });

  describe("normalizeUserLocalSettings", () => {
    it("returns defaults when input is null/undefined", () => {
      expect(normalizeUserLocalSettings(null)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings(undefined)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });

    it("returns defaults when input is empty object", () => {
      expect(normalizeUserLocalSettings({})).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });

    it("preserves valid settings", () => {
      const result = normalizeUserLocalSettings({
        ui: { language: "en-US", mainView: "image", leftSidebarWidthPx: 400 },
      });
      expect(result.ui.language).toBe("en-US");
      expect(result.ui.mainView).toBe("image");
      expect(result.ui.leftSidebarWidthPx).toBe(400);
    });

    it("clamps numeric values into valid ranges", () => {
      const result = normalizeUserLocalSettings({
        notification: { soundVolumePercent: 200 },
      });
      expect(result.notification.soundVolumePercent).toBe(100);

      const result2 = normalizeUserLocalSettings({
        notification: { soundVolumePercent: -50 },
      });
      expect(result2.notification.soundVolumePercent).toBe(0);
    });

    it("rejects invalid baseUrl (missing scheme)", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "not-a-url" },
      });
      expect(result.imageGeneration.baseUrl).toBeNull();
    });

    it("accepts valid baseUrl with http/https", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "https://api.example.com/v1" },
      });
      expect(result.imageGeneration.baseUrl).toBe("https://api.example.com/v1");
    });

    it("strips trailing slashes from baseUrl", () => {
      const result = normalizeUserLocalSettings({
        imageGeneration: { baseUrl: "https://api.example.com/v1///" },
      });
      expect(result.imageGeneration.baseUrl).toBe("https://api.example.com/v1");
    });

    it("rejects invalid mainView values", () => {
      const result = normalizeUserLocalSettings({
        ui: { mainView: "invalid" },
      });
      expect(result.ui.mainView).toBe("chat");
    });

    it("handles non-object input gracefully", () => {
      expect(normalizeUserLocalSettings("string")).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings(42)).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
      expect(normalizeUserLocalSettings([])).toEqual(
        DEFAULT_USER_LOCAL_SETTINGS,
      );
    });
  });

  describe("mergeUserLocalSettings", () => {
    it("returns defaults when base and patch are null", () => {
      const result = mergeUserLocalSettings(null, null);
      expect(result).toEqual(DEFAULT_USER_LOCAL_SETTINGS);
    });

    it("merges ui patch into base", () => {
      const base = { ui: { language: "en-US" } };
      const patch = { ui: { mainView: "image" as const } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.ui.language).toBe("en-US");
      expect(result.ui.mainView).toBe("image");
    });

    it("merges imageGeneration patch", () => {
      const base = { imageGeneration: { enabled: true } };
      const patch = { imageGeneration: { model: "dall-e-3" } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.imageGeneration.enabled).toBe(true);
      expect(result.imageGeneration.model).toBe("dall-e-3");
    });

    it("setting apiKey to null clears it", () => {
      const base = { imageGeneration: { apiKey: "sk-test" } };
      const patch = { imageGeneration: { apiKey: null } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.imageGeneration.apiKey).toBeNull();
    });

    it("does not modify unrelated fields", () => {
      const base = {
        ui: { theme: "dark", language: "en-US" },
        notification: { soundVolumePercent: 80 },
      };
      const patch = { ui: { theme: "pink" } };
      const result = mergeUserLocalSettings(base, patch);
      expect(result.ui.theme).toBe("pink");
      expect(result.notification.soundVolumePercent).toBe(80);
    });
  });

});
