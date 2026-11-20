import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ar, en, type DictKey } from "./i18n-dict";

export type Lang = "ar" | "en";
const STORAGE_KEY = "leadflow.lang";

type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: DictKey, vars?: Vars): string {
  const dict = lang === "ar" ? ar : en;
  let s = dict[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

interface I18nValue {
  lang: Lang;
  dir: "rtl" | "ltr";
  locale: string;
  setLang: (lang: Lang) => void;
  t: (key: DictKey, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // SSR renders Arabic (the default); the stored preference is applied after hydration.
  const [lang, setLangState] = useState<Lang>("ar");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ar") setLangState(stored);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      // Latin digits keep phone numbers and amounts unambiguous in both languages.
      locale: lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB",
      setLang,
      t: (key, vars) => translate(lang, key, vars),
    }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
