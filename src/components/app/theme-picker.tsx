import { useId } from "react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  return (
    <div className={compact ? "shrink-0" : "grid gap-2"}>
      {!compact && <Label htmlFor={id}>{t("themeSetting")}</Label>}
      <NativeSelect
        id={id}
        aria-label={t("themeSetting")}
        value={theme}
        className={compact ? "h-9 w-[108px] text-xs sm:w-[142px] sm:text-sm" : "w-full"}
        onChange={(event) => setTheme(event.target.value as typeof theme)}
      >
        <option value="classic-blue">{t("themeClassicBlue")}</option>
        <option value="dark">{t("themeDark")}</option>
        <option value="emerald">{t("themeEmerald")}</option>
      </NativeSelect>
    </div>
  );
}
