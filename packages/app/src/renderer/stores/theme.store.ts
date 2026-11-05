import { defineStore } from "pinia";
import { getCachedUserLocalSettings, patchUserLocalSettings } from "../domain/localSettings";
import { translate } from "../i18n/translate";

export type AppThemeName = "light" | "pink" | "dark" | "tech" | "hacker";
export type AppThemeTone = "light" | "dark";
export type AppThemeDefinition = {
  id: AppThemeName;
  label: string;
  tone: AppThemeTone;
};
type ThemeTransitionOrigin = {
  x: number;
  y: number;
};

const DEFAULT_THEME: AppThemeName = "light";
export const APP_THEME_DEFINITIONS: readonly AppThemeDefinition[] = [
  { id: "light", label: "topbarExtra.themeLight", tone: "light" },
  { id: "pink", label: "topbarExtra.themePink", tone: "light" },
  { id: "dark", label: "topbarExtra.themeDark", tone: "dark" },
  { id: "tech", label: "topbarExtra.themeTech", tone: "dark" },
  { id: "hacker", label: "topbarExtra.themeHacker", tone: "dark" },
] as const;
export const APP_THEME_ORDER: readonly AppThemeName[] = APP_THEME_DEFINITIONS.map((theme) => theme.id);
const APP_THEME_BY_ID = new Map<AppThemeName, AppThemeDefinition>(
  APP_THEME_DEFINITIONS.map((theme) => [theme.id, theme])
);

function normalizeTheme(value: unknown): AppThemeName | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (APP_THEME_BY_ID.has(raw as AppThemeName)) return raw as AppThemeName;
  return null;
}

function themeTone(theme: AppThemeName): AppThemeTone {
  return APP_THEME_BY_ID.get(theme)?.tone ?? "dark";
}

export function themeLabelFor(theme: AppThemeName): string {
  const labelKey = APP_THEME_BY_ID.get(theme)?.label ?? "";
  return labelKey ? translate(labelKey) : theme;
}

function applyThemeToDocument(theme: AppThemeName): void {
  try {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.tone = themeTone(theme);
  } catch {}
}

function supportsThemeViewTransition(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return typeof document.startViewTransition === "function";
}

function clampTransitionCoordinate(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

function resolveTransitionMetrics(origin?: ThemeTransitionOrigin): {
  x: number;
  y: number;
  radius: number;
} {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const fallbackX = viewportWidth / 2;
  const fallbackY = viewportHeight / 2;
  const x = clampTransitionCoordinate(origin?.x ?? fallbackX, viewportWidth);
  const y = clampTransitionCoordinate(origin?.y ?? fallbackY, viewportHeight);
  const radius = Math.ceil(Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y)));
  return {
    x,
    y,
    radius: Math.max(radius, 0),
  };
}

function playThemeViewTransition(applyTheme: () => void, origin?: ThemeTransitionOrigin): void {
  if (!supportsThemeViewTransition()) {
    applyTheme();
    return;
  }

  const { x, y, radius } = resolveTransitionMetrics(origin);
  const style = document.documentElement.style;
  style.setProperty("--theme-transition-x", `${x}px`);
  style.setProperty("--theme-transition-y", `${y}px`);
  style.setProperty("--theme-transition-radius", `${radius}px`);

  const cleanup = () => {
    style.removeProperty("--theme-transition-x");
    style.removeProperty("--theme-transition-y");
    style.removeProperty("--theme-transition-radius");
  };

  try {
    const transition = document.startViewTransition(() => {
      applyTheme();
    });
    void transition.finished.then(cleanup, cleanup);
  } catch (error) {
    cleanup();
    applyTheme();
    console.warn("[theme] startViewTransition failed", error);
  }
}

export const useThemeStore = defineStore("theme", {
  state: () => ({
    theme: DEFAULT_THEME as AppThemeName,
    ready: false,
  }),
  getters: {
    isLight(state): boolean {
      return themeTone(state.theme) === "light";
    },
  },
  actions: {
    initTheme() {
      const cached = getCachedUserLocalSettings();
      this.theme = normalizeTheme(cached.settings.ui.theme) ?? DEFAULT_THEME;
      this.ready = true;
      applyThemeToDocument(this.theme);
      if (!cached.exists) {
        void patchUserLocalSettings({
          ui: {
            theme: this.theme,
          },
        });
      }
    },
    setTheme(next: AppThemeName, opts?: { save?: boolean; transitionOrigin?: ThemeTransitionOrigin }) {
      const shouldSave = opts?.save ?? true;
      const normalized = normalizeTheme(next) ?? DEFAULT_THEME;
      playThemeViewTransition(() => {
        this.theme = normalized;
        applyThemeToDocument(this.theme);
      }, opts?.transitionOrigin);
      if (!shouldSave) return;
      void patchUserLocalSettings({ ui: { theme: normalized } });
    },
    cycleTheme(order: readonly AppThemeName[] = APP_THEME_ORDER, opts?: { transitionOrigin?: ThemeTransitionOrigin }) {
      const fallback = APP_THEME_ORDER;
      const list = Array.isArray(order) && order.length > 0 ? order : fallback;
      const idx = list.indexOf(this.theme);
      const next = idx >= 0 ? list[(idx + 1) % list.length] : list[0];
      this.setTheme(next, { transitionOrigin: opts?.transitionOrigin });
    },
  },
});
