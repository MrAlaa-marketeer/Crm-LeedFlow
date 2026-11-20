import { Languages } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useI18n, type Lang } from "@/lib/i18n";

export function LanguageToggle({
  onChange,
  variant = "outline",
  className,
}: {
  onChange?: (lang: Lang) => void;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const { lang, setLang, t } = useI18n();
  const next: Lang = lang === "ar" ? "en" : "ar";
  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={className}
      lang={next}
      aria-label={`${t("language")}: ${t("switchLanguage")}`}
      onClick={() => {
        setLang(next);
        onChange?.(next);
      }}
    >
      <Languages aria-hidden="true" />
      {t("switchLanguage")}
    </Button>
  );
}
