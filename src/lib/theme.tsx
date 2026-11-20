import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";

export const THEMES = ["classic-blue", "dark", "emerald"] as const;
export type AppTheme = (typeof THEMES)[number];

const DEFAULT_THEME: AppTheme = "classic-blue";
const STORAGE_PREFIX = "leadflow.theme";
const THEME_COLORS: Record<AppTheme, string> = {
  "classic-blue": "#1e3a8a",
  dark: "#60a5fa",
  emerald: "#047857",
};

function isAppTheme(value: unknown): value is AppTheme {
  return typeof value === "string" && THEMES.includes(value as AppTheme);
}

function storageKey(userId: string | null) {
  return `${STORAGE_PREFIX}.${userId ?? "guest"}`;
}

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(DEFAULT_THEME);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    function applyUserTheme(user: { id: string; user_metadata?: Record<string, unknown> } | null) {
      if (!active) return;
      const id = user?.id ?? null;
      setUserId(id);
      const stored = window.localStorage.getItem(storageKey(id));
      const profileTheme = user?.user_metadata?.["theme"];
      setThemeState(
        isAppTheme(stored) ? stored : isAppTheme(profileTheme) ? profileTheme : DEFAULT_THEME,
      );
    }

    void supabase.auth.getSession().then(({ data }) => applyUserTheme(data.session?.user ?? null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => applyUserTheme(session?.user ?? null), 0);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[theme]);
  }, [theme]);

  const setTheme = useCallback(
    (next: AppTheme) => {
      setThemeState(next);
      window.localStorage.setItem(storageKey(userId), next);
      if (userId) void supabase.auth.updateUser({ data: { theme: next } }).catch(() => undefined);
    },
    [userId],
  );

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
